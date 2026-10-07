-- 099: SpaceMR guruhi hamma uchun default (Admin chati kabi chats ro'yxatida doim turadi)
-- 1) Yangi akkaunt yaratilganda avtomatik 'spacemr' guruhiga a'zo bo'ladi (trigger)
-- 2) Mavjud barcha foydalanuvchilar bir martalik qo'shiladi (backfill)
-- Idempotent. Guruh topilmasa (username = 'spacemr' yo'q bo'lsa) hech narsa qilmaydi.
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
    null; -- bu sabab bilan ro'yxatdan o'tish hech qachon buzilmasin
  end;
  return new;
end $$;

revoke all on function public.join_default_groups() from public, anon, authenticated;

drop trigger if exists tr_join_default_groups on public.profiles;
create trigger tr_join_default_groups
  after insert on public.profiles
  for each row execute function public.join_default_groups();

-- Backfill: rate-limit triggeri (50 a'zo/daqiqa) ommaviy qo'shishni to'sadi, shuning uchun vaqtincha o'chiriladi
alter table public.group_members disable trigger tr_rate_limit_group_members;

insert into public.group_members (group_id, user_id, role)
select g.id, p.id, 'member'
from public.groups g
cross join public.profiles p
where lower(g.username) = 'spacemr'
on conflict (group_id, user_id) do nothing;

alter table public.group_members enable trigger tr_rate_limit_group_members;

commit;
