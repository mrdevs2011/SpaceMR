-- 114: Story reaction counts RPC & policies
create or replace function public.get_story_reaction_counts(p_story_id uuid)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_object_agg(reaction, cnt),
    '{}'::jsonb
  )
  from (
    select reaction, count(*)::int as cnt
    from public.story_views
    where story_id = p_story_id
      and reaction is not null
      and reaction != ''
    group by reaction
  ) sub;
$$;

grant execute on function public.get_story_reaction_counts(uuid) to authenticated, anon;
