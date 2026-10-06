-- Admin: barcha clientlarga hard refresh (online realtime + offline keyingi kirishda)
CREATE TABLE IF NOT EXISTS public.app_force_reload (
  id text PRIMARY KEY DEFAULT 'global' CHECK (id = 'global'),
  version bigint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  by_admin uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

INSERT INTO public.app_force_reload (id, version)
VALUES ('global', 0)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.app_force_reload ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "force_reload_select" ON public.app_force_reload;
CREATE POLICY "force_reload_select" ON public.app_force_reload
  FOR SELECT TO authenticated
  USING (true);

-- Faqat RPC orqali yozish (to'g'ridan-to'g'ri insert/update yo'q)
DROP POLICY IF EXISTS "force_reload_no_write" ON public.app_force_reload;

CREATE OR REPLACE FUNCTION public.admin_trigger_force_reload()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

REVOKE ALL ON FUNCTION public.admin_trigger_force_reload() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_trigger_force_reload() TO authenticated;

-- Realtime (online clientlar darhol eshitsin)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'app_force_reload'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.app_force_reload;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'realtime publication: %', SQLERRM;
END $$;
