-- Fix: storage.objects ga to'g'ridan-to'g'ri DELETE taqiqlangan.
-- Xabar/post o'chirish hech qachon storage xatosi tufayli fail bo'lmasin.
-- Media tozalash best-effort; muvaffaqiyatsiz bo'lsa WARNING, asosiy DELETE davom etadi.

CREATE OR REPLACE FUNCTION public.cleanup_media_on_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
BEGIN
  IF OLD.media_path IS NOT NULL AND btrim(OLD.media_path) <> '' THEN
    BEGIN
      -- Storage API o'rniga table delete — ba'zi loyihalarda ishlaydi;
      -- ishlamasa EXCEPTION tutib, xabar o'chirishni buzmaymiz.
      DELETE FROM storage.objects
      WHERE bucket_id = 'media'
        AND name = OLD.media_path;
    EXCEPTION
      WHEN OTHERS THEN
        RAISE WARNING 'cleanup_media_on_delete(%): %', OLD.media_path, SQLERRM;
    END;
  END IF;
  RETURN OLD;
END;
$$;

COMMENT ON FUNCTION public.cleanup_media_on_delete() IS
  'Best-effort media cleanup on message/post/story delete. Never aborts the parent DELETE.';
