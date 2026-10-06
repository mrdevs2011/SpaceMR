# Phase 3 migratsiyalar (074 + 075)

## Qo'llash
Supabase SQL Editor yoki CLI:

```bash
# tartib muhim
psql "$DATABASE_URL" -f supabase/migrations/074_msg_seq_tombstones.sql
psql "$DATABASE_URL" -f supabase/migrations/075_sync_rpc.sql
```

Yoki Dashboard → SQL → har bir faylni ketma-ket ishga tushiring.

## Tekshiruv (smoke)

```sql
-- seq ustunlari
select column_name from information_schema.columns
 where table_schema='public' and table_name='messages' and column_name='seq';

-- RPC
select public.get_heads();  -- autentifikatsiya bilan

-- Negativ: boshqa chat sync_chat → forbidden
-- select public.sync_chat('<boshqa-chat-uuid>', 0, 10);

-- Tombstone: xabar o'chiring → message_tombstones da qator + realtime INSERT

-- Retention
-- select public.cleanup_message_tombstones(30);
```

## Orqaga qaytarish (qo'lda)

```sql
-- RPC
drop function if exists public.sync_group(uuid, bigint, int);
drop function if exists public.sync_chat(uuid, bigint, int);
drop function if exists public.get_heads();

-- triggers / tombstone (ixtiyoriy — ustunlar qolishi mumkin)
drop trigger if exists messages_tombstone_trg on public.messages;
drop trigger if exists group_messages_tombstone_trg on public.group_messages;
drop trigger if exists messages_seq_trg on public.messages;
drop trigger if exists group_messages_seq_trg on public.group_messages;
```

Eski klientlar `seq` ni e'tiborsiz qoldiradi (qo'shimcha ustun).
