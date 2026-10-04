-- ═══════════════════════════════════════════════════════════════════════
-- 060: Foydalanuvchi username lari va guruh username lari — ALOHIDA nomlar fazosi.
-- Endi user "mr" va guruh "mr" birga yashay oladi (URL lar ham alohida:
-- /chats/u/<username> va /chats/g/<username>).
--   • username_available(text)      — faqat profiles
--   • group_username_available(...) — faqat groups (yangi)
--   • change_my_username            — groups bilan solishtirmaydi
-- Idempotent: qayta ishga tushirsa xavfsiz.
-- ═══════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.username_available(p_username text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  select not exists (
    select 1 from public.profiles where username = lower(p_username)
  );
$$;
GRANT ALL ON FUNCTION public.username_available(text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.group_username_available(p_username text, p_exclude uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  select not exists (
    select 1 from public.groups
    where username is not null
      and lower(username) = lower(p_username)
      and (p_exclude is null or id <> p_exclude)
  );
$$;
GRANT EXECUTE ON FUNCTION public.group_username_available(text, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.change_my_username(p_new_username text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
declare
  v_uid uuid := auth.uid();
  v_clean text;
  v_old text;
  v_new_email text;
  v_exists boolean;
begin
  if v_uid is null then
    raise exception 'Avtorizatsiyadan o''tilmagan';
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

  -- Login email username@gmail.com formatida (ro'yxatdan o'tish bilan bir xil)
  v_new_email := v_clean || '@gmail.com';

  -- Agar bu email boshqa auth userda bo'lsa — to'qnashuv
  if exists(select 1 from auth.users where email = v_new_email and id <> v_uid) then
    raise exception 'Bu username band';
  end if;

  update auth.users
  set email = v_new_email,
      email_confirmed_at = coalesce(email_confirmed_at, now()),
      updated_at = now()
  where id = v_uid;

  update public.profiles
  set username = v_clean,
      email = v_new_email
  where id = v_uid;

  return json_build_object('ok', true, 'username', v_clean, 'email', v_new_email);
end;
$$;

REVOKE ALL ON FUNCTION public.change_my_username(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.change_my_username(text) TO authenticated;
