-- 103: shikoyatlar jadvali (ROADMAP 7). Klient insert; admin o'qiydi. Idempotent.
begin;

create table if not exists public.content_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  target_type text not null check (target_type in ('post', 'user', 'other')),
  target_id text,
  target_uid uuid,
  reason text not null,
  note text,
  status text not null default 'open' check (status in ('open', 'reviewing', 'closed')),
  created_at timestamptz not null default now()
);

create index if not exists content_reports_created_idx on public.content_reports (created_at desc);
create index if not exists content_reports_status_idx on public.content_reports (status);

alter table public.content_reports enable row level security;

drop policy if exists content_reports_insert on public.content_reports;
create policy content_reports_insert on public.content_reports
  for insert to authenticated
  with check (reporter_id = (select auth.uid()) and public.is_approved());

drop policy if exists content_reports_select_own on public.content_reports;
create policy content_reports_select_own on public.content_reports
  for select to authenticated
  using (reporter_id = (select auth.uid()) or public.is_admin());

drop policy if exists content_reports_update_admin on public.content_reports;
create policy content_reports_update_admin on public.content_reports
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

revoke all on table public.content_reports from anon, public;
grant select, insert on table public.content_reports to authenticated;
grant update on table public.content_reports to authenticated;

-- anon hech narsa
revoke all on function public.join_default_groups() from anon, public;

commit;
