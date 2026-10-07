-- 086: Ommaviy vs maxfiy guruh xabar tarixi
-- Ommaviy: a'zo bo'lmasa ham (va qayta kirsa ham) barcha xabarlarni o'qiy oladi
-- Maxfiy: faqat a'zo va faqat o'z joined_at dan keyingi xabarlar

CREATE OR REPLACE FUNCTION public.can_read_group_message(p_group uuid, p_created timestamptz)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
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

REVOKE ALL ON FUNCTION public.can_read_group_message(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_read_group_message(uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_group_message(uuid, timestamptz) TO service_role;

DROP POLICY IF EXISTS "gmsg_select" ON public.group_messages;
CREATE POLICY "gmsg_select" ON public.group_messages
  FOR SELECT TO authenticated
  USING (public.can_read_group_message(group_id, created_at));

-- Maxfiy guruhlarni nom/username bo'yicha qidirish uchun alohida yordamchi
-- (RLS allaqachon yashiradi; RPC aniq invite_code bilan topadi)
CREATE OR REPLACE FUNCTION public.resolve_group_invite(p_token text)
RETURNS json
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
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

REVOKE ALL ON FUNCTION public.resolve_group_invite(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_group_invite(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_group_invite(text) TO service_role;

-- join_group_by_token: URL dan ham kod ajratib olsin
CREATE OR REPLACE FUNCTION public.join_group_by_token(p_token text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
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
$$;
