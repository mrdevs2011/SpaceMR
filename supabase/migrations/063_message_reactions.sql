-- 063 (2026-10-05): xabarlarga reaksiya (DM + guruh). Bir foydalanuvchi — bir xabarga bitta reaksiya.
-- Klient: modules/chat/msg-reactions.js (menyu tepasida tezkor emoji qatori + chevron paneli, chiplar xabar tagida).
-- message_id — messages.id yoki group_messages.id (ikki jadval, shuning uchun FK yo'q; xabar o'chsa trigger tozalaydi).
-- Idempotent. Ishga tushirish: Supabase SQL editor.

create table if not exists public.message_reactions (
  message_id uuid        not null,
  user_id    uuid        not null default auth.uid() references public.profiles(id) on delete cascade,
  thread_id  uuid        not null,                       -- chat_id (dm) yoki group_id (group)
  kind       text        not null check (kind in ('dm', 'group')),
  emoji      text        not null check (char_length(emoji) between 1 and 16),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
create index if not exists message_reactions_thread_idx on public.message_reactions (thread_id);

alter table public.message_reactions enable row level security;

drop policy if exists mreact_select on public.message_reactions;
create policy mreact_select on public.message_reactions for select to authenticated
  using (public.is_admin()
         or (kind = 'dm'    and public.is_chat_member(thread_id))
         or (kind = 'group' and public.is_group_member(thread_id)));

-- Faqat o'zim uchun, va xabar haqiqatan shu suhbatga tegishli bo'lsagina
drop policy if exists mreact_insert on public.message_reactions;
create policy mreact_insert on public.message_reactions for insert to authenticated
  with check (user_id = auth.uid() and public.is_approved() and (
    (kind = 'dm'    and public.is_chat_member(thread_id)  and exists (select 1 from public.messages m       where m.id = message_id and m.chat_id  = thread_id))
 or (kind = 'group' and public.is_group_member(thread_id) and exists (select 1 from public.group_messages g where g.id = message_id and g.group_id = thread_id))));

drop policy if exists mreact_update on public.message_reactions;
create policy mreact_update on public.message_reactions for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists mreact_delete on public.message_reactions;
create policy mreact_delete on public.message_reactions for delete to authenticated
  using (user_id = auth.uid());

-- Xabar o'chirilsa — reaksiyalari ham ketadi
create or replace function public.drop_message_reactions()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.message_reactions where message_id = old.id;
  return old;
end $$;

drop trigger if exists messages_drop_reactions on public.messages;
create trigger messages_drop_reactions after delete on public.messages
  for each row execute function public.drop_message_reactions();

drop trigger if exists group_messages_drop_reactions on public.group_messages;
create trigger group_messages_drop_reactions after delete on public.group_messages
  for each row execute function public.drop_message_reactions();

-- Realtime (DELETE hodisasida message_id/user_id kelishi uchun replica identity full)
alter table public.message_reactions replica identity full;
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_reactions') then
    alter publication supabase_realtime add table public.message_reactions;
  end if;
end $$;
