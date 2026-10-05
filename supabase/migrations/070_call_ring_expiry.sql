-- 070: Qo'ng'iroq maksimal jiringlash vaqti — SERVER zaxirasi.
-- Asosiy chegara klientda (modules/call/call.js: CALL_RING_MAX_MS = 45s). Chaqiruvchi ilovasi yopilib/uzilib qolsa
-- 'ringing' yozuvi osilib qolmasin: shuncha soniyadan eski 'ringing' qo'ng'iroqlar 'ended' bo'ladi.
-- Soat farqi uchun zaxira bilan: 45s + 30s = 75s. Idempotent.

create or replace function public.expire_stale_calls(p_max_seconds integer default 75)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  update public.calls
     set status = 'ended'
   where status = 'ringing'
     and created_at < now() - make_interval(secs => greatest(p_max_seconds, 15));
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.expire_stale_calls(integer) from public;
grant execute on function public.expire_stale_calls(integer) to authenticated, service_role;

-- pg_cron bor bo'lsa — har daqiqada avtomatik (yo'q bo'lsa jimgina o'tkazib yuboriladi)
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('expire-stale-calls', '* * * * *', 'select public.expire_stale_calls(75)');
  end if;
exception when others then
  raise notice 'pg_cron jadvali o''rnatilmadi: %', sqlerrm;
end $$;
