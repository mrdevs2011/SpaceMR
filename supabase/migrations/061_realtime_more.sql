-- Realtime: hikoyalar, hikoya ko'rishlari va saqlanganlar ham jonli bo'lsin (ilova: modules/core/live.js).
-- Idempotent: qayta ishga tushirsa xato bermaydi.
do $$
declare t text;
begin
  foreach t in array array['stories','story_views','saved_posts'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- DELETE hodisalarida eski qator (post_id / story_id) kelishi uchun
alter table public.stories     replica identity full;
alter table public.saved_posts replica identity full;
