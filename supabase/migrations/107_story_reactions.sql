-- 107: story reactions (one active reaction per viewer per story).
-- Values are PNG paths only; removing a reaction deletes the viewer's row.

create table if not exists public.story_reactions (
  story_id   uuid not null references public.stories(id) on delete cascade,
  user_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  emoji      text not null check (
    char_length(emoji) <= 96
    and emoji ~ '^emoji/2d/[0-9a-f]{2,6}(-[0-9a-f]{2,6})*\.png$'
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (story_id, user_id)
);

create index if not exists story_reactions_story_idx
  on public.story_reactions (story_id);

alter table public.story_reactions enable row level security;

drop policy if exists story_reactions_select on public.story_reactions;
create policy story_reactions_select on public.story_reactions
  for select to authenticated
  using (exists (
    select 1 from public.stories s
    where s.id = story_id and s.expires_at > now()
  ));

drop policy if exists story_reactions_insert on public.story_reactions;
create policy story_reactions_insert on public.story_reactions
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.is_approved()
    and exists (
      select 1 from public.stories s
      where s.id = story_id and s.expires_at > now() and s.user_id <> auth.uid()
    )
  );

drop policy if exists story_reactions_update on public.story_reactions;
create policy story_reactions_update on public.story_reactions
  for update to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.stories s
      where s.id = story_id and s.expires_at > now() and s.user_id <> auth.uid()
    )
  );

drop policy if exists story_reactions_delete on public.story_reactions;
create policy story_reactions_delete on public.story_reactions
  for delete to authenticated
  using (user_id = auth.uid());

grant select, insert, update, delete on public.story_reactions to authenticated;

alter table public.story_reactions replica identity full;
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'story_reactions'
  ) then
    alter publication supabase_realtime add table public.story_reactions;
  end if;
end $$;
