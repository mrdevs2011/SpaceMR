-- 096: sync_chat / sync_group tombstone so'rovi
-- jsonb_agg + tashqi ORDER BY t.seq Postgresda GROUP BY xatosi beradi:
--   column "t.seq" must appear in the GROUP BY clause or be used in an aggregate function
-- Tartib va limit ichki so'rovda, agregat tashqarida.

create or replace function public.sync_chat(
  p_chat_id uuid,
  p_after_seq bigint default 0,
  p_limit int default 100
)
returns jsonb
language plpgsql
security invoker
set search_path = public
stable
as $$
declare
  uid uuid := auth.uid();
  head bigint;
  lim int := greatest(1, least(coalesce(p_limit, 100), 200));
  after_seq bigint := coalesce(p_after_seq, 0);
  oldest_tomb bigint;
  reset_req boolean := false;
  msgs jsonb;
  tombs jsonb;
  has_more boolean := false;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not (public.is_chat_member(p_chat_id) or public.is_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select c.msg_seq into head from public.chats c where c.id = p_chat_id;
  if head is null then
    return jsonb_build_object(
      'messages', '[]'::jsonb,
      'tombstones', '[]'::jsonb,
      'head_seq', 0,
      'has_more', false,
      'reset_required', true,
      'server_time', now()
    );
  end if;

  select min(t.seq) into oldest_tomb
    from public.message_tombstones t where t.chat_id = p_chat_id;
  if after_seq > 0 and oldest_tomb is not null and after_seq < oldest_tomb then
    reset_req := true;
  end if;

  if reset_req then
    return jsonb_build_object(
      'messages', '[]'::jsonb,
      'tombstones', '[]'::jsonb,
      'head_seq', head,
      'has_more', false,
      'reset_required', true,
      'server_time', now()
    );
  end if;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.seq), '[]'::jsonb)
  into msgs
  from (
    select m.id, m.seq, m.chat_id, m.sender_id, m.type, m.text,
           m.media_path, m.media_type, m.file_name, m.file_size,
           m.duration, m.status, m.read_at, m.edited_at, m.created_at,
           m.reply_to, m.waveform
    from public.messages m
    where m.chat_id = p_chat_id and m.seq > after_seq
    order by m.seq asc
    limit lim + 1
  ) x;

  if jsonb_array_length(msgs) > lim then
    has_more := true;
    msgs := (
      select coalesce(jsonb_agg(s.e order by s.n), '[]'::jsonb) from (
        select e, n from jsonb_array_elements(msgs) with ordinality t(e, n)
        where n <= lim
      ) s
    );
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'message_id', s.message_id,
    'seq', s.seq,
    'deleted_at', s.deleted_at
  ) order by s.seq), '[]'::jsonb)
  into tombs
  from (
    select t.message_id, t.seq, t.deleted_at
    from public.message_tombstones t
    where t.chat_id = p_chat_id and t.seq > after_seq
    order by t.seq asc
    limit lim
  ) s;

  return jsonb_build_object(
    'messages', msgs,
    'tombstones', tombs,
    'head_seq', head,
    'has_more', has_more,
    'reset_required', false,
    'server_time', now()
  );
end;
$$;

create or replace function public.sync_group(
  p_group_id uuid,
  p_after_seq bigint default 0,
  p_limit int default 100
)
returns jsonb
language plpgsql
security invoker
set search_path = public
stable
as $$
declare
  uid uuid := auth.uid();
  head bigint;
  lim int := greatest(1, least(coalesce(p_limit, 100), 200));
  after_seq bigint := coalesce(p_after_seq, 0);
  oldest_tomb bigint;
  reset_req boolean := false;
  msgs jsonb;
  tombs jsonb;
  has_more boolean := false;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not (public.is_group_member(p_group_id) or public.is_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select g.msg_seq into head from public.groups g where g.id = p_group_id;
  if head is null then
    return jsonb_build_object(
      'messages', '[]'::jsonb,
      'tombstones', '[]'::jsonb,
      'head_seq', 0,
      'has_more', false,
      'reset_required', true,
      'server_time', now()
    );
  end if;

  select min(t.seq) into oldest_tomb
    from public.group_message_tombstones t where t.group_id = p_group_id;
  if after_seq > 0 and oldest_tomb is not null and after_seq < oldest_tomb then
    reset_req := true;
  end if;

  if reset_req then
    return jsonb_build_object(
      'messages', '[]'::jsonb,
      'tombstones', '[]'::jsonb,
      'head_seq', head,
      'has_more', false,
      'reset_required', true,
      'server_time', now()
    );
  end if;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.seq), '[]'::jsonb)
  into msgs
  from (
    select m.id, m.seq, m.group_id, m.sender_id, m.type, m.text,
           m.media_path, m.media_type, m.file_name, m.file_size,
           m.duration, m.edited_at, m.created_at, m.reply_to, m.waveform
    from public.group_messages m
    where m.group_id = p_group_id and m.seq > after_seq
    order by m.seq asc
    limit lim + 1
  ) x;

  if jsonb_array_length(msgs) > lim then
    has_more := true;
    msgs := (
      select coalesce(jsonb_agg(s.e order by s.n), '[]'::jsonb) from (
        select e, n from jsonb_array_elements(msgs) with ordinality t(e, n)
        where n <= lim
      ) s
    );
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'message_id', s.message_id,
    'seq', s.seq,
    'deleted_at', s.deleted_at
  ) order by s.seq), '[]'::jsonb)
  into tombs
  from (
    select t.message_id, t.seq, t.deleted_at
    from public.group_message_tombstones t
    where t.group_id = p_group_id and t.seq > after_seq
    order by t.seq asc
    limit lim
  ) s;

  return jsonb_build_object(
    'messages', msgs,
    'tombstones', tombs,
    'head_seq', head,
    'has_more', has_more,
    'reset_required', false,
    'server_time', now()
  );
end;
$$;

revoke all on function public.sync_chat(uuid, bigint, int) from public, anon;
grant execute on function public.sync_chat(uuid, bigint, int) to authenticated, service_role;
revoke all on function public.sync_group(uuid, bigint, int) from public, anon;
grant execute on function public.sync_group(uuid, bigint, int) to authenticated, service_role;

comment on function public.sync_group(uuid, bigint, int) is 'Delta sync for group thread; tombstone ORDER BY subquery (096)';
