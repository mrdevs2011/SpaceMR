-- 111_post_views_and_metrics.sql
-- Instagram-style post views tracking & atomic metrics

-- 1) Create post_views table for unique user views
CREATE TABLE IF NOT EXISTS public.post_views (
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  viewed_at timestamptz DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_post_views_post_id ON public.post_views (post_id);
CREATE INDEX IF NOT EXISTS idx_post_views_user_id ON public.post_views (user_id);

-- 2) Enable RLS on post_views
ALTER TABLE public.post_views ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS post_views_select ON public.post_views;
CREATE POLICY post_views_select ON public.post_views
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS post_views_insert ON public.post_views;
CREATE POLICY post_views_insert ON public.post_views
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

GRANT ALL ON TABLE public.post_views TO authenticated;
GRANT ALL ON TABLE public.post_views TO service_role;

-- 3) Ensure views_count column exists on posts table
ALTER TABLE public.posts ADD COLUMN IF NOT EXISTS views_count integer DEFAULT 0;

-- 4) Atomic secure RPC function to record a post view and increment counter
CREATE OR REPLACE FUNCTION public.increment_post_views(p_post_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

GRANT EXECUTE ON FUNCTION public.increment_post_views(uuid) TO authenticated;

-- 5) Story views index for high-frequency queries
CREATE INDEX IF NOT EXISTS idx_story_views_story_id ON public.story_views (story_id);
CREATE INDEX IF NOT EXISTS idx_story_views_user_id ON public.story_views (user_id);
