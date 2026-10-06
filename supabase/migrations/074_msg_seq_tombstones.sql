-- 074: Per-chat/group message sequence + tombstones (Phase 3 / cache roadmap §5.1)
-- Additive only — eski klientlar ishlashda davom etadi.
-- Idempotent. Down (izohda): drop trigger/function/table/column.

-- ── (a) Hisoblagichlar ─────────────────────────────────────────────────
alter table public.chats  add column if not exists msg_seq bigint not null default 0;
alter table public.groups add column if not exists msg_seq bigint not null default 0;

alter table public.messages       add column if not exists seq bigint;
alter table public.group_messages add column if not exists seq bigint;

create index if not exists messages_chat_seq_idx
  on public.messages (chat_id, seq);
create index if not exists group_messages_group_seq_idx
  on public.group_messages (group_id, seq);

-- ── (a) INSERT da seq (qator qulfi — commit tartibi) ───────────────────
-- Faqat INSERT: status='read' UPDATE seq oshirmaydi (trafik). Tombstone o'z seq oladi.

create or replace function public.messages_assign_seq()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.seq is not null then
    return new; -- backfill / aniq berilgan
  end if;
  update public.chats
     set msg_seq = msg_seq + 1
   where id = new.chat_id
  returning msg_seq into new.seq;
  return new;
end;
$$;

drop trigger if exists messages_seq_trg on public.messages;
create trigger messages_seq_trg
  before insert on public.messages
  for each row execute function public.messages_assign_seq();

create or replace function public.group_messages_assign_seq()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.seq is not null then
    return new;
  end if;
  update public.groups
     set msg_seq = msg_seq + 1
   where id = new.group_id
  returning msg_seq into new.seq;
  return new;
end;
$$;

drop trigger if exists group_messages_seq_trg on public.group_messages;
create trigger group_messages_seq_trg
  before insert on public.group_messages
  for each row execute function public.group_messages_assign_seq();

-- ── (b) Tombstone jadvallari ───────────────────────────────────────────
create table if not exists public.message_tombstones (
  chat_id    uuid not null references public.chats(id) on delete cascade,
  message_id uuid not null,
  seq        bigint not null,
  deleted_at timestamptz not null default now(),
  primary key (chat_id, message_id)
);
create index if not exists message_tombstones_chat_seq_idx
  on public.message_tombstones (chat_id, seq);

create table if not exists public.group_message_tombstones (
  group_id   uuid not null references public.groups(id) on delete cascade,
  message_id uuid not null,
  seq        bigint not null,
  deleted_at timestamptz not null default now(),
  primary key (group_id, message_id)
);
create index if not exists group_message_tombstones_group_seq_idx
  on public.group_message_tombstones (group_id, seq);

-- Entity-level tombstones (post/profile/group meta) — Phase 5 uchun tayyor
create table if not exists public.entity_tombstones (
  id         bigserial primary key,
  entity     text not null,          -- 'post' | 'profile' | 'group' | 'chat'
  entity_id  uuid not null,
  scope_id   uuid,                   -- ixtiyoriy (masalan chat_id)
  created_at timestamptz not null default now()
);
create index if not exists entity_tombstones_entity_idx
  on public.entity_tombstones (entity, entity_id);
create index if not exists entity_tombstones_created_idx
  on public.entity_tombstones (created_at);

-- DELETE → tombstone + seq oshirish (realtime INSERT filtrlanadi)
create or replace function public.messages_tombstone()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare s bigint;
begin
  update public.chats set msg_seq = msg_seq + 1 where id = old.chat_id returning msg_seq into s;
  insert into public.message_tombstones (chat_id, message_id, seq)
  values (old.chat_id, old.id, coalesce(s, 0))
  on conflict (chat_id, message_id) do update
    set seq = excluded.seq, deleted_at = now();
  return old;
end;
$$;

drop trigger if exists messages_tombstone_trg on public.messages;
create trigger messages_tombstone_trg
  after delete on public.messages
  for each row execute function public.messages_tombstone();

create or replace function public.group_messages_tombstone()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare s bigint;
begin
  update public.groups set msg_seq = msg_seq + 1 where id = old.group_id returning msg_seq into s;
  insert into public.group_message_tombstones (group_id, message_id, seq)
  values (old.group_id, old.id, coalesce(s, 0))
  on conflict (group_id, message_id) do update
    set seq = excluded.seq, deleted_at = now();
  return old;
end;
$$;

drop trigger if exists group_messages_tombstone_trg on public.group_messages;
create trigger group_messages_tombstone_trg
  after delete on public.group_messages
  for each row execute function public.group_messages_tombstone();

-- ── RLS ────────────────────────────────────────────────────────────────
alter table public.message_tombstones enable row level security;
alter table public.group_message_tombstones enable row level security;
alter table public.entity_tombstones enable row level security;

drop policy if exists message_tombstones_select on public.message_tombstones;
create policy message_tombstones_select on public.message_tombstones
  for select to authenticated
  using (public.is_chat_member(chat_id) or public.is_admin());

drop policy if exists group_message_tombstones_select on public.group_message_tombstones;
create policy group_message_tombstones_select on public.group_message_tombstones
  for select to authenticated
  using (public.is_group_member(group_id) or public.is_admin());

-- entity_tombstones: authenticated o'qiydi (post o'chirish global); yozish faqat service/trigger
drop policy if exists entity_tombstones_select on public.entity_tombstones;
create policy entity_tombstones_select on public.entity_tombstones
  for select to authenticated using (true);

-- Klient to'g'ridan INSERT qilmasin (faqat trigger/service_role)
revoke insert, update, delete on public.message_tombstones from authenticated;
revoke insert, update, delete on public.group_message_tombstones from authenticated;
revoke insert, update, delete on public.entity_tombstones from authenticated;
grant select on public.message_tombstones to authenticated;
grant select on public.group_message_tombstones to authenticated;
grant select on public.entity_tombstones to authenticated;

-- ── Realtime publication (INSERT tombstone — DELETE filtrlanmaydi, P8) ─
do $$
declare t text;
begin
  foreach t in array array['message_tombstones', 'group_message_tombstones', 'entity_tombstones'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

alter table public.message_tombstones replica identity full;
alter table public.group_message_tombstones replica identity full;

-- ── Backfill seq (mavjud xabarlar: created_at, id tartibida) ───────────
-- Trigger o'chirilmagan: seq berilgan qatorlar triggerda o'tkazib yuboriladi.
do $$
begin
  -- messages
  if exists (select 1 from public.messages where seq is null limit 1) then
    with ordered as (
      select id,
             row_number() over (partition by chat_id order by created_at asc, id asc) as rn
      from public.messages
      where seq is null
    )
    update public.messages m set seq = o.rn from ordered o where m.id = o.id;

    update public.chats c set msg_seq = coalesce((
      select max(m.seq) from public.messages m where m.chat_id = c.id
    ), 0)
    where coalesce((
      select max(m.seq) from public.messages m where m.chat_id = c.id
    ), 0) > c.msg_seq;
  end if;

  -- group_messages
  if exists (select 1 from public.group_messages where seq is null limit 1) then
    with ordered as (
      select id,
             row_number() over (partition by group_id order by created_at asc, id asc) as rn
      from public.group_messages
      where seq is null
    )
    update public.group_messages m set seq = o.rn from ordered o where m.id = o.id;

    update public.groups g set msg_seq = coalesce((
      select max(m.seq) from public.group_messages m where m.group_id = g.id
    ), 0)
    where coalesce((
      select max(m.seq) from public.group_messages m where m.group_id = g.id
    ), 0) > g.msg_seq;
  end if;
end $$;

-- ── Retention yordamchisi (30 kun) — cron yoki qo'lda chaqiriladi ───────
create or replace function public.cleanup_message_tombstones(p_days int default 30)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare n bigint := 0; n2 bigint := 0;
begin
  delete from public.message_tombstones
   where deleted_at < now() - make_interval(days => p_days);
  get diagnostics n = row_count;
  delete from public.group_message_tombstones
   where deleted_at < now() - make_interval(days => p_days);
  get diagnostics n2 = row_count;
  delete from public.entity_tombstones
   where created_at < now() - make_interval(days => p_days);
  return n + n2;
end;
$$;

revoke all on function public.cleanup_message_tombstones(int) from public;
grant execute on function public.cleanup_message_tombstones(int) to service_role;

comment on column public.messages.seq is 'Per-chat monotonic sequence (Phase 3 sync cursor)';
comment on column public.chats.msg_seq is 'Last assigned message seq for this chat';
comment on table public.message_tombstones is 'Deleted message trace; clients subscribe to INSERT not DELETE';
