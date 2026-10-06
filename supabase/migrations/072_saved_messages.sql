-- Saqlangan xabarlar: har bir foydalanuvchining o'zi bilan chati (chats.user_a = user_b = auth.uid()).
-- URL: /chats/saved-messages. Chatni o'chirib bo'lmaydi (faqat profil o'chirilganda cascade bilan ketadi).

-- 1) user_a < user_b  ->  user_a <= user_b  (o'zi bilan chatga ruxsat)
alter table public.chats drop constraint if exists chats_check;
alter table public.chats add constraint chats_check check (user_a <= user_b);

-- 2) get_or_create_chat(p_other = o'zim) -> saqlangan xabarlar chati
create or replace function public.get_or_create_chat(p_other uuid) returns uuid
  language plpgsql security definer set search_path to 'public' as $$
declare
  me uuid := auth.uid();
  a uuid; b uuid; cid uuid;
begin
  if me is null or not public.is_approved() then raise exception 'Ruxsat yo''q'; end if;
  a := least(me, p_other); b := greatest(me, p_other);
  select id into cid from public.chats where user_a = a and user_b = b;
  if cid is null then
    insert into public.chats (user_a, user_b) values (a, b) returning id into cid;
    if a = b then
      insert into public.chat_members (chat_id, user_id) values (cid, a);
    else
      insert into public.chat_members (chat_id, user_id) values (cid, a), (cid, b);
    end if;
  end if;
  return cid;
end $$;

-- 3) Saqlangan xabarlar chatini to'g'ridan-to'g'ri o'chirib bo'lmasin (profil o'chirilsa cascade ruxsat)
create or replace function public.guard_saved_chat_delete() returns trigger
  language plpgsql security definer set search_path to 'public' as $$
begin
  if old.user_a = old.user_b and exists (select 1 from public.profiles where id = old.user_a) then
    raise exception 'Saqlangan xabarlarni o''chirib bo''lmaydi';
  end if;
  return old;
end $$;

drop trigger if exists tr_guard_saved_chat_delete on public.chats;
create trigger tr_guard_saved_chat_delete before delete on public.chats
  for each row execute function public.guard_saved_chat_delete();
