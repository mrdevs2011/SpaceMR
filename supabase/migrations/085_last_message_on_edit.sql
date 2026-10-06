-- 085: Xabar tahrirlanganda (text o'zgarganda) chat/guruh ro'yxatidagi last_message
-- prevyusi ham yangilansin — agar shu xabar suhbatdagi eng so'nggisi bo'lsa.
-- Sabab: last_message faqat INSERT/DELETE da yozilardi; edit da eski matn qolib ketardi.

CREATE OR REPLACE FUNCTION public.on_message_edit_last()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Faqat matn o'zgarganda (status/read_at emas)
  IF NEW.text IS NOT DISTINCT FROM OLD.text THEN
    RETURN NEW;
  END IF;

  -- Bu xabar chatdagi eng so'nggi bo'lsa last_message ni yangila
  UPDATE public.chats c SET
    last_message = CASE NEW.type
      WHEN 'voice' THEN 'Ovozli xabar'
      WHEN 'file'  THEN coalesce(nullif(NEW.text, ''), NEW.file_name, 'Fayl')
      ELSE coalesce(NEW.text, '')
    END
  WHERE c.id = NEW.chat_id
    AND NOT EXISTS (
      SELECT 1 FROM public.messages m
      WHERE m.chat_id = NEW.chat_id AND m.created_at > NEW.created_at
    );

  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS tr_message_edit_last ON public.messages;
CREATE TRIGGER tr_message_edit_last
  AFTER UPDATE OF text ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.on_message_edit_last();

CREATE OR REPLACE FUNCTION public.on_group_message_edit_last()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.text IS NOT DISTINCT FROM OLD.text THEN
    RETURN NEW;
  END IF;

  UPDATE public.groups g SET
    last_message = CASE NEW.type
      WHEN 'voice' THEN 'Ovozli xabar'
      WHEN 'file'  THEN coalesce(nullif(NEW.text, ''), NEW.file_name, 'Fayl')
      ELSE coalesce(NEW.text, '')
    END
  WHERE g.id = NEW.group_id
    AND NOT EXISTS (
      SELECT 1 FROM public.group_messages m
      WHERE m.group_id = NEW.group_id AND m.created_at > NEW.created_at
    );

  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS tr_group_message_edit_last ON public.group_messages;
CREATE TRIGGER tr_group_message_edit_last
  AFTER UPDATE OF text ON public.group_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.on_group_message_edit_last();
