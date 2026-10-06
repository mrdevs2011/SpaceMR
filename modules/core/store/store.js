/**
 * store/store.js — reaktiv xotira ko'zgusi + IDB + BroadcastChannel.
 * UI hali to'g'ridan-to'g'ri chizmaydi (Phase 4); Phase 2 da dual-write / adapter.
 *
 * store.get(path) — sinxron
 * store.subscribe(path, cb) — microtask batch
 * store.dispatch(op) — mem + IDB + BC
 */
import { canCache } from '../cache-policy.js';
import {
  openDb, ensureSchema, idbPut, idbDelete, idbGet, clearAllStores,
  scopedKey, msgScope, isDbFailed,
} from './db.js';
import { isStoreV2Enabled as _flagStore } from './flags.js';

const BC_NAME = 'spacemr-store-v2';
const mem = new Map(); // path string -> value
const subs = new Map(); // path -> Set<fn>
let _uid = null;
let _ready = false;
let _readyP = null;
let _bc = null;
let _batch = new Set();
let _batchScheduled = false;

function _clone(v) {
  if (v == null || typeof v !== 'object') return v;
  try { return structuredClone(v); } catch { try { return JSON.parse(JSON.stringify(v)); } catch { return v; } }
}

function _notify(path) {
  _batch.add(path);
  if (_batchScheduled) return;
  _batchScheduled = true;
  queueMicrotask(() => {
    _batchScheduled = false;
    const paths = [..._batch];
    _batch.clear();
    for (const p of paths) {
      const set = subs.get(p);
      if (!set) continue;
      const val = mem.has(p) ? _clone(mem.get(p)) : undefined;
      for (const fn of set) {
        try { fn(val); } catch (e) { console.error('[store] sub', e); }
      }
    }
  });
}

function _bcSend(msg) {
  try {
    if (!_bc && typeof BroadcastChannel !== 'undefined') _bc = new BroadcastChannel(BC_NAME);
    _bc?.postMessage(msg);
  } catch (_) {}
}

function _bcListen() {
  if (typeof BroadcastChannel === 'undefined') return;
  try {
    _bc = new BroadcastChannel(BC_NAME);
    _bc.onmessage = (ev) => {
      const m = ev.data;
      if (!m || m.src === _tabId) return;
      if (m.type === 'set' && m.path) {
        mem.set(m.path, m.value);
        _notify(m.path);
      } else if (m.type === 'del' && m.path) {
        mem.delete(m.path);
        _notify(m.path);
      } else if (m.type === 'clear') {
        mem.clear();
        for (const p of subs.keys()) _notify(p);
      }
    };
  } catch (_) {}
}

const _tabId = (typeof crypto !== 'undefined' && crypto.randomUUID)
  ? crypto.randomUUID()
  : String(Math.random());

_bcListen();

export function isStoreV2Enabled() { return _flagStore(); }

export function setUid(uid) {
  _uid = uid || null;
}

export function getUid() { return _uid; }

export function whenStoreReady() {
  if (_ready) return Promise.resolve(true);
  if (!_readyP) {
    _readyP = (async () => {
      if (!isStoreV2Enabled() || isDbFailed()) { _ready = true; return false; }
      await openDb();
      await ensureSchema(_uid);
      _ready = true;
      return !!openDb();
    })().catch(() => { _ready = true; return false; });
  }
  return _readyP;
}

// Boot: fonda ochish (bloklamaydi)
try { whenStoreReady(); } catch (_) {}

export function get(path) {
  if (!mem.has(path)) return undefined;
  return _clone(mem.get(path));
}

export function subscribe(path, cb) {
  if (!subs.has(path)) subs.set(path, new Set());
  subs.get(path).add(cb);
  return () => { subs.get(path)?.delete(cb); };
}

/**
 * @param {{ type: string, path?: string, value?: any, entity?: string, persist?: boolean }} op
 */
export function dispatch(op) {
  if (!op || !op.type) return;
  if (op.entity && !canCache(op.entity)) return; // EPHEMERAL / unknown

  if (op.type === 'set' && op.path) {
    const val = _clone(op.value);
    mem.set(op.path, val);
    _notify(op.path);
    _bcSend({ type: 'set', path: op.path, value: val, src: _tabId });
    if (op.persist !== false) _persistSet(op.path, val, op.entity);
  } else if (op.type === 'del' && op.path) {
    mem.delete(op.path);
    _notify(op.path);
    _bcSend({ type: 'del', path: op.path, src: _tabId });
    if (op.persist !== false) _persistDel(op.path, op.entity);
  } else if (op.type === 'clear') {
    mem.clear();
    for (const p of subs.keys()) _notify(p);
    _bcSend({ type: 'clear', src: _tabId });
    clearAllStores().catch(() => {});
  }
}

async function _persistSet(path, value, entity) {
  if (!isStoreV2Enabled()) return;
  const db = await openDb();
  if (!db) return;
  try {
    const row = _pathToRow(path, value, entity);
    if (!row) return;
    await idbPut(db, row.store, row.record);
  } catch (e) {
    if (e?.name === 'QuotaExceededError') console.warn('[store] quota', path);
  }
}

async function _persistDel(path, entity) {
  if (!isStoreV2Enabled()) return;
  const db = await openDb();
  if (!db) return;
  try {
    const row = _pathToRow(path, null, entity);
    if (!row) return;
    await idbDelete(db, row.store, row.key);
  } catch (_) {}
}

/** path → { store, key, record } */
function _pathToRow(path, value, entity) {
  const uid = _uid || 'anon';
  const now = Date.now();
  // profiles:<userId>
  if (path.startsWith('profile:') || entity === 'profile') {
    const userId = path.replace(/^profile:/, '') || value?.uid || value?.id;
    if (!userId) return null;
    return {
      store: 'profiles',
      key: scopedKey(uid, userId),
      record: { uid, userId, data: value, t: now, v: 2 },
    };
  }
  // posts:list
  if (path === 'posts' || entity === 'post' || entity === 'feed_page') {
    return {
      store: 'posts',
      key: scopedKey(uid, '_feed'),
      record: { uid, id: '_feed', data: value, t: now, v: 2, createdAt: now },
    };
  }
  // thread:dm:<chatId> or thread:grp:<id>
  if (path.startsWith('thread:')) {
    const scope = path.slice('thread:'.length); // dm:uuid | grp:uuid
    return {
      store: 'messages',
      key: [scope, '_snapshot'],
      record: {
        scope, id: '_snapshot', data: value, t: now, v: 2,
        seq: 0, createdAt: now,
      },
    };
  }
  // chats:list
  if (path === 'chats' || entity === 'chats_list') {
    return {
      store: 'chats',
      key: scopedKey(uid, '_list'),
      record: { uid, chatId: '_list', data: value, t: now, v: 2, lastMsgAt: now },
    };
  }
  // meta
  return {
    store: 'meta',
    key: path,
    record: { key: path, data: value, t: now, v: 2 },
  };
}

/* ── Convenience API (adapter uchun) ─────────────────────────────────── */

export function putProfile(userId, data) {
  setUid(_uid || data?.uid);
  dispatch({ type: 'set', path: 'profile:' + userId, value: data, entity: 'profile' });
}

export function putPosts(posts) {
  dispatch({ type: 'set', path: 'posts', value: posts, entity: 'feed_page' });
}

export function putThread(kind, id, msgs) {
  const scope = msgScope(kind, id);
  dispatch({ type: 'set', path: 'thread:' + scope, value: msgs, entity: kind === 'group' ? 'group_message' : 'message' });
}

export function putChatsList(data) {
  dispatch({ type: 'set', path: 'chats', value: data, entity: 'chats_list' });
}

export async function clearStore() {
  mem.clear();
  for (const p of subs.keys()) _notify(p);
  _bcSend({ type: 'clear', src: _tabId });
  await clearAllStores();
}

export const store = { get, subscribe, dispatch, setUid, getUid, whenStoreReady, isStoreV2Enabled, clearStore, putProfile, putPosts, putThread, putChatsList };
export default store;
