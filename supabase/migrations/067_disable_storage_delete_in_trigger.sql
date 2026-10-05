-- Storage.objects ga to'g'ridan-to'g'ri DELETE Supabase da taqiqlangan va
-- EXCEPTION bilan ham ba'zi holatlarda parent DELETE ni 403 bilan buzadi.
-- Media tozalash endi faqat client Storage API orqali (msg-menu.js).
-- Trigger faqat no-op: xabar/post o'chirish hech qachon storage tufayli yiqilmasin.

CREATE OR REPLACE FUNCTION public.cleanup_media_on_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Storage cleanup is handled by the client (sb.storage.from('media').remove).
  -- Direct DELETE FROM storage.objects is forbidden by Supabase and must not
  -- abort the parent row delete.
  RETURN OLD;
END;
$$;

COMMENT ON FUNCTION public.cleanup_media_on_delete() IS
  'No-op: media files are removed via Storage API on the client. Never aborts DELETE.';
