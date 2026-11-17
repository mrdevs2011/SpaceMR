-- 115: Fayl turi cheklovlari olib tashlandi: har qanday fayl (SVG, HTML, video, exe...) <= 50 MB.
-- Qoldi: yo'l tozaligi, 50 MB hajm, story/avatar/guruh avatari faqat rasm/video (funksional).
-- Idempotent.

create or replace function public.storage_object_violation(p_name text, p_mime text, p_size bigint)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_mime    text    := lower(split_part(coalesce(p_mime, ''), ';', 1));
  v_ext     text    := lower(coalesce(substring(coalesce(p_name, '') from '\.([A-Za-z0-9]+)$'), ''));
  v_imgonly boolean := coalesce(p_name, '') ~ '^[^/]+/(avatars|group-avatars)/';
  v_story   boolean := coalesce(p_name, '') ~ '^[^/]+/stories/';
begin
  if p_name is null or p_name ~ '(^|/)\.\.?(/|$)' or p_name ~ '[[:cntrl:]]' then
    return 'Noto''g''ri fayl yo''li';
  end if;
  if coalesce(p_size, 0) > 52428800 then return 'Fayl juda katta. Maksimal hajm 50MB.'; end if;
  if v_story then
    if not (v_mime like 'image/%' or v_mime like 'video/%'
            or (v_mime = '' and v_ext in ('jpg','jpeg','png','gif','webp','avif','heic','heif','bmp','mp4','webm','mov'))) then
      return 'Storyga faqat rasm yoki video qo''yish mumkin';
    end if;
  elsif v_imgonly then
    if not (v_mime like 'image/%' or (v_mime = '' and v_ext in ('jpg','jpeg','png','gif','webp','avif','heic','heif','bmp'))) then
      return 'Bu yerga faqat rasm qo''yish mumkin';
    end if;
  end if;
  return null;
end $$;

create or replace function public.enforce_no_video_audio_rows()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  return new;
end $$;

drop policy if exists media_insert on storage.objects;
create policy media_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = (auth.uid())::text
    and public.is_approved()
    and (metadata->>'size' is null or (metadata->>'size')::bigint <= 52428800)
  );
