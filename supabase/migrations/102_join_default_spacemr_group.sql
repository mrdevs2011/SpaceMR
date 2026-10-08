-- 102: yangi profil → SpaceMR guruhiga avtomatik a'zo; backfill. Idempotent.
begin;

create or replace function public.join_default_groups() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_gid uuid;
begin
  begin
    select id into v_gid from public.groups where lower(username) = 'spacemr' limit 1;
    if v_gid is not null then
      insert into public.group_members (group_id, user_id, role)
      values (v_gid, new.id, 'member')
      on conflict (group_id, user_id) do nothing;
    end if;
  exception when others then
    null;
  end;
  return new;
end $$;

revoke all on function public.join_default_groups() from public, anon, authenticated;

drop trigger if exists tr_join_default_groups on public.profiles;
create trigger tr_join_default_groups
  after insert on public.profiles
  for each row execute function public.join_default_groups();

-- Backfill: rate-limit triggeri ommaviy insertni to'smasin
do $$
begin
  alter table public.group_members disable trigger tr_rate_limit_group_members;
exception when undefined_object then null;
end $$;

insert into public.group_members (group_id, user_id, role)
select g.id, p.id, 'member'
from public.groups g
cross join public.profiles p
where lower(g.username) = 'spacemr'
on conflict (group_id, user_id) do nothing;

do $$
begin
  alter table public.group_members enable trigger tr_rate_limit_group_members;
exception when undefined_object then null;
end $$;

commit;
