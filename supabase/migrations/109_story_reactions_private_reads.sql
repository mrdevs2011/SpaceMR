-- 109: reaction rows are visible only to their author and the story owner.
drop policy if exists story_reactions_select on public.story_reactions;
create policy story_reactions_select on public.story_reactions
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.stories s
      where s.id = story_id and s.user_id = auth.uid()
    )
  );
