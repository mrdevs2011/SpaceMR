-- 116: Hech qanday hajm / trafik / tur cheklovi yo'q. Hajmni faqat Supabase Storage'ning o'zi
-- (loyiha sozlamasidagi global limit) belgilaydi. Qolgani: faqat tizimga kirgan egasi bo'lishi shart.

update storage.buckets set file_size_limit = null, allowed_mime_types = null where id = 'media';

create or replace function public.check_storage_rate_limit()
returns trigger
language plpgsql
security definer
as $$
declare v_uid uuid;
begin
  v_uid := coalesce(auth.uid(), new.owner, nullif(new.owner_id, '')::uuid);
  if v_uid is null then raise exception 'Ruxsatsiz fayl yuklash taqiqlangan'; end if;
  return new;
end $$;

create or replace function public.storage_object_violation(p_name text, p_mime text, p_size bigint)
returns text
language plpgsql
immutable
set search_path = public
as $$
begin
  if p_name is null or p_name ~ '(^|/)\.\.?(/|$)' or p_name ~ '[[:cntrl:]]' then
    return 'Noto''g''ri fayl yo''li';
  end if;
  return null;
end $$;

create or replace function public.enforce_no_video_audio_rows()
returns trigger language plpgsql set search_path = public
as $$ begin return new; end $$;

drop policy if exists media_insert on storage.objects;
create policy media_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = (auth.uid())::text
    and public.is_approved()
  );
