-- 113: Allow story owners and viewers to delete rows from story_views
-- Enables clean deletion cascade from client when removing a story

drop policy if exists story_views_delete on public.story_views;
create policy story_views_delete on public.story_views
  for delete to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.stories s
      where s.id = story_views.story_id and s.user_id = auth.uid()
    )
  );

grant delete on public.story_views to authenticated;
