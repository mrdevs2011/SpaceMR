-- 079: storage SELECT + media_insert tighten + entity_tombstones less open

-- Public bucket: SELECT for everyone (CDN public URLs); writes stay authenticated
drop policy if exists media_select on storage.objects;
create policy media_select on storage.objects
  for select
  using (bucket_id = 'media');

-- Insert: only own folder + approved
drop policy if exists media_insert on storage.objects;
create policy media_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = (auth.uid())::text
    and public.is_approved()
  );

-- entity_tombstones: faqat authenticated SELECT (already), lekin using true o'rniga hech narsa ochiq emas — OK qoladi
-- Admin wipe RPCs: is_admin check ichida; authenticated grant kerak admin UI uchun.

-- profiles: insert faqat trigger (handle_new_user) — authenticated INSERT bo'lmasin
revoke insert on public.profiles from authenticated;

-- client_errors: anon yozmasin (allaqachon revoke); authenticated faqat insert o'z xatosi
-- (mavjud policy ga tegmaymiz)

comment on policy media_select on storage.objects is 'Public media read (bucket public)';
comment on policy media_insert on storage.objects is 'Upload only to own uid folder when approved';
