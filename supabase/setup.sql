-- ═══════════════════════════════════════════════════════════════════════════════
--  SpaceMR — BAZANI SOZLASH (BITTA FAYL, BIR MARTA, IDEMPOTENT)
-- ═══════════════════════════════════════════════════════════════════════════════
--  Nima qiladi: butun baza sxemasini 0 dan quradi — jadvallar, funksiyalar, triggerlar, RLS siyosatlari,
--  grantlar, realtime, media bucket'i, auth→profil triggeri, cron ishlari.
--
--  Qanday ishlatiladi:
--    Supabase → SQL Editor → New query → shu faylning HAMMASINI paste → Run.
--    Yangi loyihada ham, mavjud bazada ham xavfsiz: qayta ishga tushirilsa xato bermaydi (idempotent),
--    mavjud ma'lumotlarga tegmaydi (faqat sxema).
--
--  Qoidalar (bitta aniq maqsad — har bo'lim o'z vazifasi uchun):
--    • Fayl turi/hajmi bo'yicha HECH QANDAY cheklov yo'q; hajmni faqat Supabase Storage'ning global limiti belgilaydi.
--    • Media bucket ommaviy (public); yozish/o'chirish faqat egasi (yoki admin).
--    • Eski migratsiyalar (supabase/migrations/*) tarix sifatida qoladi; yangi o'rnatish uchun faqat shu fayl kerak.
--
--  ⚙️ SOZLAMA (faqat push-bildirishnoma webhooklari uchun, 14-bo'lim):
--    PUSH_WEBHOOK_SECRET qiymatini 14-bo'limdagi  __WEBHOOK_SECRET__  o'rniga qo'ying
--    (Edge Functions → Secrets → PUSH_WEBHOOK_SECRET bilan BIR XIL). Qo'yilmasa — qolgan hamma narsa
--    ishlaydi, faqat push triggerlari o'tkazib yuboriladi (NOTICE chiqadi).
-- ═══════════════════════════════════════════════════════════════════════════════

SET statement_timeout = 0;
SET lock_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET check_function_bodies = false;
SET client_min_messages = warning;
SET row_security = off;

-- ═══ 1. KENGAYTMALAR ═══════════════════════════════════════════════════════════
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";
DO $ext$ BEGIN
  -- Ixtiyoriy kengaytmalar: Supabase'da odatda mavjud; bo'lmasa o'tkazib yuboriladi (asosiy sxema ularsiz ham quriladi)
  BEGIN CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions"; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'pg_net o''tkazib yuborildi: %', SQLERRM; END;
  BEGIN CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog"; EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'pg_cron o''tkazib yuborildi: %', SQLERRM; END;
END $ext$;

-- (public sxemasi 2–9-bo'limlar: funksiyalar, jadvallar, cheklovlar, indekslar, triggerlar, RLS, siyosatlar, huquqlar)

COMMENT ON SCHEMA "public" IS 'SpaceMR 078 lockdown: anon table grants revoked; public RPCs limited to auth/recovery';

-- ═══ 2. FUNKSIYALAR ════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION "public"."_admin_password_ok"("p_password" "text") RETURNS boolean
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_hash text;
begin
  if auth.uid() is null or not public.is_admin() then return false; end if;
  if coalesce(p_password, '') = '' then return false; end if;
  select encrypted_password into v_hash from auth.users where id = auth.uid();
  return v_hash is not null and extensions.crypt(p_password, v_hash) = v_hash;
end $$;

CREATE OR REPLACE FUNCTION "public"."_admin_wipe_guard"("p_scope" "text", "p_password" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Faqat admin' using errcode = '42501';
  end if;
  if p_scope not in ('accounts', 'content', 'chats', 'all') then
    raise exception 'Noto''g''ri bo''lim: %', p_scope using errcode = '22023';
  end if;
  if not public._admin_password_ok(p_password) then
    perform pg_sleep(1);
    raise exception 'Admin paroli noto''g''ri' using errcode = '28P01';
  end if;
end $$;

CREATE OR REPLACE FUNCTION "public"."_admin_wipe_objects"("p_scope" "text") RETURNS SETOF "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select o.name
  from storage.objects o
  where o.bucket_id = 'media'
    and (
      p_scope = 'all'
      or (p_scope = 'content'  and split_part(o.name, '/', 2) in ('posts', 'stories'))
      or (p_scope = 'chats'    and split_part(o.name, '/', 2) not in ('posts', 'stories', 'avatars'))
      or (p_scope = 'accounts' and split_part(o.name, '/', 1) not in (select id::text from public.profiles where is_admin))
    );
$$;

CREATE OR REPLACE FUNCTION "public"."admin_delete_user"("p_uid" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if not public.is_admin() then
    raise exception 'Faqat admin';
  end if;
  if p_uid = auth.uid() then
    raise exception 'O''zingizni bu yerdan o''chirib bo''lmaydi';
  end if;

  -- 1. Storage'dagi foydalanuvchiga tegishli barcha media fayllarni tozalash
  -- Supabase Storage protect_objects_delete triggeri storage.allow_delete_query = true bo'lishini talab qiladi
  begin
    perform set_config('storage.allow_delete_query', 'true', true);
    delete from storage.objects
    where bucket_id = 'media'
      and (name like p_uid::text || '/%' or (owner is not null and owner::text = p_uid::text));
  exception when others then
    -- Agar storage triggeri xatolik bersa ham profil o'chirilishi to'xtab qolmasin
    raise notice 'Storage tozalashda ogohlantirish: %', SQLERRM;
  end;

  -- 2. Push tokenlarni tozalash
  delete from public.push_tokens where user_id = p_uid;

  -- 3. Profiles qatorini o'chirish (ON DELETE CASCADE barcha bog'liq ma'lumotlarni tozalaydi)
  delete from public.profiles where id = p_uid;

  -- 4. Supabase auth.users dan o'chirish (sessiya va token butunlay bekor qilinadi)
  delete from auth.users where id = p_uid;
end $$;

CREATE OR REPLACE FUNCTION "public"."admin_issue_recovery_code"("p_uid" "uuid", "p_code" "text") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  return public.admin_reset_user_password(p_uid, p_code);
end $$;

CREATE OR REPLACE FUNCTION "public"."admin_reset_user_password"("p_uid" "uuid", "p_temp_password" "text") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_rec text;
  v_uname text;
  v_masked text;
  v_len int;
begin
  if not public.is_admin() then
    raise exception 'Faqat administrator amalga oshira oladi';
  end if;
  if p_uid = auth.uid() then
    raise exception 'O''zingizning parolingizni profil sozlamalaridan o''zgartiring';
  end if;
  if p_temp_password is null or length(trim(p_temp_password)) < 6 then
    raise exception 'Tiklash kodi kamida 6 ta belgi bo''lishi kerak';
  end if;

  select username, recovery_email into v_uname, v_rec
  from public.profiles
  where id = p_uid;

  if v_uname is null then
    raise exception 'Foydalanuvchi topilmadi';
  end if;

  -- Foydalanuvchining joriy paroli o'z kuchida qoladi.
  -- 24 soat amal qiladigan vaqtinchalik tiklash kodi (OTP) yoziladi:
  update public.profiles
  set recovery_code = trim(p_temp_password),
      recovery_code_expires_at = now() + interval '24 hours',
      recovery_attempts = 0
  where id = p_uid;

  -- BARCHA SESSIYALARNI O'CHIRISH (BUTUNLAY LOGOUT)
  delete from auth.sessions where user_id = p_uid;
  delete from auth.refresh_tokens where parent like '%' || p_uid::text || '%';

  if v_rec is not null and trim(v_rec) != '' then
    v_len := position('@' in v_rec);
    if v_len > 3 then
      v_masked := substr(v_rec, 1, 1) || '***' || substr(v_rec, v_len - 1);
    else
      v_masked := '***' || substr(v_rec, v_len);
    end if;
  end if;

  return json_build_object(
    'ok', true,
    'uid', p_uid,
    'username', v_uname,
    'recovery_email', v_rec,
    'masked_email', v_masked,
    'code', trim(p_temp_password)
  );
end $$;

CREATE OR REPLACE FUNCTION "public"."admin_storage_usage"() RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return coalesce((
    select sum((metadata->>'size')::bigint)
    from storage.objects
    where bucket_id = 'media'
  ), 0);
end;
$$;

CREATE OR REPLACE FUNCTION "public"."admin_trigger_force_reload"() RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v bigint;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v := (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::bigint;
  INSERT INTO public.app_force_reload (id, version, updated_at, by_admin)
  VALUES ('global', v, now(), auth.uid())
  ON CONFLICT (id) DO UPDATE
    SET version = EXCLUDED.version,
        updated_at = EXCLUDED.updated_at,
        by_admin = EXCLUDED.by_admin;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION "public"."admin_verify_password"("p_username" "text", "p_password" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_ok boolean;
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Faqat admin' using errcode = '42501';
  end if;
  v_ok := lower(trim(coalesce(p_username, ''))) = (select username from public.profiles where id = auth.uid())
          and public._admin_password_ok(p_password);
  if not v_ok then perform pg_sleep(1); end if;   -- parol tanlashni sekinlashtiradi
  return v_ok;
end $$;

CREATE OR REPLACE FUNCTION "public"."admin_wipe"("p_scope" "text", "p_password" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  r jsonb := '{}'::jsonb;
  n bigint;
begin
  perform public._admin_wipe_guard(p_scope, p_password);

  -- quyidagi storage tozalash uchun ruxsat (faqat shu tranzaksiyada)
  perform set_config('storage.allow_delete_query', 'true', true);

  if p_scope in ('content', 'all') then
    delete from public.saved_posts where true; get diagnostics n = row_count; r := r || jsonb_build_object('saved_posts', n);
    delete from public.comments    where true; get diagnostics n = row_count; r := r || jsonb_build_object('comments', n);
    delete from public.post_likes  where true; get diagnostics n = row_count; r := r || jsonb_build_object('post_likes', n);
    delete from public.posts       where true; get diagnostics n = row_count; r := r || jsonb_build_object('posts', n);
    delete from public.story_views where true; get diagnostics n = row_count; r := r || jsonb_build_object('story_views', n);
    delete from public.stories     where true; get diagnostics n = row_count; r := r || jsonb_build_object('stories', n);
  end if;

  if p_scope in ('chats', 'all') then
    delete from public.messages       where true; get diagnostics n = row_count; r := r || jsonb_build_object('messages', n);
    delete from public.chat_members   where true; get diagnostics n = row_count; r := r || jsonb_build_object('chat_members', n);
    delete from public.chats          where true; get diagnostics n = row_count; r := r || jsonb_build_object('chats', n);
    delete from public.group_messages where true; get diagnostics n = row_count; r := r || jsonb_build_object('group_messages', n);
    delete from public.group_members  where true; get diagnostics n = row_count; r := r || jsonb_build_object('group_members', n);
    delete from public.groups         where true; get diagnostics n = row_count; r := r || jsonb_build_object('groups', n);
    delete from public.calls          where true; get diagnostics n = row_count; r := r || jsonb_build_object('calls', n);
  end if;

  if p_scope in ('accounts', 'all') then
    -- profiles → auth.users CASCADE: postlar, xabarlar, a'zoliklar va h.k. ham o'chadi
    delete from auth.users
    where id not in (select id from public.profiles where is_admin);
    get diagnostics n = row_count; r := r || jsonb_build_object('accounts', n);
  end if;

  if p_scope = 'all' then
    delete from public.client_errors where true; get diagnostics n = row_count; r := r || jsonb_build_object('client_errors', n);
    delete from public.admin_notice  where true; get diagnostics n = row_count; r := r || jsonb_build_object('admin_notice', n);
    delete from public.contacts      where true; get diagnostics n = row_count; r := r || jsonb_build_object('contacts', n);
    update public.profiles set avatar = '' where is_admin;   -- avatar fayli ham o'chadi
  end if;

  -- Storage API orqali o'chmay qolgan fayl qatorlari (fayllar oldin klientda o'chirilgan)
  delete from storage.objects
  where bucket_id = 'media' and name in (select public._admin_wipe_objects(p_scope));
  get diagnostics n = row_count; r := r || jsonb_build_object('storage_rows', n);

  return r;
end $$;

CREATE OR REPLACE FUNCTION "public"."admin_wipe_paths"("p_scope" "text", "p_password" "text") RETURNS "text"[]
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  perform public._admin_wipe_guard(p_scope, p_password);
  return coalesce((select array_agg(n) from public._admin_wipe_objects(p_scope) as n), '{}');
end $$;

CREATE OR REPLACE FUNCTION "public"."append_call_candidate"("p_call" "uuid", "p_candidate" "jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  update public.calls set
    caller_candidates = case when caller_id = auth.uid() then caller_candidates || jsonb_build_array(p_candidate) else caller_candidates end,
    callee_candidates = case when callee_id = auth.uid() then callee_candidates || jsonb_build_array(p_candidate) else callee_candidates end
  where id = p_call and auth.uid() in (caller_id, callee_id);
end $$;

CREATE OR REPLACE FUNCTION "public"."apps_namespace_guard"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare cnt int;
begin
  if tg_op = 'UPDATE' then
    if new.slug is distinct from old.slug then raise exception 'Unikal nom o''zgarmaydi'; end if;
    new.owner_id := old.owner_id;
    return new;
  end if;
  if new.slug in ('new','edit','mine','all','create','categories','category','admin','api','apps') then
    raise exception 'Bu nom band';
  end if;
  if tg_table_name = 'apps' then
    if exists (select 1 from public.app_categories where slug = new.slug) then raise exception 'Bu nom band'; end if;
    select count(*) into cnt from public.apps where owner_id = new.owner_id;
    if cnt >= 50 then raise exception 'Ilovalar limiti (50) to''ldi'; end if;
  else
    if exists (select 1 from public.apps where slug = new.slug) then raise exception 'Bu nom band'; end if;
    select count(*) into cnt from public.app_categories where owner_id = new.owner_id;
    if cnt >= 20 then raise exception 'Kategoriyalar limiti (20) to''ldi'; end if;
  end if;
  return new;
end $$;

CREATE OR REPLACE FUNCTION "public"."apps_touch_updated"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin new.updated_at := now(); return new; end $$;

CREATE OR REPLACE FUNCTION "public"."bump_post_counters"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if tg_table_name = 'post_likes' then
    update public.posts set likes_count = greatest(likes_count + case when tg_op = 'INSERT' then 1 else -1 end, 0)
    where id = coalesce(new.post_id, old.post_id);
  else
    update public.posts set comment_count = greatest(comment_count + case when tg_op = 'INSERT' then 1 else -1 end, 0)
    where id = coalesce(new.post_id, old.post_id);
  end if;
  return null;
end $$;

CREATE OR REPLACE FUNCTION "public"."can_post_in_group"("p_group" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
    from public.groups g
    join public.group_members m on m.group_id = g.id and m.user_id = auth.uid()
    where g.id = p_group
      and (
        m.role in ('owner', 'admin')
        or (g.type = 'group' and g.msg_permission = 'all')
        or (g.type = 'group' and g.msg_permission = 'selected' and coalesce(m.can_write, false) = true)
      )
  );
$$;

CREATE OR REPLACE FUNCTION "public"."can_read_group_message"("p_group" "uuid", "p_created" timestamp with time zone) RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT COALESCE(
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.groups g
      WHERE g.id = p_group
        AND g.is_private IS NOT TRUE
    )
    OR EXISTS (
      SELECT 1 FROM public.group_members m
      WHERE m.group_id = p_group
        AND m.user_id = auth.uid()
        AND m.joined_at <= COALESCE(p_created, now()) + interval '2 seconds'
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION "public"."change_my_password"("p_old_password" "text", "p_new_password" "text", "p_device_id" "text" DEFAULT NULL::"text") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth', 'extensions'
    AS $$
declare
  v_uid uuid;
  v_enc text;
  v_lock int;
begin
  v_uid := auth.uid();
  if v_uid is null then raise exception 'Avtorizatsiyadan o''tilmagan'; end if;

  if p_device_id is null or length(trim(p_device_id)) < 8 then
    raise exception 'Xavfsizlik: qurilma identifikatori kerak';
  end if;

  v_lock := public.security_lock_remaining(trim(p_device_id));
  if v_lock > 0 then
    raise exception 'Xavfsizlik: yangi kirishdan keyin % daqiqa kuting (parol o''zgartirish)', greatest(1, ceil(v_lock / 60.0)::int);
  end if;

  if p_old_password is null or trim(p_old_password) = '' then
    raise exception 'Joriy parolni kiriting';
  end if;
  if p_new_password is null or length(p_new_password) < 6 then
    raise exception 'Yangi parol kamida 6 ta belgidan iborat bo''lishi kerak';
  end if;

  select encrypted_password into v_enc from auth.users where id = v_uid;
  if v_enc is null then raise exception 'Foydalanuvchi topilmadi'; end if;
  if v_enc != extensions.crypt(p_old_password, v_enc) then
    raise exception 'Joriy parol noto''g''ri';
  end if;

  update auth.users
  set encrypted_password = extensions.crypt(p_new_password, extensions.gen_salt('bf')),
      updated_at = now()
  where id = v_uid;

  update public.profiles
  set must_change_password = false,
      password_changed_at = now()
  where id = v_uid;

  return json_build_object('ok', true, 'message', 'Parol muvaffaqiyatli yangilandi');
end $$;

CREATE OR REPLACE FUNCTION "public"."change_my_username"("p_new_username" "text", "p_device_id" "text" DEFAULT NULL::"text") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_clean text;
  v_old text;
  v_new_email text;
  v_exists boolean;
  v_lock int;
begin
  if v_uid is null then
    raise exception 'Avtorizatsiyadan o''tilmagan';
  end if;

  if p_device_id is null or length(trim(p_device_id)) < 8 then
    raise exception 'Xavfsizlik: qurilma identifikatori kerak';
  end if;

  v_lock := public.security_lock_remaining(trim(p_device_id));
  if v_lock > 0 then
    raise exception 'Xavfsizlik: yangi kirishdan keyin % daqiqa kuting (username)', greatest(1, ceil(v_lock / 60.0)::int);
  end if;

  v_clean := lower(trim(coalesce(p_new_username, '')));
  v_clean := regexp_replace(v_clean, '[^a-z0-9_]', '', 'g');

  if length(v_clean) < 2 then
    raise exception 'Username kamida 2 ta belgi bo''lishi kerak';
  end if;
  if length(v_clean) > 20 then
    raise exception 'Username 20 ta belgidan oshmasligi kerak';
  end if;

  select username into v_old from public.profiles where id = v_uid;
  if v_old is null then
    raise exception 'Profil topilmadi';
  end if;

  if v_clean = v_old then
    return json_build_object('ok', true, 'username', v_clean, 'unchanged', true);
  end if;

  select exists(
    select 1 from public.profiles where username = v_clean and id <> v_uid
  ) into v_exists;
  if v_exists then
    raise exception 'Bu username band';
  end if;

  -- groups bilan solishtirmaymiz (alohida namespace, 060)
  v_new_email := v_clean || '@gmail.com';

  update public.profiles
  set username = v_clean,
      email = v_new_email
  where id = v_uid;

  update auth.users
  set email = v_new_email,
      email_confirmed_at = coalesce(email_confirmed_at, now()),
      updated_at = now()
  where id = v_uid;

  return json_build_object('ok', true, 'username', v_clean, 'email', v_new_email);
end;
$$;

CREATE OR REPLACE FUNCTION "public"."check_chats_rate_limit"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE recent_count INT;
BEGIN
  IF public.is_admin() THEN RETURN NEW; END IF;
  SELECT count(*) INTO recent_count FROM public.chats 
  WHERE (user_a = auth.uid() OR user_b = auth.uid()) AND created_at > now() - interval '1 minute';
  IF recent_count >= 3 THEN RAISE EXCEPTION 'Juda ko''p suhbat ochdingiz. 1 daqiqa kuting.'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "public"."check_comments_update_security"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF current_user IN ('postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  IF NOT public.is_admin() THEN
    -- Only allow changing text and edited_at
    IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
       RAISE EXCEPTION 'Security violation: Cannot modify created_at';
    END IF;
    IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
       RAISE EXCEPTION 'Security violation: Cannot transfer ownership';
    END IF;
    IF NEW.post_id IS DISTINCT FROM OLD.post_id THEN
       RAISE EXCEPTION 'Security violation: Cannot move comment to another post';
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id THEN
       RAISE EXCEPTION 'Security violation: Cannot modify comment id';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "public"."check_contacts_rate_limit"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  total_count INT;
BEGIN
  IF public.is_admin() THEN RETURN NEW; END IF;

  SELECT count(*) INTO total_count FROM public.contacts 
  WHERE owner_id = auth.uid();
    
  IF total_count >= 5000 THEN
    RAISE EXCEPTION 'Too many contacts. Maximum limit reached.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "public"."check_group_members_rate_limit"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE recent_count INT;
BEGIN
  IF public.is_admin() THEN RETURN NEW; END IF;
  SELECT count(*) INTO recent_count FROM public.group_members 
  WHERE group_id = NEW.group_id AND joined_at > now() - interval '1 minute';
  IF recent_count >= 10 THEN RAISE EXCEPTION 'Guruhga birdaniga ko''p a''zo qo''shilmoqda. 1 daqiqa kuting.'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "public"."check_group_message_update_security"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- If the user updating is NOT the sender, NOT a group admin, and NOT an admin
  IF OLD.sender_id != auth.uid() AND NOT public.is_group_admin(OLD.group_id) AND NOT public.is_admin() THEN
    IF NEW.text IS DISTINCT FROM OLD.text 
       OR NEW.media_path IS DISTINCT FROM OLD.media_path 
       OR NEW.edited_at IS DISTINCT FROM OLD.edited_at
       OR NEW.type IS DISTINCT FROM OLD.type THEN
       RAISE EXCEPTION 'Security violation: Cannot edit other users group messages';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "public"."check_groups_rate_limit"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE recent_count INT;
BEGIN
  IF public.is_admin() THEN RETURN NEW; END IF;
  SELECT count(*) INTO recent_count FROM public.groups 
  WHERE owner_id = auth.uid() AND created_at > now() - interval '1 hour';
  IF recent_count >= 3 THEN RAISE EXCEPTION 'Juda ko''p guruh yaratdingiz. 1 soat kuting.'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "public"."check_groups_update_security"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF current_user IN ('postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  IF NOT public.is_admin() THEN
    IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
       RAISE EXCEPTION 'Security violation: Cannot modify created_at';
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id THEN
       RAISE EXCEPTION 'Security violation: Cannot modify group id';
    END IF;
    IF NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
       RAISE EXCEPTION 'Security violation: Cannot transfer ownership directly (use proper RPC if allowed)';
    END IF;
    IF NEW.type IS DISTINCT FROM OLD.type THEN
       RAISE EXCEPTION 'Security violation: Cannot change group type';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "public"."check_likes_rate_limit"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE recent_count INT;
BEGIN
  IF public.is_admin() THEN RETURN NEW; END IF;
  SELECT count(*) INTO recent_count FROM public.post_likes 
  WHERE user_id = auth.uid() AND created_at > now() - interval '1 minute';
  IF recent_count >= 30 THEN RAISE EXCEPTION 'Juda ko''p reaksiya bildirdingiz. 1 daqiqa kuting.'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "public"."check_message_update_security"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- If the user updating is NOT the sender and NOT an admin
  IF OLD.sender_id != auth.uid() AND NOT public.is_admin() THEN
    -- They can only change status and read_at
    IF NEW.text IS DISTINCT FROM OLD.text 
       OR NEW.media_path IS DISTINCT FROM OLD.media_path 
       OR NEW.edited_at IS DISTINCT FROM OLD.edited_at
       OR NEW.type IS DISTINCT FROM OLD.type THEN
       RAISE EXCEPTION 'Security violation: Cannot edit other users messages';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "public"."check_posts_update_security"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF current_user IN ('postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  IF NOT public.is_admin() THEN
    IF NEW.views IS DISTINCT FROM OLD.views THEN
       IF NEW.views != OLD.views + 1 THEN
         RAISE EXCEPTION 'Security violation: Cannot artificially modify views';
       END IF;
    END IF;
    
    IF NEW.likes_count IS DISTINCT FROM OLD.likes_count THEN
       RAISE EXCEPTION 'Security violation: Cannot modify likes_count manually';
    END IF;
    
    IF NEW.comment_count IS DISTINCT FROM OLD.comment_count THEN
       RAISE EXCEPTION 'Security violation: Cannot modify comment_count manually';
    END IF;

    -- Prevent cheating feed order or ownership
    IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
       RAISE EXCEPTION 'Security violation: Cannot modify created_at (feed cheating)';
    END IF;
    IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN
       RAISE EXCEPTION 'Security violation: Cannot transfer ownership';
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id THEN
       RAISE EXCEPTION 'Security violation: Cannot modify post id';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "public"."check_profile_update_security"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  -- If the user updating is NOT an admin
  IF NOT public.is_admin() THEN
    -- Prevent changing is_admin
    IF NEW.is_admin IS DISTINCT FROM OLD.is_admin THEN
       RAISE EXCEPTION 'Security violation: Cannot modify is_admin status';
    END IF;
    -- Prevent changing approval status
    IF NEW.approval IS DISTINCT FROM OLD.approval THEN
       RAISE EXCEPTION 'Security violation: Cannot modify approval status';
    END IF;
    -- Prevent changing blocked status
    IF NEW.blocked IS DISTINCT FROM OLD.blocked THEN
       RAISE EXCEPTION 'Security violation: Cannot modify blocked status';
    END IF;
    IF NEW.blocked_until IS DISTINCT FROM OLD.blocked_until THEN
       RAISE EXCEPTION 'Security violation: Cannot modify blocked_until status';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "public"."check_rate_limit"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE recent_count INT;
BEGIN
  IF public.is_admin() THEN RETURN NEW; END IF;

  IF TG_TABLE_NAME = 'posts' THEN
    SELECT count(*) INTO recent_count FROM public.posts WHERE user_id = auth.uid() AND created_at > now() - interval '1 minute';
    IF recent_count >= 3 THEN RAISE EXCEPTION 'Juda ko''p post yukladingiz. 1 daqiqa kuting.'; END IF;
  ELSIF TG_TABLE_NAME = 'comments' THEN
    SELECT count(*) INTO recent_count FROM public.comments WHERE user_id = auth.uid() AND created_at > now() - interval '1 minute';
    IF recent_count >= 10 THEN RAISE EXCEPTION 'Juda ko''p izoh qoldirdingiz. 1 daqiqa kuting.'; END IF;
  ELSIF TG_TABLE_NAME = 'messages' THEN
    SELECT count(*) INTO recent_count FROM public.messages WHERE sender_id = auth.uid() AND created_at > now() - interval '1 minute';
    IF recent_count >= 15 THEN RAISE EXCEPTION 'Juda ko''p xabar yubordingiz. 1 daqiqa kuting.'; END IF;
  ELSIF TG_TABLE_NAME = 'group_messages' THEN
    SELECT count(*) INTO recent_count FROM public.group_messages WHERE sender_id = auth.uid() AND created_at > now() - interval '1 minute';
    IF recent_count >= 15 THEN RAISE EXCEPTION 'Guruhga juda ko''p xabar yubordingiz. 1 daqiqa kuting.'; END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "public"."check_rate_limit_calls"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE recent_count INT;
BEGIN
  IF public.is_admin() THEN RETURN NEW; END IF;
  SELECT count(*) INTO recent_count FROM public.calls WHERE caller_id = auth.uid() AND created_at > now() - interval '1 minute';
  IF recent_count >= 5 THEN RAISE EXCEPTION 'Juda ko''p qo''ng''iroq qildingiz. 1 daqiqa kuting.'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "public"."check_rate_limit_errors"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE recent_count INT;
BEGIN
  IF public.is_admin() THEN RETURN NEW; END IF;
  SELECT count(*) INTO recent_count FROM public.client_errors 
  WHERE (user_id = auth.uid() OR ip = current_setting('request.headers', true)::json->>'x-forwarded-for') 
    AND created_at > now() - interval '1 minute';
  IF recent_count >= 10 THEN RAISE EXCEPTION 'Too many errors logged.'; END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION "public"."check_user_recovery"("p_username" "text") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_uid uuid;
  v_rec text;
  v_has boolean := false;
begin
  perform pg_sleep(0.1);
  select id, recovery_email into v_uid, v_rec
  from public.profiles
  where username = lower(trim(coalesce(p_username, '')));

  if v_uid is not null and v_rec is not null and trim(v_rec) <> '' then
    v_has := true;
  end if;

  -- same keys always
  return json_build_object('exists', v_uid is not null, 'has_recovery', v_has);
end;
$$;

CREATE OR REPLACE FUNCTION "public"."cleanup_message_tombstones"("p_days" integer DEFAULT 30) RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare n bigint := 0; n2 bigint := 0;
begin
  delete from public.message_tombstones
   where deleted_at < now() - make_interval(days => p_days);
  get diagnostics n = row_count;
  delete from public.group_message_tombstones
   where deleted_at < now() - make_interval(days => p_days);
  get diagnostics n2 = row_count;
  delete from public.entity_tombstones
   where created_at < now() - make_interval(days => p_days);
  return n + n2;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."delete_my_account"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Tizimga kirilmagan';
  end if;

  -- 1. Storage ob'ektlarini tozalash
  begin
    perform set_config('storage.allow_delete_query', 'true', true);
    delete from storage.objects
    where bucket_id = 'media'
      and (name like v_uid::text || '/%' or (owner is not null and owner::text = v_uid::text));
  exception when others then
    raise notice 'Storage tozalashda ogohlantirish: %', SQLERRM;
  end;

  -- 2. Push tokenlar
  delete from public.push_tokens where user_id = v_uid;

  -- 3. Profiles (barcha jadvallar CASCADE bo'yicha o'chadi)
  delete from public.profiles where id = v_uid;

  -- 4. Auth foydalanuvchi
  delete from auth.users where id = v_uid;
end $$;

CREATE OR REPLACE FUNCTION "public"."drop_message_reactions"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  delete from public.message_reactions where message_id = old.id;
  return old;
end $$;

CREATE OR REPLACE FUNCTION "public"."email_for_username"("p_username" "text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_ip text;
  v_lookups int;
  v_last timestamptz;
  v_email text;
begin
  perform pg_sleep(0.05);
  begin
    v_ip := current_setting('request.headers', true)::json->>'x-forwarded-for';
    if v_ip is null then v_ip := 'unknown';
    else v_ip := 'eu:' || split_part(v_ip, ',', 1);
    end if;
  exception when others then
    v_ip := 'unknown';
  end;

  if random() < 0.01 then
    delete from public.anon_rate_limits where last_lookup < now() - interval '1 hour';
  end if;

  select lookups, last_lookup into v_lookups, v_last
  from public.anon_rate_limits where ip = v_ip;

  if v_lookups is not null then
    if v_lookups >= 40 and v_last > now() - interval '15 minutes' then
      return null;
    elsif v_lookups >= 40 then
      update public.anon_rate_limits set lookups = 1, last_lookup = now() where ip = v_ip;
    else
      update public.anon_rate_limits set lookups = lookups + 1, last_lookup = now() where ip = v_ip;
    end if;
  else
    insert into public.anon_rate_limits (ip) values (v_ip)
    on conflict (ip) do update set lookups = 1, last_lookup = now();
  end if;

  select email into v_email from public.profiles where username = lower(trim(p_username));
  return v_email;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."enforce_media_path_sane"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $_$
begin
  if new.media_path is not null and (
        char_length(new.media_path) > 500
     or new.media_path !~ '^[A-Za-z0-9_][A-Za-z0-9_./-]*$'
     or new.media_path ~ '\.\.'
  ) then
    raise exception 'Noto''g''ri media yo''li' using errcode = '22023';
  end if;
  return new;
end $_$;

CREATE OR REPLACE FUNCTION "public"."enforce_voice_waveform"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  j jsonb := to_jsonb(new);
  n int;
begin
  -- Fayl/matn xabarida to'lqin bo'lmaydi (mp3 yuklansa ham — faqat progress chiziq)
  if coalesce(j->>'type', '') <> 'voice' then
    new.waveform := null;
    return new;
  end if;

  -- Yozib olingan ovoz faqat chat-voice papkasidan
  if new.media_path is not null and new.media_path !~ '^[^/]+/chat-voice/' then
    raise exception 'Ovozli xabar faqat chat-voice papkasidan bo''lishi kerak' using errcode = '22023';
  end if;

  if new.waveform is null then
    return new;
  end if;

  n := coalesce(array_length(new.waveform, 1), 0);
  if n < 8 or n > 128 then
    new.waveform := null;           -- yaroqsiz uzunlik: klient decode qilib chizadi
    return new;
  end if;

  -- qiymatlarni 0..31 oralig'iga siqamiz
  new.waveform := (
    select array_agg(least(greatest(coalesce(x, 0), 0), 31)::smallint)
    from unnest(new.waveform) as x
  );
  return new;
end $$;

CREATE OR REPLACE FUNCTION "public"."expire_stale_calls"("p_max_seconds" integer DEFAULT 75) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  n integer;
begin
  update public.calls
     set status = 'ended'
   where status = 'ringing'
     and created_at < now() - make_interval(secs => greatest(p_max_seconds, 15));
  get diagnostics n = row_count;
  return n;
end $$;

CREATE OR REPLACE FUNCTION "public"."get_heads"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    AS $$
declare
  uid uuid := auth.uid();
  result jsonb;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'server_time', now(),
    'chats', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'msg_seq', c.msg_seq,
        'last_message_at', c.last_message_at,
        'last_preview', c.last_message,
        'last_sender_id', c.last_sender_id,
        'unread', coalesce(cm.unread_count, 0)
      ) order by c.last_message_at desc nulls last)
      from public.chats c
      join public.chat_members cm on cm.chat_id = c.id and cm.user_id = uid
    ), '[]'::jsonb),
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', g.id,
        'msg_seq', g.msg_seq,
        'last_message_at', g.last_message_at,
        'last_preview', g.last_message,
        'last_sender_id', g.last_sender_id,
        'unread', coalesce(gm.unread_count, 0),
        'role', gm.role
      ) order by g.last_message_at desc nulls last)
      from public.groups g
      join public.group_members gm on gm.group_id = g.id and gm.user_id = uid
    ), '[]'::jsonb),
    'feed_head', (
      select jsonb_build_object(
        'max_created_at', max(p.created_at),
        'count', count(*)::int
      ) from public.posts p
    ),
    'stories_head', (
      select jsonb_build_object(
        'max_created_at', max(s.created_at),
        'count', count(*)::int
      )
      from public.stories s
      where s.created_at > now() - interval '24 hours'
    ),
    'profile_rev', (
      select extract(epoch from p.last_seen)::bigint
      from public.profiles p where p.id = uid
    )
  ) into result;

  return result;
end;
$$;

COMMENT ON FUNCTION "public"."get_heads"() IS 'Phase 3: single-request heads for chats/groups/feed/stories';

CREATE OR REPLACE FUNCTION "public"."get_or_create_chat"("p_other" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  me uuid := auth.uid();
  a uuid; b uuid; cid uuid;
begin
  if me is null or not public.is_approved() then raise exception 'Ruxsat yo''q'; end if;
  a := least(me, p_other); b := greatest(me, p_other);
  select id into cid from public.chats where user_a = a and user_b = b;
  if cid is null then
    insert into public.chats (user_a, user_b) values (a, b) returning id into cid;
    if a = b then
      insert into public.chat_members (chat_id, user_id) values (cid, a);
    else
      insert into public.chat_members (chat_id, user_id) values (cid, a), (cid, b);
    end if;
  end if;
  return cid;
end $$;

CREATE OR REPLACE FUNCTION "public"."get_story_reaction_counts"("p_story_id" "uuid") RETURNS "jsonb"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(
    jsonb_object_agg(reaction, cnt),
    '{}'::jsonb
  )
  from (
    select reaction, count(*)::int as cnt
    from public.story_views
    where story_id = p_story_id
      and reaction is not null
      and reaction != ''
    group by reaction
  ) sub;
$$;

CREATE OR REPLACE FUNCTION "public"."group_is_private"("p_group" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce((select is_private from public.groups where id = p_group), true);
$$;

CREATE OR REPLACE FUNCTION "public"."group_messages_assign_seq"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.seq is not null then
    return new;
  end if;
  update public.groups
     set msg_seq = msg_seq + 1
   where id = new.group_id
  returning msg_seq into new.seq;
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."group_messages_tombstone"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare s bigint;
begin
  if not exists (select 1 from public.groups where id = old.group_id) then
    return old;   -- guruh o'chirilyapti (cascade)
  end if;
  update public.groups set msg_seq = msg_seq + 1 where id = old.group_id returning msg_seq into s;
  insert into public.group_message_tombstones (group_id, message_id, seq)
  values (old.group_id, old.id, coalesce(s, 0))
  on conflict (group_id, message_id) do update
    set seq = excluded.seq, deleted_at = now();
  return old;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."group_username_available"("p_username" "text", "p_exclude" "uuid" DEFAULT NULL::"uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select not exists (
    select 1 from public.groups
    where username is not null
      and lower(username) = lower(p_username)
      and (p_exclude is null or id <> p_exclude)
  );
$$;

CREATE OR REPLACE FUNCTION "public"."guard_call_update"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if auth.uid() is null or public.is_admin() then return new; end if;
  if new.caller_id is distinct from old.caller_id or new.callee_id is distinct from old.callee_id
     or new.type is distinct from old.type or new.offer is distinct from old.offer
     or new.created_at is distinct from old.created_at then
    raise exception 'Qo''ng''iroq asosiy maydonlari o''zgarmaydi';
  end if;
  if auth.uid() = old.caller_id and (new.answer is distinct from old.answer
     or new.callee_candidates is distinct from old.callee_candidates) then
    raise exception 'Chaqiruvchi callee maydonlariga tega olmaydi';
  end if;
  if auth.uid() = old.callee_id and new.caller_candidates is distinct from old.caller_candidates then
    raise exception 'Qabul qiluvchi caller maydonlariga tega olmaydi';
  end if;
  return new;
end $$;

CREATE OR REPLACE FUNCTION "public"."guard_member_update"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if auth.uid() is not null and new.role is distinct from old.role
     and not (public.is_group_admin(old.group_id) or public.is_admin()) then
    raise exception 'Rolni faqat admin o''zgartira oladi';
  end if;
  return new;
end $$;

CREATE OR REPLACE FUNCTION "public"."guard_message_update"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if auth.uid() is null then return new; end if;
  if auth.uid() = old.sender_id then
    if new.chat_id is distinct from old.chat_id or new.sender_id is distinct from old.sender_id
       or new.type is distinct from old.type or new.media_path is distinct from old.media_path
       or new.created_at is distinct from old.created_at then
      raise exception 'Faqat matn/holatni o''zgartirish mumkin';
    end if;
  else
    if new.text is distinct from old.text or new.edited_at is distinct from old.edited_at
       or new.chat_id is distinct from old.chat_id or new.sender_id is distinct from old.sender_id
       or new.type is distinct from old.type or new.media_path is distinct from old.media_path
       or new.created_at is distinct from old.created_at then
      raise exception 'Qabul qiluvchi faqat o''qilgan deb belgilay oladi';
    end if;
  end if;
  return new;
end $$;

CREATE OR REPLACE FUNCTION "public"."guard_profile_update"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if new.id is distinct from old.id
       or new.approval is distinct from old.approval
       or new.blocked is distinct from old.blocked
       or new.blocked_until is distinct from old.blocked_until
       or new.is_admin is distinct from old.is_admin
       or new.created_at is distinct from old.created_at then
      raise exception 'Bu maydonlarni faqat admin o''zgartira oladi';
    end if;
    -- email: faqat username ham o'zgarganda ruxsat (login sinxroni uchun)
    if new.email is distinct from old.email
       and new.username is not distinct from old.username then
      raise exception 'Bu maydonlarni faqat admin o''zgartira oladi';
    end if;
  end if;
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."guard_saved_chat_delete"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if old.user_a = old.user_b and exists (select 1 from public.profiles where id = old.user_a) then
    raise exception 'Saqlangan xabarlarni o''chirib bo''lmaydi';
  end if;
  return old;
end $$;

CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  uname text := lower(coalesce(new.raw_user_meta_data->>'username', split_part(new.email, '@', 1)));
  rec_email text := nullif(trim(new.raw_user_meta_data->>'recovery_email'), '');
begin
  insert into public.profiles (id, username, full_name, email, avatar, recovery_email)
  values (
    new.id,
    uname,
    coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), uname),
    new.email,
    coalesce(new.raw_user_meta_data->>'avatar', ''),
    rec_email
  );
  return new;
end $$;

CREATE OR REPLACE FUNCTION "public"."increment_post_views"("p_post_id" "uuid") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_uid uuid;
  v_new_count integer;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RETURN 0;
  END IF;

  -- Insert unique view
  INSERT INTO public.post_views (post_id, user_id, viewed_at)
  VALUES (p_post_id, v_uid, now())
  ON CONFLICT (post_id, user_id) DO NOTHING;

  -- If inserted, increment counter on post
  IF FOUND THEN
    UPDATE public.posts
    SET views_count = coalesce(views_count, 0) + 1
    WHERE id = p_post_id
    RETURNING views_count INTO v_new_count;
  ELSE
    SELECT coalesce(views_count, 0) INTO v_new_count
    FROM public.posts
    WHERE id = p_post_id;
  END IF;

  RETURN coalesce(v_new_count, 0);
END;
$$;

CREATE OR REPLACE FUNCTION "public"."is_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

CREATE OR REPLACE FUNCTION "public"."is_approved"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.approval = 'approved'
      and (not p.blocked or (p.blocked_until is not null and p.blocked_until < now()))
  );
$$;

CREATE OR REPLACE FUNCTION "public"."is_chat_member"("p_chat" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (select 1 from public.chats c
                 where c.id = p_chat and auth.uid() in (c.user_a, c.user_b));
$$;

CREATE OR REPLACE FUNCTION "public"."is_group_admin"("p_group" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (select 1 from public.group_members
                 where group_id = p_group and user_id = auth.uid() and role in ('owner','admin'));
$$;

CREATE OR REPLACE FUNCTION "public"."is_group_member"("p_group" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (select 1 from public.group_members
                 where group_id = p_group and user_id = auth.uid());
$$;

CREATE OR REPLACE FUNCTION "public"."is_my_device_revoked"("p_device_id" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.device_sessions
     where user_id = auth.uid()
       and device_id = trim(p_device_id)
       and revoked_at is not null
  );
$$;

CREATE OR REPLACE FUNCTION "public"."join_default_groups"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare v_gid uuid;
begin
  begin
    select id into v_gid from public.groups where lower(username) = 'spacemr' limit 1;
    if v_gid is not null then
      insert into public.group_members (group_id, user_id, role)
      values (v_gid, new.id, 'member')
      on conflict (group_id, user_id) do nothing;
    end if;
  exception when others then
    null;
  end;
  return new;
end $$;

CREATE OR REPLACE FUNCTION "public"."join_group_by_token"("p_token" "text") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
DECLARE
  v_group record;
  v_uid uuid := auth.uid();
  v_code text := trim(COALESCE(p_token, ''));
BEGIN
  IF v_uid IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Avtorizatsiyadan o''tilmagan');
  END IF;

  IF v_code ~* 'chats/g/' THEN
    v_code := regexp_replace(v_code, '^.*chats/g/', '', 'i');
  END IF;
  v_code := split_part(v_code, '?', 1);
  v_code := split_part(v_code, '#', 1);
  -- To'liq hex (invite) yoki username (faqat ommaviy)
  IF v_code ~ '^[a-fA-F0-9]{16,}$' THEN
    v_code := lower(regexp_replace(v_code, '[^a-fA-F0-9]', '', 'g'));
  ELSE
    v_code := lower(trim(v_code));
  END IF;

  IF v_code = '' THEN
    RETURN json_build_object('success', false, 'error', 'Havola yoki kod kiriting');
  END IF;

  SELECT * INTO v_group FROM public.groups
  WHERE (invite_code IS NOT NULL AND (invite_code = v_code OR invite_code = lower(v_code)))
     OR (username IS NOT NULL AND lower(username) = v_code AND is_private = false)
     OR (id::text = v_code)
  LIMIT 1;

  IF v_group.id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Guruh topilmadi yoki havola yaroqsiz');
  END IF;

  INSERT INTO public.group_members (group_id, user_id, role)
  VALUES (v_group.id, v_uid, 'member')
  ON CONFLICT (group_id, user_id) DO NOTHING;

  RETURN json_build_object(
    'success', true,
    'group_id', v_group.id,
    'name', v_group.name,
    'username', v_group.username,
    'is_private', COALESCE(v_group.is_private, true)
  );
END;
$_$;

CREATE OR REPLACE FUNCTION "public"."leave_group"("p_group" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_name text;
  v_role text;
begin
  if v_uid is null then
    raise exception 'Tizimga kirilmagan' using errcode = '28000';
  end if;
  select role into v_role
  from public.group_members
  where group_id = p_group and user_id = v_uid;
  if v_role is null then
    raise exception 'Bu guruhda a''zo emassiz' using errcode = '42501';
  end if;
  if v_role = 'owner' then
    raise exception 'Guruh egasi chiqa olmaydi' using errcode = '42501';
  end if;
  select coalesce(nullif(trim(full_name), ''), nullif(trim(username), ''), 'User')
    into v_name
  from public.profiles
  where id = v_uid;
  insert into public.group_messages (group_id, sender_id, type, text)
  values (p_group, v_uid, 'text', coalesce(v_name, 'User') || ' left the group');
  delete from public.group_members
  where group_id = p_group and user_id = v_uid;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."mark_my_device_password_login"("p_device_id" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  if p_device_id is null or length(trim(p_device_id)) < 8 then raise exception 'Invalid device_id'; end if;

  insert into public.device_sessions as ds (user_id, device_id, password_login_at, last_seen, revoked_at)
  values (v_uid, trim(p_device_id), now(), now(), null)
  on conflict (user_id, device_id) do update set
    password_login_at = now(),
    last_seen = now(),
    revoked_at = null
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'password_login_at', now());
end;
$$;

CREATE OR REPLACE FUNCTION "public"."message_secrets_cleanup_dm"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  delete from public.message_secrets where scope = 'dm' and message_id = old.id;
  return old;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."message_secrets_cleanup_group"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  delete from public.message_secrets where scope = 'group' and message_id = old.id;
  return old;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."messages_assign_seq"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.seq is not null then
    return new; -- backfill / aniq berilgan
  end if;
  update public.chats
     set msg_seq = msg_seq + 1
   where id = new.chat_id
  returning msg_seq into new.seq;
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."messages_tombstone"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare s bigint;
begin
  if not exists (select 1 from public.chats where id = old.chat_id) then
    return old;   -- chat o'chirilyapti (cascade)
  end if;
  update public.chats set msg_seq = msg_seq + 1 where id = old.chat_id returning msg_seq into s;
  insert into public.message_tombstones (chat_id, message_id, seq)
  values (old.chat_id, old.id, coalesce(s, 0))
  on conflict (chat_id, message_id) do update
    set seq = excluded.seq, deleted_at = now();
  return old;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."on_group_insert"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  insert into public.group_members (group_id, user_id, role) values (new.id, new.owner_id, 'owner');
  return null;
end $$;

CREATE OR REPLACE FUNCTION "public"."on_group_message_delete"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  update public.groups g set
    last_message    = coalesce(l.msg, ''),
    last_sender_id  = l.sender_id,
    last_message_at = coalesce(l.created_at, g.created_at)
  from (select distinct group_id from old_rows) d
  left join lateral (
    select m.sender_id, m.created_at,
           case m.type when 'voice' then 'Ovozli xabar'
                       when 'file'  then coalesce(nullif(m.text, ''), m.file_name, 'Fayl')
                       else coalesce(m.text, '') end as msg
    from public.group_messages m where m.group_id = d.group_id
    order by m.created_at desc limit 1
  ) l on true
  where g.id = d.group_id;
  return null;
end $$;

CREATE OR REPLACE FUNCTION "public"."on_group_message_delete_recalc_unread"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
$$;

CREATE OR REPLACE FUNCTION "public"."on_group_message_edit_last"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
$$;

CREATE OR REPLACE FUNCTION "public"."on_group_message_insert"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  update public.groups set
    last_message    = case new.type when 'voice' then 'Ovozli xabar'
                                    when 'file'  then coalesce(nullif(new.text, ''), new.file_name, 'Fayl')
                                    else coalesce(new.text, '') end,
    last_sender_id  = new.sender_id,
    last_message_at = new.created_at
  where id = new.group_id;
  update public.group_members set unread_count = unread_count + 1
  where group_id = new.group_id and user_id <> new.sender_id;
  return null;
end $$;

CREATE OR REPLACE FUNCTION "public"."on_message_delete"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  update public.chats c set
    last_message    = coalesce(l.msg, ''),
    last_sender_id  = l.sender_id,
    last_message_at = coalesce(l.created_at, c.created_at)
  from (select distinct chat_id from old_rows) d
  left join lateral (
    select m.sender_id, m.created_at,
           case m.type when 'voice' then 'Ovozli xabar'
                       when 'file'  then coalesce(nullif(m.text, ''), m.file_name, 'Fayl')
                       else coalesce(m.text, '') end as msg
    from public.messages m where m.chat_id = d.chat_id
    order by m.created_at desc limit 1
  ) l on true
  where c.id = d.chat_id;
  return null;
end $$;

CREATE OR REPLACE FUNCTION "public"."on_message_delete_recalc_unread"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
$$;

CREATE OR REPLACE FUNCTION "public"."on_message_edit_last"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
$$;

CREATE OR REPLACE FUNCTION "public"."on_message_insert"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  update public.chats set
    last_message    = case new.type when 'voice' then 'Ovozli xabar'
                                    when 'file'  then coalesce(nullif(new.text, ''), new.file_name, 'Fayl')
                                    else coalesce(new.text, '') end,
    last_sender_id  = new.sender_id,
    last_message_at = new.created_at
  where id = new.chat_id;
  update public.chat_members set unread_count = unread_count + 1
  where chat_id = new.chat_id and user_id <> new.sender_id;
  return null;
end $$;

CREATE OR REPLACE FUNCTION "public"."post_is_visible"("p_post" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select public.is_admin() or exists (
    select 1 from public.posts
    where id = p_post and (is_public or user_id = auth.uid())
  );
$$;

CREATE OR REPLACE FUNCTION "public"."register_push_token"("p_token" "text", "p_platform" "text" DEFAULT NULL::"text", "p_origin" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if auth.uid() is null then raise exception 'Tizimga kirilmagan'; end if;
  insert into public.push_tokens (token, user_id, platform, origin)
  values (p_token, auth.uid(), p_platform, left(p_origin, 200))
  on conflict (token) do update
    set user_id  = auth.uid(),
        platform = excluded.platform,
        origin   = coalesce(excluded.origin, public.push_tokens.origin);
end $$;

CREATE OR REPLACE FUNCTION "public"."request_password_reset"("p_username" "text", "p_temp_password" "text") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth', 'extensions'
    AS $$
declare
  v_uid uuid;
  v_rec text;
  v_masked text;
  v_len int;
  v_ip text;
  v_lookups int;
  v_last timestamptz;
begin
  -- uniform slow path against user enumeration
  perform pg_sleep(0.15);

  if p_temp_password is null or length(trim(p_temp_password)) < 6 or length(trim(p_temp_password)) > 64 then
    return json_build_object('ok', false, 'error', 'invalid');
  end if;

  -- rate limit by IP (reuse anon_rate_limits)
  begin
    v_ip := current_setting('request.headers', true)::json->>'x-forwarded-for';
    if v_ip is null then v_ip := 'unknown';
    else v_ip := 'rp:' || split_part(v_ip, ',', 1);
    end if;
  exception when others then
    v_ip := 'unknown';
  end;

  select lookups, last_lookup into v_lookups, v_last
  from public.anon_rate_limits where ip = v_ip;

  if v_lookups is not null then
    if v_lookups >= 5 and v_last > now() - interval '15 minutes' then
      return json_build_object('ok', false, 'error', 'rate_limited');
    elsif v_lookups >= 5 then
      update public.anon_rate_limits set lookups = 1, last_lookup = now() where ip = v_ip;
    else
      update public.anon_rate_limits set lookups = lookups + 1, last_lookup = now() where ip = v_ip;
    end if;
  else
    insert into public.anon_rate_limits (ip, lookups, last_lookup)
    values (v_ip, 1, now())
    on conflict (ip) do update set lookups = 1, last_lookup = now();
  end if;

  select id, recovery_email into v_uid, v_rec
  from public.profiles
  where username = lower(trim(p_username));

  -- always same shape — no "user not found" vs "no email" distinction to attacker
  if v_uid is null or v_rec is null or trim(v_rec) = '' then
    return json_build_object('ok', true, 'masked_email', null, 'sent', false);
  end if;

  update public.profiles
  set recovery_code = trim(p_temp_password),
      recovery_code_expires_at = now() + interval '15 minutes',
      recovery_attempts = 0
  where id = v_uid;

  v_len := position('@' in v_rec);
  if v_len > 3 then
    v_masked := substr(v_rec, 1, 1) || '***' || substr(v_rec, greatest(v_len - 1, 1));
  else
    v_masked := '***';
  end if;

  -- NEVER return uid or full recovery_email
  return json_build_object('ok', true, 'masked_email', v_masked, 'sent', true);
end;
$$;

COMMENT ON FUNCTION "public"."request_password_reset"("p_username" "text", "p_temp_password" "text") IS '081: no uid/full email; rate-limited; uniform ok response';

CREATE OR REPLACE FUNCTION "public"."reset_password_with_code"("p_username" "text", "p_code" "text", "p_new_password" "text") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_uid uuid;
  v_email text;
  v_code text;
  v_exp timestamptz;
  v_attempts int;
begin
  if p_new_password is null or length(trim(p_new_password)) < 6 then
    raise exception 'Yangi parol kamida 6 ta belgidan iborat bo''lishi kerak';
  end if;

  if p_code is null or trim(p_code) = '' then
    raise exception 'Tasdiqlash kodini kiriting';
  end if;

  select id, email, recovery_code, recovery_code_expires_at, coalesce(recovery_attempts, 0)
  into v_uid, v_email, v_code, v_exp, v_attempts
  from public.profiles
  where lower(username) = lower(trim(p_username));

  if v_uid is null then
    raise exception 'Bunday foydalanuvchi topilmadi';
  end if;

  if v_code is null or v_exp is null then
    raise exception 'Tiklash kodi so''ralmagan yoki allaqachon ishlatilgan';
  end if;

  if now() > v_exp then
    -- Muddati o'tgan kodni tozalash
    update public.profiles set recovery_code = null, recovery_code_expires_at = null where id = v_uid;
    raise exception 'Tasdiqlash kodining amal qilish muddati tugagan. Qaytadan so''rang.';
  end if;

  if v_attempts >= 5 then
    update public.profiles set recovery_code = null, recovery_code_expires_at = null where id = v_uid;
    raise exception 'Kod juda ko''p marta noto''g''ri kiritildi. Qaytadan kod so''rang.';
  end if;

  -- Kodni solishtirish (katta-kichik harfga sezgir bo'lmagan qilib tekshiramiz)
  if lower(trim(v_code)) != lower(trim(p_code)) then
    update public.profiles set recovery_attempts = v_attempts + 1 where id = v_uid;
    raise exception 'Tasdiqlash kodi noto''g''ri (% ta urinish qoldi)', (5 - (v_attempts + 1));
  end if;

  -- 1. auth.users da yangi shaxsiy parolni shifrlab o'rnatish
  update auth.users
  set encrypted_password = extensions.crypt(p_new_password, extensions.gen_salt('bf')),
      updated_at = now()
  where id = v_uid;

  -- 2. profiles dagi tiklash kodini tozalash va must_change_password ni SOZLASh
  -- Agar ular kodning o'zini parol sifatida jo'natishgan bo'lsa (login ekranidan), must_change_password = true bo'ladi!
  update public.profiles
  set recovery_code = null,
      recovery_code_expires_at = null,
      recovery_attempts = 0,
      must_change_password = case when trim(p_code) = trim(p_new_password) then true else false end,
      password_changed_at = now()
  where id = v_uid;

  return json_build_object(
    'ok', true,
    'username', lower(trim(p_username)),
    'email', v_email,
    'message', 'Parol muvaffaqiyatli yangilandi'
  );
end $$;

CREATE OR REPLACE FUNCTION "public"."resolve_group_invite"("p_token" "text") RETURNS json
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_raw text := trim(COALESCE(p_token, ''));
  v_code text;
  v_group record;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Avtorizatsiyadan o''tilmagan');
  END IF;
  IF v_raw = '' THEN
    RETURN json_build_object('success', false, 'error', 'Havola yoki kod kiriting');
  END IF;

  -- URL / path dan kod ajratish
  v_code := v_raw;
  -- https://.../chats/g/<code>
  IF v_code ~* 'chats/g/' THEN
    v_code := regexp_replace(v_code, '^.*chats/g/', '', 'i');
  END IF;
  -- query/hash olib tashlash
  v_code := split_part(v_code, '?', 1);
  v_code := split_part(v_code, '#', 1);
  v_code := regexp_replace(v_code, '[^a-fA-F0-9]', '', 'g');

  IF length(v_code) < 16 THEN
    RETURN json_build_object('success', false, 'error', 'Kod juda qisqa yoki noto''g''ri');
  END IF;

  SELECT id, name, username, is_private, avatar, invite_code
    INTO v_group
  FROM public.groups
  WHERE invite_code = v_code
     OR invite_code = lower(v_code)
     OR id::text = v_code
  LIMIT 1;

  IF v_group.id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Guruh topilmadi');
  END IF;

  RETURN json_build_object(
    'success', true,
    'group_id', v_group.id,
    'name', v_group.name,
    'username', v_group.username,
    'is_private', COALESCE(v_group.is_private, true),
    'avatar', v_group.avatar
  );
END;
$$;

CREATE OR REPLACE FUNCTION "public"."reveal_spoiler"("p_scope" "text", "p_message_id" "uuid", "p_ordinal" integer) RETURNS "text"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_ok boolean := false;
  v_body text;
  v_chat uuid;
  v_group uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if p_scope is null or p_scope not in ('dm', 'group') then
    raise exception 'bad scope';
  end if;
  if p_message_id is null or p_ordinal is null or p_ordinal < 0 or p_ordinal > 63 then
    raise exception 'bad args';
  end if;

  if p_scope = 'dm' then
    select chat_id into v_chat from public.messages where id = p_message_id;
    if v_chat is null then
      return null;
    end if;
    v_ok := public.is_chat_member(v_chat) or public.is_admin();
  else
    select group_id into v_group from public.group_messages where id = p_message_id;
    if v_group is null then
      return null;
    end if;
    v_ok := public.is_group_member(v_group) or public.is_admin();
  end if;

  if not v_ok then
    raise exception 'forbidden';
  end if;

  select body into v_body
  from public.message_secrets
  where scope = p_scope and message_id = p_message_id and ordinal = p_ordinal;

  return v_body;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."revoke_my_device_sessions"("p_device_id" "text" DEFAULT NULL::"text", "p_all_others" boolean DEFAULT false, "p_caller_device_id" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_ids text[];
  v_count int := 0;
  v_lock int;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;

  if p_caller_device_id is null or length(trim(p_caller_device_id)) < 8 then
    raise exception 'Qurilma identifikatori kerak';
  end if;

  v_lock := public.security_lock_remaining(trim(p_caller_device_id));
  if v_lock > 0 then
    raise exception 'Xavfsizlik: yangi kirishdan keyin % daqiqa kuting (qurilmalar / parol)', greatest(1, ceil(v_lock / 60.0)::int);
  end if;

  if p_all_others then
    with updated as (
      update public.device_sessions
         set revoked_at = now()
       where user_id = v_uid
         and revoked_at is null
         and device_id is distinct from trim(p_caller_device_id)
      returning device_id
    )
    select coalesce(array_agg(device_id), array[]::text[]) into v_ids from updated;
  elsif p_device_id is not null and length(trim(p_device_id)) > 0 then
    if trim(p_device_id) = trim(p_caller_device_id) then
      raise exception 'Joriy qurilmani chiqarib bo''lmaydi';
    end if;
    with updated as (
      update public.device_sessions
         set revoked_at = now()
       where user_id = v_uid
         and device_id = trim(p_device_id)
         and revoked_at is null
      returning device_id
    )
    select coalesce(array_agg(device_id), array[]::text[]) into v_ids from updated;
  else
    raise exception 'device_id yoki all_others kerak';
  end if;

  v_count := coalesce(array_length(v_ids, 1), 0);
  return jsonb_build_object('ok', true, 'count', v_count, 'device_ids', to_jsonb(coalesce(v_ids, array[]::text[])));
end;
$$;

CREATE OR REPLACE FUNCTION "public"."security_lock_remaining"("p_device_id" "text") RETURNS integer
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_at timestamptz;
  v_sec integer;
begin
  if v_uid is null then return 3600; end if;
  if p_device_id is null or length(trim(p_device_id)) < 8 then return 3600; end if;

  select password_login_at into v_at
  from public.device_sessions
  where user_id = v_uid and device_id = trim(p_device_id);

  if v_at is null then return 0; end if;

  v_sec := greatest(0, ceil(extract(epoch from (v_at + interval '1 hour' - now())))::integer);
  return v_sec;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."server_now"() RETURNS timestamp with time zone
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$ select now(); $$;

CREATE OR REPLACE FUNCTION "public"."store_message_secrets"("p_scope" "text", "p_message_id" "uuid", "p_secrets" "text"[]) RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_sender uuid;
  v_n int;
  i int;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if p_scope is null or p_scope not in ('dm', 'group') then
    raise exception 'bad scope';
  end if;
  if p_message_id is null then
    raise exception 'bad message_id';
  end if;
  v_n := coalesce(array_length(p_secrets, 1), 0);
  if v_n = 0 then
    return;
  end if;
  if v_n > 32 then
    raise exception 'too many secrets';
  end if;

  if p_scope = 'dm' then
    select sender_id into v_sender from public.messages where id = p_message_id;
  else
    select sender_id into v_sender from public.group_messages where id = p_message_id;
  end if;

  if v_sender is null then
    raise exception 'message not found';
  end if;
  if v_sender <> v_uid and not public.is_admin() then
    raise exception 'not sender';
  end if;

  for i in 1..v_n loop
    if p_secrets[i] is null or char_length(p_secrets[i]) = 0 or char_length(p_secrets[i]) > 8000 then
      raise exception 'bad secret at %', i - 1;
    end if;
    insert into public.message_secrets (scope, message_id, ordinal, body)
    values (p_scope, p_message_id, i - 1, p_secrets[i])
    on conflict (scope, message_id, ordinal) do update
      set body = excluded.body
      where public.message_secrets.body is distinct from excluded.body;
  end loop;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."sync_chat"("p_chat_id" "uuid", "p_after_seq" bigint DEFAULT 0, "p_limit" integer DEFAULT 100) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    AS $$
declare
  uid uuid := auth.uid();
  head bigint;
  lim int := greatest(1, least(coalesce(p_limit, 100), 200));
  after_seq bigint := coalesce(p_after_seq, 0);
  oldest_tomb bigint;
  reset_req boolean := false;
  msgs jsonb;
  tombs jsonb;
  has_more boolean := false;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not (public.is_chat_member(p_chat_id) or public.is_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select c.msg_seq into head from public.chats c where c.id = p_chat_id;
  if head is null then
    return jsonb_build_object(
      'messages', '[]'::jsonb,
      'tombstones', '[]'::jsonb,
      'head_seq', 0,
      'has_more', false,
      'reset_required', true,
      'server_time', now()
    );
  end if;

  select min(t.seq) into oldest_tomb
    from public.message_tombstones t where t.chat_id = p_chat_id;
  if after_seq > 0 and oldest_tomb is not null and after_seq < oldest_tomb then
    reset_req := true;
  end if;

  if reset_req then
    return jsonb_build_object(
      'messages', '[]'::jsonb,
      'tombstones', '[]'::jsonb,
      'head_seq', head,
      'has_more', false,
      'reset_required', true,
      'server_time', now()
    );
  end if;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.seq), '[]'::jsonb)
  into msgs
  from (
    select m.id, m.seq, m.chat_id, m.sender_id, m.type, m.text,
           m.media_path, m.media_type, m.file_name, m.file_size,
           m.duration, m.status, m.read_at, m.edited_at, m.created_at,
           m.reply_to, m.waveform
    from public.messages m
    where m.chat_id = p_chat_id and m.seq > after_seq
    order by m.seq asc
    limit lim + 1
  ) x;

  if jsonb_array_length(msgs) > lim then
    has_more := true;
    msgs := (
      select coalesce(jsonb_agg(s.e order by s.n), '[]'::jsonb) from (
        select e, n from jsonb_array_elements(msgs) with ordinality t(e, n)
        where n <= lim
      ) s
    );
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'message_id', s.message_id,
    'seq', s.seq,
    'deleted_at', s.deleted_at
  ) order by s.seq), '[]'::jsonb)
  into tombs
  from (
    select t.message_id, t.seq, t.deleted_at
    from public.message_tombstones t
    where t.chat_id = p_chat_id and t.seq > after_seq
    order by t.seq asc
    limit lim
  ) s;

  return jsonb_build_object(
    'messages', msgs,
    'tombstones', tombs,
    'head_seq', head,
    'has_more', has_more,
    'reset_required', false,
    'server_time', now()
  );
end;
$$;

COMMENT ON FUNCTION "public"."sync_chat"("p_chat_id" "uuid", "p_after_seq" bigint, "p_limit" integer) IS 'Phase 3: delta sync for DM thread';

CREATE OR REPLACE FUNCTION "public"."sync_group"("p_group_id" "uuid", "p_after_seq" bigint DEFAULT 0, "p_limit" integer DEFAULT 100) RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    AS $$
declare
  uid uuid := auth.uid();
  head bigint;
  lim int := greatest(1, least(coalesce(p_limit, 100), 200));
  after_seq bigint := coalesce(p_after_seq, 0);
  oldest_tomb bigint;
  reset_req boolean := false;
  msgs jsonb;
  tombs jsonb;
  has_more boolean := false;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not (public.is_group_member(p_group_id) or public.is_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select g.msg_seq into head from public.groups g where g.id = p_group_id;
  if head is null then
    return jsonb_build_object(
      'messages', '[]'::jsonb,
      'tombstones', '[]'::jsonb,
      'head_seq', 0,
      'has_more', false,
      'reset_required', true,
      'server_time', now()
    );
  end if;

  select min(t.seq) into oldest_tomb
    from public.group_message_tombstones t where t.group_id = p_group_id;
  if after_seq > 0 and oldest_tomb is not null and after_seq < oldest_tomb then
    reset_req := true;
  end if;

  if reset_req then
    return jsonb_build_object(
      'messages', '[]'::jsonb,
      'tombstones', '[]'::jsonb,
      'head_seq', head,
      'has_more', false,
      'reset_required', true,
      'server_time', now()
    );
  end if;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.seq), '[]'::jsonb)
  into msgs
  from (
    select m.id, m.seq, m.group_id, m.sender_id, m.type, m.text,
           m.media_path, m.media_type, m.file_name, m.file_size,
           m.duration, m.edited_at, m.created_at, m.reply_to, m.waveform
    from public.group_messages m
    where m.group_id = p_group_id and m.seq > after_seq
    order by m.seq asc
    limit lim + 1
  ) x;

  if jsonb_array_length(msgs) > lim then
    has_more := true;
    msgs := (
      select coalesce(jsonb_agg(s.e order by s.n), '[]'::jsonb) from (
        select e, n from jsonb_array_elements(msgs) with ordinality t(e, n)
        where n <= lim
      ) s
    );
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'message_id', s.message_id,
    'seq', s.seq,
    'deleted_at', s.deleted_at
  ) order by s.seq), '[]'::jsonb)
  into tombs
  from (
    select t.message_id, t.seq, t.deleted_at
    from public.group_message_tombstones t
    where t.group_id = p_group_id and t.seq > after_seq
    order by t.seq asc
    limit lim
  ) s;

  return jsonb_build_object(
    'messages', msgs,
    'tombstones', tombs,
    'head_seq', head,
    'has_more', has_more,
    'reset_required', false,
    'server_time', now()
  );
end;
$$;

COMMENT ON FUNCTION "public"."sync_group"("p_group_id" "uuid", "p_after_seq" bigint, "p_limit" integer) IS 'Delta sync for group thread; tombstone ORDER BY subquery (096)';

CREATE OR REPLACE FUNCTION "public"."touch_group_member_read"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
begin
  -- faqat a'zoning o'zi o'qilgan deb belgilaganda (unread_count -> 0)
  if auth.uid() is not null and auth.uid() = new.user_id and new.unread_count = 0 then
    new.last_read_at := now();
  end if;
  return new;
end $$;

CREATE OR REPLACE FUNCTION "public"."transfer_groups_on_profile_delete"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
    g record;
    new_owner uuid;
BEGIN
    FOR g IN SELECT id FROM public.groups WHERE owner_id = OLD.id LOOP
        -- find oldest admin
        SELECT user_id INTO new_owner FROM public.group_members 
        WHERE group_id = g.id AND user_id != OLD.id AND role = 'admin' 
        ORDER BY joined_at ASC LIMIT 1;
        
        IF new_owner IS NULL THEN
            -- find oldest member
            SELECT user_id INTO new_owner FROM public.group_members 
            WHERE group_id = g.id AND user_id != OLD.id 
            ORDER BY joined_at ASC LIMIT 1;
        END IF;

        IF new_owner IS NOT NULL THEN
            UPDATE public.groups SET owner_id = new_owner WHERE id = g.id;
            UPDATE public.group_members SET role = 'owner' WHERE group_id = g.id AND user_id = new_owner;
        ELSE
            DELETE FROM public.groups WHERE id = g.id;
        END IF;
    END LOOP;
    RETURN OLD;
END;
$$;

CREATE OR REPLACE FUNCTION "public"."upsert_my_device_session"("p_device_id" "text", "p_device_name" "text" DEFAULT ''::"text", "p_device_model" "text" DEFAULT ''::"text", "p_browser" "text" DEFAULT ''::"text", "p_client_type" "text" DEFAULT 'browser'::"text", "p_platform" "text" DEFAULT ''::"text", "p_os_version" "text" DEFAULT ''::"text", "p_user_agent" "text" DEFAULT ''::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
  v_ct  text;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if p_device_id is null or length(trim(p_device_id)) < 8 then
    raise exception 'Invalid device_id';
  end if;
  v_ct := case when p_client_type in ('browser','pwa','unknown') then p_client_type else 'browser' end;

  insert into public.device_sessions as ds (
    user_id, device_id, device_name, device_model, browser, client_type,
    platform, os_version, user_agent, last_seen, revoked_at
  ) values (
    v_uid, trim(p_device_id),
    left(coalesce(p_device_name,''), 120),
    left(coalesce(p_device_model,''), 120),
    left(coalesce(p_browser,''), 80),
    v_ct,
    left(coalesce(p_platform,''), 80),
    left(coalesce(p_os_version,''), 40),
    left(coalesce(p_user_agent,''), 512),
    now(),
    null
  )
  on conflict (user_id, device_id) do update set
    device_name  = excluded.device_name,
    device_model = excluded.device_model,
    browser      = excluded.browser,
    client_type  = excluded.client_type,
    platform     = excluded.platform,
    os_version   = excluded.os_version,
    user_agent   = excluded.user_agent,
    last_seen    = now(),
    revoked_at   = null
  returning id into v_id;

  return v_id;
end;
$$;

CREATE OR REPLACE FUNCTION "public"."user_password_updated"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if auth.uid() is null then
    raise exception 'Tizimga kirilmagan';
  end if;

  update public.profiles
  set must_change_password = false,
      password_changed_at = now()
  where id = auth.uid();
end $$;

CREATE OR REPLACE FUNCTION "public"."username_available"("p_username" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select not exists (
    select 1 from public.profiles where username = lower(p_username)
  );
$$;

CREATE OR REPLACE FUNCTION "public"."verify_recovery_code"("p_username" "text", "p_code" "text") RETURNS json
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_uid uuid;
  v_rec text;
  v_code text;
  v_exp timestamptz;
  v_masked text;
  v_len int;
  v_attempts int;
begin
  if p_username is null or p_code is null or trim(p_code) = '' then
    return json_build_object('valid', false);
  end if;

  select id, recovery_email, recovery_code, recovery_code_expires_at, coalesce(recovery_attempts, 0)
  into v_uid, v_rec, v_code, v_exp, v_attempts
  from public.profiles
  where username = lower(trim(p_username));

  if v_uid is null or v_code is null or v_exp is null then
    return json_build_object('valid', false);
  end if;

  if v_attempts >= 8 then
    return json_build_object('valid', false, 'locked', true);
  end if;

  if now() > v_exp then
    return json_build_object('valid', false, 'expired', true);
  end if;

  if lower(trim(v_code)) = lower(trim(p_code)) then
    update public.profiles set recovery_attempts = 0 where id = v_uid;
    if v_rec is not null then
      v_len := position('@' in v_rec);
      if v_len > 3 then
        v_masked := substr(v_rec, 1, 1) || '***' || substr(v_rec, v_len - 1);
      else
        v_masked := '***' || substr(v_rec, v_len);
      end if;
    end if;
    return json_build_object(
      'valid', true,
      'username', lower(trim(p_username)),
      'masked_email', v_masked
    );
  end if;

  update public.profiles
  set recovery_attempts = coalesce(recovery_attempts, 0) + 1
  where id = v_uid;

  return json_build_object('valid', false, 'attempts', v_attempts + 1);
end;
$$;

-- ═══ 3. JADVALLAR VA ketma-ketliklar ═══════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "public"."admin_notice" (
    "id" "text" DEFAULT 'global'::"text" NOT NULL,
    "text" "text" NOT NULL,
    "target" "text" DEFAULT 'all'::"text" NOT NULL,
    "admin_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "admin_notice_id_check" CHECK (("id" = 'global'::"text"))
);

CREATE TABLE IF NOT EXISTS "public"."anon_rate_limits" (
    "ip" "text" NOT NULL,
    "lookups" integer DEFAULT 1,
    "last_lookup" timestamp with time zone DEFAULT "now"()
);

CREATE TABLE IF NOT EXISTS "public"."app_categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "slug" "text" NOT NULL,
    "name" "text" NOT NULL,
    "owner_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "app_categories_name_chk" CHECK ((("char_length"("btrim"("name")) >= 1) AND ("char_length"("btrim"("name")) <= 40))),
    CONSTRAINT "app_categories_slug_chk" CHECK (("slug" ~ '^[a-z0-9][a-z0-9_-]{2,29}$'::"text"))
);

CREATE TABLE IF NOT EXISTS "public"."app_force_reload" (
    "id" "text" DEFAULT 'global'::"text" NOT NULL,
    "version" bigint DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "by_admin" "uuid",
    CONSTRAINT "app_force_reload_id_check" CHECK (("id" = 'global'::"text"))
);

CREATE TABLE IF NOT EXISTS "public"."apps" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "slug" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "category_id" "uuid" NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "html" "text" NOT NULL,
    "logo" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "apps_desc_chk" CHECK (("char_length"("description") <= 200)),
    CONSTRAINT "apps_html_chk" CHECK ((("octet_length"("html") >= 1) AND ("octet_length"("html") <= 1000000))),
    CONSTRAINT "apps_logo_chk" CHECK ((("logo" IS NULL) OR (("logo" ~ '^data:image/(png|jpeg|svg\+xml|webp);base64,[A-Za-z0-9+/=]+$'::"text") AND ("char_length"("logo") <= 120000)))),
    CONSTRAINT "apps_name_chk" CHECK ((("char_length"("btrim"("name")) >= 1) AND ("char_length"("btrim"("name")) <= 40))),
    CONSTRAINT "apps_slug_chk" CHECK (("slug" ~ '^[a-z0-9][a-z0-9_-]{2,29}$'::"text"))
);

CREATE TABLE IF NOT EXISTS "public"."calls" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "caller_id" "uuid" NOT NULL,
    "callee_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "status" "text" DEFAULT 'ringing'::"text" NOT NULL,
    "offer" "jsonb" NOT NULL,
    "answer" "jsonb",
    "caller_candidates" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "callee_candidates" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "video_offer" "jsonb",
    "video_answer" "jsonb",
    CONSTRAINT "calls_type_check" CHECK (("type" = ANY (ARRAY['voice'::"text", 'video'::"text"])))
);

ALTER TABLE ONLY "public"."calls" REPLICA IDENTITY FULL;

CREATE TABLE IF NOT EXISTS "public"."chat_members" (
    "chat_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "unread_count" integer DEFAULT 0 NOT NULL
);

ALTER TABLE ONLY "public"."chat_members" REPLICA IDENTITY FULL;

CREATE TABLE IF NOT EXISTS "public"."chats" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_a" "uuid" NOT NULL,
    "user_b" "uuid" NOT NULL,
    "last_message" "text" DEFAULT ''::"text" NOT NULL,
    "last_sender_id" "uuid",
    "last_message_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "msg_seq" bigint DEFAULT 0 NOT NULL,
    CONSTRAINT "chats_check" CHECK (("user_a" <= "user_b"))
);

COMMENT ON COLUMN "public"."chats"."msg_seq" IS 'Last assigned message seq for this chat';

CREATE TABLE IF NOT EXISTS "public"."client_errors" (
    "id" bigint NOT NULL,
    "user_id" "uuid",
    "message" "text" NOT NULL,
    "source" "text",
    "stack" "text",
    "ua" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ip" "text"
);

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public."client_errors"'::regclass AND attname = 'id' AND attidentity <> '') THEN
    ALTER TABLE "public"."client_errors" ALTER COLUMN "id" ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME "public"."client_errors_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);
  END IF;
END $do$;

CREATE TABLE IF NOT EXISTS "public"."comments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "post_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "user_name" "text" DEFAULT ''::"text" NOT NULL,
    "text" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "comments_text_length_check" CHECK (("char_length"("text") <= 3000))
);

ALTER TABLE ONLY "public"."comments" REPLICA IDENTITY FULL;

CREATE TABLE IF NOT EXISTS "public"."composer_drafts" (
    "user_id" "uuid" NOT NULL,
    "scope" "text" NOT NULL,
    "body" "text" DEFAULT ''::"text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."contacts" (
    "owner_id" "uuid" NOT NULL,
    "contact_id" "uuid" NOT NULL,
    "full_name" "text" DEFAULT ''::"text" NOT NULL,
    "avatar" "text" DEFAULT ''::"text" NOT NULL,
    "added_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."content_reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "reporter_id" "uuid" NOT NULL,
    "target_type" "text" NOT NULL,
    "target_id" "text",
    "target_uid" "uuid",
    "reason" "text" NOT NULL,
    "note" "text",
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "content_reports_status_check" CHECK (("status" = ANY (ARRAY['open'::"text", 'reviewing'::"text", 'closed'::"text"]))),
    CONSTRAINT "content_reports_target_type_check" CHECK (("target_type" = ANY (ARRAY['post'::"text", 'user'::"text", 'other'::"text"])))
);

CREATE TABLE IF NOT EXISTS "public"."device_sessions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "device_id" "text" NOT NULL,
    "device_name" "text" DEFAULT ''::"text" NOT NULL,
    "device_model" "text" DEFAULT ''::"text" NOT NULL,
    "browser" "text" DEFAULT ''::"text" NOT NULL,
    "client_type" "text" DEFAULT 'browser'::"text" NOT NULL,
    "platform" "text" DEFAULT ''::"text" NOT NULL,
    "os_version" "text" DEFAULT ''::"text" NOT NULL,
    "user_agent" "text" DEFAULT ''::"text" NOT NULL,
    "last_seen" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "revoked_at" timestamp with time zone,
    "password_login_at" timestamp with time zone,
    CONSTRAINT "device_sessions_client_type_check" CHECK (("client_type" = ANY (ARRAY['browser'::"text", 'pwa'::"text", 'unknown'::"text"])))
);

CREATE TABLE IF NOT EXISTS "public"."entity_tombstones" (
    "id" bigint NOT NULL,
    "entity" "text" NOT NULL,
    "entity_id" "uuid" NOT NULL,
    "scope_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

CREATE SEQUENCE IF NOT EXISTS "public"."entity_tombstones_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE "public"."entity_tombstones_id_seq" OWNED BY "public"."entity_tombstones"."id";

CREATE TABLE IF NOT EXISTS "public"."group_members" (
    "group_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'member'::"text" NOT NULL,
    "unread_count" integer DEFAULT 0 NOT NULL,
    "joined_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_read_at" timestamp with time zone,
    "can_write" boolean DEFAULT true NOT NULL,
    CONSTRAINT "group_members_role_check" CHECK (("role" = ANY (ARRAY['owner'::"text", 'admin'::"text", 'member'::"text"])))
);

ALTER TABLE ONLY "public"."group_members" REPLICA IDENTITY FULL;

CREATE TABLE IF NOT EXISTS "public"."group_message_tombstones" (
    "group_id" "uuid" NOT NULL,
    "message_id" "uuid" NOT NULL,
    "seq" bigint NOT NULL,
    "deleted_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE ONLY "public"."group_message_tombstones" REPLICA IDENTITY FULL;

CREATE TABLE IF NOT EXISTS "public"."group_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "group_id" "uuid" NOT NULL,
    "sender_id" "uuid" NOT NULL,
    "type" "text" DEFAULT 'text'::"text" NOT NULL,
    "text" "text",
    "media_path" "text",
    "media_type" "text",
    "file_name" "text",
    "file_size" bigint,
    "edited_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "duration" integer,
    "reply_to" "uuid",
    "waveform" smallint[],
    "seq" bigint NOT NULL,
    CONSTRAINT "gmsg_text_length_check" CHECK (("char_length"("text") <= 5000)),
    CONSTRAINT "group_messages_type_check" CHECK (("type" = ANY (ARRAY['text'::"text", 'voice'::"text", 'file'::"text"])))
);

ALTER TABLE ONLY "public"."group_messages" REPLICA IDENTITY FULL;

COMMENT ON COLUMN "public"."group_messages"."reply_to" IS 'Parent message id this message is replying to (Telegram-style quote)';

CREATE TABLE IF NOT EXISTS "public"."groups" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "type" "text" NOT NULL,
    "name" "text" NOT NULL,
    "avatar" "text" DEFAULT ''::"text" NOT NULL,
    "description" "text" DEFAULT ''::"text" NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "is_private" boolean DEFAULT false NOT NULL,
    "invite_code" "text",
    "msg_permission" "text" DEFAULT 'all'::"text" NOT NULL,
    "last_message" "text" DEFAULT ''::"text" NOT NULL,
    "last_sender_id" "uuid",
    "last_message_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "username" "text",
    "msg_seq" bigint DEFAULT 0 NOT NULL,
    CONSTRAINT "groups_description_length_check" CHECK (("char_length"("description") <= 1000)),
    CONSTRAINT "groups_msg_permission_check" CHECK (("msg_permission" = ANY (ARRAY['all'::"text", 'admins'::"text", 'selected'::"text"]))),
    CONSTRAINT "groups_name_length_check" CHECK (("char_length"("name") <= 100)),
    CONSTRAINT "groups_type_check" CHECK (("type" = ANY (ARRAY['group'::"text", 'channel'::"text"]))),
    CONSTRAINT "groups_username_check" CHECK ((("username" IS NULL) OR (("username" = "lower"("username")) AND ("length"("username") >= 2) AND ("length"("username") <= 40) AND ("username" ~ '^[a-z0-9_]+$'::"text"))))
);

CREATE TABLE IF NOT EXISTS "public"."message_reactions" (
    "message_id" "uuid" NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "thread_id" "uuid" NOT NULL,
    "kind" "text" NOT NULL,
    "emoji" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "message_reactions_emoji_check" CHECK ((("char_length"("emoji") <= 96) AND ("emoji" ~ '^emoji/2d/[0-9a-f]{2,6}(-[0-9a-f]{2,6})*\.png$'::"text"))),
    CONSTRAINT "message_reactions_kind_check" CHECK (("kind" = ANY (ARRAY['dm'::"text", 'group'::"text"])))
);

ALTER TABLE ONLY "public"."message_reactions" REPLICA IDENTITY FULL;

CREATE TABLE IF NOT EXISTS "public"."message_secrets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "scope" "text" NOT NULL,
    "message_id" "uuid" NOT NULL,
    "ordinal" integer NOT NULL,
    "body" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "message_secrets_body_check" CHECK ((("char_length"("body") > 0) AND ("char_length"("body") <= 8000))),
    CONSTRAINT "message_secrets_ordinal_check" CHECK ((("ordinal" >= 0) AND ("ordinal" < 64))),
    CONSTRAINT "message_secrets_scope_check" CHECK (("scope" = ANY (ARRAY['dm'::"text", 'group'::"text"])))
);

CREATE TABLE IF NOT EXISTS "public"."message_tombstones" (
    "chat_id" "uuid" NOT NULL,
    "message_id" "uuid" NOT NULL,
    "seq" bigint NOT NULL,
    "deleted_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE ONLY "public"."message_tombstones" REPLICA IDENTITY FULL;

COMMENT ON TABLE "public"."message_tombstones" IS 'Deleted message trace; clients subscribe to INSERT not DELETE';

CREATE TABLE IF NOT EXISTS "public"."messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "chat_id" "uuid" NOT NULL,
    "sender_id" "uuid" NOT NULL,
    "type" "text" DEFAULT 'text'::"text" NOT NULL,
    "text" "text",
    "media_path" "text",
    "media_type" "text",
    "file_name" "text",
    "file_size" bigint,
    "duration" integer,
    "status" "text" DEFAULT 'sent'::"text" NOT NULL,
    "read_at" timestamp with time zone,
    "edited_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "reply_to" "uuid",
    "waveform" smallint[],
    "seq" bigint NOT NULL,
    CONSTRAINT "messages_status_check" CHECK (("status" = ANY (ARRAY['sent'::"text", 'delivered'::"text", 'read'::"text"]))),
    CONSTRAINT "messages_text_length_check" CHECK (("char_length"("text") <= 5000)),
    CONSTRAINT "messages_type_check" CHECK (("type" = ANY (ARRAY['text'::"text", 'voice'::"text", 'file'::"text"])))
);

ALTER TABLE ONLY "public"."messages" REPLICA IDENTITY FULL;

COMMENT ON COLUMN "public"."messages"."reply_to" IS 'Parent message id this message is replying to (Telegram-style quote)';

COMMENT ON COLUMN "public"."messages"."seq" IS 'Per-chat monotonic sequence (Phase 3 sync cursor)';

CREATE TABLE IF NOT EXISTS "public"."post_likes" (
    "post_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE ONLY "public"."post_likes" REPLICA IDENTITY FULL;

CREATE TABLE IF NOT EXISTS "public"."post_views" (
    "post_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "viewed_at" timestamp with time zone DEFAULT "now"()
);

CREATE TABLE IF NOT EXISTS "public"."posts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "user_full_name" "text" DEFAULT ''::"text" NOT NULL,
    "text" "text",
    "media_path" "text",
    "media_type" "text",
    "media_width" integer,
    "media_height" integer,
    "file_name" "text",
    "file_size" bigint,
    "is_public" boolean DEFAULT false NOT NULL,
    "is_max_private" boolean DEFAULT false NOT NULL,
    "likes_count" integer DEFAULT 0 NOT NULL,
    "comment_count" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "views_count" integer DEFAULT 0,
    CONSTRAINT "posts_text_length_check" CHECK (("char_length"("text") <= 10000))
);

CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "username" "text" NOT NULL,
    "full_name" "text" DEFAULT ''::"text" NOT NULL,
    "email" "text",
    "bio" "text" DEFAULT ''::"text" NOT NULL,
    "avatar" "text" DEFAULT ''::"text" NOT NULL,
    "cover_url" "text",
    "website" "text",
    "location" "text",
    "approval" "text" DEFAULT 'pending'::"text" NOT NULL,
    "blocked" boolean DEFAULT false NOT NULL,
    "blocked_until" timestamp with time zone,
    "is_admin" boolean DEFAULT false NOT NULL,
    "last_seen" timestamp with time zone,
    "last_login" timestamp with time zone,
    "last_user_agent" "text",
    "last_platform" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "must_change_password" boolean DEFAULT false NOT NULL,
    "password_changed_at" timestamp with time zone DEFAULT "now"(),
    "recovery_email" "text",
    "recovery_code" "text",
    "recovery_code_expires_at" timestamp with time zone,
    "recovery_attempts" integer DEFAULT 0,
    "phone" "text",
    CONSTRAINT "profiles_approval_check" CHECK (("approval" = ANY (ARRAY['pending'::"text", 'approved'::"text", 'rejected'::"text"]))),
    CONSTRAINT "profiles_bio_length_check" CHECK (("char_length"("bio") <= 1000)),
    CONSTRAINT "profiles_fullname_length_check" CHECK (("char_length"("full_name") <= 100)),
    CONSTRAINT "profiles_username_check" CHECK ((("username" = "lower"("username")) AND (("length"("username") >= 2) AND ("length"("username") <= 40))))
);

ALTER TABLE ONLY "public"."profiles" REPLICA IDENTITY FULL;

COMMENT ON COLUMN "public"."profiles"."website" IS 'Foydalanuvchi veb-sayti URL, ixtiyoriy';

COMMENT ON COLUMN "public"."profiles"."phone" IS 'O''zbekiston telefon raqami (+998...), ixtiyoriy';

CREATE TABLE IF NOT EXISTS "public"."push_tokens" (
    "token" "text" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "platform" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "origin" "text"
);

CREATE TABLE IF NOT EXISTS "public"."saved_posts" (
    "user_id" "uuid" NOT NULL,
    "post_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);

ALTER TABLE ONLY "public"."saved_posts" REPLICA IDENTITY FULL;

CREATE TABLE IF NOT EXISTS "public"."stories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "media_path" "text" NOT NULL,
    "media_type" "text" DEFAULT 'image'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '24:00:00'::interval) NOT NULL,
    "caption" "text",
    CONSTRAINT "stories_caption_len" CHECK ((("caption" IS NULL) OR ("char_length"("caption") <= 200))),
    CONSTRAINT "stories_caption_length_check" CHECK ((("caption" IS NULL) OR ("char_length"("caption") <= 500)))
);

ALTER TABLE ONLY "public"."stories" REPLICA IDENTITY FULL;

CREATE TABLE IF NOT EXISTS "public"."story_reactions" (
    "story_id" "uuid" NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "emoji" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "story_reactions_emoji_check" CHECK ((("char_length"("emoji") <= 96) AND ("emoji" ~ '^emoji/2d/[0-9a-f]{2,6}(-[0-9a-f]{2,6})*\.png$'::"text")))
);

ALTER TABLE ONLY "public"."story_reactions" REPLICA IDENTITY FULL;

CREATE TABLE IF NOT EXISTS "public"."story_views" (
    "story_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "viewed_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "reaction" "text"
);

ALTER TABLE ONLY "public"."entity_tombstones" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."entity_tombstones_id_seq"'::"regclass");

-- ═══ 4. CHEKLOVLAR (PRIMARY/FOREIGN KEY, UNIQUE, CHECK) ════════════════════════════

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admin_notice_pkey' AND conrelid = 'public."admin_notice"'::regclass) THEN
    ALTER TABLE ONLY "public"."admin_notice" ADD CONSTRAINT "admin_notice_pkey" PRIMARY KEY ("id");
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'anon_rate_limits_pkey' AND conrelid = 'public."anon_rate_limits"'::regclass) THEN
    ALTER TABLE ONLY "public"."anon_rate_limits" ADD CONSTRAINT "anon_rate_limits_pkey" PRIMARY KEY ("ip");
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'app_categories_pkey' AND conrelid = 'public."app_categories"'::regclass) THEN
    ALTER TABLE ONLY "public"."app_categories" ADD CONSTRAINT "app_categories_pkey" PRIMARY KEY ("id");
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'app_categories_slug_key' AND conrelid = 'public."app_categories"'::regclass) THEN
    ALTER TABLE ONLY "public"."app_categories" ADD CONSTRAINT "app_categories_slug_key" UNIQUE ("slug");
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'app_force_reload_pkey' AND conrelid = 'public."app_force_reload"'::regclass) THEN
    ALTER TABLE ONLY "public"."app_force_reload" ADD CONSTRAINT "app_force_reload_pkey" PRIMARY KEY ("id");
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'apps_pkey' AND conrelid = 'public."apps"'::regclass) THEN
    ALTER TABLE ONLY "public"."apps" ADD CONSTRAINT "apps_pkey" PRIMARY KEY ("id");
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'apps_slug_key' AND conrelid = 'public."apps"'::regclass) THEN
    ALTER TABLE ONLY "public"."apps" ADD CONSTRAINT "apps_slug_key" UNIQUE ("slug");
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'calls_pkey' AND conrelid = 'public."calls"'::regclass) THEN
    ALTER TABLE ONLY "public"."calls" ADD CONSTRAINT "calls_pkey" PRIMARY KEY ("id");
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_members_pkey' AND conrelid = 'public."chat_members"'::regclass) THEN
    ALTER TABLE ONLY "public"."chat_members" ADD CONSTRAINT "chat_members_pkey" PRIMARY KEY ("chat_id", "user_id");
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chats_pkey' AND conrelid = 'public."chats"'::regclass) THEN
    ALTER TABLE ONLY "public"."chats" ADD CONSTRAINT "chats_pkey" PRIMARY KEY ("id");
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chats_user_a_user_b_key' AND conrelid = 'public."chats"'::regclass) THEN
    ALTER TABLE ONLY "public"."chats" ADD CONSTRAINT "chats_user_a_user_b_key" UNIQUE ("user_a", "user_b");
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'client_errors_pkey' AND conrelid = 'public."client_errors"'::regclass) THEN
    ALTER TABLE ONLY "public"."client_errors" ADD CONSTRAINT "client_errors_pkey" PRIMARY KEY ("id");
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'comments_pkey' AND conrelid = 'public."comments"'::regclass) THEN
    ALTER TABLE ONLY "public"."comments" ADD CONSTRAINT "comments_pkey" PRIMARY KEY ("id");
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'composer_drafts_pkey' AND conrelid = 'public."composer_drafts"'::regclass) THEN
    ALTER TABLE ONLY "public"."composer_drafts" ADD CONSTRAINT "composer_drafts_pkey" PRIMARY KEY ("user_id", "scope");
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contacts_pkey' AND conrelid = 'public."contacts"'::regclass) THEN
    ALTER TABLE ONLY "public"."contacts" ADD CONSTRAINT "contacts_pkey" PRIMARY KEY ("owner_id", "contact_id");
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_reports_pkey' AND conrelid = 'public."content_reports"'::regclass) THEN
    ALTER TABLE ONLY "public"."content_reports" ADD CONSTRAINT "content_reports_pkey" PRIMARY KEY ("id");
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'device_sessions_pkey' AND conrelid = 'public."device_sessions"'::regclass) THEN
    ALTER TABLE ONLY "public"."device_sessions" ADD CONSTRAINT "device_sessions_pkey" PRIMARY KEY ("id");
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'device_sessions_user_id_device_id_key' AND conrelid = 'public."device_sessions"'::regclass) THEN
    ALTER TABLE ONLY "public"."device_sessions" ADD CONSTRAINT "device_sessions_user_id_device_id_key" UNIQUE ("user_id", "device_id");
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'entity_tombstones_pkey' AND conrelid = 'public."entity_tombstones"'::regclass) THEN
    ALTER TABLE ONLY "public"."entity_tombstones" ADD CONSTRAINT "entity_tombstones_pkey" PRIMARY KEY ("id");
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'group_members_pkey' AND conrelid = 'public."group_members"'::regclass) THEN
    ALTER TABLE ONLY "public"."group_members" ADD CONSTRAINT "group_members_pkey" PRIMARY KEY ("group_id", "user_id");
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'group_message_tombstones_pkey' AND conrelid = 'public."group_message_tombstones"'::regclass) THEN
    ALTER TABLE ONLY "public"."group_message_tombstones" ADD CONSTRAINT "group_message_tombstones_pkey" PRIMARY KEY ("group_id", "message_id");
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'group_messages_pkey' AND conrelid = 'public."group_messages"'::regclass) THEN
    ALTER TABLE ONLY "public"."group_messages" ADD CONSTRAINT "group_messages_pkey" PRIMARY KEY ("id");
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'groups_invite_code_key' AND conrelid = 'public."groups"'::regclass) THEN
    ALTER TABLE ONLY "public"."groups" ADD CONSTRAINT "groups_invite_code_key" UNIQUE ("invite_code");
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'groups_pkey' AND conrelid = 'public."groups"'::regclass) THEN
    ALTER TABLE ONLY "public"."groups" ADD CONSTRAINT "groups_pkey" PRIMARY KEY ("id");
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'message_reactions_pkey' AND conrelid = 'public."message_reactions"'::regclass) THEN
    ALTER TABLE ONLY "public"."message_reactions" ADD CONSTRAINT "message_reactions_pkey" PRIMARY KEY ("message_id", "user_id");
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'message_secrets_pkey' AND conrelid = 'public."message_secrets"'::regclass) THEN
    ALTER TABLE ONLY "public"."message_secrets" ADD CONSTRAINT "message_secrets_pkey" PRIMARY KEY ("id");
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'message_secrets_scope_message_id_ordinal_key' AND conrelid = 'public."message_secrets"'::regclass) THEN
    ALTER TABLE ONLY "public"."message_secrets" ADD CONSTRAINT "message_secrets_scope_message_id_ordinal_key" UNIQUE ("scope", "message_id", "ordinal");
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'message_tombstones_pkey' AND conrelid = 'public."message_tombstones"'::regclass) THEN
    ALTER TABLE ONLY "public"."message_tombstones" ADD CONSTRAINT "message_tombstones_pkey" PRIMARY KEY ("chat_id", "message_id");
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_pkey' AND conrelid = 'public."messages"'::regclass) THEN
    ALTER TABLE ONLY "public"."messages" ADD CONSTRAINT "messages_pkey" PRIMARY KEY ("id");
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'post_likes_pkey' AND conrelid = 'public."post_likes"'::regclass) THEN
    ALTER TABLE ONLY "public"."post_likes" ADD CONSTRAINT "post_likes_pkey" PRIMARY KEY ("post_id", "user_id");
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'post_views_pkey' AND conrelid = 'public."post_views"'::regclass) THEN
    ALTER TABLE ONLY "public"."post_views" ADD CONSTRAINT "post_views_pkey" PRIMARY KEY ("post_id", "user_id");
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posts_pkey' AND conrelid = 'public."posts"'::regclass) THEN
    ALTER TABLE ONLY "public"."posts" ADD CONSTRAINT "posts_pkey" PRIMARY KEY ("id");
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_pkey' AND conrelid = 'public."profiles"'::regclass) THEN
    ALTER TABLE ONLY "public"."profiles" ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'push_tokens_pkey' AND conrelid = 'public."push_tokens"'::regclass) THEN
    ALTER TABLE ONLY "public"."push_tokens" ADD CONSTRAINT "push_tokens_pkey" PRIMARY KEY ("token");
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'saved_posts_pkey' AND conrelid = 'public."saved_posts"'::regclass) THEN
    ALTER TABLE ONLY "public"."saved_posts" ADD CONSTRAINT "saved_posts_pkey" PRIMARY KEY ("user_id", "post_id");
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stories_pkey' AND conrelid = 'public."stories"'::regclass) THEN
    ALTER TABLE ONLY "public"."stories" ADD CONSTRAINT "stories_pkey" PRIMARY KEY ("id");
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'story_reactions_pkey' AND conrelid = 'public."story_reactions"'::regclass) THEN
    ALTER TABLE ONLY "public"."story_reactions" ADD CONSTRAINT "story_reactions_pkey" PRIMARY KEY ("story_id", "user_id");
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'story_views_pkey' AND conrelid = 'public."story_views"'::regclass) THEN
    ALTER TABLE ONLY "public"."story_views" ADD CONSTRAINT "story_views_pkey" PRIMARY KEY ("story_id", "user_id");
  END IF;
END $do$;

-- ═══ 5. INDEKSLAR ══════════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS "apps_category_idx" ON "public"."apps" USING "btree" ("category_id");

CREATE INDEX IF NOT EXISTS "apps_owner_idx" ON "public"."apps" USING "btree" ("owner_id");

CREATE INDEX IF NOT EXISTS "calls_callee_idx" ON "public"."calls" USING "btree" ("callee_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "chat_members_user_idx" ON "public"."chat_members" USING "btree" ("user_id");

CREATE INDEX IF NOT EXISTS "comments_post_idx" ON "public"."comments" USING "btree" ("post_id", "created_at");

CREATE INDEX IF NOT EXISTS "content_reports_created_idx" ON "public"."content_reports" USING "btree" ("created_at" DESC);

CREATE INDEX IF NOT EXISTS "content_reports_status_idx" ON "public"."content_reports" USING "btree" ("status");

CREATE INDEX IF NOT EXISTS "device_sessions_user_active_idx" ON "public"."device_sessions" USING "btree" ("user_id") WHERE ("revoked_at" IS NULL);

CREATE INDEX IF NOT EXISTS "device_sessions_user_idx" ON "public"."device_sessions" USING "btree" ("user_id");

CREATE INDEX IF NOT EXISTS "entity_tombstones_created_idx" ON "public"."entity_tombstones" USING "btree" ("created_at");

CREATE INDEX IF NOT EXISTS "entity_tombstones_entity_idx" ON "public"."entity_tombstones" USING "btree" ("entity", "entity_id");

CREATE INDEX IF NOT EXISTS "group_members_user_idx" ON "public"."group_members" USING "btree" ("user_id");

CREATE INDEX IF NOT EXISTS "group_message_tombstones_group_seq_idx" ON "public"."group_message_tombstones" USING "btree" ("group_id", "seq");

CREATE INDEX IF NOT EXISTS "group_messages_group_seq_idx" ON "public"."group_messages" USING "btree" ("group_id", "seq");

CREATE UNIQUE INDEX IF NOT EXISTS "group_messages_group_seq_uidx" ON "public"."group_messages" USING "btree" ("group_id", "seq");

CREATE INDEX IF NOT EXISTS "group_messages_idx" ON "public"."group_messages" USING "btree" ("group_id", "created_at");

CREATE INDEX IF NOT EXISTS "group_messages_reply_to_idx" ON "public"."group_messages" USING "btree" ("reply_to") WHERE ("reply_to" IS NOT NULL);

CREATE UNIQUE INDEX IF NOT EXISTS "groups_username_idx" ON "public"."groups" USING "btree" ("lower"("username")) WHERE ("username" IS NOT NULL);

CREATE INDEX IF NOT EXISTS "idx_post_views_post_id" ON "public"."post_views" USING "btree" ("post_id");

CREATE INDEX IF NOT EXISTS "idx_post_views_user_id" ON "public"."post_views" USING "btree" ("user_id");

CREATE INDEX IF NOT EXISTS "idx_story_views_story_id" ON "public"."story_views" USING "btree" ("story_id");

CREATE INDEX IF NOT EXISTS "idx_story_views_user_id" ON "public"."story_views" USING "btree" ("user_id");

CREATE INDEX IF NOT EXISTS "message_reactions_thread_idx" ON "public"."message_reactions" USING "btree" ("thread_id");

CREATE INDEX IF NOT EXISTS "message_secrets_msg_idx" ON "public"."message_secrets" USING "btree" ("scope", "message_id");

CREATE INDEX IF NOT EXISTS "message_tombstones_chat_seq_idx" ON "public"."message_tombstones" USING "btree" ("chat_id", "seq");

CREATE INDEX IF NOT EXISTS "messages_chat_idx" ON "public"."messages" USING "btree" ("chat_id", "created_at");

CREATE INDEX IF NOT EXISTS "messages_chat_seq_idx" ON "public"."messages" USING "btree" ("chat_id", "seq");

CREATE UNIQUE INDEX IF NOT EXISTS "messages_chat_seq_uidx" ON "public"."messages" USING "btree" ("chat_id", "seq");

COMMENT ON INDEX "public"."messages_chat_seq_uidx" IS 'Phase 3 unique per-chat seq';

CREATE INDEX IF NOT EXISTS "messages_reply_to_idx" ON "public"."messages" USING "btree" ("reply_to") WHERE ("reply_to" IS NOT NULL);

CREATE INDEX IF NOT EXISTS "posts_created_idx" ON "public"."posts" USING "btree" ("created_at" DESC);

CREATE INDEX IF NOT EXISTS "posts_user_idx" ON "public"."posts" USING "btree" ("user_id", "created_at" DESC);

CREATE UNIQUE INDEX IF NOT EXISTS "profiles_username_key" ON "public"."profiles" USING "btree" ("username");

CREATE INDEX IF NOT EXISTS "push_tokens_user_idx" ON "public"."push_tokens" USING "btree" ("user_id");

CREATE INDEX IF NOT EXISTS "saved_posts_user_created_idx" ON "public"."saved_posts" USING "btree" ("user_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "stories_expires_idx" ON "public"."stories" USING "btree" ("expires_at" DESC);

CREATE INDEX IF NOT EXISTS "stories_user_idx" ON "public"."stories" USING "btree" ("user_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "story_reactions_story_idx" ON "public"."story_reactions" USING "btree" ("story_id");

-- ═══ 6. TRIGGERLAR ═════════════════════════════════════════════════════════════════

CREATE OR REPLACE TRIGGER "calls_guard" BEFORE UPDATE ON "public"."calls" FOR EACH ROW EXECUTE FUNCTION "public"."guard_call_update"();

CREATE OR REPLACE TRIGGER "comments_count" AFTER INSERT OR DELETE ON "public"."comments" FOR EACH ROW EXECUTE FUNCTION "public"."bump_post_counters"();

CREATE OR REPLACE TRIGGER "group_members_guard" BEFORE UPDATE ON "public"."group_members" FOR EACH ROW EXECUTE FUNCTION "public"."guard_member_update"();

CREATE OR REPLACE TRIGGER "group_members_touch_read" BEFORE UPDATE ON "public"."group_members" FOR EACH ROW EXECUTE FUNCTION "public"."touch_group_member_read"();

CREATE OR REPLACE TRIGGER "group_messages_after_insert" AFTER INSERT ON "public"."group_messages" FOR EACH ROW EXECUTE FUNCTION "public"."on_group_message_insert"();

CREATE OR REPLACE TRIGGER "group_messages_drop_reactions" AFTER DELETE ON "public"."group_messages" FOR EACH ROW EXECUTE FUNCTION "public"."drop_message_reactions"();

CREATE OR REPLACE TRIGGER "group_messages_seq_trg" BEFORE INSERT ON "public"."group_messages" FOR EACH ROW EXECUTE FUNCTION "public"."group_messages_assign_seq"();

CREATE OR REPLACE TRIGGER "group_messages_tombstone_trg" AFTER DELETE ON "public"."group_messages" FOR EACH ROW EXECUTE FUNCTION "public"."group_messages_tombstone"();

CREATE OR REPLACE TRIGGER "groups_after_insert" AFTER INSERT ON "public"."groups" FOR EACH ROW EXECUTE FUNCTION "public"."on_group_insert"();

CREATE OR REPLACE TRIGGER "messages_after_insert" AFTER INSERT ON "public"."messages" FOR EACH ROW EXECUTE FUNCTION "public"."on_message_insert"();

CREATE OR REPLACE TRIGGER "messages_drop_reactions" AFTER DELETE ON "public"."messages" FOR EACH ROW EXECUTE FUNCTION "public"."drop_message_reactions"();

CREATE OR REPLACE TRIGGER "messages_guard" BEFORE UPDATE ON "public"."messages" FOR EACH ROW EXECUTE FUNCTION "public"."guard_message_update"();

CREATE OR REPLACE TRIGGER "messages_seq_trg" BEFORE INSERT ON "public"."messages" FOR EACH ROW EXECUTE FUNCTION "public"."messages_assign_seq"();

CREATE OR REPLACE TRIGGER "messages_tombstone_trg" AFTER DELETE ON "public"."messages" FOR EACH ROW EXECUTE FUNCTION "public"."messages_tombstone"();

CREATE OR REPLACE TRIGGER "post_likes_count" AFTER INSERT OR DELETE ON "public"."post_likes" FOR EACH ROW EXECUTE FUNCTION "public"."bump_post_counters"();

CREATE OR REPLACE TRIGGER "profiles_guard" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."guard_profile_update"();

CREATE OR REPLACE TRIGGER "tr_app_categories_ns" BEFORE INSERT OR UPDATE ON "public"."app_categories" FOR EACH ROW EXECUTE FUNCTION "public"."apps_namespace_guard"();

CREATE OR REPLACE TRIGGER "tr_apps_ns" BEFORE INSERT OR UPDATE ON "public"."apps" FOR EACH ROW EXECUTE FUNCTION "public"."apps_namespace_guard"();

CREATE OR REPLACE TRIGGER "tr_apps_touch" BEFORE UPDATE ON "public"."apps" FOR EACH ROW EXECUTE FUNCTION "public"."apps_touch_updated"();

CREATE OR REPLACE TRIGGER "tr_check_comments_update_security" BEFORE UPDATE ON "public"."comments" FOR EACH ROW EXECUTE FUNCTION "public"."check_comments_update_security"();

CREATE OR REPLACE TRIGGER "tr_check_group_message_update_security" BEFORE UPDATE ON "public"."group_messages" FOR EACH ROW EXECUTE FUNCTION "public"."check_group_message_update_security"();

CREATE OR REPLACE TRIGGER "tr_check_groups_update_security" BEFORE UPDATE ON "public"."groups" FOR EACH ROW EXECUTE FUNCTION "public"."check_groups_update_security"();

CREATE OR REPLACE TRIGGER "tr_check_message_update_security" BEFORE UPDATE ON "public"."messages" FOR EACH ROW EXECUTE FUNCTION "public"."check_message_update_security"();

CREATE OR REPLACE TRIGGER "tr_check_posts_update_security" BEFORE UPDATE ON "public"."posts" FOR EACH ROW EXECUTE FUNCTION "public"."check_posts_update_security"();

CREATE OR REPLACE TRIGGER "tr_check_profile_update_security" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."check_profile_update_security"();

CREATE OR REPLACE TRIGGER "tr_group_message_delete_last" AFTER DELETE ON "public"."group_messages" REFERENCING OLD TABLE AS "old_rows" FOR EACH STATEMENT EXECUTE FUNCTION "public"."on_group_message_delete"();

CREATE OR REPLACE TRIGGER "tr_group_message_delete_recalc_unread" AFTER DELETE ON "public"."group_messages" REFERENCING OLD TABLE AS "old_rows" FOR EACH STATEMENT EXECUTE FUNCTION "public"."on_group_message_delete_recalc_unread"();

CREATE OR REPLACE TRIGGER "tr_group_message_edit_last" AFTER UPDATE OF "text" ON "public"."group_messages" FOR EACH ROW EXECUTE FUNCTION "public"."on_group_message_edit_last"();

CREATE OR REPLACE TRIGGER "tr_guard_saved_chat_delete" BEFORE DELETE ON "public"."chats" FOR EACH ROW EXECUTE FUNCTION "public"."guard_saved_chat_delete"();

CREATE OR REPLACE TRIGGER "tr_join_default_groups" AFTER INSERT ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."join_default_groups"();

CREATE OR REPLACE TRIGGER "tr_limit_contacts" BEFORE INSERT ON "public"."contacts" FOR EACH ROW EXECUTE FUNCTION "public"."check_contacts_rate_limit"();

CREATE OR REPLACE TRIGGER "tr_message_delete_last" AFTER DELETE ON "public"."messages" REFERENCING OLD TABLE AS "old_rows" FOR EACH STATEMENT EXECUTE FUNCTION "public"."on_message_delete"();

CREATE OR REPLACE TRIGGER "tr_message_delete_recalc_unread" AFTER DELETE ON "public"."messages" REFERENCING OLD TABLE AS "old_rows" FOR EACH STATEMENT EXECUTE FUNCTION "public"."on_message_delete_recalc_unread"();

CREATE OR REPLACE TRIGGER "tr_message_edit_last" AFTER UPDATE OF "text" ON "public"."messages" FOR EACH ROW EXECUTE FUNCTION "public"."on_message_edit_last"();

CREATE OR REPLACE TRIGGER "tr_message_secrets_cleanup_dm" AFTER DELETE ON "public"."messages" FOR EACH ROW EXECUTE FUNCTION "public"."message_secrets_cleanup_dm"();

CREATE OR REPLACE TRIGGER "tr_message_secrets_cleanup_group" AFTER DELETE ON "public"."group_messages" FOR EACH ROW EXECUTE FUNCTION "public"."message_secrets_cleanup_group"();

CREATE OR REPLACE TRIGGER "tr_rate_limit_calls" BEFORE INSERT ON "public"."calls" FOR EACH ROW EXECUTE FUNCTION "public"."check_rate_limit_calls"();

CREATE OR REPLACE TRIGGER "tr_rate_limit_chats" BEFORE INSERT ON "public"."chats" FOR EACH ROW EXECUTE FUNCTION "public"."check_chats_rate_limit"();

CREATE OR REPLACE TRIGGER "tr_rate_limit_comments" BEFORE INSERT ON "public"."comments" FOR EACH ROW EXECUTE FUNCTION "public"."check_rate_limit"();

CREATE OR REPLACE TRIGGER "tr_rate_limit_errors" BEFORE INSERT ON "public"."client_errors" FOR EACH ROW EXECUTE FUNCTION "public"."check_rate_limit_errors"();

CREATE OR REPLACE TRIGGER "tr_rate_limit_gmessages" BEFORE INSERT ON "public"."group_messages" FOR EACH ROW EXECUTE FUNCTION "public"."check_rate_limit"();

CREATE OR REPLACE TRIGGER "tr_rate_limit_group_members" BEFORE INSERT ON "public"."group_members" FOR EACH ROW EXECUTE FUNCTION "public"."check_group_members_rate_limit"();

CREATE OR REPLACE TRIGGER "tr_rate_limit_groups" BEFORE INSERT ON "public"."groups" FOR EACH ROW EXECUTE FUNCTION "public"."check_groups_rate_limit"();

CREATE OR REPLACE TRIGGER "tr_rate_limit_likes" BEFORE INSERT ON "public"."post_likes" FOR EACH ROW EXECUTE FUNCTION "public"."check_likes_rate_limit"();

CREATE OR REPLACE TRIGGER "tr_rate_limit_messages" BEFORE INSERT ON "public"."messages" FOR EACH ROW EXECUTE FUNCTION "public"."check_rate_limit"();

CREATE OR REPLACE TRIGGER "tr_rate_limit_posts" BEFORE INSERT ON "public"."posts" FOR EACH ROW EXECUTE FUNCTION "public"."check_rate_limit"();

CREATE OR REPLACE TRIGGER "tr_transfer_groups_on_profile_delete" BEFORE DELETE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."transfer_groups_on_profile_delete"();

CREATE OR REPLACE TRIGGER "trg_enforce_voice_waveform" BEFORE INSERT OR UPDATE OF "type", "media_path", "waveform" ON "public"."group_messages" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_voice_waveform"();

CREATE OR REPLACE TRIGGER "trg_enforce_voice_waveform" BEFORE INSERT OR UPDATE OF "type", "media_path", "waveform" ON "public"."messages" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_voice_waveform"();

CREATE OR REPLACE TRIGGER "trg_media_path_sane" BEFORE INSERT OR UPDATE OF "media_path" ON "public"."group_messages" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_media_path_sane"();

CREATE OR REPLACE TRIGGER "trg_media_path_sane" BEFORE INSERT OR UPDATE OF "media_path" ON "public"."messages" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_media_path_sane"();

CREATE OR REPLACE TRIGGER "trg_media_path_sane" BEFORE INSERT OR UPDATE OF "media_path" ON "public"."posts" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_media_path_sane"();

CREATE OR REPLACE TRIGGER "trg_media_path_sane" BEFORE INSERT OR UPDATE OF "media_path" ON "public"."stories" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_media_path_sane"();

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'admin_notice_admin_id_fkey' AND conrelid = 'public."admin_notice"'::regclass) THEN
    ALTER TABLE ONLY "public"."admin_notice" ADD CONSTRAINT "admin_notice_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'app_categories_owner_id_fkey' AND conrelid = 'public."app_categories"'::regclass) THEN
    ALTER TABLE ONLY "public"."app_categories" ADD CONSTRAINT "app_categories_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'app_force_reload_by_admin_fkey' AND conrelid = 'public."app_force_reload"'::regclass) THEN
    ALTER TABLE ONLY "public"."app_force_reload" ADD CONSTRAINT "app_force_reload_by_admin_fkey" FOREIGN KEY ("by_admin") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'apps_category_id_fkey' AND conrelid = 'public."apps"'::regclass) THEN
    ALTER TABLE ONLY "public"."apps" ADD CONSTRAINT "apps_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."app_categories"("id") ON DELETE RESTRICT;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'apps_owner_id_fkey' AND conrelid = 'public."apps"'::regclass) THEN
    ALTER TABLE ONLY "public"."apps" ADD CONSTRAINT "apps_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'calls_callee_id_fkey' AND conrelid = 'public."calls"'::regclass) THEN
    ALTER TABLE ONLY "public"."calls" ADD CONSTRAINT "calls_callee_id_fkey" FOREIGN KEY ("callee_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'calls_caller_id_fkey' AND conrelid = 'public."calls"'::regclass) THEN
    ALTER TABLE ONLY "public"."calls" ADD CONSTRAINT "calls_caller_id_fkey" FOREIGN KEY ("caller_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_members_chat_id_fkey' AND conrelid = 'public."chat_members"'::regclass) THEN
    ALTER TABLE ONLY "public"."chat_members" ADD CONSTRAINT "chat_members_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE CASCADE;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_members_user_id_fkey' AND conrelid = 'public."chat_members"'::regclass) THEN
    ALTER TABLE ONLY "public"."chat_members" ADD CONSTRAINT "chat_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chats_user_a_fkey' AND conrelid = 'public."chats"'::regclass) THEN
    ALTER TABLE ONLY "public"."chats" ADD CONSTRAINT "chats_user_a_fkey" FOREIGN KEY ("user_a") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chats_user_b_fkey' AND conrelid = 'public."chats"'::regclass) THEN
    ALTER TABLE ONLY "public"."chats" ADD CONSTRAINT "chats_user_b_fkey" FOREIGN KEY ("user_b") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'client_errors_user_id_fkey' AND conrelid = 'public."client_errors"'::regclass) THEN
    ALTER TABLE ONLY "public"."client_errors" ADD CONSTRAINT "client_errors_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'comments_post_id_fkey' AND conrelid = 'public."comments"'::regclass) THEN
    ALTER TABLE ONLY "public"."comments" ADD CONSTRAINT "comments_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE CASCADE;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'comments_user_id_fkey' AND conrelid = 'public."comments"'::regclass) THEN
    ALTER TABLE ONLY "public"."comments" ADD CONSTRAINT "comments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'composer_drafts_user_id_fkey' AND conrelid = 'public."composer_drafts"'::regclass) THEN
    ALTER TABLE ONLY "public"."composer_drafts" ADD CONSTRAINT "composer_drafts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contacts_contact_id_fkey' AND conrelid = 'public."contacts"'::regclass) THEN
    ALTER TABLE ONLY "public"."contacts" ADD CONSTRAINT "contacts_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contacts_owner_id_fkey' AND conrelid = 'public."contacts"'::regclass) THEN
    ALTER TABLE ONLY "public"."contacts" ADD CONSTRAINT "contacts_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_reports_reporter_id_fkey' AND conrelid = 'public."content_reports"'::regclass) THEN
    ALTER TABLE ONLY "public"."content_reports" ADD CONSTRAINT "content_reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'device_sessions_user_id_fkey' AND conrelid = 'public."device_sessions"'::regclass) THEN
    ALTER TABLE ONLY "public"."device_sessions" ADD CONSTRAINT "device_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'group_members_group_id_fkey' AND conrelid = 'public."group_members"'::regclass) THEN
    ALTER TABLE ONLY "public"."group_members" ADD CONSTRAINT "group_members_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE CASCADE;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'group_members_user_id_fkey' AND conrelid = 'public."group_members"'::regclass) THEN
    ALTER TABLE ONLY "public"."group_members" ADD CONSTRAINT "group_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'group_message_tombstones_group_id_fkey' AND conrelid = 'public."group_message_tombstones"'::regclass) THEN
    ALTER TABLE ONLY "public"."group_message_tombstones" ADD CONSTRAINT "group_message_tombstones_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE CASCADE;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'group_messages_group_id_fkey' AND conrelid = 'public."group_messages"'::regclass) THEN
    ALTER TABLE ONLY "public"."group_messages" ADD CONSTRAINT "group_messages_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE CASCADE;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'group_messages_reply_to_fkey' AND conrelid = 'public."group_messages"'::regclass) THEN
    ALTER TABLE ONLY "public"."group_messages" ADD CONSTRAINT "group_messages_reply_to_fkey" FOREIGN KEY ("reply_to") REFERENCES "public"."group_messages"("id") ON DELETE SET NULL;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'group_messages_sender_id_fkey' AND conrelid = 'public."group_messages"'::regclass) THEN
    ALTER TABLE ONLY "public"."group_messages" ADD CONSTRAINT "group_messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'groups_owner_id_fkey' AND conrelid = 'public."groups"'::regclass) THEN
    ALTER TABLE ONLY "public"."groups" ADD CONSTRAINT "groups_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'message_reactions_user_id_fkey' AND conrelid = 'public."message_reactions"'::regclass) THEN
    ALTER TABLE ONLY "public"."message_reactions" ADD CONSTRAINT "message_reactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'message_tombstones_chat_id_fkey' AND conrelid = 'public."message_tombstones"'::regclass) THEN
    ALTER TABLE ONLY "public"."message_tombstones" ADD CONSTRAINT "message_tombstones_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE CASCADE;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_chat_id_fkey' AND conrelid = 'public."messages"'::regclass) THEN
    ALTER TABLE ONLY "public"."messages" ADD CONSTRAINT "messages_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "public"."chats"("id") ON DELETE CASCADE;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_reply_to_fkey' AND conrelid = 'public."messages"'::regclass) THEN
    ALTER TABLE ONLY "public"."messages" ADD CONSTRAINT "messages_reply_to_fkey" FOREIGN KEY ("reply_to") REFERENCES "public"."messages"("id") ON DELETE SET NULL;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_sender_id_fkey' AND conrelid = 'public."messages"'::regclass) THEN
    ALTER TABLE ONLY "public"."messages" ADD CONSTRAINT "messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'post_likes_post_id_fkey' AND conrelid = 'public."post_likes"'::regclass) THEN
    ALTER TABLE ONLY "public"."post_likes" ADD CONSTRAINT "post_likes_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE CASCADE;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'post_likes_user_id_fkey' AND conrelid = 'public."post_likes"'::regclass) THEN
    ALTER TABLE ONLY "public"."post_likes" ADD CONSTRAINT "post_likes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'post_views_post_id_fkey' AND conrelid = 'public."post_views"'::regclass) THEN
    ALTER TABLE ONLY "public"."post_views" ADD CONSTRAINT "post_views_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE CASCADE;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'post_views_user_id_fkey' AND conrelid = 'public."post_views"'::regclass) THEN
    ALTER TABLE ONLY "public"."post_views" ADD CONSTRAINT "post_views_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'posts_user_id_fkey' AND conrelid = 'public."posts"'::regclass) THEN
    ALTER TABLE ONLY "public"."posts" ADD CONSTRAINT "posts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_id_fkey' AND conrelid = 'public."profiles"'::regclass) THEN
    ALTER TABLE ONLY "public"."profiles" ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'push_tokens_user_id_fkey' AND conrelid = 'public."push_tokens"'::regclass) THEN
    ALTER TABLE ONLY "public"."push_tokens" ADD CONSTRAINT "push_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'saved_posts_post_id_fkey' AND conrelid = 'public."saved_posts"'::regclass) THEN
    ALTER TABLE ONLY "public"."saved_posts" ADD CONSTRAINT "saved_posts_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE CASCADE;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'saved_posts_user_id_fkey' AND conrelid = 'public."saved_posts"'::regclass) THEN
    ALTER TABLE ONLY "public"."saved_posts" ADD CONSTRAINT "saved_posts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'stories_user_id_fkey' AND conrelid = 'public."stories"'::regclass) THEN
    ALTER TABLE ONLY "public"."stories" ADD CONSTRAINT "stories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'story_reactions_story_id_fkey' AND conrelid = 'public."story_reactions"'::regclass) THEN
    ALTER TABLE ONLY "public"."story_reactions" ADD CONSTRAINT "story_reactions_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE CASCADE;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'story_reactions_user_id_fkey' AND conrelid = 'public."story_reactions"'::regclass) THEN
    ALTER TABLE ONLY "public"."story_reactions" ADD CONSTRAINT "story_reactions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'story_views_story_id_fkey' AND conrelid = 'public."story_views"'::regclass) THEN
    ALTER TABLE ONLY "public"."story_views" ADD CONSTRAINT "story_views_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "public"."stories"("id") ON DELETE CASCADE;
  END IF;
END $do$;

DO $do$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'story_views_user_id_fkey' AND conrelid = 'public."story_views"'::regclass) THEN
    ALTER TABLE ONLY "public"."story_views" ADD CONSTRAINT "story_views_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;
  END IF;
END $do$;

-- ═══ 7. RLS (qator darajasidagi xavfsizlik) yoqish ═════════════════════════════════

ALTER TABLE "public"."admin_notice" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."anon_rate_limits" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."app_categories" ENABLE ROW LEVEL SECURITY;

-- ═══ 8. RLS SIYOSATLARI ════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "app_categories_delete" ON "public"."app_categories";

CREATE POLICY "app_categories_delete" ON "public"."app_categories" FOR DELETE TO "authenticated" USING ((("owner_id" = "auth"."uid"()) OR "public"."is_admin"()));

DROP POLICY IF EXISTS "app_categories_insert" ON "public"."app_categories";

CREATE POLICY "app_categories_insert" ON "public"."app_categories" FOR INSERT TO "authenticated" WITH CHECK ((("owner_id" = "auth"."uid"()) AND "public"."is_approved"()));

DROP POLICY IF EXISTS "app_categories_select" ON "public"."app_categories";

CREATE POLICY "app_categories_select" ON "public"."app_categories" FOR SELECT TO "authenticated" USING (("public"."is_approved"() OR "public"."is_admin"()));

DROP POLICY IF EXISTS "app_categories_update" ON "public"."app_categories";

CREATE POLICY "app_categories_update" ON "public"."app_categories" FOR UPDATE TO "authenticated" USING ((("owner_id" = "auth"."uid"()) OR "public"."is_admin"())) WITH CHECK ((("owner_id" = "auth"."uid"()) OR "public"."is_admin"()));

ALTER TABLE "public"."app_force_reload" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."apps" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "apps_delete" ON "public"."apps";

CREATE POLICY "apps_delete" ON "public"."apps" FOR DELETE TO "authenticated" USING ((("owner_id" = "auth"."uid"()) OR "public"."is_admin"()));

DROP POLICY IF EXISTS "apps_insert" ON "public"."apps";

CREATE POLICY "apps_insert" ON "public"."apps" FOR INSERT TO "authenticated" WITH CHECK ((("owner_id" = "auth"."uid"()) AND "public"."is_approved"()));

DROP POLICY IF EXISTS "apps_select" ON "public"."apps";

CREATE POLICY "apps_select" ON "public"."apps" FOR SELECT TO "authenticated" USING (("public"."is_approved"() OR "public"."is_admin"()));

DROP POLICY IF EXISTS "apps_update" ON "public"."apps";

CREATE POLICY "apps_update" ON "public"."apps" FOR UPDATE TO "authenticated" USING ((("owner_id" = "auth"."uid"()) OR "public"."is_admin"())) WITH CHECK ((("owner_id" = "auth"."uid"()) OR "public"."is_admin"()));

ALTER TABLE "public"."calls" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "calls_delete" ON "public"."calls";

CREATE POLICY "calls_delete" ON "public"."calls" FOR DELETE TO "authenticated" USING (((("auth"."uid"() = "caller_id") OR ("auth"."uid"() = "callee_id")) OR "public"."is_admin"()));

DROP POLICY IF EXISTS "calls_insert" ON "public"."calls";

CREATE POLICY "calls_insert" ON "public"."calls" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_admin"() OR (("caller_id" = "auth"."uid"()) AND "public"."is_approved"())));

DROP POLICY IF EXISTS "calls_select" ON "public"."calls";

CREATE POLICY "calls_select" ON "public"."calls" FOR SELECT TO "authenticated" USING (((("auth"."uid"() = "caller_id") OR ("auth"."uid"() = "callee_id")) OR "public"."is_admin"()));

DROP POLICY IF EXISTS "calls_update" ON "public"."calls";

CREATE POLICY "calls_update" ON "public"."calls" FOR UPDATE TO "authenticated" USING (((("auth"."uid"() = "caller_id") OR ("auth"."uid"() = "callee_id")) OR "public"."is_admin"()));

ALTER TABLE "public"."chat_members" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chat_members_select" ON "public"."chat_members";

CREATE POLICY "chat_members_select" ON "public"."chat_members" FOR SELECT TO "authenticated" USING (("public"."is_chat_member"("chat_id") OR "public"."is_admin"()));

DROP POLICY IF EXISTS "chat_members_update" ON "public"."chat_members";

CREATE POLICY "chat_members_update" ON "public"."chat_members" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));

ALTER TABLE "public"."chats" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "chats_delete" ON "public"."chats";

CREATE POLICY "chats_delete" ON "public"."chats" FOR DELETE TO "authenticated" USING ("public"."is_admin"());

DROP POLICY IF EXISTS "chats_select" ON "public"."chats";

CREATE POLICY "chats_select" ON "public"."chats" FOR SELECT TO "authenticated" USING (((("auth"."uid"() = "user_a") OR ("auth"."uid"() = "user_b")) OR "public"."is_admin"()));

ALTER TABLE "public"."client_errors" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "client_errors_admin_delete" ON "public"."client_errors";

CREATE POLICY "client_errors_admin_delete" ON "public"."client_errors" FOR DELETE TO "authenticated" USING ("public"."is_admin"());

DROP POLICY IF EXISTS "client_errors_admin_read" ON "public"."client_errors";

CREATE POLICY "client_errors_admin_read" ON "public"."client_errors" FOR SELECT TO "authenticated" USING ("public"."is_admin"());

DROP POLICY IF EXISTS "client_errors_insert" ON "public"."client_errors";

CREATE POLICY "client_errors_insert" ON "public"."client_errors" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" IS NULL) OR ("user_id" = "auth"."uid"())));

ALTER TABLE "public"."comments" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "comments_delete" ON "public"."comments";

CREATE POLICY "comments_delete" ON "public"."comments" FOR DELETE TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."is_admin"()));

DROP POLICY IF EXISTS "comments_insert" ON "public"."comments";

CREATE POLICY "comments_insert" ON "public"."comments" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = "auth"."uid"()) AND "public"."is_approved"() AND "public"."post_is_visible"("post_id")));

DROP POLICY IF EXISTS "comments_select" ON "public"."comments";

CREATE POLICY "comments_select" ON "public"."comments" FOR SELECT TO "authenticated" USING (("public"."is_admin"() OR ("public"."is_approved"() AND "public"."post_is_visible"("post_id"))));

DROP POLICY IF EXISTS "comments_update" ON "public"."comments";

CREATE POLICY "comments_update" ON "public"."comments" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));

ALTER TABLE "public"."composer_drafts" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "composer_drafts_delete" ON "public"."composer_drafts";

CREATE POLICY "composer_drafts_delete" ON "public"."composer_drafts" FOR DELETE TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));

DROP POLICY IF EXISTS "composer_drafts_insert" ON "public"."composer_drafts";

CREATE POLICY "composer_drafts_insert" ON "public"."composer_drafts" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));

DROP POLICY IF EXISTS "composer_drafts_select" ON "public"."composer_drafts";

CREATE POLICY "composer_drafts_select" ON "public"."composer_drafts" FOR SELECT TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));

DROP POLICY IF EXISTS "composer_drafts_update" ON "public"."composer_drafts";

CREATE POLICY "composer_drafts_update" ON "public"."composer_drafts" FOR UPDATE TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));

ALTER TABLE "public"."contacts" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "contacts_all" ON "public"."contacts";

CREATE POLICY "contacts_all" ON "public"."contacts" TO "authenticated" USING (("owner_id" = "auth"."uid"())) WITH CHECK ((("owner_id" = "auth"."uid"()) AND "public"."is_approved"()));

ALTER TABLE "public"."content_reports" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "content_reports_insert" ON "public"."content_reports";

CREATE POLICY "content_reports_insert" ON "public"."content_reports" FOR INSERT TO "authenticated" WITH CHECK ((("reporter_id" = ( SELECT "auth"."uid"() AS "uid")) AND "public"."is_approved"()));

DROP POLICY IF EXISTS "content_reports_select_own" ON "public"."content_reports";

CREATE POLICY "content_reports_select_own" ON "public"."content_reports" FOR SELECT TO "authenticated" USING ((("reporter_id" = ( SELECT "auth"."uid"() AS "uid")) OR "public"."is_admin"()));

DROP POLICY IF EXISTS "content_reports_update_admin" ON "public"."content_reports";

CREATE POLICY "content_reports_update_admin" ON "public"."content_reports" FOR UPDATE TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());

ALTER TABLE "public"."device_sessions" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "device_sessions_delete" ON "public"."device_sessions";

CREATE POLICY "device_sessions_delete" ON "public"."device_sessions" FOR DELETE TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));

DROP POLICY IF EXISTS "device_sessions_insert" ON "public"."device_sessions";

CREATE POLICY "device_sessions_insert" ON "public"."device_sessions" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));

DROP POLICY IF EXISTS "device_sessions_select" ON "public"."device_sessions";

CREATE POLICY "device_sessions_select" ON "public"."device_sessions" FOR SELECT TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));

DROP POLICY IF EXISTS "device_sessions_update" ON "public"."device_sessions";

CREATE POLICY "device_sessions_update" ON "public"."device_sessions" FOR UPDATE TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));

ALTER TABLE "public"."entity_tombstones" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "entity_tombstones_select" ON "public"."entity_tombstones";

CREATE POLICY "entity_tombstones_select" ON "public"."entity_tombstones" FOR SELECT TO "authenticated" USING (true);

DROP POLICY IF EXISTS "force_reload_select" ON "public"."app_force_reload";

CREATE POLICY "force_reload_select" ON "public"."app_force_reload" FOR SELECT TO "authenticated" USING (true);

DROP POLICY IF EXISTS "gm_delete" ON "public"."group_members";

CREATE POLICY "gm_delete" ON "public"."group_members" FOR DELETE TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."is_group_admin"("group_id") OR "public"."is_admin"()));

DROP POLICY IF EXISTS "gm_insert" ON "public"."group_members";

CREATE POLICY "gm_insert" ON "public"."group_members" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_admin"() OR "public"."is_group_admin"("group_id") OR (("user_id" = "auth"."uid"()) AND ("role" = 'member'::"text") AND "public"."is_approved"() AND (NOT "public"."group_is_private"("group_id")))));

DROP POLICY IF EXISTS "gm_select" ON "public"."group_members";

CREATE POLICY "gm_select" ON "public"."group_members" FOR SELECT TO "authenticated" USING (("public"."is_admin"() OR "public"."is_group_member"("group_id") OR (NOT "public"."group_is_private"("group_id"))));

DROP POLICY IF EXISTS "gm_update" ON "public"."group_members";

CREATE POLICY "gm_update" ON "public"."group_members" FOR UPDATE TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."is_group_admin"("group_id") OR "public"."is_admin"()));

DROP POLICY IF EXISTS "gmsg_delete" ON "public"."group_messages";

CREATE POLICY "gmsg_delete" ON "public"."group_messages" FOR DELETE TO "authenticated" USING ((("sender_id" = "auth"."uid"()) OR "public"."is_group_admin"("group_id") OR "public"."is_admin"()));

DROP POLICY IF EXISTS "gmsg_insert" ON "public"."group_messages";

CREATE POLICY "gmsg_insert" ON "public"."group_messages" FOR INSERT TO "authenticated" WITH CHECK ((("sender_id" = "auth"."uid"()) AND "public"."is_approved"() AND ("public"."can_post_in_group"("group_id") OR "public"."is_admin"())));

DROP POLICY IF EXISTS "gmsg_select" ON "public"."group_messages";

CREATE POLICY "gmsg_select" ON "public"."group_messages" FOR SELECT TO "authenticated" USING ("public"."can_read_group_message"("group_id", "created_at"));

DROP POLICY IF EXISTS "gmsg_update" ON "public"."group_messages";

CREATE POLICY "gmsg_update" ON "public"."group_messages" FOR UPDATE TO "authenticated" USING (("sender_id" = "auth"."uid"())) WITH CHECK (("sender_id" = "auth"."uid"()));

ALTER TABLE "public"."group_members" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."group_message_tombstones" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "group_message_tombstones_select" ON "public"."group_message_tombstones";

CREATE POLICY "group_message_tombstones_select" ON "public"."group_message_tombstones" FOR SELECT TO "authenticated" USING (("public"."is_group_member"("group_id") OR "public"."is_admin"()));

ALTER TABLE "public"."group_messages" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."groups" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "groups_delete" ON "public"."groups";

CREATE POLICY "groups_delete" ON "public"."groups" FOR DELETE TO "authenticated" USING ((("owner_id" = "auth"."uid"()) OR "public"."is_admin"()));

DROP POLICY IF EXISTS "groups_insert" ON "public"."groups";

CREATE POLICY "groups_insert" ON "public"."groups" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_admin"() OR ("public"."is_approved"() AND ("owner_id" = "auth"."uid"()))));

DROP POLICY IF EXISTS "groups_select" ON "public"."groups";

CREATE POLICY "groups_select" ON "public"."groups" FOR SELECT TO "authenticated" USING (("public"."is_admin"() OR (NOT "is_private") OR "public"."is_group_member"("id")));

DROP POLICY IF EXISTS "groups_update" ON "public"."groups";

CREATE POLICY "groups_update" ON "public"."groups" FOR UPDATE TO "authenticated" USING (("public"."is_group_admin"("id") OR "public"."is_admin"())) WITH CHECK (("public"."is_group_admin"("id") OR "public"."is_admin"()));

DROP POLICY IF EXISTS "likes_delete" ON "public"."post_likes";

CREATE POLICY "likes_delete" ON "public"."post_likes" FOR DELETE TO "authenticated" USING (("user_id" = "auth"."uid"()));

DROP POLICY IF EXISTS "likes_insert" ON "public"."post_likes";

CREATE POLICY "likes_insert" ON "public"."post_likes" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = "auth"."uid"()) AND "public"."is_approved"() AND "public"."post_is_visible"("post_id")));

DROP POLICY IF EXISTS "likes_select" ON "public"."post_likes";

CREATE POLICY "likes_select" ON "public"."post_likes" FOR SELECT TO "authenticated" USING (("public"."is_admin"() OR ("public"."is_approved"() AND "public"."post_is_visible"("post_id"))));

ALTER TABLE "public"."message_reactions" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."message_secrets" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."message_tombstones" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "message_tombstones_select" ON "public"."message_tombstones";

CREATE POLICY "message_tombstones_select" ON "public"."message_tombstones" FOR SELECT TO "authenticated" USING (("public"."is_chat_member"("chat_id") OR "public"."is_admin"()));

ALTER TABLE "public"."messages" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "messages_delete" ON "public"."messages";

CREATE POLICY "messages_delete" ON "public"."messages" FOR DELETE TO "authenticated" USING ((("sender_id" = "auth"."uid"()) OR "public"."is_admin"()));

DROP POLICY IF EXISTS "messages_insert" ON "public"."messages";

CREATE POLICY "messages_insert" ON "public"."messages" FOR INSERT TO "authenticated" WITH CHECK ((("sender_id" = "auth"."uid"()) AND "public"."is_approved"() AND "public"."is_chat_member"("chat_id")));

DROP POLICY IF EXISTS "messages_select" ON "public"."messages";

CREATE POLICY "messages_select" ON "public"."messages" FOR SELECT TO "authenticated" USING ("public"."is_chat_member"("chat_id"));

DROP POLICY IF EXISTS "messages_update" ON "public"."messages";

CREATE POLICY "messages_update" ON "public"."messages" FOR UPDATE TO "authenticated" USING ("public"."is_chat_member"("chat_id")) WITH CHECK ("public"."is_chat_member"("chat_id"));

DROP POLICY IF EXISTS "mreact_delete" ON "public"."message_reactions";

CREATE POLICY "mreact_delete" ON "public"."message_reactions" FOR DELETE TO "authenticated" USING (("user_id" = "auth"."uid"()));

DROP POLICY IF EXISTS "mreact_insert" ON "public"."message_reactions";

CREATE POLICY "mreact_insert" ON "public"."message_reactions" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = "auth"."uid"()) AND "public"."is_approved"() AND ((("kind" = 'dm'::"text") AND "public"."is_chat_member"("thread_id") AND (EXISTS ( SELECT 1
   FROM "public"."messages" "m"
  WHERE (("m"."id" = "message_reactions"."message_id") AND ("m"."chat_id" = "message_reactions"."thread_id"))))) OR (("kind" = 'group'::"text") AND "public"."is_group_member"("thread_id") AND (EXISTS ( SELECT 1
   FROM "public"."group_messages" "g"
  WHERE (("g"."id" = "message_reactions"."message_id") AND ("g"."group_id" = "message_reactions"."thread_id"))))))));

DROP POLICY IF EXISTS "mreact_select" ON "public"."message_reactions";

CREATE POLICY "mreact_select" ON "public"."message_reactions" FOR SELECT TO "authenticated" USING (("public"."is_admin"() OR (("kind" = 'dm'::"text") AND "public"."is_chat_member"("thread_id")) OR (("kind" = 'group'::"text") AND "public"."is_group_member"("thread_id"))));

DROP POLICY IF EXISTS "mreact_update" ON "public"."message_reactions";

CREATE POLICY "mreact_update" ON "public"."message_reactions" FOR UPDATE TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));

DROP POLICY IF EXISTS "notice_select" ON "public"."admin_notice";

CREATE POLICY "notice_select" ON "public"."admin_notice" FOR SELECT TO "authenticated" USING (true);

DROP POLICY IF EXISTS "notice_write" ON "public"."admin_notice";

CREATE POLICY "notice_write" ON "public"."admin_notice" TO "authenticated" USING ("public"."is_admin"()) WITH CHECK ("public"."is_admin"());

ALTER TABLE "public"."post_likes" ENABLE ROW LEVEL SECURITY;

ALTER TABLE "public"."post_views" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "post_views_insert" ON "public"."post_views";

CREATE POLICY "post_views_insert" ON "public"."post_views" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));

DROP POLICY IF EXISTS "post_views_select" ON "public"."post_views";

CREATE POLICY "post_views_select" ON "public"."post_views" FOR SELECT TO "authenticated" USING (true);

ALTER TABLE "public"."posts" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "posts_delete" ON "public"."posts";

CREATE POLICY "posts_delete" ON "public"."posts" FOR DELETE TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."is_admin"()));

DROP POLICY IF EXISTS "posts_insert" ON "public"."posts";

CREATE POLICY "posts_insert" ON "public"."posts" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_admin"() OR ("public"."is_approved"() AND ("user_id" = "auth"."uid"()) AND ("likes_count" = 0) AND ("comment_count" = 0))));

DROP POLICY IF EXISTS "posts_select" ON "public"."posts";

CREATE POLICY "posts_select" ON "public"."posts" FOR SELECT TO "authenticated" USING (("public"."is_admin"() OR ("user_id" = "auth"."uid"()) OR "is_public"));

DROP POLICY IF EXISTS "posts_update" ON "public"."posts";

CREATE POLICY "posts_update" ON "public"."posts" FOR UPDATE TO "authenticated" USING ((("public"."is_approved"() AND ("user_id" = "auth"."uid"())) OR "public"."is_admin"())) WITH CHECK ((("user_id" = "auth"."uid"()) OR "public"."is_admin"()));

ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_delete" ON "public"."profiles";

CREATE POLICY "profiles_delete" ON "public"."profiles" FOR DELETE TO "authenticated" USING ("public"."is_admin"());

DROP POLICY IF EXISTS "profiles_select" ON "public"."profiles";

CREATE POLICY "profiles_select" ON "public"."profiles" FOR SELECT TO "authenticated" USING ((("id" = "auth"."uid"()) OR "public"."is_approved"() OR "public"."is_admin"()));

DROP POLICY IF EXISTS "profiles_update" ON "public"."profiles";

CREATE POLICY "profiles_update" ON "public"."profiles" FOR UPDATE TO "authenticated" USING ((("id" = "auth"."uid"()) OR "public"."is_admin"())) WITH CHECK ((("id" = "auth"."uid"()) OR "public"."is_admin"()));

ALTER TABLE "public"."push_tokens" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "push_tokens_admin_select" ON "public"."push_tokens";

CREATE POLICY "push_tokens_admin_select" ON "public"."push_tokens" FOR SELECT TO "authenticated" USING ("public"."is_admin"());

DROP POLICY IF EXISTS "push_tokens_all" ON "public"."push_tokens";

CREATE POLICY "push_tokens_all" ON "public"."push_tokens" TO "authenticated" USING (("user_id" = "auth"."uid"())) WITH CHECK (("user_id" = "auth"."uid"()));

DROP POLICY IF EXISTS "saved_delete" ON "public"."saved_posts";

CREATE POLICY "saved_delete" ON "public"."saved_posts" FOR DELETE TO "authenticated" USING (("user_id" = "auth"."uid"()));

DROP POLICY IF EXISTS "saved_insert" ON "public"."saved_posts";

CREATE POLICY "saved_insert" ON "public"."saved_posts" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = "auth"."uid"()) AND "public"."is_approved"() AND "public"."post_is_visible"("post_id")));

ALTER TABLE "public"."saved_posts" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "saved_select" ON "public"."saved_posts";

CREATE POLICY "saved_select" ON "public"."saved_posts" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));

ALTER TABLE "public"."stories" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "stories_delete" ON "public"."stories";

CREATE POLICY "stories_delete" ON "public"."stories" FOR DELETE TO "authenticated" USING (("auth"."uid"() = "user_id"));

DROP POLICY IF EXISTS "stories_insert" ON "public"."stories";

CREATE POLICY "stories_insert" ON "public"."stories" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));

DROP POLICY IF EXISTS "stories_select" ON "public"."stories";

CREATE POLICY "stories_select" ON "public"."stories" FOR SELECT TO "authenticated" USING (("expires_at" > "now"()));

ALTER TABLE "public"."story_reactions" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "story_reactions_delete" ON "public"."story_reactions";

CREATE POLICY "story_reactions_delete" ON "public"."story_reactions" FOR DELETE TO "authenticated" USING (("user_id" = "auth"."uid"()));

DROP POLICY IF EXISTS "story_reactions_insert" ON "public"."story_reactions";

CREATE POLICY "story_reactions_insert" ON "public"."story_reactions" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = "auth"."uid"()) AND "public"."is_approved"() AND (EXISTS ( SELECT 1
   FROM "public"."stories" "s"
  WHERE (("s"."id" = "story_reactions"."story_id") AND ("s"."expires_at" > "now"()) AND ("s"."user_id" <> "auth"."uid"()))))));

DROP POLICY IF EXISTS "story_reactions_select" ON "public"."story_reactions";

CREATE POLICY "story_reactions_select" ON "public"."story_reactions" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."stories" "s"
  WHERE (("s"."id" = "story_reactions"."story_id") AND ("s"."user_id" = "auth"."uid"()))))));

DROP POLICY IF EXISTS "story_reactions_update" ON "public"."story_reactions";

CREATE POLICY "story_reactions_update" ON "public"."story_reactions" FOR UPDATE TO "authenticated" USING ((("user_id" = "auth"."uid"()) AND "public"."is_approved"())) WITH CHECK ((("user_id" = "auth"."uid"()) AND "public"."is_approved"() AND (EXISTS ( SELECT 1
   FROM "public"."stories" "s"
  WHERE (("s"."id" = "story_reactions"."story_id") AND ("s"."expires_at" > "now"()) AND ("s"."user_id" <> "auth"."uid"()))))));

ALTER TABLE "public"."story_views" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "story_views_delete" ON "public"."story_views";

CREATE POLICY "story_views_delete" ON "public"."story_views" FOR DELETE TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."stories" "s"
  WHERE (("s"."id" = "story_views"."story_id") AND ("s"."user_id" = "auth"."uid"()))))));

DROP POLICY IF EXISTS "story_views_insert" ON "public"."story_views";

CREATE POLICY "story_views_insert" ON "public"."story_views" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "user_id"));

DROP POLICY IF EXISTS "story_views_select" ON "public"."story_views";

CREATE POLICY "story_views_select" ON "public"."story_views" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."stories" "s"
  WHERE (("s"."id" = "story_views"."story_id") AND ("s"."user_id" = "auth"."uid"()))))));

COMMENT ON POLICY "story_views_select" ON "public"."story_views" IS '080: own views or story owner only';

DROP POLICY IF EXISTS "story_views_update" ON "public"."story_views";

CREATE POLICY "story_views_update" ON "public"."story_views" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));

-- ═══ 9. FUNKSIYA / JADVAL HUQUQLARI (GRANT/REVOKE) ═════════════════════════════════

GRANT USAGE ON SCHEMA "public" TO "postgres";

GRANT USAGE ON SCHEMA "public" TO "anon";

GRANT USAGE ON SCHEMA "public" TO "authenticated";

GRANT USAGE ON SCHEMA "public" TO "service_role";

REVOKE ALL ON FUNCTION "public"."_admin_password_ok"("p_password" "text") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."_admin_password_ok"("p_password" "text") TO "service_role";

GRANT ALL ON FUNCTION "public"."_admin_password_ok"("p_password" "text") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."_admin_wipe_guard"("p_scope" "text", "p_password" "text") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."_admin_wipe_guard"("p_scope" "text", "p_password" "text") TO "service_role";

GRANT ALL ON FUNCTION "public"."_admin_wipe_guard"("p_scope" "text", "p_password" "text") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."_admin_wipe_objects"("p_scope" "text") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."_admin_wipe_objects"("p_scope" "text") TO "service_role";

GRANT ALL ON FUNCTION "public"."_admin_wipe_objects"("p_scope" "text") TO "authenticated";

REVOKE ALL ON FUNCTION "public"."admin_delete_user"("p_uid" "uuid") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."admin_delete_user"("p_uid" "uuid") TO "authenticated";

GRANT ALL ON FUNCTION "public"."admin_delete_user"("p_uid" "uuid") TO "service_role";

REVOKE ALL ON FUNCTION "public"."admin_issue_recovery_code"("p_uid" "uuid", "p_code" "text") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."admin_issue_recovery_code"("p_uid" "uuid", "p_code" "text") TO "authenticated";

GRANT ALL ON FUNCTION "public"."admin_issue_recovery_code"("p_uid" "uuid", "p_code" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."admin_reset_user_password"("p_uid" "uuid", "p_temp_password" "text") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."admin_reset_user_password"("p_uid" "uuid", "p_temp_password" "text") TO "authenticated";

GRANT ALL ON FUNCTION "public"."admin_reset_user_password"("p_uid" "uuid", "p_temp_password" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."admin_storage_usage"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."admin_storage_usage"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."admin_storage_usage"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."admin_trigger_force_reload"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."admin_trigger_force_reload"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."admin_trigger_force_reload"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."admin_verify_password"("p_username" "text", "p_password" "text") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."admin_verify_password"("p_username" "text", "p_password" "text") TO "authenticated";

GRANT ALL ON FUNCTION "public"."admin_verify_password"("p_username" "text", "p_password" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."admin_wipe"("p_scope" "text", "p_password" "text") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."admin_wipe"("p_scope" "text", "p_password" "text") TO "authenticated";

GRANT ALL ON FUNCTION "public"."admin_wipe"("p_scope" "text", "p_password" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."admin_wipe_paths"("p_scope" "text", "p_password" "text") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."admin_wipe_paths"("p_scope" "text", "p_password" "text") TO "authenticated";

GRANT ALL ON FUNCTION "public"."admin_wipe_paths"("p_scope" "text", "p_password" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."append_call_candidate"("p_call" "uuid", "p_candidate" "jsonb") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."append_call_candidate"("p_call" "uuid", "p_candidate" "jsonb") TO "authenticated";

GRANT ALL ON FUNCTION "public"."append_call_candidate"("p_call" "uuid", "p_candidate" "jsonb") TO "service_role";

REVOKE ALL ON FUNCTION "public"."apps_namespace_guard"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."apps_namespace_guard"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."apps_namespace_guard"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."apps_touch_updated"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."apps_touch_updated"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."apps_touch_updated"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."bump_post_counters"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."bump_post_counters"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."bump_post_counters"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."can_post_in_group"("p_group" "uuid") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."can_post_in_group"("p_group" "uuid") TO "authenticated";

GRANT ALL ON FUNCTION "public"."can_post_in_group"("p_group" "uuid") TO "service_role";

REVOKE ALL ON FUNCTION "public"."can_read_group_message"("p_group" "uuid", "p_created" timestamp with time zone) FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."can_read_group_message"("p_group" "uuid", "p_created" timestamp with time zone) TO "authenticated";

GRANT ALL ON FUNCTION "public"."can_read_group_message"("p_group" "uuid", "p_created" timestamp with time zone) TO "service_role";

REVOKE ALL ON FUNCTION "public"."change_my_password"("p_old_password" "text", "p_new_password" "text", "p_device_id" "text") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."change_my_password"("p_old_password" "text", "p_new_password" "text", "p_device_id" "text") TO "authenticated";

GRANT ALL ON FUNCTION "public"."change_my_password"("p_old_password" "text", "p_new_password" "text", "p_device_id" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."change_my_username"("p_new_username" "text", "p_device_id" "text") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."change_my_username"("p_new_username" "text", "p_device_id" "text") TO "authenticated";

GRANT ALL ON FUNCTION "public"."change_my_username"("p_new_username" "text", "p_device_id" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."check_chats_rate_limit"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."check_chats_rate_limit"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."check_chats_rate_limit"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."check_comments_update_security"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."check_comments_update_security"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."check_comments_update_security"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."check_contacts_rate_limit"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."check_contacts_rate_limit"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."check_contacts_rate_limit"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."check_group_members_rate_limit"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."check_group_members_rate_limit"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."check_group_members_rate_limit"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."check_group_message_update_security"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."check_group_message_update_security"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."check_group_message_update_security"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."check_groups_rate_limit"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."check_groups_rate_limit"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."check_groups_rate_limit"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."check_groups_update_security"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."check_groups_update_security"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."check_groups_update_security"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."check_likes_rate_limit"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."check_likes_rate_limit"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."check_likes_rate_limit"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."check_message_update_security"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."check_message_update_security"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."check_message_update_security"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."check_posts_update_security"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."check_posts_update_security"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."check_posts_update_security"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."check_profile_update_security"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."check_profile_update_security"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."check_profile_update_security"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."check_rate_limit"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."check_rate_limit"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."check_rate_limit"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."check_rate_limit_calls"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."check_rate_limit_calls"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."check_rate_limit_calls"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."check_rate_limit_errors"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."check_rate_limit_errors"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."check_rate_limit_errors"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."check_user_recovery"("p_username" "text") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."check_user_recovery"("p_username" "text") TO "authenticated";

GRANT ALL ON FUNCTION "public"."check_user_recovery"("p_username" "text") TO "service_role";

GRANT ALL ON FUNCTION "public"."check_user_recovery"("p_username" "text") TO "anon";

REVOKE ALL ON FUNCTION "public"."cleanup_message_tombstones"("p_days" integer) FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."cleanup_message_tombstones"("p_days" integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."delete_my_account"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."delete_my_account"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."delete_my_account"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."drop_message_reactions"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."drop_message_reactions"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."drop_message_reactions"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."email_for_username"("p_username" "text") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."email_for_username"("p_username" "text") TO "authenticated";

GRANT ALL ON FUNCTION "public"."email_for_username"("p_username" "text") TO "service_role";

GRANT ALL ON FUNCTION "public"."email_for_username"("p_username" "text") TO "anon";

REVOKE ALL ON FUNCTION "public"."enforce_media_path_sane"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."enforce_media_path_sane"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."enforce_media_path_sane"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."enforce_voice_waveform"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."enforce_voice_waveform"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."enforce_voice_waveform"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."expire_stale_calls"("p_max_seconds" integer) FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."expire_stale_calls"("p_max_seconds" integer) TO "authenticated";

GRANT ALL ON FUNCTION "public"."expire_stale_calls"("p_max_seconds" integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."get_heads"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."get_heads"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."get_heads"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."get_or_create_chat"("p_other" "uuid") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."get_or_create_chat"("p_other" "uuid") TO "authenticated";

GRANT ALL ON FUNCTION "public"."get_or_create_chat"("p_other" "uuid") TO "service_role";

GRANT ALL ON FUNCTION "public"."get_story_reaction_counts"("p_story_id" "uuid") TO "authenticated";

GRANT ALL ON FUNCTION "public"."get_story_reaction_counts"("p_story_id" "uuid") TO "service_role";

GRANT ALL ON FUNCTION "public"."get_story_reaction_counts"("p_story_id" "uuid") TO "anon";

REVOKE ALL ON FUNCTION "public"."group_is_private"("p_group" "uuid") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."group_is_private"("p_group" "uuid") TO "authenticated";

GRANT ALL ON FUNCTION "public"."group_is_private"("p_group" "uuid") TO "service_role";

REVOKE ALL ON FUNCTION "public"."group_messages_assign_seq"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."group_messages_assign_seq"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."group_messages_assign_seq"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."group_messages_tombstone"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."group_messages_tombstone"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."group_messages_tombstone"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."group_username_available"("p_username" "text", "p_exclude" "uuid") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."group_username_available"("p_username" "text", "p_exclude" "uuid") TO "authenticated";

GRANT ALL ON FUNCTION "public"."group_username_available"("p_username" "text", "p_exclude" "uuid") TO "service_role";

REVOKE ALL ON FUNCTION "public"."guard_call_update"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."guard_call_update"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."guard_call_update"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."guard_member_update"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."guard_member_update"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."guard_member_update"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."guard_message_update"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."guard_message_update"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."guard_message_update"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."guard_profile_update"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."guard_profile_update"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."guard_profile_update"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."guard_saved_chat_delete"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."guard_saved_chat_delete"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."guard_saved_chat_delete"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."handle_new_user"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";

GRANT ALL ON FUNCTION "public"."increment_post_views"("p_post_id" "uuid") TO "authenticated";

GRANT ALL ON FUNCTION "public"."increment_post_views"("p_post_id" "uuid") TO "service_role";

REVOKE ALL ON FUNCTION "public"."is_admin"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."is_admin"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."is_admin"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."is_approved"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."is_approved"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."is_approved"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."is_chat_member"("p_chat" "uuid") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."is_chat_member"("p_chat" "uuid") TO "authenticated";

GRANT ALL ON FUNCTION "public"."is_chat_member"("p_chat" "uuid") TO "service_role";

REVOKE ALL ON FUNCTION "public"."is_group_admin"("p_group" "uuid") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."is_group_admin"("p_group" "uuid") TO "authenticated";

GRANT ALL ON FUNCTION "public"."is_group_admin"("p_group" "uuid") TO "service_role";

REVOKE ALL ON FUNCTION "public"."is_group_member"("p_group" "uuid") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."is_group_member"("p_group" "uuid") TO "authenticated";

GRANT ALL ON FUNCTION "public"."is_group_member"("p_group" "uuid") TO "service_role";

REVOKE ALL ON FUNCTION "public"."is_my_device_revoked"("p_device_id" "text") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."is_my_device_revoked"("p_device_id" "text") TO "authenticated";

GRANT ALL ON FUNCTION "public"."is_my_device_revoked"("p_device_id" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."join_default_groups"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."join_default_groups"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."join_group_by_token"("p_token" "text") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."join_group_by_token"("p_token" "text") TO "authenticated";

GRANT ALL ON FUNCTION "public"."join_group_by_token"("p_token" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."leave_group"("p_group" "uuid") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."leave_group"("p_group" "uuid") TO "authenticated";

GRANT ALL ON FUNCTION "public"."leave_group"("p_group" "uuid") TO "service_role";

REVOKE ALL ON FUNCTION "public"."mark_my_device_password_login"("p_device_id" "text") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."mark_my_device_password_login"("p_device_id" "text") TO "authenticated";

GRANT ALL ON FUNCTION "public"."mark_my_device_password_login"("p_device_id" "text") TO "service_role";

GRANT ALL ON FUNCTION "public"."message_secrets_cleanup_dm"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."message_secrets_cleanup_dm"() TO "service_role";

GRANT ALL ON FUNCTION "public"."message_secrets_cleanup_group"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."message_secrets_cleanup_group"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."messages_assign_seq"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."messages_assign_seq"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."messages_assign_seq"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."messages_tombstone"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."messages_tombstone"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."messages_tombstone"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."on_group_insert"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."on_group_insert"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."on_group_insert"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."on_group_message_delete"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."on_group_message_delete"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."on_group_message_delete"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."on_group_message_delete_recalc_unread"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."on_group_message_delete_recalc_unread"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."on_group_message_delete_recalc_unread"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."on_group_message_edit_last"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."on_group_message_edit_last"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."on_group_message_edit_last"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."on_group_message_insert"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."on_group_message_insert"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."on_group_message_insert"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."on_message_delete"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."on_message_delete"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."on_message_delete"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."on_message_delete_recalc_unread"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."on_message_delete_recalc_unread"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."on_message_delete_recalc_unread"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."on_message_edit_last"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."on_message_edit_last"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."on_message_edit_last"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."on_message_insert"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."on_message_insert"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."on_message_insert"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."post_is_visible"("p_post" "uuid") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."post_is_visible"("p_post" "uuid") TO "authenticated";

GRANT ALL ON FUNCTION "public"."post_is_visible"("p_post" "uuid") TO "service_role";

REVOKE ALL ON FUNCTION "public"."register_push_token"("p_token" "text", "p_platform" "text", "p_origin" "text") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."register_push_token"("p_token" "text", "p_platform" "text", "p_origin" "text") TO "authenticated";

GRANT ALL ON FUNCTION "public"."register_push_token"("p_token" "text", "p_platform" "text", "p_origin" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."request_password_reset"("p_username" "text", "p_temp_password" "text") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."request_password_reset"("p_username" "text", "p_temp_password" "text") TO "authenticated";

GRANT ALL ON FUNCTION "public"."request_password_reset"("p_username" "text", "p_temp_password" "text") TO "service_role";

GRANT ALL ON FUNCTION "public"."request_password_reset"("p_username" "text", "p_temp_password" "text") TO "anon";

REVOKE ALL ON FUNCTION "public"."reset_password_with_code"("p_username" "text", "p_code" "text", "p_new_password" "text") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."reset_password_with_code"("p_username" "text", "p_code" "text", "p_new_password" "text") TO "authenticated";

GRANT ALL ON FUNCTION "public"."reset_password_with_code"("p_username" "text", "p_code" "text", "p_new_password" "text") TO "service_role";

GRANT ALL ON FUNCTION "public"."reset_password_with_code"("p_username" "text", "p_code" "text", "p_new_password" "text") TO "anon";

REVOKE ALL ON FUNCTION "public"."resolve_group_invite"("p_token" "text") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."resolve_group_invite"("p_token" "text") TO "authenticated";

GRANT ALL ON FUNCTION "public"."resolve_group_invite"("p_token" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."reveal_spoiler"("p_scope" "text", "p_message_id" "uuid", "p_ordinal" integer) FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."reveal_spoiler"("p_scope" "text", "p_message_id" "uuid", "p_ordinal" integer) TO "authenticated";

GRANT ALL ON FUNCTION "public"."reveal_spoiler"("p_scope" "text", "p_message_id" "uuid", "p_ordinal" integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."revoke_my_device_sessions"("p_device_id" "text", "p_all_others" boolean, "p_caller_device_id" "text") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."revoke_my_device_sessions"("p_device_id" "text", "p_all_others" boolean, "p_caller_device_id" "text") TO "authenticated";

GRANT ALL ON FUNCTION "public"."revoke_my_device_sessions"("p_device_id" "text", "p_all_others" boolean, "p_caller_device_id" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."security_lock_remaining"("p_device_id" "text") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."security_lock_remaining"("p_device_id" "text") TO "authenticated";

GRANT ALL ON FUNCTION "public"."security_lock_remaining"("p_device_id" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."server_now"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."server_now"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."server_now"() TO "service_role";

GRANT ALL ON FUNCTION "public"."server_now"() TO "anon";

REVOKE ALL ON FUNCTION "public"."store_message_secrets"("p_scope" "text", "p_message_id" "uuid", "p_secrets" "text"[]) FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."store_message_secrets"("p_scope" "text", "p_message_id" "uuid", "p_secrets" "text"[]) TO "authenticated";

GRANT ALL ON FUNCTION "public"."store_message_secrets"("p_scope" "text", "p_message_id" "uuid", "p_secrets" "text"[]) TO "service_role";

REVOKE ALL ON FUNCTION "public"."sync_chat"("p_chat_id" "uuid", "p_after_seq" bigint, "p_limit" integer) FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."sync_chat"("p_chat_id" "uuid", "p_after_seq" bigint, "p_limit" integer) TO "authenticated";

GRANT ALL ON FUNCTION "public"."sync_chat"("p_chat_id" "uuid", "p_after_seq" bigint, "p_limit" integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."sync_group"("p_group_id" "uuid", "p_after_seq" bigint, "p_limit" integer) FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."sync_group"("p_group_id" "uuid", "p_after_seq" bigint, "p_limit" integer) TO "authenticated";

GRANT ALL ON FUNCTION "public"."sync_group"("p_group_id" "uuid", "p_after_seq" bigint, "p_limit" integer) TO "service_role";

REVOKE ALL ON FUNCTION "public"."touch_group_member_read"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."touch_group_member_read"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."touch_group_member_read"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."transfer_groups_on_profile_delete"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."transfer_groups_on_profile_delete"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."transfer_groups_on_profile_delete"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."upsert_my_device_session"("p_device_id" "text", "p_device_name" "text", "p_device_model" "text", "p_browser" "text", "p_client_type" "text", "p_platform" "text", "p_os_version" "text", "p_user_agent" "text") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."upsert_my_device_session"("p_device_id" "text", "p_device_name" "text", "p_device_model" "text", "p_browser" "text", "p_client_type" "text", "p_platform" "text", "p_os_version" "text", "p_user_agent" "text") TO "authenticated";

GRANT ALL ON FUNCTION "public"."upsert_my_device_session"("p_device_id" "text", "p_device_name" "text", "p_device_model" "text", "p_browser" "text", "p_client_type" "text", "p_platform" "text", "p_os_version" "text", "p_user_agent" "text") TO "service_role";

REVOKE ALL ON FUNCTION "public"."user_password_updated"() FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."user_password_updated"() TO "authenticated";

GRANT ALL ON FUNCTION "public"."user_password_updated"() TO "service_role";

REVOKE ALL ON FUNCTION "public"."username_available"("p_username" "text") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."username_available"("p_username" "text") TO "authenticated";

GRANT ALL ON FUNCTION "public"."username_available"("p_username" "text") TO "service_role";

GRANT ALL ON FUNCTION "public"."username_available"("p_username" "text") TO "anon";

REVOKE ALL ON FUNCTION "public"."verify_recovery_code"("p_username" "text", "p_code" "text") FROM PUBLIC;

GRANT ALL ON FUNCTION "public"."verify_recovery_code"("p_username" "text", "p_code" "text") TO "authenticated";

GRANT ALL ON FUNCTION "public"."verify_recovery_code"("p_username" "text", "p_code" "text") TO "service_role";

GRANT ALL ON FUNCTION "public"."verify_recovery_code"("p_username" "text", "p_code" "text") TO "anon";

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."admin_notice" TO "authenticated";

GRANT ALL ON TABLE "public"."admin_notice" TO "service_role";

GRANT ALL ON TABLE "public"."anon_rate_limits" TO "service_role";

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."app_categories" TO "authenticated";

GRANT ALL ON TABLE "public"."app_categories" TO "service_role";

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."app_force_reload" TO "authenticated";

GRANT ALL ON TABLE "public"."app_force_reload" TO "service_role";

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."apps" TO "authenticated";

GRANT ALL ON TABLE "public"."apps" TO "service_role";

GRANT SELECT,INSERT,DELETE,MAINTAIN ON TABLE "public"."calls" TO "authenticated";

GRANT ALL ON TABLE "public"."calls" TO "service_role";

GRANT UPDATE("status") ON TABLE "public"."calls" TO "authenticated";

GRANT UPDATE("answer") ON TABLE "public"."calls" TO "authenticated";

GRANT UPDATE("caller_candidates") ON TABLE "public"."calls" TO "authenticated";

GRANT UPDATE("callee_candidates") ON TABLE "public"."calls" TO "authenticated";

GRANT UPDATE("video_offer") ON TABLE "public"."calls" TO "authenticated";

GRANT UPDATE("video_answer") ON TABLE "public"."calls" TO "authenticated";

GRANT SELECT,INSERT,DELETE,MAINTAIN ON TABLE "public"."chat_members" TO "authenticated";

GRANT ALL ON TABLE "public"."chat_members" TO "service_role";

GRANT UPDATE("unread_count") ON TABLE "public"."chat_members" TO "authenticated";

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."chats" TO "authenticated";

GRANT ALL ON TABLE "public"."chats" TO "service_role";

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."client_errors" TO "authenticated";

GRANT ALL ON TABLE "public"."client_errors" TO "service_role";

GRANT ALL ON SEQUENCE "public"."client_errors_id_seq" TO "authenticated";

GRANT ALL ON SEQUENCE "public"."client_errors_id_seq" TO "service_role";

GRANT SELECT,INSERT,DELETE,MAINTAIN ON TABLE "public"."comments" TO "authenticated";

GRANT ALL ON TABLE "public"."comments" TO "service_role";

GRANT UPDATE("text") ON TABLE "public"."comments" TO "authenticated";

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."composer_drafts" TO "authenticated";

GRANT ALL ON TABLE "public"."composer_drafts" TO "service_role";

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."contacts" TO "authenticated";

GRANT ALL ON TABLE "public"."contacts" TO "service_role";

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."content_reports" TO "authenticated";

GRANT ALL ON TABLE "public"."content_reports" TO "service_role";

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."device_sessions" TO "authenticated";

GRANT ALL ON TABLE "public"."device_sessions" TO "service_role";

GRANT SELECT,MAINTAIN ON TABLE "public"."entity_tombstones" TO "authenticated";

GRANT ALL ON TABLE "public"."entity_tombstones" TO "service_role";

GRANT ALL ON SEQUENCE "public"."entity_tombstones_id_seq" TO "authenticated";

GRANT ALL ON SEQUENCE "public"."entity_tombstones_id_seq" TO "service_role";

GRANT SELECT,INSERT,DELETE,MAINTAIN ON TABLE "public"."group_members" TO "authenticated";

GRANT ALL ON TABLE "public"."group_members" TO "service_role";

GRANT UPDATE("role") ON TABLE "public"."group_members" TO "authenticated";

GRANT UPDATE("unread_count") ON TABLE "public"."group_members" TO "authenticated";

GRANT UPDATE("can_write") ON TABLE "public"."group_members" TO "authenticated";

GRANT SELECT,MAINTAIN ON TABLE "public"."group_message_tombstones" TO "authenticated";

GRANT ALL ON TABLE "public"."group_message_tombstones" TO "service_role";

GRANT SELECT,INSERT,DELETE,MAINTAIN ON TABLE "public"."group_messages" TO "authenticated";

GRANT ALL ON TABLE "public"."group_messages" TO "service_role";

GRANT UPDATE("text") ON TABLE "public"."group_messages" TO "authenticated";

GRANT UPDATE("edited_at") ON TABLE "public"."group_messages" TO "authenticated";

GRANT SELECT,INSERT,DELETE,MAINTAIN ON TABLE "public"."groups" TO "authenticated";

GRANT ALL ON TABLE "public"."groups" TO "service_role";

GRANT UPDATE("name") ON TABLE "public"."groups" TO "authenticated";

GRANT UPDATE("avatar") ON TABLE "public"."groups" TO "authenticated";

GRANT UPDATE("description") ON TABLE "public"."groups" TO "authenticated";

GRANT UPDATE("is_private") ON TABLE "public"."groups" TO "authenticated";

GRANT UPDATE("invite_code") ON TABLE "public"."groups" TO "authenticated";

GRANT UPDATE("msg_permission") ON TABLE "public"."groups" TO "authenticated";

GRANT UPDATE("username") ON TABLE "public"."groups" TO "authenticated";

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."message_reactions" TO "authenticated";

GRANT ALL ON TABLE "public"."message_reactions" TO "service_role";

GRANT ALL ON TABLE "public"."message_secrets" TO "service_role";

GRANT SELECT,MAINTAIN ON TABLE "public"."message_tombstones" TO "authenticated";

GRANT ALL ON TABLE "public"."message_tombstones" TO "service_role";

GRANT SELECT,INSERT,DELETE,MAINTAIN ON TABLE "public"."messages" TO "authenticated";

GRANT ALL ON TABLE "public"."messages" TO "service_role";

GRANT UPDATE("text") ON TABLE "public"."messages" TO "authenticated";

GRANT UPDATE("status") ON TABLE "public"."messages" TO "authenticated";

GRANT UPDATE("read_at") ON TABLE "public"."messages" TO "authenticated";

GRANT UPDATE("edited_at") ON TABLE "public"."messages" TO "authenticated";

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."post_likes" TO "authenticated";

GRANT ALL ON TABLE "public"."post_likes" TO "service_role";

GRANT ALL ON TABLE "public"."post_views" TO "authenticated";

GRANT ALL ON TABLE "public"."post_views" TO "service_role";

GRANT SELECT,INSERT,DELETE,MAINTAIN ON TABLE "public"."posts" TO "authenticated";

GRANT ALL ON TABLE "public"."posts" TO "service_role";

GRANT UPDATE("text") ON TABLE "public"."posts" TO "authenticated";

GRANT UPDATE("is_public") ON TABLE "public"."posts" TO "authenticated";

GRANT UPDATE("is_max_private") ON TABLE "public"."posts" TO "authenticated";

GRANT SELECT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."profiles" TO "authenticated";

GRANT ALL ON TABLE "public"."profiles" TO "service_role";

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."push_tokens" TO "authenticated";

GRANT ALL ON TABLE "public"."push_tokens" TO "service_role";

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."saved_posts" TO "authenticated";

GRANT ALL ON TABLE "public"."saved_posts" TO "service_role";

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."stories" TO "authenticated";

GRANT ALL ON TABLE "public"."stories" TO "service_role";

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."story_reactions" TO "authenticated";

GRANT ALL ON TABLE "public"."story_reactions" TO "service_role";

GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLE "public"."story_views" TO "authenticated";

GRANT ALL ON TABLE "public"."story_views" TO "service_role";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT SELECT,INSERT,DELETE,MAINTAIN,UPDATE ON TABLES TO "authenticated";

ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";

-- ═══ 10. REALTIME (supabase_realtime) ═════════════════════════════════════════════
DO $pub$
DECLARE t text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
  FOREACH t IN ARRAY ARRAY['admin_notice', 'app_force_reload', 'calls', 'chat_members', 'chats', 'comments', 'entity_tombstones', 'group_members', 'group_message_tombstones', 'group_messages', 'groups', 'message_reactions', 'message_tombstones', 'messages', 'post_likes', 'posts', 'profiles', 'saved_posts', 'stories', 'story_reactions', 'story_views'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = t) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE ONLY public.%I', t);
    END IF;
  END LOOP;
END $pub$;

-- ═══ 11. MEDIA BUCKET va STORAGE SIYOSATLARI ════════════════════════════════════════
-- Bitta bucket: 'media' (ommaviy). Hajm/MIME bo'yicha cheklov yo'q (null) — faqat Supabase global limiti amal qiladi.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('media', 'media', true, NULL, NULL)
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = NULL, allowed_mime_types = NULL;

-- Yo'l tozaligi (yagona qoida): '..' va boshqaruv belgilari bo'lmasin. Fayl turi/hajmi tekshirilmaydi.
CREATE OR REPLACE FUNCTION public.enforce_storage_object_path() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public AS $f$
BEGIN
  IF NEW.name IS NULL OR NEW.name ~ '(^|/)\.\.?(/|$)' OR NEW.name ~ '[[:cntrl:]]' THEN
    RAISE EXCEPTION 'Noto''g''ri fayl yo''li' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $f$;
REVOKE ALL ON FUNCTION public.enforce_storage_object_path() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enforce_storage_object_path() TO authenticated, service_role;

DROP TRIGGER IF EXISTS trg_storage_object_path ON storage.objects;
CREATE TRIGGER trg_storage_object_path BEFORE INSERT OR UPDATE OF name ON storage.objects
  FOR EACH ROW EXECUTE FUNCTION public.enforce_storage_object_path();

DROP POLICY IF EXISTS "media_select" ON storage.objects;
CREATE POLICY "media_select" ON storage.objects FOR SELECT
  USING (bucket_id = 'media');

DROP POLICY IF EXISTS "media_insert" ON storage.objects;
CREATE POLICY "media_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'media' AND (storage.foldername(name))[1] = auth.uid()::text AND public.is_approved());

DROP POLICY IF EXISTS "media_update" ON storage.objects;
CREATE POLICY "media_update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'media' AND (storage.foldername(name))[1] = auth.uid()::text AND public.is_approved());

DROP POLICY IF EXISTS "media_delete" ON storage.objects;
CREATE POLICY "media_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'media' AND ((storage.foldername(name))[1] = auth.uid()::text OR owner = auth.uid() OR public.is_admin()));

-- ═══ 12. AUTH → PROFIL ═══════════════════════════════════════════════════════════
-- Yangi foydalanuvchi ro'yxatdan o'tganda profiles qatori avtomatik yaratiladi.
CREATE OR REPLACE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ═══ 13. CRON ISHLARI (pg_cron bo'lsa) ═════════════════════════════════════════════
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    PERFORM cron.schedule('cleanup-expired-stories', '0 3 * * *', 'DELETE FROM public.stories WHERE expires_at < now()');
    PERFORM cron.schedule('expire-stale-calls', '* * * * *', 'select public.expire_stale_calls(75)');
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'cron ishlari o''rnatilmadi: %', SQLERRM;
END $cron$;

-- ═══ 14. PUSH WEBHOOKLARI (Edge Function: send-push) ═══════════════════════════════
-- Yangi xabar / guruh xabari / qo'ng'iroq → send-push. SIR kiritilmagan bo'lsa — o'tkazib yuboriladi.
DO $push$
DECLARE
  v_ref    text := 'dsomjkskgrhaaxpkdyvs';          -- Supabase loyiha ref (modules/core/env.js dagi URL bilan bir xil)
  v_secret text := '__WEBHOOK_SECRET__';             -- ⚙️ SHU YERGA PUSH_WEBHOOK_SECRET ni qo'ying
  v_hdr    text;
  r        record;
BEGIN
  IF v_secret = '__WEBHOOK_SECRET__' THEN
    RAISE NOTICE 'Push webhook triggerlari o''tkazib yuborildi: 14-bo''limda __WEBHOOK_SECRET__ ni almashtiring va shu bo''limni qayta ishga tushiring';
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'supabase_functions' AND p.proname = 'http_request') THEN
    RAISE NOTICE 'supabase_functions.http_request topilmadi — push triggerlari o''tkazib yuborildi';
    RETURN;
  END IF;
  v_hdr := json_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret)::text;
  FOR r IN SELECT * FROM (VALUES ('calls', 'send_push_on_calls'), ('group_messages', 'send_push_on_group_messages'), ('messages', 'send_push_on_messages')) AS x(tbl, trg) LOOP
    EXECUTE format(
      'CREATE OR REPLACE TRIGGER %I AFTER INSERT ON public.%I FOR EACH ROW EXECUTE FUNCTION supabase_functions.http_request(%L, ''POST'', %L, ''{}'', ''5000'')',
      r.trg, r.tbl, 'https://' || v_ref || '.supabase.co/functions/v1/send-push', v_hdr);
  END LOOP;
END $push$;

-- ═══ 15. ESKI (ENDI KERAK BO'LMAGAN) OBYEKTLARNI TOZALASH ══════════════════════════
-- Fayl turi/hajmi/trafik cheklovlari olib tashlangan; quyidagilar eski migratsiyalardan qolgan edi.
-- Yangi bazada hech narsa topilmaydi (jim o'tadi); mavjud bazada esa tozalaydi.
DROP TRIGGER IF EXISTS tr_storage_rate_limit      ON storage.objects;
DROP TRIGGER IF EXISTS trg_only_jpg_png_storage   ON storage.objects;
DROP TRIGGER IF EXISTS trg_storage_update_guard   ON storage.objects;
DROP POLICY  IF EXISTS "media_public_select"      ON storage.objects;
DROP TRIGGER IF EXISTS trg_only_jpg_png_rows ON public.messages;
DROP TRIGGER IF EXISTS trg_only_jpg_png_rows ON public.group_messages;
DROP TRIGGER IF EXISTS trg_only_jpg_png_rows ON public.posts;
DROP TRIGGER IF EXISTS trg_only_jpg_png_rows ON public.stories;
DROP TRIGGER IF EXISTS tr_cleanup_media_messages       ON public.messages;
DROP TRIGGER IF EXISTS tr_cleanup_media_group_messages ON public.group_messages;
DROP TRIGGER IF EXISTS tr_cleanup_media_posts          ON public.posts;
DROP TRIGGER IF EXISTS tr_cleanup_media_stories        ON public.stories;
DROP FUNCTION IF EXISTS public.check_storage_rate_limit();
DROP FUNCTION IF EXISTS public.enforce_only_jpg_png_storage();
DROP FUNCTION IF EXISTS public.enforce_storage_object_update();
DROP FUNCTION IF EXISTS public.storage_object_violation(text, text, bigint);
DROP FUNCTION IF EXISTS public.enforce_no_video_audio_rows();
DROP FUNCTION IF EXISTS public.cleanup_media_on_delete();
DROP FUNCTION IF EXISTS public.can_access_media(text, uuid);
DROP TABLE   IF EXISTS public._dbg_rate;

-- ═══ TUGADI ═══════════════════════════════════════════════════════════════════════
