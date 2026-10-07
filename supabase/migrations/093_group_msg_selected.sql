-- Xabar yuborish: all | admins | selected (+ group_members.can_write)

alter table public.group_members
  add column if not exists can_write boolean not null default true;

grant update (can_write) on table public.group_members to authenticated;

alter table public.groups drop constraint if exists groups_msg_permission_check;
alter table public.groups
  add constraint groups_msg_permission_check
  check (msg_permission = any (array['all'::text, 'admins'::text, 'selected'::text]));

create or replace function public.can_post_in_group(p_group uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.groups g
    join public.group_members m on m.group_id = g.id and m.user_id = auth.uid()
    where g.id = p_group
      and (
        m.role in ('owner', 'admin')
        or (g.type = 'group' and g.msg_permission = 'all')
        or (g.type = 'group' and g.msg_permission = 'selected' and coalesce(m.can_write, false) = true)
      )
  );
$$;

revoke all on function public.can_post_in_group(uuid) from public;
grant execute on function public.can_post_in_group(uuid) to authenticated, anon, service_role;
