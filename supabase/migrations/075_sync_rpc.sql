-- 075: get_heads / sync_chat / sync_group RPCs (Phase 3)
-- SECURITY INVOKER — RLS ishlaydi, boshqa foydalanuvchi ma'lumoti sizib chiqmaydi.
-- Idempotent.

-- ── get_heads: bitta so'rov — chat/group head + feed/stories/profile ishoralar ─
create or replace function public.get_heads()
returns jsonb
language plpgsql
security invoker
set search_path = public
stable
as $$
declare
  uid uuid := auth.uid();
  result jsonb;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'server_time', now(),
    'chats', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id,
        'msg_seq', c.msg_seq,
        'last_message_at', c.last_message_at,
        'last_preview', c.last_message,
        'last_sender_id', c.last_sender_id,
        'unread', coalesce(cm.unread_count, 0)
      ) order by c.last_message_at desc nulls last)
      from public.chats c
      join public.chat_members cm on cm.chat_id = c.id and cm.user_id = uid
    ), '[]'::jsonb),
    'groups', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', g.id,
        'msg_seq', g.msg_seq,
        'last_message_at', g.last_message_at,
        'last_preview', g.last_message,
        'last_sender_id', g.last_sender_id,
        'unread', coalesce(gm.unread_count, 0),
        'role', gm.role
      ) order by g.last_message_at desc nulls last)
      from public.groups g
      join public.group_members gm on gm.group_id = g.id and gm.user_id = uid
    ), '[]'::jsonb),
    'feed_head', (
      select jsonb_build_object(
        'max_created_at', max(p.created_at),
        'count', count(*)::int
      ) from public.posts p
    ),
    'stories_head', (
      select jsonb_build_object(
        'max_created_at', max(s.created_at),
        'count', count(*)::int
      )
      from public.stories s
      where s.created_at > now() - interval '24 hours'
    ),
    'profile_rev', (
      select extract(epoch from p.last_seen)::bigint
      from public.profiles p where p.id = uid
    )
  ) into result;

  return result;
end;
$$;

revoke all on function public.get_heads() from public;
grant execute on function public.get_heads() to authenticated;

-- ── sync_chat: delta messages + tombstones after p_after_seq ───────────
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

  -- Kursor retention dan eski bo'lsa — to'liq qayta yuklash
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
      select jsonb_agg(e) from (
        select e from jsonb_array_elements(msgs) with ordinality t(e, n)
        where n <= lim
      ) s
    );
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'message_id', t.message_id,
    'seq', t.seq,
    'deleted_at', t.deleted_at
  ) order by t.seq), '[]'::jsonb)
  into tombs
  from public.message_tombstones t
  where t.chat_id = p_chat_id and t.seq > after_seq
  order by t.seq asc
  limit lim;

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

revoke all on function public.sync_chat(uuid, bigint, int) from public;
grant execute on function public.sync_chat(uuid, bigint, int) to authenticated;

-- ── sync_group ─────────────────────────────────────────────────────────
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
      select jsonb_agg(e) from (
        select e from jsonb_array_elements(msgs) with ordinality t(e, n)
        where n <= lim
      ) s
    );
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'message_id', t.message_id,
    'seq', t.seq,
    'deleted_at', t.deleted_at
  ) order by t.seq), '[]'::jsonb)
  into tombs
  from public.group_message_tombstones t
  where t.group_id = p_group_id and t.seq > after_seq
  order by t.seq asc
  limit lim;

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

revoke all on function public.sync_group(uuid, bigint, int) from public;
grant execute on function public.sync_group(uuid, bigint, int) to authenticated;

comment on function public.get_heads() is 'Phase 3: single-request heads for chats/groups/feed/stories';
comment on function public.sync_chat(uuid, bigint, int) is 'Phase 3: delta sync for DM thread';
comment on function public.sync_group(uuid, bigint, int) is 'Phase 3: delta sync for group thread';
