-- 082: guruhdan chiqish a'zolikni o'chiradi va chatga xizmat xabari yozadi.
create or replace function public.leave_group(p_group uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
  v_role text;
begin
  if v_uid is null then
    raise exception 'Tizimga kirilmagan' using errcode = '28000';
  end if;
  select role into v_role
  from public.group_members
  where group_id = p_group and user_id = v_uid;
  if v_role is null then
    raise exception 'Bu guruhda a''zo emassiz' using errcode = '42501';
  end if;
  if v_role = 'owner' then
    raise exception 'Guruh egasi chiqa olmaydi' using errcode = '42501';
  end if;
  select coalesce(nullif(trim(full_name), ''), nullif(trim(username), ''), 'User')
    into v_name
  from public.profiles
  where id = v_uid;
  insert into public.group_messages (group_id, sender_id, type, text)
  values (p_group, v_uid, 'text', coalesce(v_name, 'User') || ' left the group');
  delete from public.group_members
  where group_id = p_group and user_id = v_uid;
end;
$$;

revoke all on function public.leave_group(uuid) from public;
grant execute on function public.leave_group(uuid) to authenticated;
