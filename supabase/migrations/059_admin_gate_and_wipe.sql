-- ═══════════════════════════════════════════════════════════════════════
-- 059: ADMIN PANEL — parol bilan kirish + test ma'lumotlarini tozalash
--   • admin_verify_password(username, password) — panelga har kirishda
--   • admin_wipe_paths(scope, password)          — o'chiriladigan fayllar ro'yxati
--                                                  (klient ularni Storage API bilan o'chiradi)
--   • admin_wipe(scope, password)                — jadvallarni tozalaydi
--   scope: 'accounts' | 'content' | 'chats' | 'all'
--     accounts — admindan boshqa barcha akkauntlar (ularning hamma narsasi bilan)
--     content  — postlar, izohlar, like, saqlanganlar, story
--     chats    — shaxsiy chatlar, guruhlar, xabarlar, qo'ng'iroqlar
--     all      — yuqoridagilarning hammasi + xatolar logi, e'lonlar, kontaktlar; storage 0 B
-- Admin akkaunt(lar)i hech qachon o'chirilmaydi.
-- Idempotent: qayta ishga tushirish xavfsiz.
-- ═══════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto with schema extensions;

-- Ichki: joriy admin parolini tekshirish (to'g'ridan-to'g'ri chaqirib bo'lmaydi)
create or replace function public._admin_password_ok(p_password text) returns boolean
language plpgsql stable security definer
set search_path = public, auth, extensions as $$
declare
  v_hash text;
begin
  if auth.uid() is null or not public.is_admin() then return false; end if;
  if coalesce(p_password, '') = '' then return false; end if;
  select encrypted_password into v_hash from auth.users where id = auth.uid();
  return v_hash is not null and extensions.crypt(p_password, v_hash) = v_hash;
end $$;
revoke all on function public._admin_password_ok(text) from public, anon, authenticated;

-- Panelga kirish: username joriy adminniki bo'lishi va parol to'g'ri bo'lishi shart
create or replace function public.admin_verify_password(p_username text, p_password text) returns boolean
language plpgsql volatile security definer
set search_path = public, auth, extensions as $$
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
revoke all on function public.admin_verify_password(text, text) from public, anon;
grant execute on function public.admin_verify_password(text, text) to authenticated;

-- Ichki: bo'lim bo'yicha 'media' bucket fayllari
-- Yo'l formati: {uid}/{papka}/{fayl}; papkalar: posts, stories, avatars, group-avatars, chat-voice, group-files, ...
create or replace function public._admin_wipe_objects(p_scope text) returns setof text
language sql stable security definer
set search_path = public, storage as $$
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
revoke all on function public._admin_wipe_objects(text) from public, anon, authenticated;

create or replace function public._admin_wipe_guard(p_scope text, p_password text) returns void
language plpgsql volatile security definer
set search_path = public, auth, extensions as $$
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
revoke all on function public._admin_wipe_guard(text, text) from public, anon, authenticated;

-- 1-qadam: klient o'chiradigan fayllar ro'yxati
create or replace function public.admin_wipe_paths(p_scope text, p_password text) returns text[]
language plpgsql volatile security definer
set search_path = public, storage as $$
begin
  perform public._admin_wipe_guard(p_scope, p_password);
  return coalesce((select array_agg(n) from public._admin_wipe_objects(p_scope) as n), '{}');
end $$;
revoke all on function public.admin_wipe_paths(text, text) from public, anon;
grant execute on function public.admin_wipe_paths(text, text) to authenticated;

-- 2-qadam: jadvallarni tozalash. Natija: har jadvaldan nechta qator o'chgani.
-- Eslatma: Supabase safeupdate WHERE'siz DELETE'ni bloklaydi — shuning uchun "where true".
create or replace function public.admin_wipe(p_scope text, p_password text) returns jsonb
language plpgsql volatile security definer
set search_path = public, auth, storage as $$
declare
  r jsonb := '{}'::jsonb;
  n bigint;
begin
  perform public._admin_wipe_guard(p_scope, p_password);

  -- cleanup_media_on_delete triggerlari va quyidagi storage tozalash uchun ruxsat (faqat shu tranzaksiyada)
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
revoke all on function public.admin_wipe(text, text) from public, anon;
grant execute on function public.admin_wipe(text, text) to authenticated;

-- Admin istalgan 'media' faylini Storage API orqali o'chira oladi (fayl o'zi ham o'chishi uchun)
drop policy if exists media_admin_delete on storage.objects;
create policy media_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'media' and public.is_admin());
