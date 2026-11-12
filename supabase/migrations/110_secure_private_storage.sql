-- 110: Secure Private Storage & Story Reactions Upsert Support
-- 1) Lockdown media bucket to private (signed URLs required)
UPDATE storage.buckets SET public = false WHERE id = 'media';

-- 2) Access control helper for media objects
CREATE OR REPLACE FUNCTION public.can_access_media(obj_name text, obj_owner uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  -- Admin can access all media
  IF public.is_admin() THEN
    RETURN true;
  END IF;

  -- Object owner by uid folder or owner field
  IF (storage.foldername(obj_name))[1] = v_uid::text OR obj_owner = v_uid THEN
    RETURN true;
  END IF;

  -- Direct chat participant
  IF EXISTS (
    SELECT 1 FROM public.messages m
    JOIN public.chats c ON c.id = m.chat_id
    WHERE m.media_path = obj_name
      AND (c.user_a = v_uid OR c.user_b = v_uid)
  ) THEN
    RETURN true;
  END IF;

  -- Group message participant
  IF EXISTS (
    SELECT 1 FROM public.group_messages gm
    JOIN public.group_members gmb ON gmb.group_id = gm.group_id
    WHERE gm.media_path = obj_name
      AND gmb.user_id = v_uid
  ) THEN
    RETURN true;
  END IF;

  -- Post author or approved viewer
  IF EXISTS (
    SELECT 1 FROM public.posts p
    WHERE p.media_path = obj_name
      AND (p.user_id = v_uid OR p.is_public = true OR (p.is_max_private = false AND public.is_approved()))
  ) THEN
    RETURN true;
  END IF;

  -- Stories viewer (active/non-expired story)
  IF EXISTS (
    SELECT 1 FROM public.stories s
    WHERE s.media_path = obj_name
      AND (s.user_id = v_uid OR public.is_approved())
  ) THEN
    RETURN true;
  END IF;

  -- Profile and group avatars
  IF (storage.foldername(obj_name))[2] IN ('avatars', 'group-avatars') AND public.is_approved() THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.can_access_media(text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.can_access_media(text, uuid) TO authenticated, service_role;

-- 3) Strict RLS on storage.objects
DROP POLICY IF EXISTS media_select ON storage.objects;
CREATE POLICY media_select ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'media'
    AND public.can_access_media(name, owner)
  );

DROP POLICY IF EXISTS media_insert ON storage.objects;
CREATE POLICY media_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'media'
    AND (storage.foldername(name))[1] = (auth.uid())::text
    AND public.is_approved()
    AND lower(coalesce(storage.extension(name), '')) <> 'svg'
    AND lower(coalesce((metadata->>'mimetype')::text, '')) NOT IN ('image/svg+xml', 'image/svg', 'text/html', 'application/x-javascript')
    AND (metadata->>'size' IS NULL OR (metadata->>'size')::bigint <= 52428800)
  );

DROP POLICY IF EXISTS media_delete_own ON storage.objects;
DROP POLICY IF EXISTS media_admin_delete ON storage.objects;
DROP POLICY IF EXISTS media_delete ON storage.objects;
CREATE POLICY media_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'media'
    AND (
      (storage.foldername(name))[1] = (auth.uid())::text
      OR owner = auth.uid()
      OR public.is_admin()
    )
  );

-- 4) Support for story reactions on story_views
ALTER TABLE public.story_views ADD COLUMN IF NOT EXISTS reaction text;

DROP POLICY IF EXISTS story_views_update ON public.story_views;
CREATE POLICY story_views_update ON public.story_views
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

GRANT UPDATE ON public.story_views TO authenticated;
