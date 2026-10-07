-- 098: guruh (yoki chat) o'chirilganda 409 (FK buzilishi) — tuzatish.
-- Sabab: groups qatori o'chirilganda ON DELETE CASCADE group_messages qatorlarini o'chiradi,
-- AFTER DELETE trigger (074) esa group_message_tombstones'ga group_id bilan yozadi — lekin guruh
-- allaqachon o'chirilgan, FK (group_id -> groups) buziladi => butun DELETE 409 bilan qaytadi.
-- Yechim: ota-qator yo'q bo'lsa tombstone yozmaymiz (kerak ham emas, guruhning o'zi yo'q).
create or replace function public.group_messages_tombstone()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare s bigint;
begin
  if not exists (select 1 from public.groups where id = old.group_id) then
    return old;   -- guruh o'chirilyapti (cascade)
  end if;
  update public.groups set msg_seq = msg_seq + 1 where id = old.group_id returning msg_seq into s;
  insert into public.group_message_tombstones (group_id, message_id, seq)
  values (old.group_id, old.id, coalesce(s, 0))
  on conflict (group_id, message_id) do update
    set seq = excluded.seq, deleted_at = now();
  return old;
end;
$$;

create or replace function public.messages_tombstone()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare s bigint;
begin
  if not exists (select 1 from public.chats where id = old.chat_id) then
    return old;   -- chat o'chirilyapti (cascade)
  end if;
  update public.chats set msg_seq = msg_seq + 1 where id = old.chat_id returning msg_seq into s;
  insert into public.message_tombstones (chat_id, message_id, seq)
  values (old.chat_id, old.id, coalesce(s, 0))
  on conflict (chat_id, message_id) do update
    set seq = excluded.seq, deleted_at = now();
  return old;
end;
$$;
