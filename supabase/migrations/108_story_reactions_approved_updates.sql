-- 108: require approved accounts for story reaction changes too.
drop policy if exists story_reactions_update on public.story_reactions;
create policy story_reactions_update on public.story_reactions
  for update to authenticated
  using (user_id = auth.uid() and public.is_approved())
  with check (
    user_id = auth.uid()
    and public.is_approved()
    and exists (
      select 1 from public.stories s
      where s.id = story_id and s.expires_at > now() and s.user_id <> auth.uid()
    )
  );
