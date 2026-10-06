/**
 * store/db.js — spacemr_core IndexedDB (sxema v2).
 * Boot yo'lida bloklamaydi: open() promise, xato → null (I-10).
 */
import { SCHEMA_VERSION } from '../cache-policy.js';

export const DB_NAME = 'spacemr_core';
export const DB_VER = 2;

/** Object store nomlari */
export const STORES = Object.freeze([
  'meta',        // keyPath: key
  'chats',       // keyPath: [uid, chatId]
  'groups',      // keyPath: [uid, groupId]
  'messages',    // keyPath: [scope, id]  scope = dm:<id> | grp:<id>
  'profiles',    // keyPath: [uid, userId]
  'posts',       // keyPath: [uid, id]
  'outbox',      // keyPath: opId
  'media_index', // keyPath: id
]);

let _dbp = null;
let _failed = false;

function _upgrade(db, oldV) {
  if (!db.objectStoreNames.contains('meta')) {
    db.createObjectStore('meta', { keyPath: 'key' });
  }
  if (!db.objectStoreNames.contains('chats')) {
    const s = db.createObjectStore('chats', { keyPath: ['uid', 'chatId'] });
    s.createIndex('byLastMsg', 'lastMsgAt', { unique: false });
  }
  if (!db.objectStoreNames.contains('groups')) {
    db.createObjectStore('groups', { keyPath: ['uid', 'groupId'] });
  }
  if (!db.objectStoreNames.contains('messages')) {
    const s = db.createObjectStore('messages', { keyPath: ['scope', 'id'] });
    s.createIndex('bySeq', ['scope', 'seq'], { unique: false });
    s.createIndex('byCreated', ['scope', 'createdAt'], { unique: false });
  }
  if (!db.objectStoreNames.contains('profiles')) {
    db.createObjectStore('profiles', { keyPath: ['uid', 'userId'] });
  }
  if (!db.objectStoreNames.contains('posts')) {
    const s = db.createObjectStore('posts', { keyPath: ['uid', 'id'] });
    s.createIndex('byCreated', 'createdAt', { unique: false });
  }
  if (!db.objectStoreNames.contains('outbox')) {
    const s = db.createObjectStore('outbox', { keyPath: 'opId' });
    s.createIndex('byCreated', 'createdAt', { unique: false });
  }
  if (!db.objectStoreNames.contains('media_index')) {
    const s = db.createObjectStore('media_index', { keyPath: 'id' });
    s.createIndex('byLastUsed', 'lastUsed', { unique: false });
    s.createIndex('byExpires', 'expiresAt', { unique: false });
  }
  // oldV ishlatilishi mumkin keyingi migratsiyalarda
  void oldV;
}

/** @returns {Promise<IDBDatabase|null>} */
export function openDb() {
  if (_failed) return Promise.resolve(null);
  if (_dbp) return _dbp;
  if (typeof indexedDB === 'undefined') {
    _failed = true;
    return Promise.resolve(null);
  }
  _dbp = new Promise((resolve) => {
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VER); }
    catch (e) { _failed = true; resolve(null); return; }
    req.onupgradeneeded = () => {
      try { _upgrade(req.result, req.oldVersion || 0); } catch (e) { console.warn('[store/db] upgrade', e); }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { try { db.close(); } catch (_) {} _dbp = null; };
      resolve(db);
    };
    req.onerror = () => { _failed = true; _dbp = null; resolve(null); };
    req.onblocked = () => { /* kutamiz — onsuccess/onerror */ };
  });
  return _dbp;
}

export function isDbFailed() { return _failed; }

/** Noma'lum/yuqori schemaVersion → xavfsiz tozalash (I-10). */
export async function ensureSchema(uid) {
  const db = await openDb();
  if (!db) return false;
  try {
    const meta = await idbGet(db, 'meta', 'schema');
    const ver = meta?.v;
    if (ver != null && ver > SCHEMA_VERSION) {
      await clearAllStores(db);
      await idbPut(db, 'meta', { key: 'schema', v: SCHEMA_VERSION, t: Date.now() });
      return true;
    }
    if (ver !== SCHEMA_VERSION) {
      await idbPut(db, 'meta', { key: 'schema', v: SCHEMA_VERSION, t: Date.now(), uid: uid || null });
    }
    return true;
  } catch (e) {
    console.warn('[store/db] ensureSchema', e?.message || e);
    return false;
  }
}

export function idbGet(db, store, key) {
  return new Promise((res, rej) => {
    try {
      const r = db.transaction(store, 'readonly').objectStore(store).get(key);
      r.onsuccess = () => res(r.result ?? null);
      r.onerror = () => rej(r.error);
    } catch (e) { rej(e); }
  });
}

export function idbPut(db, store, value) {
  return new Promise((res, rej) => {
    try {
      const r = db.transaction(store, 'readwrite').objectStore(store).put(value);
      r.onsuccess = () => res(true);
      r.onerror = () => rej(r.error);
    } catch (e) { rej(e); }
  });
}

export function idbDelete(db, store, key) {
  return new Promise((res, rej) => {
    try {
      const r = db.transaction(store, 'readwrite').objectStore(store).delete(key);
      r.onsuccess = () => res(true);
      r.onerror = () => rej(r.error);
    } catch (e) { rej(e); }
  });
}

export function idbClear(db, store) {
  return new Promise((res, rej) => {
    try {
      const r = db.transaction(store, 'readwrite').objectStore(store).clear();
      r.onsuccess = () => res(true);
      r.onerror = () => rej(r.error);
    } catch (e) { rej(e); }
  });
}

export async function clearAllStores(db) {
  if (!db) db = await openDb();
  if (!db) return;
  for (const s of STORES) {
    try { await idbClear(db, s); } catch (_) {}
  }
}

/** Boshqa uid yozuvlarini o'qimaslik (I-7) — store ichida uid maydoni bo'lsa. */
export function scopedKey(uid, id) {
  return [String(uid || ''), String(id || '')];
}

export function msgScope(kind, id) {
  return (kind === 'group' || kind === 'grp' ? 'grp:' : 'dm:') + id;
}
