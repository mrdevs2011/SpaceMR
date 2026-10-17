-- 106: Spoiler maxfiyligi — ||matn|| DB SELECT/Realtime/API orqali chiqmasin.
-- Matn message_secrets jadvalida; ochish faqat reveal_spoiler RPC orqali (a'zolik tekshiruvi).

create table if not exists public.message_secrets (
  id          uuid primary key default gen_random_uuid(),
  scope       text not null check (scope in ('dm', 'group')),
  message_id  uuid not null,
  ordinal     int  not null check (ordinal >= 0 and ordinal < 64),
  body        text not null check (char_length(body) > 0 and char_length(body) <= 8000),
  created_at  timestamptz not null default now(),
  unique (scope, message_id, ordinal)
);

create index if not exists message_secrets_msg_idx
  on public.message_secrets (scope, message_id);

alter table public.message_secrets enable row level security;

-- To'g'ridan-to'g'ri SELECT/INSERT/UPDATE/DELETE yo'q (faqat SECURITY DEFINER funksiyalar)
revoke all on table public.message_secrets from anon, authenticated, public;

-- Yuboruvchi: insert dan keyin maxfiylarni saqlaydi
create or replace function public.store_message_secrets(
  p_scope text,
  p_message_id uuid,
  p_secrets text[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_sender uuid;
  v_n int;
  i int;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if p_scope is null or p_scope not in ('dm', 'group') then
    raise exception 'bad scope';
  end if;
  if p_message_id is null then
    raise exception 'bad message_id';
  end if;
  v_n := coalesce(array_length(p_secrets, 1), 0);
  if v_n = 0 then
    return;
  end if;
  if v_n > 32 then
    raise exception 'too many secrets';
  end if;

  if p_scope = 'dm' then
    select sender_id into v_sender from public.messages where id = p_message_id;
  else
    select sender_id into v_sender from public.group_messages where id = p_message_id;
  end if;

  if v_sender is null then
    raise exception 'message not found';
  end if;
  if v_sender <> v_uid and not public.is_admin() then
    raise exception 'not sender';
  end if;

  for i in 1..v_n loop
    if p_secrets[i] is null or char_length(p_secrets[i]) = 0 or char_length(p_secrets[i]) > 8000 then
      raise exception 'bad secret at %', i - 1;
    end if;
    insert into public.message_secrets (scope, message_id, ordinal, body)
    values (p_scope, p_message_id, i - 1, p_secrets[i])
    on conflict (scope, message_id, ordinal) do update
      set body = excluded.body
      where public.message_secrets.body is distinct from excluded.body;
  end loop;
end;
$$;

-- O'qish: faqat chat/guruh a'zosi bitta spoiler matnini oladi
create or replace function public.reveal_spoiler(
  p_scope text,
  p_message_id uuid,
  p_ordinal int
)
returns text
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_ok boolean := false;
  v_body text;
  v_chat uuid;
  v_group uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;
  if p_scope is null or p_scope not in ('dm', 'group') then
    raise exception 'bad scope';
  end if;
  if p_message_id is null or p_ordinal is null or p_ordinal < 0 or p_ordinal > 63 then
    raise exception 'bad args';
  end if;

  if p_scope = 'dm' then
    select chat_id into v_chat from public.messages where id = p_message_id;
    if v_chat is null then
      return null;
    end if;
    v_ok := public.is_chat_member(v_chat) or public.is_admin();
  else
    select group_id into v_group from public.group_messages where id = p_message_id;
    if v_group is null then
      return null;
    end if;
    v_ok := public.is_group_member(v_group) or public.is_admin();
  end if;

  if not v_ok then
    raise exception 'forbidden';
  end if;

  select body into v_body
  from public.message_secrets
  where scope = p_scope and message_id = p_message_id and ordinal = p_ordinal;

  return v_body;
end;
$$;

revoke all on function public.store_message_secrets(text, uuid, text[]) from public, anon;
revoke all on function public.reveal_spoiler(text, uuid, int) from public, anon;
grant execute on function public.store_message_secrets(text, uuid, text[]) to authenticated;
grant execute on function public.reveal_spoiler(text, uuid, int) to authenticated;

-- Xabar o'chirilganda maxfiylar ham ketsin
create or replace function public.message_secrets_cleanup_dm()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.message_secrets where scope = 'dm' and message_id = old.id;
  return old;
end;
$$;

create or replace function public.message_secrets_cleanup_group()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.message_secrets where scope = 'group' and message_id = old.id;
  return old;
end;
$$;

drop trigger if exists tr_message_secrets_cleanup_dm on public.messages;
create trigger tr_message_secrets_cleanup_dm
  after delete on public.messages
  for each row execute function public.message_secrets_cleanup_dm();

drop trigger if exists tr_message_secrets_cleanup_group on public.group_messages;
create trigger tr_message_secrets_cleanup_group
  after delete on public.group_messages
  for each row execute function public.message_secrets_cleanup_group();
