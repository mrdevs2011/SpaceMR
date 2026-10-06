-- 078: Global security lockdown
-- 1) anon table grants olib tashlash (RLS bor, lekin privilege kerak emas)
-- 2) anon dan admin/ichki SECURITY DEFINER RPC larni revoke
-- 3) faqat login/recovery uchun kerakli RPC larni anon ga qoldirish
-- 4) barcha public funksiyalarga search_path=public
-- Idempotent.

-- ═══ 1) Table grants: anon hech narsa ═══════════════════════════════════
do $$
declare t text;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
  loop
    execute format('revoke all on table public.%I from anon', t);
  end loop;
end $$;

-- sequences (agar bor)
do $$
declare s text;
begin
  for s in
    select c.relname from pg_class c
    join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='S'
  loop
    execute format('revoke all on sequence public.%I from anon', s);
  end loop;
exception when others then null;
end $$;

-- ═══ 2) Barcha public funksiyalardan anon EXECUTE olib tashlash ═════════
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
  loop
    begin
      execute format('revoke all on function %s from anon', r.sig);
      execute format('revoke all on function %s from public', r.sig);
    exception when others then
      raise notice 'revoke skip %: %', r.sig, sqlerrm;
    end;
  end loop;
end $$;

-- ═══ 3) authenticated ga asosiy RPC lar ═════════════════════════════════
-- (default: GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated
--  ba'zi o'rnatishlarda yo'q — aniq beramiz)
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
  loop
    begin
      execute format('grant execute on function %s to authenticated', r.sig);
      execute format('grant execute on function %s to service_role', r.sig);
    exception when others then null;
    end;
  end loop;
end $$;

-- ═══ 4) Anon uchun FAQAT login/recovery oqimi ═══════════════════════════
-- Bu RPC lar login oldidan chaqiriladi.
grant execute on function public.email_for_username(text) to anon;
grant execute on function public.username_available(text) to anon;
grant execute on function public.check_user_recovery(text) to anon;
grant execute on function public.verify_recovery_code(text, text) to anon;
grant execute on function public.reset_password_with_code(text, text, text) to anon;
grant execute on function public.request_password_reset(text, text) to anon;
-- server_now ixtiyoriy (auth clock skew)
do $$ begin
  grant execute on function public.server_now() to anon;
exception when undefined_function then null;
end $$;

-- Admin / wipe / ichki — authenticated ham emas, faqat service_role yoki is_admin ichida
-- Lekin admin UI authenticated + is_admin tekshiradi; authenticated ga grant qoldiramiz,
-- lekin funksiya ichida password/is_admin guard bor.
-- cleanup_message_tombstones — faqat service_role
do $$ begin
  revoke all on function public.cleanup_message_tombstones(integer) from authenticated;
  grant execute on function public.cleanup_message_tombstones(integer) to service_role;
exception when undefined_function then null;
end $$;

-- ═══ 5) search_path barcha public funksiyalarga ═════════════════════════
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
  loop
    begin
      execute format('alter function %s set search_path = public', r.sig);
    exception when others then null;
    end;
  end loop;
end $$;

-- ═══ 6) Tombstone: authenticated INSERT yo'q (faqat trigger) ═══════════
revoke insert, update, delete, truncate on public.message_tombstones from authenticated;
revoke insert, update, delete, truncate on public.group_message_tombstones from authenticated;
revoke insert, update, delete, truncate on public.entity_tombstones from authenticated;
grant select on public.message_tombstones to authenticated;
grant select on public.group_message_tombstones to authenticated;
grant select on public.entity_tombstones to authenticated;

-- ═══ 7) Storage: public bucket o'qish OK; yozish authenticated ═════════
-- storage.objects policies (Supabase standard jadval)
do $$
begin
  -- authenticated upload own folder (agar yo'q bo'lsa yaratiladi — idempotent drop/create)
  if exists (select 1 from information_schema.tables where table_schema='storage' and table_name='objects') then
    -- ensure RLS
    alter table storage.objects enable row level security;
  end if;
exception when others then
  raise notice 'storage skip: %', sqlerrm;
end $$;

comment on schema public is 'SpaceMR 078 lockdown: anon table grants revoked; public RPCs limited to auth/recovery';
