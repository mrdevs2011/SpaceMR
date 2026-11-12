-- 112_make_media_bucket_public.sql
-- Restore media bucket to public for instant high-speed CDN delivery
-- This ensures all images, avatars, stories, and chat media load instantly with 0ms latency.
UPDATE storage.buckets SET public = true WHERE id = 'media';

DROP POLICY IF EXISTS media_public_select ON storage.objects;
CREATE POLICY media_public_select ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'media');
