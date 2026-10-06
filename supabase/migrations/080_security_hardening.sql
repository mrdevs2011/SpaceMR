-- 080: Hard security pass (idempotent)
-- 1) story_views SELECT — faqat o'z views yoki story egasi
-- 2) verify_recovery_code — attempts + lockout (8)
-- 3) entity_tombstones — INSERT/UPDATE/DELETE authenticated dan yo'q (allaqachon)

drop policy if exists story_views_select on public.story_views;
create policy story_views_select on public.story_views
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.stories s
      where s.id = story_id and s.user_id = auth.uid()
    )
  );

alter table public.profiles
  add column if not exists recovery_attempts int not null default 0;

-- verify_recovery_code: lockout + attempts (return type: json)
create or replace function public.verify_recovery_code(p_username text, p_code text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_rec text;
  v_code text;
  v_exp timestamptz;
  v_masked text;
  v_len int;
  v_attempts int;
begin
  if p_username is null or p_code is null or trim(p_code) = '' then
    return json_build_object('valid', false);
  end if;

  select id, recovery_email, recovery_code, recovery_code_expires_at, coalesce(recovery_attempts, 0)
  into v_uid, v_rec, v_code, v_exp, v_attempts
  from public.profiles
  where username = lower(trim(p_username));

  if v_uid is null or v_code is null or v_exp is null then
    return json_build_object('valid', false);
  end if;

  if v_attempts >= 8 then
    return json_build_object('valid', false, 'locked', true);
  end if;

  if now() > v_exp then
    return json_build_object('valid', false, 'expired', true);
  end if;

  if lower(trim(v_code)) = lower(trim(p_code)) then
    update public.profiles set recovery_attempts = 0 where id = v_uid;
    if v_rec is not null then
      v_len := position('@' in v_rec);
      if v_len > 3 then
        v_masked := substr(v_rec, 1, 1) || '***' || substr(v_rec, v_len - 1);
      else
        v_masked := '***' || substr(v_rec, v_len);
      end if;
    end if;
    return json_build_object(
      'valid', true,
      'username', lower(trim(p_username)),
      'masked_email', v_masked
    );
  end if;

  update public.profiles
  set recovery_attempts = coalesce(recovery_attempts, 0) + 1
  where id = v_uid;

  return json_build_object('valid', false, 'attempts', v_attempts + 1);
end;
$$;

revoke all on function public.verify_recovery_code(text, text) from public;
revoke all on function public.verify_recovery_code(text, text) from anon;
grant execute on function public.verify_recovery_code(text, text) to anon, authenticated, service_role;

comment on policy story_views_select on public.story_views is '080: own views or story owner only';
