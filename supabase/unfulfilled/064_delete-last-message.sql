-- 064: xabar o'chirilganda chat/guruh ro'yxatidagi last_message prevyusi ham yangilansin.
-- Sabab: last_message faqat INSERT triggerida yozilardi, DELETE'da hech kim tuzatmasdi -> o'chirilgan xabar ro'yxatda qolib ketardi.
-- Idempotent. Statement-level (transition table) — ommaviy o'chirishda ham tez.

CREATE OR REPLACE FUNCTION public.on_message_delete()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  update public.chats c set
    last_message    = coalesce(l.msg, ''),
    last_sender_id  = l.sender_id,
    last_message_at = coalesce(l.created_at, c.created_at)
  from (select distinct chat_id from old_rows) d
  left join lateral (
    select m.sender_id, m.created_at,
           case m.type when 'voice' then 'Ovozli xabar'
                       when 'file'  then coalesce(nullif(m.text, ''), m.file_name, 'Fayl')
                       else coalesce(m.text, '') end as msg
    from public.messages m where m.chat_id = d.chat_id
    order by m.created_at desc limit 1
  ) l on true
  where c.id = d.chat_id;
  return null;
end $function$;

DROP TRIGGER IF EXISTS tr_message_delete_last ON public.messages;
CREATE TRIGGER tr_message_delete_last AFTER DELETE ON public.messages
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.on_message_delete();

CREATE OR REPLACE FUNCTION public.on_group_message_delete()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  update public.groups g set
    last_message    = coalesce(l.msg, ''),
    last_sender_id  = l.sender_id,
    last_message_at = coalesce(l.created_at, g.created_at)
  from (select distinct group_id from old_rows) d
  left join lateral (
    select m.sender_id, m.created_at,
           case m.type when 'voice' then 'Ovozli xabar'
                       when 'file'  then coalesce(nullif(m.text, ''), m.file_name, 'Fayl')
                       else coalesce(m.text, '') end as msg
    from public.group_messages m where m.group_id = d.group_id
    order by m.created_at desc limit 1
  ) l on true
  where g.id = d.group_id;
  return null;
end $function$;

DROP TRIGGER IF EXISTS tr_group_message_delete_last ON public.group_messages;
CREATE TRIGGER tr_group_message_delete_last AFTER DELETE ON public.group_messages
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.on_group_message_delete();

-- Bir martalik tuzatish: hozirgi eskirgan prevyularni qayta hisoblash (o'chirilgan xabar ko'rinib turgan chatlar)
UPDATE public.chats c SET
  last_message    = coalesce(l.msg, ''),
  last_sender_id  = l.sender_id,
  last_message_at = coalesce(l.created_at, c.created_at)
FROM (SELECT id FROM public.chats) d
LEFT JOIN LATERAL (
  SELECT m.sender_id, m.created_at,
         case m.type when 'voice' then 'Ovozli xabar'
                     when 'file'  then coalesce(nullif(m.text, ''), m.file_name, 'Fayl')
                     else coalesce(m.text, '') end AS msg
  FROM public.messages m WHERE m.chat_id = d.id ORDER BY m.created_at DESC LIMIT 1
) l ON true
WHERE c.id = d.id;

UPDATE public.groups g SET
  last_message    = coalesce(l.msg, ''),
  last_sender_id  = l.sender_id,
  last_message_at = coalesce(l.created_at, g.created_at)
FROM (SELECT id FROM public.groups) d
LEFT JOIN LATERAL (
  SELECT m.sender_id, m.created_at,
         case m.type when 'voice' then 'Ovozli xabar'
                     when 'file'  then coalesce(nullif(m.text, ''), m.file_name, 'Fayl')
                     else coalesce(m.text, '') end AS msg
  FROM public.group_messages m WHERE m.group_id = d.id ORDER BY m.created_at DESC LIMIT 1
) l ON true
WHERE g.id = d.id;
