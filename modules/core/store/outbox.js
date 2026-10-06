/**
 * outbox.js — offline/online xabarlar navbati (exactly-once, I-9).
 * opId = client uuid; server UNIQUE(client_id) yo'q — client dedupe: opId saqlanadi.
 * Tablar: BroadcastChannel + IDB outbox store.
 */
import { sb, state } from '../config.js';
import { openDb, idbPut, idbDelete, idbGet, isDbFailed } from './db.js';
import { isStoreV2Enabled } from './store.js';

const BC = 'spacemr-outbox-v2';
let _bc = null;
let _flushing = false;
let _timer = null;
const mem = new Map(); // opId -> op

function _uid() {
  return state.me?.uid || null;
}

function _bcSend(msg) {
  try {
    if (!_bc && typeof BroadcastChannel !== 'undefined') _bc = new BroadcastChannel(BC);
    _bc?.postMessage(msg);
  } catch (_) {}
}

function _bcListen() {
  if (typeof BroadcastChannel === 'undefined') return;
  try {
    _bc = new BroadcastChannel(BC);
    _bc.onmessage = (ev) => {
      const m = ev.data;
      if (!m) return;
      if (m.type === 'enqueue' && m.op) {
        mem.set(m.op.opId, m.op);
      } else if (m.type === 'done' && m.opId) {
        mem.delete(m.opId);
      } else if (m.type === 'flush') {
        flushOutbox();
      }
    };
  } catch (_) {}
}
_bcListen();

function _newOpId() {
  try { return crypto.randomUUID(); } catch { return 'op-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9); }
}

/**
 * @param {{ kind: 'dm'|'group', targetId: string, payload: object, localId?: string }} spec
 * @returns {string} opId
 */
export function enqueueSend(spec) {
  const opId = _newOpId();
  const op = {
    opId,
    kind: spec.kind || 'dm',
    targetId: spec.targetId,
    payload: spec.payload || {},
    localId: spec.localId || opId,
    uid: _uid(),
    createdAt: Date.now(),
    attempts: 0,
    status: 'pending',
  };
  mem.set(opId, op);
  _persist(op);
  _bcSend({ type: 'enqueue', op });
  scheduleFlush(200);
  return opId;
}

async function _persist(op) {
  if (!isStoreV2Enabled() || isDbFailed()) return;
  try {
    const db = await openDb();
    if (!db) return;
    await idbPut(db, 'outbox', op);
  } catch (_) {}
}

async function _remove(opId) {
  mem.delete(opId);
  _bcSend({ type: 'done', opId });
  if (!isStoreV2Enabled() || isDbFailed()) return;
  try {
    const db = await openDb();
    if (!db) return;
    await idbDelete(db, 'outbox', opId);
  } catch (_) {}
}

export function scheduleFlush(ms = 500) {
  clearTimeout(_timer);
  _timer = setTimeout(() => { flushOutbox().catch(() => {}); }, ms);
}

async function _flushBody() {
  if (_flushing) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  _flushing = true;
  try {
    // IDB dan yuklash (boshqa tab)
    await _hydrate();
    const list = [...mem.values()].filter(o => o.status === 'pending' || o.status === 'error');
    list.sort((a, b) => a.createdAt - b.createdAt);
    for (const op of list) {
      if (op.uid && _uid() && op.uid !== _uid()) continue;
      try {
        op.attempts += 1;
        op.status = 'sending';
        await _sendOne(op);
        op.status = 'done';
        await _remove(op.opId);
      } catch (e) {
        op.status = 'error';
        await _persist(op);
        if (op.attempts >= 8) await _remove(op.opId); // tashlab yuborish (log)
        console.warn('[outbox]', op.opId, e?.message || e);
      }
    }
  } finally {
    _flushing = false;
  }
}

async function _hydrate() {
  if (!isStoreV2Enabled() || isDbFailed()) return;
  try {
    const db = await openDb();
    if (!db) return;
    const rows = await new Promise((res, rej) => {
      const r = db.transaction('outbox', 'readonly').objectStore('outbox').getAll();
      r.onsuccess = () => res(r.result || []);
      r.onerror = () => rej(r.error);
    });
    for (const row of rows) {
      if (row?.opId && !mem.has(row.opId)) mem.set(row.opId, row);
    }
  } catch (_) {}
}

async function _sendOne(op) {
  const p = op.payload || {};
  if (op.kind === 'group') {
    const row = {
      group_id: op.targetId,
      sender_id: _uid(),
      type: p.type || 'text',
      text: p.text ?? null,
      media_path: p.media_path ?? null,
      media_type: p.media_type ?? null,
      file_name: p.file_name ?? null,
      file_size: p.file_size ?? null,
      duration: p.duration ?? null,
      reply_to: p.reply_to ?? null,
      waveform: p.waveform ?? null,
    };
    const { error } = await sb.from('group_messages').insert(row);
    if (error) throw error;
  } else {
    const row = {
      chat_id: op.targetId,
      sender_id: _uid(),
      type: p.type || 'text',
      text: p.text ?? null,
      media_path: p.media_path ?? null,
      media_type: p.media_type ?? null,
      file_name: p.file_name ?? null,
      file_size: p.file_size ?? null,
      duration: p.duration ?? null,
      status: 'sent',
      reply_to: p.reply_to ?? null,
      waveform: p.waveform ?? null,
    };
    const { error } = await sb.from('messages').insert(row);
    if (error) throw error;
  }
}


/** Faqat bitta tab flush qiladi (Web Locks); boshqalar BC orqali biladi */
export async function flushOutbox() {
  if (typeof navigator !== 'undefined' && navigator.locks && navigator.locks.request) {
    try {
      await navigator.locks.request('spacemr-outbox-flush', { ifAvailable: true }, async (lock) => {
        if (!lock) return; // boshqa tab leader
        await _flushBody();
      });
      return;
    } catch (_) {}
  }
  await _flushBody();
}

export function pendingCount() {
  return [...mem.values()].filter(o => o.status !== 'done').length;
}

export function listPending() {
  return [...mem.values()];
}

// Online bo'lganda flush
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => scheduleFlush(300));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleFlush(500);
  });
}
