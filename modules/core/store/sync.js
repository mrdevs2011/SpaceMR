/**
 * sync.js — get_heads + delta (sync_chat/sync_group) + realtime bridge.
 * Feature flag: localStorage ff_sync_v2=1 (default OFF — migratsiya kerak).
 * RPC yo'q/xato → null qaytaradi, chaqiruvchi eski yo'lga tushadi.
 */
import { sb, mapMessage, state, ts } from '../config.js';
import { putThread, putChatsList, setUid, isStoreV2Enabled, store } from './store.js';
import { canCache } from '../cache-policy.js';
import { syncPath, measure } from '../perf.js';
import { isSyncV2Enabled as _flagSync } from './flags.js';

let _heads = null;
let _headsAt = 0;
const HEADS_TTL_MS = 15_000;
const cursors = new Map(); // scope -> lastSeq  e.g. dm:uuid

export function isSyncV2Enabled() {
  try { return _flagSync(state.me?.uid); } catch { return _flagSync(); }
}

export function getCursor(scope) {
  return cursors.get(scope) || 0;
}

export function setCursor(scope, seq) {
  const n = Number(seq) || 0;
  const prev = cursors.get(scope) || 0;
  if (n > prev) cursors.set(scope, n);
}

/** @returns {Promise<object|null>} */
export async function fetchHeads(force = false) {
  if (!isSyncV2Enabled()) return null;
  syncPath('get_heads');
  if (!force && _heads && Date.now() - _headsAt < HEADS_TTL_MS) return _heads;
  try {
    const { data, error } = await sb.rpc('get_heads');
    if (error) {
      console.warn('[sync] get_heads', error.message);
      return null;
    }
    _heads = data;
    _headsAt = Date.now();
    if (state.me?.uid) setUid(state.me.uid);
    return data;
  } catch (e) {
    console.warn('[sync] get_heads', e?.message || e);
    return null;
  }
}

/**
 * DM delta.
 * @returns {Promise<{ msgs: any[], tombstones: any[], headSeq: number, reset: boolean, ok: boolean }|null>}
 */
export async function syncChat(chatId, afterSeq) {
  if (!isSyncV2Enabled() || !chatId) return null;
  syncPath('sync_chat');
  const after = afterSeq != null ? afterSeq : getCursor('dm:' + chatId);
  try {
    const { data, error } = await sb.rpc('sync_chat', {
      p_chat_id: chatId,
      p_after_seq: after,
      p_limit: 100,
    });
    if (error) {
      console.warn('[sync] sync_chat', error.message);
      return null;
    }
    if (!data) return null;
    if (data.reset_required) {
      cursors.delete('dm:' + chatId);
      return { msgs: [], tombstones: [], headSeq: data.head_seq || 0, reset: true, ok: true };
    }
    const raw = Array.isArray(data.messages) ? data.messages : [];
    const msgs = raw.map(mapMessage).filter(Boolean);
    const tombs = Array.isArray(data.tombstones) ? data.tombstones : [];
    const head = Number(data.head_seq) || 0;
    // cursor: max seq in msgs or tombs
    let maxSeq = after;
    for (const m of msgs) if (m.seq != null && m.seq > maxSeq) maxSeq = m.seq;
    for (const t of tombs) if (t.seq != null && t.seq > maxSeq) maxSeq = t.seq;
    if (head > maxSeq && !data.has_more) maxSeq = head;
    setCursor('dm:' + chatId, maxSeq);
    if (canCache('message') && msgs.length) putThread('dm', chatId, msgs);
    return { msgs, tombstones: tombs, headSeq: head, reset: false, ok: true, hasMore: !!data.has_more };
  } catch (e) {
    console.warn('[sync] sync_chat', e?.message || e);
    return null;
  }
}

export async function syncGroup(groupId, afterSeq) {
  if (!isSyncV2Enabled() || !groupId) return null;
  const after = afterSeq != null ? afterSeq : getCursor('grp:' + groupId);
  try {
    const { data, error } = await sb.rpc('sync_group', {
      p_group_id: groupId,
      p_after_seq: after,
      p_limit: 100,
    });
    if (error) {
      console.warn('[sync] sync_group', error.message);
      return null;
    }
    if (!data) return null;
    if (data.reset_required) {
      cursors.delete('grp:' + groupId);
      return { msgs: [], tombstones: [], headSeq: data.head_seq || 0, reset: true, ok: true };
    }
    const raw = Array.isArray(data.messages) ? data.messages : [];
    const msgs = raw.map(mapMessage).filter(Boolean);
    const tombs = Array.isArray(data.tombstones) ? data.tombstones : [];
    const head = Number(data.head_seq) || 0;
    let maxSeq = after;
    for (const m of msgs) if (m.seq != null && m.seq > maxSeq) maxSeq = m.seq;
    for (const t of tombs) if (t.seq != null && t.seq > maxSeq) maxSeq = t.seq;
    if (head > maxSeq && !data.has_more) maxSeq = head;
    setCursor('grp:' + groupId, maxSeq);
    if (canCache('group_message') && msgs.length) putThread('group', groupId, msgs);
    return { msgs, tombstones: tombs, headSeq: head, reset: false, ok: true, hasMore: !!data.has_more };
  } catch (e) {
    console.warn('[sync] sync_group', e?.message || e);
    return null;
  }
}

/**
 * loadThread o'rniga ishlatish mumkin: kesh + delta yoki null (fallback).
 * @returns {Promise<{ msgs: any[], from: 'sync'|'cache', tombstones: any[] }|null>}
 */
export async function loadThreadDelta(chatId, cachedMsgs) {
  if (!isSyncV2Enabled()) return null;
  const scope = 'dm:' + chatId;
  // Delta HAR DOIM asosdagi (ekranda/keshda bor) eng katta seq'dan boshlanadi.
  // Jonli kursor asosdan oldinda bo'lishi mumkin (realtime/boshqa yo'l bilan surilgan) —
  // shunda orasidagi xabarlar na asosda, na deltada bo'lib, ro'yxatdan "tushib qolardi".
  let baseMax = 0;
  for (const m of cachedMsgs || []) {
    if (m && m.seq != null && m.seq > baseMax) baseMax = m.seq;
  }
  const cur = getCursor(scope) || 0;
  let after = baseMax > 0 ? Math.min(baseMax, cur || baseMax) : cur;
  if (baseMax > 0 && cur > baseMax) after = baseMax;

  let res = await syncChat(chatId, after);
  if (!res || !res.ok) return null;
  if (res.reset) return { msgs: [], from: 'sync', tombstones: [], reset: true };
  const allMsgs = res.msgs.slice();
  const allTombs = res.tombstones.slice();
  let headSeq = res.headSeq;
  // has_more bo'lsa — qolgan sahifalarni ham olamiz (kursor faqat to'liq tugagach head ga suriladi)
  for (let i = 0; res && res.hasMore && i < 10; i++) {
    let last = after;
    for (const m of res.msgs) if (m.seq != null && m.seq > last) last = m.seq;
    for (const t of res.tombstones) if (t.seq != null && t.seq > last) last = t.seq;
    if (last <= after) break;
    after = last;
    res = await syncChat(chatId, after);
    if (!res || !res.ok || res.reset) break;
    allMsgs.push(...res.msgs);
    allTombs.push(...res.tombstones);
    headSeq = res.headSeq;
  }

  // Merge: asos + delta
  const byId = new Map();
  for (const m of cachedMsgs || []) if (m?.id) byId.set(m.id, m);
  for (const m of allMsgs) if (m?.id) byId.set(m.id, m);
  for (const t of allTombs) {
    if (t.message_id) byId.delete(t.message_id);
  }
  const msgs = [...byId.values()].sort((a, b) => {
    const sa = a.seq != null ? a.seq : 0;
    const sb_ = b.seq != null ? b.seq : 0;
    if (sa && sb_ && sa !== sb_) return sa - sb_;
    return (a.createdAt || 0) - (b.createdAt || 0);
  });
  return { msgs, from: 'sync', tombstones: allTombs, reset: false, headSeq };
}


/**
 * Guruh thread delta (loadMsgs uchun).
 */
export async function loadGroupDelta(groupId, cachedMsgs) {
  if (!isSyncV2Enabled() || !groupId) return null;
  const scope = 'grp:' + groupId;
  // Asosdagi eng katta seq'dan boshlaymiz: jonli kursor asosdan oldinda bo'lsa orada xabar tushib qolmasin
  let baseMax = 0;
  for (const m of cachedMsgs || []) if (m && m.seq != null && m.seq > baseMax) baseMax = m.seq;
  const cur = getCursor(scope) || 0;
  let after = baseMax > 0 ? Math.min(baseMax, cur || baseMax) : cur;
  const res = await syncGroup(groupId, after);
  if (!res || !res.ok) return null;
  if (res.reset) return { msgs: [], from: 'sync', tombstones: [], reset: true };

  const byId = new Map();
  for (const m of cachedMsgs || []) if (m?.id) byId.set(m.id, m);
  for (const m of res.msgs) if (m?.id) byId.set(m.id, m);
  for (const t of res.tombstones) {
    if (t.message_id) byId.delete(t.message_id);
  }
  // status='read' UPDATE seq oshirmaydi (074) — delta uni qaytarmaydi, keshdagi "yuborildi" galochkasi abadiy qolardi.
  // Mening hali o'qilmagan xabarlarimning joriy holatini alohida so'raymiz.
  try {
    const me = state.me?.uid;
    const pend = me ? [...byId.values()].filter(m => m && m.senderId === me && m.status !== 'read' && m.id && !String(m.id).startsWith('tmp') && m.seq != null).slice(-200).map(m => m.id) : [];
    if (pend.length) {
      const { data: st } = await sb.from('messages').select('id, status, read_at').in('id', pend);
      for (const r of st || []) {
        const cur = byId.get(r.id);
        if (cur && r.status && r.status !== cur.status) byId.set(r.id, { ...cur, status: r.status, readAt: ts(r.read_at) });
      }
    }
  } catch (_) {}
  const msgs = [...byId.values()].sort((a, b) => {
    const sa = a.seq != null ? a.seq : 0;
    const sb_ = b.seq != null ? b.seq : 0;
    if (sa && sb_ && sa !== sb_) return sa - sb_;
    return (a.createdAt || 0) - (b.createdAt || 0);
  });
  return { msgs, from: 'sync', tombstones: res.tombstones, reset: false, headSeq: res.headSeq };
}

/** Tombstone realtime: message_tombstones INSERT */
export function bindTombstoneChannel(chatId, onTombstone) {
  if (!isSyncV2Enabled() || !chatId) return () => {};
  const ch = sb.channel('tomb-dm-' + chatId)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'message_tombstones',
      filter: `chat_id=eq.${chatId}`,
    }, (p) => {
      const row = p.new;
      if (row?.seq != null) setCursor('dm:' + chatId, row.seq);
      try { onTombstone?.(row); } catch (_) {}
    })
    .subscribe();
  return () => { try { sb.removeChannel(ch); } catch (_) {} };
}

export function bindGroupTombstoneChannel(groupId, onTombstone) {
  if (!isSyncV2Enabled() || !groupId) return () => {};
  const ch = sb.channel('tomb-grp-' + groupId)
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'group_message_tombstones',
      filter: `group_id=eq.${groupId}`,
    }, (p) => {
      const row = p.new;
      if (row?.seq != null) setCursor('grp:' + groupId, row.seq);
      try { onTombstone?.(row); } catch (_) {}
    })
    .subscribe();
  return () => { try { sb.removeChannel(ch); } catch (_) {} };
}

/** Guruh o'chirilgan/chiqarilgan: lokal kursor va keshdagi xabarlarni butunlay tozalaydi */
export function forgetGroup(groupId) {
  if (!groupId) return;
  cursors.delete('grp:' + groupId);
  try { store.dispatch({ type: 'del', path: 'thread:' + 'grp:' + groupId, entity: 'group_message' }); } catch (_) {}
}

export function invalidateHeads() {
  _heads = null;
  _headsAt = 0;
}
