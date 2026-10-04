-- 062 (2026-10-04): guruhda "kimlar ko'rdi" — group_members.last_read_at.
-- A'zo guruhni ochganda / ochiq guruhda yangi xabar kelganda klient unread_count = 0 qiladi;
-- trigger shu paytda last_read_at = now() (SERVER vaqti) yozadi. Xabar m ni a'zo ko'rgan deb
-- hisoblanadi: last_read_at >= m.created_at (va a'zo xabardan oldin qo'shilgan).
-- Klientga yangi UPDATE huquqi KERAK EMAS (ustun trigger ichida yoziladi).
-- Idempotent. Ishga tushirish: Supabase SQL editor.

alter table public.group_members add column if not exists last_read_at timestamptz;

create or replace function public.touch_group_member_read()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- faqat a'zoning o'zi o'qilgan deb belgilaganda (unread_count -> 0)
  if auth.uid() is not null and auth.uid() = new.user_id and new.unread_count = 0 then
    new.last_read_at := now();
  end if;
  return new;
end $$;

drop trigger if exists group_members_touch_read on public.group_members;
create trigger group_members_touch_read
  before update on public.group_members
  for each row execute function public.touch_group_member_read();

-- Mavjud a'zolar: hozir hammasini o'qib bo'lgan (unread = 0) deb belgilaymiz
update public.group_members set last_read_at = now()
where last_read_at is null and unread_count = 0;
