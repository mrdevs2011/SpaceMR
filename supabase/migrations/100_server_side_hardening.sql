-- 100 (2026-10-08): SERVER darajasidagi xavfsizlik — UI/klientga tayanmaydi. Idempotent.
--
-- Jonli bazani tekshirish natijasida topilgan teshiklar:
--  1) public sxemasidagi DEFAULT PRIVILEGES yangi jadval/funksiyalarni avtomatik `anon` ga ochadi
--     (078 faqat O'SHA PAYTDA mavjud obyektlarni yopgan). Natija: app_force_reload, device_sessions
--     jadvallarida anon'da ALL (TRUNCATE ham), 14 ta SECURITY DEFINER funksiyada anon EXECUTE.
--  2) authenticated'da TRUNCATE/REFERENCES/TRIGGER huquqlari (TRUNCATE RLS'ni aylanib o'tadi).
--  3) storage.objects: fayl turi/papka/hajm tekshiruvi faqat BEFORE INSERT'da — media_update policy
--     orqali fayl nomini/turini O'ZGARTIRIB (move) hammasini aylanib o'tish mumkin edi.
--  4) chat-files / group-files papkalari HECH QANDAY tekshiruvdan o'tmasdi (html, exe, ...).
--  5) media_path ustuni formatsiz (".." va uzun satrlar).

-- ═══ 1) DEFAULT PRIVILEGES: kelajakdagi obyektlar anon'ga ochilmasin ═══════════
alter default privileges for role postgres in schema public revoke all on tables    from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke execute on functions from anon;
alter default privileges for role postgres in schema public revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke truncate, references, trigger on tables from authenticated;

do $$ begin
  execute 'alter default privileges for role supabase_admin in schema public revoke all on tables from anon';
  execute 'alter default privileges for role supabase_admin in schema public revoke all on sequences from anon';
  execute 'alter default privileges for role supabase_admin in schema public revoke execute on functions from anon';
  execute 'alter default privileges for role supabase_admin in schema public revoke execute on functions from public';
  execute 'alter default privileges for role supabase_admin in schema public revoke truncate, references, trigger on tables from authenticated';
exception when others then
  raise notice 'supabase_admin default privileges skip: %', sqlerrm;
end $$;

-- ═══ 2) MAVJUD obyektlar: anon hech narsa, authenticated'da TRUNCATE yo'q ═══════
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke truncate, references, trigger on all tables in schema public from authenticated;

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
  loop
    begin
      execute format('revoke all on function %s from anon', r.sig);
      execute format('revoke all on function %s from public', r.sig);
    exception when others then
      raise notice 'revoke skip %: %', r.sig, sqlerrm;
    end;
  end loop;
end $$;

-- Anon uchun FAQAT login/recovery oqimi (078 bilan bir xil ro'yxat)
grant execute on function public.email_for_username(text)              to anon;
grant execute on function public.username_available(text)              to anon;
grant execute on function public.check_user_recovery(text)             to anon;
grant execute on function public.verify_recovery_code(text, text)      to anon;
grant execute on function public.reset_password_with_code(text, text, text) to anon;
grant execute on function public.request_password_reset(text, text)    to anon;
do $$ begin
  grant execute on function public.server_now() to anon;
exception when undefined_function then null;
end $$;

-- ═══ 3) storage: BITTA qoidalar to'plami — INSERT ham, UPDATE (move/rename) ham ═══
create or replace function public.storage_object_violation(p_name text, p_mime text, p_size bigint)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_mime    text    := lower(split_part(coalesce(p_mime, ''), ';', 1));
  v_ext     text    := lower(coalesce(substring(coalesce(p_name, '') from '\.([A-Za-z0-9]+)$'), ''));
  v_voice   boolean := coalesce(p_name, '') ~ '^[^/]+/chat-voice/' and v_ext in ('webm','ogg','opus','mp4','m4a','mp3','wav');
  v_file    boolean := coalesce(p_name, '') ~ '^[^/]+/(chat-files|group-files)/';
  v_imgonly boolean := coalesce(p_name, '') ~ '^[^/]+/(avatars|group-avatars)/';
  v_story   boolean := coalesce(p_name, '') ~ '^[^/]+/stories/';
  v_std     boolean := coalesce(p_name, '') ~ '^[^/]+/(posts|stories)/';
begin
  if p_name is null or p_name ~ '(^|/)\.\.?(/|$)' or p_name ~ '[[:cntrl:]]' then
    return 'Noto''g''ri fayl yo''li';
  end if;

  if v_ext in ('svg','svgz','html','htm','xhtml','xht','shtml','mhtml','xml','xsl','xslt','swf','hta',
               'exe','msi','bat','cmd','com','scr','dll','ps1','vbs','vbe','wsf','jar','apk','lnk','reg','pif','cpl','msc')
     or v_mime in ('image/svg+xml','image/svg','text/html','application/xhtml+xml','text/xml','application/xml',
                   'application/x-msdownload','application/x-msdos-program','application/vnd.microsoft.portable-executable',
                   'application/java-archive','application/vnd.android.package-archive','application/x-shockwave-flash',
                   'application/x-sh','application/x-bat') then
    return 'Bu turdagi faylni yuklash mumkin emas';
  end if;

  if v_voice and (v_mime = '' or v_mime like 'audio/%') then return null; end if;
  if v_file then return null; end if;

  if v_std and (v_mime like 'video/%' or v_ext in ('webm','mp4')) then
    if v_ext not in ('webm','mp4') then return 'Video faqat kamera standarti (webm/mp4)'; end if;
    if v_mime <> '' and v_mime not like 'video/%' then return 'Video faqat kamera standarti'; end if;
    if coalesce(p_size, 0) > 31457280 then return 'Video 30 MB dan oshdi'; end if;
    return null;
  end if;

  if v_mime like 'video/%'
     or (v_ext in ('mp4','mov','mkv','avi','m4v','wmv','flv','3gp','mpg','mpeg','ogv','webm') and v_mime not like 'audio/%') then
    return 'Video yuklash mumkin emas';
  end if;

  if v_story then
    if not (v_mime like 'image/%' or (v_mime = '' and v_ext in ('jpg','jpeg','png','gif','webp','avif','heic','heif','bmp'))) then
      return 'Storyga faqat rasm yoki video qo''yish mumkin';
    end if;
  elsif v_imgonly then
    if not (v_mime like 'image/%' or (v_mime = '' and v_ext in ('jpg','jpeg','png','gif','webp','avif','heic','heif','bmp'))) then
      return 'Bu yerga faqat rasm qo''yish mumkin';
    end if;
  end if;
  return null;
end $$;

revoke all on function public.storage_object_violation(text, text, bigint) from public, anon;

create or replace function public.enforce_only_jpg_png_storage()
returns trigger
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_size bigint := case when coalesce(new.metadata->>'size', '') ~ '^[0-9]{1,15}$' then (new.metadata->>'size')::bigint else 0 end;
  v_err  text;
begin
  v_err := public.storage_object_violation(new.name, new.metadata->>'mimetype', v_size);
  if v_err is not null then
    raise exception '%', v_err using errcode = '22023';
  end if;
  return new;
end $$;

create or replace function public.enforce_storage_object_update()
returns trigger
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  v_size bigint := case when coalesce(new.metadata->>'size', '') ~ '^[0-9]{1,15}$' then (new.metadata->>'size')::bigint else 0 end;
  v_err  text;
begin
  if new.name is distinct from old.name
     or (new.metadata->>'mimetype') is distinct from (old.metadata->>'mimetype') then
    v_err := public.storage_object_violation(new.name, new.metadata->>'mimetype', v_size);
    if v_err is not null then
      raise exception '%', v_err using errcode = '22023';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_storage_update_guard on storage.objects;
create trigger trg_storage_update_guard
  before update on storage.objects
  for each row execute function public.enforce_storage_object_update();

-- ═══ 4) media_path formati: bazada majburlanadi ═══════════════════════════════
create or replace function public.enforce_media_path_sane()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.media_path is not null and (
        char_length(new.media_path) > 500
     or new.media_path !~ '^[A-Za-z0-9_][A-Za-z0-9_./-]*$'
     or new.media_path ~ '\.\.'
  ) then
    raise exception 'Noto''g''ri media yo''li' using errcode = '22023';
  end if;
  return new;
end $$;

drop trigger if exists trg_media_path_sane on public.messages;
create trigger trg_media_path_sane before insert or update of media_path on public.messages
  for each row execute function public.enforce_media_path_sane();
drop trigger if exists trg_media_path_sane on public.group_messages;
create trigger trg_media_path_sane before insert or update of media_path on public.group_messages
  for each row execute function public.enforce_media_path_sane();
drop trigger if exists trg_media_path_sane on public.posts;
create trigger trg_media_path_sane before insert or update of media_path on public.posts
  for each row execute function public.enforce_media_path_sane();
drop trigger if exists trg_media_path_sane on public.stories;
create trigger trg_media_path_sane before insert or update of media_path on public.stories
  for each row execute function public.enforce_media_path_sane();

comment on function public.storage_object_violation(text, text, bigint) is
  '100: storage fayl qoidalari (INSERT + UPDATE/move uchun yagona manba)';
