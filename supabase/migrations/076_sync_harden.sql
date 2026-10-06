-- 076: Phase 3/8 hardening after 074+075
-- - anon dan RPC execute olib tashlash
-- - seq NOT NULL (backfill 0 null)
-- - unique (chat_id, seq) / (group_id, seq)
-- - search_path fix (advisor)
-- Idempotent.

-- 1) RPC: faqat authenticated + service_role
revoke all on function public.get_heads() from public;
revoke all on function public.get_heads() from anon;
grant execute on function public.get_heads() to authenticated;
grant execute on function public.get_heads() to service_role;

revoke all on function public.sync_chat(uuid, bigint, int) from public;
revoke all on function public.sync_chat(uuid, bigint, int) from anon;
grant execute on function public.sync_chat(uuid, bigint, int) to authenticated;
grant execute on function public.sync_chat(uuid, bigint, int) to service_role;

revoke all on function public.sync_group(uuid, bigint, int) from public;
revoke all on function public.sync_group(uuid, bigint, int) from anon;
grant execute on function public.sync_group(uuid, bigint, int) to authenticated;
grant execute on function public.sync_group(uuid, bigint, int) to service_role;

-- 2) seq to'liq backfill qilingan — NOT NULL + default yo'q (trigger beradi)
do $$
begin
  if not exists (select 1 from public.messages where seq is null limit 1) then
    alter table public.messages alter column seq set not null;
  end if;
  if not exists (select 1 from public.group_messages where seq is null limit 1) then
    alter table public.group_messages alter column seq set not null;
  end if;
end $$;

-- 3) Unique per-chat sequence (takrorlanmasin)
create unique index if not exists messages_chat_seq_uidx
  on public.messages (chat_id, seq);
create unique index if not exists group_messages_group_seq_uidx
  on public.group_messages (group_id, seq);

-- 4) Advisor: search_path mutable — eng muhim RPC/trigger funksiyalari
-- (mavjud funksiyalarni qayta o'rnatmasdan ALTER)
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'get_heads','sync_chat','sync_group',
        'messages_assign_seq','group_messages_assign_seq',
        'messages_tombstone','group_messages_tombstone',
        'cleanup_message_tombstones',
        'server_now'
      )
  loop
    begin
      execute format('alter function %s set search_path = public', r.sig);
    exception when others then
      raise notice 'skip %: %', r.sig, sqlerrm;
    end;
  end loop;
end $$;

-- 5) Tombstone jadvallarida SELECT grant aniq
grant select on public.message_tombstones to authenticated;
grant select on public.group_message_tombstones to authenticated;
grant select on public.entity_tombstones to authenticated;

comment on index public.messages_chat_seq_uidx is 'Phase 3 unique per-chat seq';
