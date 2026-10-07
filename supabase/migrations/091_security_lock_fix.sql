alter table public.device_sessions
  add column if not exists password_login_at timestamptz;

create or replace function public.mark_my_device_password_login(p_device_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if p_device_id is null or length(trim(p_device_id)) < 8 then raise exception 'Invalid device_id'; end if;

  insert into public.device_sessions as ds (user_id, device_id, password_login_at, last_seen, revoked_at)
  values (v_uid, trim(p_device_id), now(), now(), null)
  on conflict (user_id, device_id) do update set
    password_login_at = now(),
    last_seen = now(),
    revoked_at = null
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'password_login_at', now());
end;
$$;

revoke all on function public.mark_my_device_password_login(text) from public;
grant execute on function public.mark_my_device_password_login(text) to authenticated;

create or replace function public.security_lock_remaining(p_device_id text)
returns integer
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_uid uuid := auth.uid();
  v_at timestamptz;
  v_sec integer;
begin
  if v_uid is null then return 3600; end if;
  if p_device_id is null or length(trim(p_device_id)) < 8 then return 3600; end if;

  select password_login_at into v_at
  from public.device_sessions
  where user_id = v_uid and device_id = trim(p_device_id);

  if v_at is null then return 0; end if;

  v_sec := greatest(0, ceil(extract(epoch from (v_at + interval '1 hour' - now())))::integer);
  return v_sec;
end;
$$;

revoke all on function public.security_lock_remaining(text) from public;
grant execute on function public.security_lock_remaining(text) to authenticated;

-- drop old overloads
drop function if exists public.revoke_my_device_sessions(text, boolean);
drop function if exists public.revoke_my_device_sessions(text, boolean, text);

create or replace function public.revoke_my_device_sessions(
  p_device_id text default null,
  p_all_others boolean default false,
  p_caller_device_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_ids text[];
  v_count int := 0;
  v_lock int;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  if p_caller_device_id is null or length(trim(p_caller_device_id)) < 8 then
    raise exception 'Qurilma identifikatori kerak';
  end if;

  v_lock := public.security_lock_remaining(trim(p_caller_device_id));
  if v_lock > 0 then
    raise exception 'Xavfsizlik: yangi kirishdan keyin % daqiqa kuting (qurilmalar / parol)', greatest(1, ceil(v_lock / 60.0)::int);
  end if;

  if p_all_others then
    with updated as (
      update public.device_sessions
         set revoked_at = now()
       where user_id = v_uid
         and revoked_at is null
         and device_id is distinct from trim(p_caller_device_id)
      returning device_id
    )
    select coalesce(array_agg(device_id), array[]::text[]) into v_ids from updated;
  elsif p_device_id is not null and length(trim(p_device_id)) > 0 then
    if trim(p_device_id) = trim(p_caller_device_id) then
      raise exception 'Joriy qurilmani chiqarib bo''lmaydi';
    end if;
    with updated as (
      update public.device_sessions
         set revoked_at = now()
       where user_id = v_uid
         and device_id = trim(p_device_id)
         and revoked_at is null
      returning device_id
    )
    select coalesce(array_agg(device_id), array[]::text[]) into v_ids from updated;
  else
    raise exception 'device_id yoki all_others kerak';
  end if;

  v_count := coalesce(array_length(v_ids, 1), 0);
  return jsonb_build_object('ok', true, 'count', v_count, 'device_ids', to_jsonb(coalesce(v_ids, array[]::text[])));
end;
$$;

revoke all on function public.revoke_my_device_sessions(text, boolean, text) from public;
grant execute on function public.revoke_my_device_sessions(text, boolean, text) to authenticated;

drop function if exists public.change_my_password(text, text);
drop function if exists public.change_my_password(text, text, text);

create or replace function public.change_my_password(
  p_old_password text,
  p_new_password text,
  p_device_id text default null
)
returns json
language plpgsql security definer
set search_path = public, auth, extensions as $$
declare
  v_uid uuid;
  v_enc text;
  v_lock int;
begin
  v_uid := auth.uid();
  if v_uid is null then raise exception 'Avtorizatsiyadan o''tilmagan'; end if;

  if p_device_id is null or length(trim(p_device_id)) < 8 then
    raise exception 'Xavfsizlik: qurilma identifikatori kerak';
  end if;

  v_lock := public.security_lock_remaining(trim(p_device_id));
  if v_lock > 0 then
    raise exception 'Xavfsizlik: yangi kirishdan keyin % daqiqa kuting (parol o''zgartirish)', greatest(1, ceil(v_lock / 60.0)::int);
  end if;

  if p_old_password is null or trim(p_old_password) = '' then
    raise exception 'Joriy parolni kiriting';
  end if;
  if p_new_password is null or length(p_new_password) < 6 then
    raise exception 'Yangi parol kamida 6 ta belgidan iborat bo''lishi kerak';
  end if;

  select encrypted_password into v_enc from auth.users where id = v_uid;
  if v_enc is null then raise exception 'Foydalanuvchi topilmadi'; end if;
  if v_enc != extensions.crypt(p_old_password, v_enc) then
    raise exception 'Joriy parol noto''g''ri';
  end if;

  update auth.users
  set encrypted_password = extensions.crypt(p_new_password, extensions.gen_salt('bf')),
      updated_at = now()
  where id = v_uid;

  update public.profiles
  set must_change_password = false,
      password_changed_at = now()
  where id = v_uid;

  return json_build_object('ok', true, 'message', 'Parol muvaffaqiyatli yangilandi');
end $$;

revoke all on function public.change_my_password(text, text, text) from public, anon;
grant execute on function public.change_my_password(text, text, text) to authenticated;
