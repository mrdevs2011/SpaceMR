-- 105: hisob darajasidagi qoralamalar (post, story, dm, guruh)
begin;

create table if not exists public.composer_drafts (
  user_id uuid not null references auth.users(id) on delete cascade,
  scope text not null,
  body text not null default '',
  updated_at timestamptz not null default now(),
  primary key (user_id, scope)
);

alter table public.composer_drafts enable row level security;

drop policy if exists composer_drafts_select on public.composer_drafts;
create policy composer_drafts_select on public.composer_drafts
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists composer_drafts_insert on public.composer_drafts;
create policy composer_drafts_insert on public.composer_drafts
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists composer_drafts_update on public.composer_drafts;
create policy composer_drafts_update on public.composer_drafts
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists composer_drafts_delete on public.composer_drafts;
create policy composer_drafts_delete on public.composer_drafts
  for delete to authenticated
  using (user_id = (select auth.uid()));

commit;
