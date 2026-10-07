-- 095: SVG yuklashni storage darajasida rad etish (XSS: SVG ichida script).
-- Klient: modules/core/upload-policy.js allaqachon bloklaydi; bu qo'shimcha himoya.
-- Idempotent. Jonli bazaga faqat MR yurgizadi.

drop policy if exists media_insert on storage.objects;
create policy media_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = (auth.uid())::text
    and public.is_approved()
    and lower(coalesce(storage.extension(name), '')) <> 'svg'
    and lower(coalesce((metadata->>'mimetype')::text, '')) not in ('image/svg+xml', 'image/svg')
  );

comment on policy media_insert on storage.objects is
  'Upload only to own uid folder when approved; SVG blocked';
