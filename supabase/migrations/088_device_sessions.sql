-- Ulangan qurilmalar (sessiyalar): ro'yxat, batafsil ma'lumot, bitta/barcha chiqarish
create table if not exists public.device_sessions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles(id) on delete cascade,
  device_id     text not null,
  device_name   text not null default '',
  device_model  text not null default '',
  browser       text not null default '',
  client_type   text not null default 'browser'
                  check (client_type in ('browser', 'pwa', 'unknown')),
  platform      text not null default '',
  os_version    text not null default '',
  user_agent    text not null default '',
  last_seen     timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  revoked_at    timestamptz,
  unique (user_id, device_id)
);

create index if not exists device_sessions_user_idx
  on public.device_sessions (user_id);

create index if not exists device_sessions_user_active_idx
  on public.device_sessions (user_id)
  where revoked_at is null;

alter table public.device_sessions enable row level security;

drop policy if exists device_sessions_select on public.device_sessions;
create policy device_sessions_select on public.device_sessions
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists device_sessions_insert on public.device_sessions;
create policy device_sessions_insert on public.device_sessions
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists device_sessions_update on public.device_sessions;
create policy device_sessions_update on public.device_sessions
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists device_sessions_delete on public.device_sessions;
create policy device_sessions_delete on public.device_sessions
  for delete to authenticated
  using (user_id = auth.uid());

-- Joriy qurilmani upsert (login / heartbeat)
create or replace function public.upsert_my_device_session(
  p_device_id    text,
  p_device_name  text default '',
  p_device_model text default '',
  p_browser      text default '',
  p_client_type  text default 'browser',
  p_platform     text default '',
  p_os_version   text default '',
  p_user_agent   text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
  v_ct  text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if p_device_id is null or length(trim(p_device_id)) < 8 then
    raise exception 'Invalid device_id';
  end if;
  v_ct := case when p_client_type in ('browser','pwa','unknown') then p_client_type else 'browser' end;

  insert into public.device_sessions as ds (
    user_id, device_id, device_name, device_model, browser, client_type,
    platform, os_version, user_agent, last_seen, revoked_at
  ) values (
    v_uid, trim(p_device_id),
    left(coalesce(p_device_name,''), 120),
    left(coalesce(p_device_model,''), 120),
    left(coalesce(p_browser,''), 80),
    v_ct,
    left(coalesce(p_platform,''), 80),
    left(coalesce(p_os_version,''), 40),
    left(coalesce(p_user_agent,''), 512),
    now(),
    null
  )
  on conflict (user_id, device_id) do update set
    device_name  = excluded.device_name,
    device_model = excluded.device_model,
    browser      = excluded.browser,
    client_type  = excluded.client_type,
    platform     = excluded.platform,
    os_version   = excluded.os_version,
    user_agent   = excluded.user_agent,
    last_seen    = now(),
    revoked_at   = null
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.upsert_my_device_session from public;
grant execute on function public.upsert_my_device_session to authenticated;

-- Bitta yoki barcha (boshqa) sessiyalarni revoke
create or replace function public.revoke_my_device_sessions(
  p_device_id text default null,
  p_all_others boolean default false
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
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  if p_all_others then
    with updated as (
      update public.device_sessions
         set revoked_at = now()
       where user_id = v_uid
         and revoked_at is null
         and (p_device_id is null or device_id is distinct from p_device_id)
      returning device_id
    )
    select coalesce(array_agg(device_id), array[]::text[]) into v_ids from updated;
  elsif p_device_id is not null and length(trim(p_device_id)) > 0 then
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

revoke all on function public.revoke_my_device_sessions from public;
grant execute on function public.revoke_my_device_sessions to authenticated;

-- Boot: joriy device revokedmi?
create or replace function public.is_my_device_revoked(p_device_id text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.device_sessions
     where user_id = auth.uid()
       and device_id = trim(p_device_id)
       and revoked_at is not null
  );
$$;

revoke all on function public.is_my_device_revoked from public;
grant execute on function public.is_my_device_revoked to authenticated;
