-- 104: device_sessions RLS — auth.uid() ni (select auth.uid()) qilib initplan WARN tuzatish.
begin;

drop policy if exists device_sessions_select on public.device_sessions;
create policy device_sessions_select on public.device_sessions
  for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists device_sessions_insert on public.device_sessions;
create policy device_sessions_insert on public.device_sessions
  for insert to authenticated
  with check (user_id = (select auth.uid()));

drop policy if exists device_sessions_update on public.device_sessions;
create policy device_sessions_update on public.device_sessions
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists device_sessions_delete on public.device_sessions;
create policy device_sessions_delete on public.device_sessions
  for delete to authenticated
  using (user_id = (select auth.uid()));

commit;
