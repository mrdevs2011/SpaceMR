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

/* ── 0ms Media Dimension & Aspect Ratio Registry (Zero CLS) ────────── */
const DIMS_STORAGE_KEY = 'spacemr_media_dims';
const MAX_DIMS_ENTRIES = 1500;
const _dimMap = new Map();

function _loadDims() {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(DIMS_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (Array.isArray(item) && item[0] && item[1]?.w && item[1]?.h) {
              _dimMap.set(item[0], item[1]);
            }
          }
        }
      }
    }
  } catch (_) {}
}
_loadDims();

let _dimSaveTimeout = null;
function _persistDims() {
  if (typeof localStorage === 'undefined') return;
  if (_dimSaveTimeout) clearTimeout(_dimSaveTimeout);
  _dimSaveTimeout = setTimeout(() => {
    try {
      const entries = [..._dimMap.entries()].slice(-MAX_DIMS_ENTRIES);
      localStorage.setItem(DIMS_STORAGE_KEY, JSON.stringify(entries));
    } catch (_) {}
  }, 1000);
}

/**
 * Har qanday URL yoki yo'lni yagona kanonik kalitga keltiradi (Deduplication).
 * Supabase public URL, signed URL (?token=...) yoki to'g'ridan-to'g'ri path
 * bitta umumiy identifikatorga aylanadi.
 */
export function normalizeMediaKey(pathOrUrl) {
  if (!pathOrUrl) return null;
  const s = String(pathOrUrl).trim();
  // Supabase storage object path (/storage/v1/object/(public|sign|authenticated)/media/<path>)
  const m = s.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/media\/([^?#]+)/);
  if (m) return decodeURIComponent(m[1].replace(/^\/+/, ''));
  // Tashqi URL
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      // Agar Supabase bo'lsa
      if (u.pathname.includes('/storage/v1/object/')) {
        const sub = u.pathname.split('/storage/v1/object/')[1] || '';
        return sub.replace(/^(?:public|sign|authenticated)\/media\//, '').replace(/^\/+/, '');
      }
      return 'url:' + (u.origin + u.pathname).slice(0, 200);
    } catch (_) {
      return 'url:' + s.split('?')[0].slice(0, 200);
    }
  }
  return s.split('?')[0].replace(/^\/+/, '');
}

export function _idFromPath(pathOrUrl) {
  return normalizeMediaKey(pathOrUrl);
}

export function getMediaDimensions(pathOrUrl) {
  const key = normalizeMediaKey(pathOrUrl);
  if (!key) return null;
  const item = _dimMap.get(key);
  if (!item) return null;
  return {
    width: item.w,
    height: item.h,
    ratio: item.r || `${item.w}/${item.h}`,
    aspectRatioStyle: `aspect-ratio: ${item.r || `${item.w}/${item.h}`}; width: 100%;`
  };
}

export function setMediaDimensions(pathOrUrl, width, height) {
  const w = parseInt(width, 10);
  const h = parseInt(height, 10);
  if (!w || !h || w <= 0 || h <= 0) return null;
  const key = normalizeMediaKey(pathOrUrl);
  if (!key) return null;
  const r = `${w}/${h}`;
  const existing = _dimMap.get(key);
  if (existing && existing.w === w && existing.h === h) return existing;
  const val = { w, h, r };
  _dimMap.set(key, val);
  _persistDims();
  return val;
}

export function getMediaAspectStyle(pathOrUrl, width, height, fallback = '') {
  const w = parseInt(width, 10);
  const h = parseInt(height, 10);
  if (w && h && w > 0 && h > 0) {
    return ` style="aspect-ratio:${w}/${h}; width: 100%;"`;
  }
  const cached = getMediaDimensions(pathOrUrl);
  if (cached) {
    return ` style="aspect-ratio:${cached.ratio}; width: 100%;"`;
  }
  if (fallback) {
    return ` style="${fallback}"`;
  }
  return '';
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
  normalizeMediaKey, getMediaDimensions, setMediaDimensions, getMediaAspectStyle,
};

if (typeof window !== 'undefined') {
  window.__mediaCache = mediaCache;

  // Har qanday rasm to'liq yuklangach (onload) — uning haqiqiy o'lchamlarini eslab qolish va blur'ni ochish
  window.__onMediaLoad = function(el) {
    if (!el) return;
    el.classList.add('loaded');
    const box = el.closest('.media-blur-box') || el.closest('.post-media') || el.closest('.cfm-vid-box');
    if (box) {
      box.classList.remove('pm-loading');
      box.classList.add('loaded');
    }
    const w = el.naturalWidth || el.videoWidth;
    const h = el.naturalHeight || el.videoHeight;
    const path = el.dataset.mediaPath || el.currentSrc || el.src;
    if (w && h && path) {
      setMediaDimensions(path, w, h);
      if (box && !box.style.aspectRatio) {
        box.style.aspectRatio = `${w}/${h}`;
      }
    }
  };

  // Video metadata yuklangach (onloadedmetadata)
  window.__onVideoMeta = function(v) {
    if (!v) return;
    v.classList.add('loaded');
    const box = v.closest('.media-blur-box') || v.closest('.post-media') || v.closest('.cfm-vid-box');
    if (box) {
      box.classList.remove('pm-loading');
      box.classList.add('loaded');
    }
    const w = v.videoWidth;
    const h = v.videoHeight;
    const path = v.dataset.mediaPath || v.currentSrc || v.src;
    if (w && h && path) {
      setMediaDimensions(path, w, h);
      if (box && !box.style.aspectRatio) {
        box.style.aspectRatio = `${w}/${h}`;
      }
    }
  };
}

export default mediaCache;
