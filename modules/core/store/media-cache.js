/**
 * media-cache.js — umumiy media kesh (Phase 6).
 * Prefer OPFS (File System Access), fallback: IndexedDB Blob.
 * Index: spacemr_core.media_index (lastUsed, size, expiresAt).
 * LRU: MAX_TOTAL_BYTES oshsa eng eski lastUsed o'chiriladi.
 *
 * API:
 *   resolveMedia(path|url, opts) → blob URL (kesh yoki network)
 *   putMedia(id, blob, meta)
 *   touch(id) / evictIfNeeded() / clearMediaCache()
 */
import { openDb, idbPut, idbDelete, idbGet, isDbFailed } from './db.js';
import { isStoreV2Enabled } from './store.js';

const MAX_ITEM_BYTES = 40 * 1024 * 1024;
const MAX_TOTAL_BYTES = 400 * 1024 * 1024;
const OPFS_DIR = 'spacemr-media';

const _urls = new Map();     // id -> blob: URL
const _inflight = new Map(); // id -> Promise
let _opfsRoot = null;
let _opfsFailed = false;
let _totalBytes = 0;
let _totalKnown = false;

function _idFromPath(pathOrUrl) {
  if (!pathOrUrl) return null;
  const s = String(pathOrUrl);
  // public URL dan path ajratish
  const m = s.match(/\/storage\/v1\/object\/public\/media\/(.+)$/);
  if (m) return decodeURIComponent(m[1].split('?')[0]);
  if (/^https?:\/\//i.test(s)) return 'url:' + s.slice(0, 180);
  return s.replace(/^\/+/, '');
}

async function _getOpfs() {
  if (_opfsFailed) return null;
  if (_opfsRoot) return _opfsRoot;
  try {
    if (!navigator?.storage?.getDirectory) { _opfsFailed = true; return null; }
    const root = await navigator.storage.getDirectory();
    _opfsRoot = await root.getDirectoryHandle(OPFS_DIR, { create: true });
    return _opfsRoot;
  } catch (_) {
    _opfsFailed = true;
    return null;
  }
}

function _safeName(id) {
  return String(id).replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 180);
}

async function _opfsWrite(id, blob) {
  const dir = await _getOpfs();
  if (!dir) return false;
  try {
    const fh = await dir.getFileHandle(_safeName(id), { create: true });
    const w = await fh.createWritable();
    await w.write(blob);
    await w.close();
    return true;
  } catch (_) { return false; }
}

async function _opfsRead(id) {
  const dir = await _getOpfs();
  if (!dir) return null;
  try {
    const fh = await dir.getFileHandle(_safeName(id));
    const f = await fh.getFile();
    return f;
  } catch (_) { return null; }
}

async function _opfsRemove(id) {
  const dir = await _getOpfs();
  if (!dir) return;
  try { await dir.removeEntry(_safeName(id)); } catch (_) {}
}

async function _indexPut(rec) {
  if (!isStoreV2Enabled() || isDbFailed()) return;
  try {
    const db = await openDb();
    if (!db) return;
    await idbPut(db, 'media_index', rec);
  } catch (_) {}
}

async function _indexGet(id) {
  if (!isStoreV2Enabled() || isDbFailed()) return null;
  try {
    const db = await openDb();
    if (!db) return null;
    return await idbGet(db, 'media_index', id);
  } catch (_) { return null; }
}

async function _indexDelete(id) {
  if (!isStoreV2Enabled() || isDbFailed()) return;
  try {
    const db = await openDb();
    if (!db) return;
    await idbDelete(db, 'media_index', id);
  } catch (_) {}
}

async function _listIndex() {
  if (!isStoreV2Enabled() || isDbFailed()) return [];
  try {
    const db = await openDb();
    if (!db) return [];
    return await new Promise((res, rej) => {
      const r = db.transaction('media_index', 'readonly').objectStore('media_index').getAll();
      r.onsuccess = () => res(r.result || []);
      r.onerror = () => rej(r.error);
    });
  } catch (_) { return []; }
}

function _memUrl(id, blob) {
  const prev = _urls.get(id);
  if (prev) try { URL.revokeObjectURL(prev); } catch (_) {}
  const u = URL.createObjectURL(blob);
  _urls.set(id, u);
  return u;
}

/** Sessiya ichida tayyor URL */
export function cachedMediaUrlSync(pathOrUrl) {
  const id = _idFromPath(pathOrUrl);
  return id ? (_urls.get(id) || null) : null;
}

/**
 * @param {string} pathOrUrl
 * @param {{ expiresAt?: number, force?: boolean }} [opts]
 * @returns {Promise<string|null>} blob: URL yoki null
 */
export async function resolveMedia(pathOrUrl, opts = {}) {
  const id = _idFromPath(pathOrUrl);
  if (!id) return null;
  if (!opts.force && _urls.has(id)) {
    touch(id);
    return _urls.get(id);
  }
  if (_inflight.has(id)) return _inflight.get(id);

  const p = (async () => {
    // 1) OPFS
    let blob = await _opfsRead(id);
    // 2) index meta + re-fetch if missing body
    const meta = await _indexGet(id);
    if (meta?.expiresAt && meta.expiresAt <= Date.now()) {
      await removeMedia(id);
      blob = null;
    }
    if (blob) {
      touch(id);
      return _memUrl(id, blob);
    }

    // 3) Network
    const url = /^https?:\/\//i.test(pathOrUrl)
      ? pathOrUrl
      : pathOrUrl; // caller should pass full public URL ideally
    if (!/^https?:\/\//i.test(url) && !url.startsWith('blob:')) {
      // path only — caller must pass public URL; return null rather than invent
      return null;
    }
    try {
      const ctl = new AbortController();
      const to = setTimeout(() => ctl.abort(), 60000);
      const res = await fetch(url, { signal: ctl.signal, credentials: 'omit' });
      clearTimeout(to);
      if (!res.ok) return null;
      const len = parseInt(res.headers.get('content-length') || '0', 10);
      if (len && len > MAX_ITEM_BYTES) return null;
      blob = await res.blob();
      if (!blob.size || blob.size > MAX_ITEM_BYTES) return null;
      await putMedia(id, blob, {
        path: id.startsWith('url:') ? null : id,
        expiresAt: opts.expiresAt || null,
        type: blob.type || '',
      });
      return _urls.get(id) || _memUrl(id, blob);
    } catch (_) {
      return null;
    }
  })().finally(() => _inflight.delete(id));

  _inflight.set(id, p);
  return p;
}

/**
 * @param {string} id
 * @param {Blob} blob
 * @param {{ path?: string, expiresAt?: number|null, type?: string }} [meta]
 */
export async function putMedia(id, blob, meta = {}) {
  if (!id || !blob || !blob.size) return false;
  if (blob.size > MAX_ITEM_BYTES) return false;
  try {
    const opfsOk = await _opfsWrite(id, blob);
    const now = Date.now();
    const rec = {
      id,
      path: meta.path || null,
      size: blob.size,
      type: meta.type || blob.type || '',
      expiresAt: meta.expiresAt || null,
      lastUsed: now,
      storedAt: now,
      backend: opfsOk ? 'opfs' : 'none',
    };
    await _indexPut(rec);
    _memUrl(id, blob);
    _totalBytes += blob.size;
    await evictIfNeeded();
    return true;
  } catch (e) {
    if (e?.name === 'QuotaExceededError') {
      await evictIfNeeded(true);
      try {
        await _opfsWrite(id, blob);
        await _indexPut({
          id, path: meta.path || null, size: blob.size, type: meta.type || '',
          expiresAt: meta.expiresAt || null, lastUsed: Date.now(), storedAt: Date.now(), backend: 'opfs',
        });
        _memUrl(id, blob);
        return true;
      } catch (_) { return false; }
    }
    return false;
  }
}

export async function touch(id) {
  if (!id) return;
  const meta = await _indexGet(id);
  if (!meta) return;
  meta.lastUsed = Date.now();
  await _indexPut(meta);
}

export async function removeMedia(id) {
  if (!id) return;
  const u = _urls.get(id);
  if (u) { try { URL.revokeObjectURL(u); } catch (_) {} _urls.delete(id); }
  const meta = await _indexGet(id);
  if (meta?.size) _totalBytes = Math.max(0, _totalBytes - meta.size);
  await _opfsRemove(id);
  await _indexDelete(id);
}

export async function evictIfNeeded(force = false) {
  const all = await _listIndex();
  // expired
  const now = Date.now();
  for (const r of all) {
    if (r.expiresAt && r.expiresAt <= now) await removeMedia(r.id);
  }
  const live = (await _listIndex()).slice();
  let total = live.reduce((a, x) => a + (x.size || 0), 0);
  _totalBytes = total;
  _totalKnown = true;
  if (!force && total <= MAX_TOTAL_BYTES) return;
  live.sort((a, b) => (a.lastUsed || 0) - (b.lastUsed || 0));
  for (const r of live) {
    if (total <= MAX_TOTAL_BYTES * 0.85) break;
    await removeMedia(r.id);
    total -= r.size || 0;
  }
}

export async function clearMediaCache() {
  for (const u of _urls.values()) { try { URL.revokeObjectURL(u); } catch (_) {} }
  _urls.clear();
  _inflight.clear();
  _totalBytes = 0;
  // OPFS wipe
  try {
    if (navigator?.storage?.getDirectory) {
      const root = await navigator.storage.getDirectory();
      try { await root.removeEntry(OPFS_DIR, { recursive: true }); } catch (_) {}
      _opfsRoot = null;
    }
  } catch (_) {}
  // index clear
  try {
    const db = await openDb();
    if (db) {
      await new Promise((res) => {
        const r = db.transaction('media_index', 'readwrite').objectStore('media_index').clear();
        r.onsuccess = () => res();
        r.onerror = () => res();
      });
    }
  } catch (_) {}
}

/** mediaPublicUrl + cache: UI uchun qulay wrapper */
export async function resolvePublicMedia(publicUrl, opts) {
  if (!publicUrl) return null;
  const cached = cachedMediaUrlSync(publicUrl);
  if (cached) return cached;
  return resolveMedia(publicUrl, opts);
}


/** Orqa fonda bir nechta media URL ni keshlaydi (parallel, limit bilan). */
export async function prefetchMany(urls, { concurrency = 4, expiresAt = null } = {}) {
  const list = [...new Set((urls || []).filter(u => u && /^https?:\/\//i.test(u)))];
  if (!list.length) return;
  let i = 0;
  const worker = async () => {
    while (i < list.length) {
      const u = list[i++];
      try { await resolveMedia(u, { expiresAt }); } catch (_) {}
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, worker));
}

export const mediaCache = {
  resolveMedia, putMedia, touch, removeMedia, evictIfNeeded, clearMediaCache,
  cachedMediaUrlSync, resolvePublicMedia, prefetchMany,
};
export default mediaCache;
