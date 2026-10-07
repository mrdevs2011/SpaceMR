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
