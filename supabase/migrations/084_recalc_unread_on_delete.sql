-- 084: Xabar o'chirilganda unread_count ni haqiqiy qolgan o'qilmagan xabarlar asosida qayta hisoblash.
-- Sabab: insert da +1 qilinardi, delete da hech narsa — admin/moderator yoki o'zi o'chirganda badge (+N)
-- qolib ketardi, chatga kirganda esa xabarlar yo'q edi. Realtime: chat_members / group_members
-- UPDATE orqali klient badge ni darhol yangilaydi (mavjud watcher).
-- Statement-level (transition table) — ommaviy o'chirishda ham bir marta ishlaydi. Idempotent.

-- ── DM: messages DELETE ───────────────────────────────────────────────
-- O'qilmagan = sender boshqa + status != 'read'
CREATE OR REPLACE FUNCTION public.on_message_delete_recalc_unread()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.chat_members cm
  SET unread_count = sub.cnt
  FROM (
    SELECT d.chat_id, cm2.user_id,
           (
             SELECT count(*)::int
             FROM public.messages m
             WHERE m.chat_id = d.chat_id
               AND m.sender_id <> cm2.user_id
               AND m.status IS DISTINCT FROM 'read'
           ) AS cnt
    FROM (SELECT DISTINCT chat_id FROM old_rows) d
    JOIN public.chat_members cm2 ON cm2.chat_id = d.chat_id
  ) sub
  WHERE cm.chat_id = sub.chat_id AND cm.user_id = sub.user_id
    AND cm.unread_count IS DISTINCT FROM sub.cnt;
  RETURN NULL;
END
$function$;

DROP TRIGGER IF EXISTS tr_message_delete_recalc_unread ON public.messages;
CREATE TRIGGER tr_message_delete_recalc_unread
  AFTER DELETE ON public.messages
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.on_message_delete_recalc_unread();

-- ── Guruh: group_messages DELETE ──────────────────────────────────────
-- O'qilmagan = sender boshqa + created_at > last_read_at (yoki last_read_at null)
CREATE OR REPLACE FUNCTION public.on_group_message_delete_recalc_unread()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.group_members gm
  SET unread_count = sub.cnt
  FROM (
    SELECT d.group_id, gm2.user_id,
           (
             SELECT count(*)::int
             FROM public.group_messages m
             WHERE m.group_id = d.group_id
               AND m.sender_id <> gm2.user_id
               AND (gm2.last_read_at IS NULL OR m.created_at > gm2.last_read_at)
           ) AS cnt
    FROM (SELECT DISTINCT group_id FROM old_rows) d
    JOIN public.group_members gm2 ON gm2.group_id = d.group_id
  ) sub
  WHERE gm.group_id = sub.group_id AND gm.user_id = sub.user_id
    AND gm.unread_count IS DISTINCT FROM sub.cnt;
  RETURN NULL;
END
$function$;

DROP TRIGGER IF EXISTS tr_group_message_delete_recalc_unread ON public.group_messages;
CREATE TRIGGER tr_group_message_delete_recalc_unread
  AFTER DELETE ON public.group_messages
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.on_group_message_delete_recalc_unread();

-- ── Bir martalik tuzatish: hozirgi noto'g'ri unread_count larni tozalash ─
UPDATE public.chat_members cm
SET unread_count = sub.cnt
FROM (
  SELECT cm2.chat_id, cm2.user_id,
         (
           SELECT count(*)::int
           FROM public.messages m
           WHERE m.chat_id = cm2.chat_id
             AND m.sender_id <> cm2.user_id
             AND m.status IS DISTINCT FROM 'read'
         ) AS cnt
  FROM public.chat_members cm2
) sub
WHERE cm.chat_id = sub.chat_id AND cm.user_id = sub.user_id
  AND cm.unread_count IS DISTINCT FROM sub.cnt;

UPDATE public.group_members gm
SET unread_count = sub.cnt
FROM (
  SELECT gm2.group_id, gm2.user_id,
         (
           SELECT count(*)::int
           FROM public.group_messages m
           WHERE m.group_id = gm2.group_id
             AND m.sender_id <> gm2.user_id
             AND (gm2.last_read_at IS NULL OR m.created_at > gm2.last_read_at)
         ) AS cnt
  FROM public.group_members gm2
) sub
WHERE gm.group_id = sub.group_id AND gm.user_id = sub.user_id
  AND gm.unread_count IS DISTINCT FROM sub.cnt;
