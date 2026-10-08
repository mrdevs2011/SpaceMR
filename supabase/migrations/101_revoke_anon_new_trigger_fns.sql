-- 101: 100 da yaratilgan 2 ta trigger funksiyasi default ACL tufayli anon EXECUTE bilan chiqdi
-- (trigger funksiyani RPC sifatida chaqirib bo'lmaydi, lekin "anon faqat login oqimi" qoidasi buzilmasin).
-- Shu bilan birga: anon allowlist'dan tashqari HAMMA public funksiyalarni qayta tozalaydigan supurgi.
-- Kelajakda yangi funksiya qo'shilgan har migratsiya oxirida shu blokni takrorlash kerak (docs/RUNBOOK.md).

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and p.proname not in ('email_for_username','username_available','check_user_recovery',
                            'verify_recovery_code','reset_password_with_code','request_password_reset','server_now')
  loop
    begin
      execute format('revoke all on function %s from anon', r.sig);
      execute format('revoke all on function %s from public', r.sig);
    exception when others then
      raise notice 'revoke skip %: %', r.sig, sqlerrm;
    end;
  end loop;
end $$;
