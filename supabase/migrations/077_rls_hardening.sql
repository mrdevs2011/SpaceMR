-- 077: RLS hardening — ichki jadvallar ochiq qolmasin
-- Idempotent.

-- anon_rate_limits: rate-limit yozuvi, klient o'qimasin/yozmasin
alter table public.anon_rate_limits enable row level security;

-- hech qanday policy yo'q = authenticated/anon uchun rad; service_role RLS ni aylanib o'tadi
drop policy if exists anon_rate_limits_deny_all on public.anon_rate_limits;
-- ixtiyoriy: aniq deny kerak emas, policy yo'qligi yetarli

revoke all on table public.anon_rate_limits from anon, authenticated;
grant all on table public.anon_rate_limits to service_role;

-- _dbg_rate: debug jadvali
alter table public._dbg_rate enable row level security;
revoke all on table public._dbg_rate from anon, authenticated;
grant all on table public._dbg_rate to service_role;

-- Qolgan search_path advisor funksiyalari (mavjudlar)
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'check_likes_rate_limit',
        'check_groups_update_security',
        'check_group_message_update_security',
        'is_chat_member','is_group_member','is_group_admin','is_admin','is_approved',
        'post_is_visible','group_is_private'
      )
  loop
    begin
      execute format('alter function %s set search_path = public', r.sig);
    exception when others then
      raise notice 'skip %: %', r.sig, sqlerrm;
    end;
  end loop;
end $$;
