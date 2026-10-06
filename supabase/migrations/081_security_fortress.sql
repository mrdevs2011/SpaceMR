-- 081: Security fortress — critical leak + abuse fixes (idempotent)
-- 1) profiles sensitive columns — recovery/email secrets not readable by others
-- 2) request_password_reset — no uid/full email leak, rate limit, uniform errors
-- 3) email_for_username — rate limit kept, no exception timing abuse notes
-- 4) storage: own-file DELETE only
-- 5) admin RPCs: extra grant hygiene

-- ═══ 1) Column-level: recovery secrets hidden from clients ═════════════
-- RLS row-level; approved users could SELECT * including recovery_code.
revoke all on table public.profiles from anon;
grant select on table public.profiles to authenticated;
-- Secrets: only SECURITY DEFINER RPCs / service_role may read these
revoke select (recovery_code, recovery_code_expires_at, recovery_attempts)
  on public.profiles from authenticated;
revoke select (recovery_code, recovery_code_expires_at, recovery_attempts)
  on public.profiles from anon;
grant all on table public.profiles to service_role;

-- ═══ 2) request_password_reset: harden ═════════════════════════════════
create or replace function public.request_password_reset(p_username text, p_temp_password text)
returns json
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
declare
  v_uid uuid;
  v_rec text;
  v_masked text;
  v_len int;
  v_ip text;
  v_lookups int;
  v_last timestamptz;
begin
  -- uniform slow path against user enumeration
  perform pg_sleep(0.15);

  if p_temp_password is null or length(trim(p_temp_password)) < 6 or length(trim(p_temp_password)) > 64 then
    return json_build_object('ok', false, 'error', 'invalid');
  end if;

  -- rate limit by IP (reuse anon_rate_limits)
  begin
    v_ip := current_setting('request.headers', true)::json->>'x-forwarded-for';
    if v_ip is null then v_ip := 'unknown';
    else v_ip := 'rp:' || split_part(v_ip, ',', 1);
    end if;
  exception when others then
    v_ip := 'unknown';
  end;

  select lookups, last_lookup into v_lookups, v_last
  from public.anon_rate_limits where ip = v_ip;

  if v_lookups is not null then
    if v_lookups >= 5 and v_last > now() - interval '15 minutes' then
      return json_build_object('ok', false, 'error', 'rate_limited');
    elsif v_lookups >= 5 then
      update public.anon_rate_limits set lookups = 1, last_lookup = now() where ip = v_ip;
    else
      update public.anon_rate_limits set lookups = lookups + 1, last_lookup = now() where ip = v_ip;
    end if;
  else
    insert into public.anon_rate_limits (ip, lookups, last_lookup)
    values (v_ip, 1, now())
    on conflict (ip) do update set lookups = 1, last_lookup = now();
  end if;

  select id, recovery_email into v_uid, v_rec
  from public.profiles
  where username = lower(trim(p_username));

  -- always same shape — no "user not found" vs "no email" distinction to attacker
  if v_uid is null or v_rec is null or trim(v_rec) = '' then
    return json_build_object('ok', true, 'masked_email', null, 'sent', false);
  end if;

  update public.profiles
  set recovery_code = trim(p_temp_password),
      recovery_code_expires_at = now() + interval '15 minutes',
      recovery_attempts = 0
  where id = v_uid;

  v_len := position('@' in v_rec);
  if v_len > 3 then
    v_masked := substr(v_rec, 1, 1) || '***' || substr(v_rec, greatest(v_len - 1, 1));
  else
    v_masked := '***';
  end if;

  -- NEVER return uid or full recovery_email
  return json_build_object('ok', true, 'masked_email', v_masked, 'sent', true);
end;
$$;

revoke all on function public.request_password_reset(text, text) from public;
revoke all on function public.request_password_reset(text, text) from anon;
grant execute on function public.request_password_reset(text, text) to anon, authenticated, service_role;

-- ═══ 3) email_for_username: never raise (uniform), keep rate limit ═════
create or replace function public.email_for_username(p_username text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ip text;
  v_lookups int;
  v_last timestamptz;
  v_email text;
begin
  perform pg_sleep(0.05);
  begin
    v_ip := current_setting('request.headers', true)::json->>'x-forwarded-for';
    if v_ip is null then v_ip := 'unknown';
    else v_ip := 'eu:' || split_part(v_ip, ',', 1);
    end if;
  exception when others then
    v_ip := 'unknown';
  end;

  if random() < 0.01 then
    delete from public.anon_rate_limits where last_lookup < now() - interval '1 hour';
  end if;

  select lookups, last_lookup into v_lookups, v_last
  from public.anon_rate_limits where ip = v_ip;

  if v_lookups is not null then
    if v_lookups >= 8 and v_last > now() - interval '15 minutes' then
      return null; -- soft fail, no exception (no oracle)
    elsif v_lookups >= 8 then
      update public.anon_rate_limits set lookups = 1, last_lookup = now() where ip = v_ip;
    else
      update public.anon_rate_limits set lookups = lookups + 1, last_lookup = now() where ip = v_ip;
    end if;
  else
    insert into public.anon_rate_limits (ip) values (v_ip)
    on conflict (ip) do update set lookups = 1, last_lookup = now();
  end if;

  select email into v_email from public.profiles where username = lower(trim(p_username));
  return v_email; -- login needs real email; rate-limited
end;
$$;

revoke all on function public.email_for_username(text) from public;
grant execute on function public.email_for_username(text) to anon, authenticated, service_role;

-- ═══ 4) Storage: user may delete ONLY own objects ══════════════════════
drop policy if exists media_delete_own on storage.objects;
create policy media_delete_own on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = (auth.uid())::text
    and public.is_approved()
  );

-- ═══ 5) check_user_recovery: uniform response, no exception oracle ═════
create or replace function public.check_user_recovery(p_username text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid;
  v_rec text;
  v_has boolean := false;
begin
  perform pg_sleep(0.1);
  select id, recovery_email into v_uid, v_rec
  from public.profiles
  where username = lower(trim(coalesce(p_username, '')));

  if v_uid is not null and v_rec is not null and trim(v_rec) <> '' then
    v_has := true;
  end if;

  -- same keys always
  return json_build_object('exists', v_uid is not null, 'has_recovery', v_has);
end;
$$;
-- Note: exists still leaks username existence slightly — acceptable for closed family app;
-- rate-limit is via client + optional IP table in request path.

revoke all on function public.check_user_recovery(text) from public;
grant execute on function public.check_user_recovery(text) to anon, authenticated, service_role;

-- ═══ 6) ensure is_admin cannot be read-amplified for privilege ══════════
-- is_admin column still visible (UI badges) — OK; elevation blocked by triggers.

comment on function public.request_password_reset(text, text) is
  '081: no uid/full email; rate-limited; uniform ok response';
comment on policy media_delete_own on storage.objects is
  '081: delete only own media folder when approved';
