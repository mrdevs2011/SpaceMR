/**
 * story-cache.js — Story'lar uchun IndexedDB kesh (24 soat).
 *
 * Qoida: story bazaga tushgan vaqt (created_at) + 24 soat = muddati (expiresAt).
 * Vaqt storyning O'ZI bilan keladi, shuning uchun kesh'dan ochilsa ham "14:40 da kelgan" deb to'g'ri ko'rsatiladi
 * (hozirgi vaqt bilan emas, server vaqti bilan hisoblanadi).
 *
 * Saqlanadi:
 *   groups — oxirgi story ro'yxati (strip + viewer uchun), foydalanuvchi bo'yicha;
 *   media  — har bir story'ning rasm/video fayli (Blob), story id bo'yicha.
 *
 * Har safar serverdan yangi ro'yxat kelganda solishtiriladi:
 *   id keshda bor  → keshdan ochiladi (tarmoq yo'q);
 *   id keshda yo'q → yuklab keshlanadi;
 *   serverda yo'q yoki muddati o'tgan → keshdan o'chiriladi.
 */

const DB_NAME = 'spacemr_stories';
const DB_VER = 1;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_ITEM_BYTES = 40 * 1024 * 1024;     // bitta fayl uchun yuqori chegara
const MAX_TOTAL_BYTES = 300 * 1024 * 1024;   // umumiy kesh chegarasi
const CONCURRENCY = 3;

let _dbp = null;
const _urls = new Map();       // storyId -> blob: URL (sessiya davomida)
const _inflight = new Map();   // storyId -> Promise (bir xil faylni ikki marta yuklamaslik)

function db() {
  if (_dbp) return _dbp;
  _dbp = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no-idb'));
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('groups')) d.createObjectStore('groups', { keyPath: 'uid' });
      if (!d.objectStoreNames.contains('media')) d.createObjectStore('media', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('idb-blocked'));
  });
  _dbp.catch(() => { _dbp = null; });
  return _dbp;
}

/** Bitta tranzaksiya: fn(store) natijasi (Promise bo'lishi mumkin) tranzaksiya tugagach qaytadi */
function tx(store, mode, fn) {
  return db().then(d => new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    try { out = fn(s); } catch (e) { reject(e); return; }
    Promise.resolve(out).then(v => { t.oncomplete = () => resolve(v); }, reject);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

/** Story muddati: created_at + 24 soat (server expires_at erta bo'lsa — o'sha). */
export function storyExpiresAt(createdAt, serverExpires) {
  const c = Date.parse(createdAt);
  let e = isNaN(c) ? Date.now() + DAY_MS : c + DAY_MS;
  const s = Date.parse(serverExpires);
  if (!isNaN(s) && s < e) e = s;
  return e;
}
export const isExpired = (item) => !!item && (item.expiresAt || storyExpiresAt(item.createdAt)) <= Date.now();

/* ── Ro'yxat snapshot'i ───────────────────────────────────────────────── */
export async function loadSnapshot(uid) {
  if (!uid) return null;
  try {
    const rec = await tx('groups', 'readonly', s => reqP(s.get(uid)));
    if (!rec?.groups) return null;
    const groups = rec.groups
      .map(g => ({ ...g, items: (g.items || []).filter(i => !isExpired(i)) }))
      .filter(g => g.isMe || g.items.length);
    return { groups, savedAt: rec.savedAt || 0 };
  } catch (_) { return null; }
}

export async function saveSnapshot(uid, groups) {
  if (!uid || !Array.isArray(groups)) return;
  try {
    const clean = groups.map(g => ({
      ...g,
      items: (g.items || []).filter(i => !i._optimistic).map(i => ({ ...i })),
    }));
    await tx('groups', 'readwrite', s => { s.put({ uid, groups: clean, savedAt: Date.now() }); });
  } catch (_) {}
}

/* ── Media ────────────────────────────────────────────────────────────── */
/** Sinxron: sessiyada allaqachon tayyor blob URL bo'lsa */
export const cachedUrlSync = (id) => _urls.get(id) || null;

/** Keshdan blob URL (bo'lmasa null) */
export async function cachedUrl(id) {
  if (!id) return null;
  if (_urls.has(id)) return _urls.get(id);
  try {
    const rec = await tx('media', 'readonly', s => reqP(s.get(id)));
    if (!rec?.blob || (rec.expiresAt && rec.expiresAt <= Date.now())) return null;
    const u = URL.createObjectURL(rec.blob);
    _urls.set(id, u);
    return u;
  } catch (_) { return null; }
}

async function hasMedia(id) {
  try {
    const k = await tx('media', 'readonly', s => reqP(s.getKey(id)));
    return k != null;
  } catch (_) { return false; }
}

/** Bitta story faylini keshlaydi (bor bo'lsa tegmaydi). true = keshda bor */
export function cacheItem(item) {
  if (!item?.id || !item.mediaUrl || item._optimistic || isExpired(item)) return Promise.resolve(false);
  if (/^(blob|data):/.test(item.mediaUrl)) return Promise.resolve(false);
  if (_inflight.has(item.id)) return _inflight.get(item.id);
  const p = (async () => {
    if (_urls.has(item.id) || await hasMedia(item.id)) return true;
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 60000);
    try {
      const res = await fetch(item.mediaUrl, { signal: ctl.signal, credentials: 'omit' });
      if (!res.ok) return false;
      const len = parseInt(res.headers.get('content-length') || '0', 10);
      if (len && len > MAX_ITEM_BYTES) return false;
      const blob = await res.blob();
      if (!blob.size || blob.size > MAX_ITEM_BYTES) return false;
      const expiresAt = item.expiresAt || storyExpiresAt(item.createdAt);
      await tx('media', 'readwrite', s => {
        s.put({ id: item.id, mediaPath: item.mediaPath || null, type: item.mediaType || '', blob, size: blob.size,
                createdAt: item.createdAt || null, expiresAt, storedAt: Date.now() });
      });
      _urls.set(item.id, URL.createObjectURL(blob));
      return true;
    } catch (_) { return false; }
    finally { clearTimeout(to); }
  })().finally(() => _inflight.delete(item.id));
  _inflight.set(item.id, p);
  return p;
}

/**
 * Serverdan kelgan guruhlar bilan keshni solishtiradi:
 *  - yangi story'lar keshlanadi (ko'rilmaganlar va birinchilar oldin);
 *  - serverda yo'q / muddati o'tganlar keshdan o'chadi.
 */
export async function syncMedia(groups) {
  try {
    const items = [];
    for (const g of groups || []) for (const i of g.items || []) if (!i._optimistic && !isExpired(i)) items.push(i);
    const live = new Set(items.map(i => i.id));
    await purge(live);
    const order = [...items.filter(i => !i.seen), ...items.filter(i => i.seen)];
    let idx = 0;
    const worker = async () => { while (idx < order.length) { await cacheItem(order[idx++]); } };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, order.length) }, worker));
    await trimTotal();
  } catch (_) {}
}

/** Muddati o'tgan yoki serverda endi yo'q (o'chirilgan) story fayllarini o'chiradi. */
export async function purge(liveIds) {
  try {
    const dead = await tx('media', 'readwrite', s => new Promise(res => {
      const out = [];
      const r = s.openCursor();
      r.onsuccess = () => {
        const c = r.result;
        if (!c) return res(out);
        const v = c.value;
        if ((v.expiresAt && v.expiresAt <= Date.now()) || (liveIds && !liveIds.has(v.id))) { out.push(v.id); c.delete(); }
        c.continue();
      };
      r.onerror = () => res(out);
    }));
    for (const id of dead || []) {
      const u = _urls.get(id);
      if (u) { try { URL.revokeObjectURL(u); } catch (_) {} _urls.delete(id); }
    }
  } catch (_) {}
}

async function trimTotal() {
  try {
    const all = await tx('media', 'readonly', s => new Promise(res => {
      const out = []; const r = s.openCursor();
      r.onsuccess = () => {
        const c = r.result;
        if (!c) return res(out);
        out.push({ id: c.value.id, size: c.value.size || 0, at: c.value.storedAt || 0 });
        c.continue();
      };
      r.onerror = () => res(out);
    }));
    let total = (all || []).reduce((a, x) => a + x.size, 0);
    if (total <= MAX_TOTAL_BYTES) return;
    const oldest = [...all].sort((a, b) => a.at - b.at);
    await tx('media', 'readwrite', s => {
      for (const x of oldest) {
        if (total <= MAX_TOTAL_BYTES) break;
        s.delete(x.id); total -= x.size;
        const u = _urls.get(x.id); if (u) { try { URL.revokeObjectURL(u); } catch (_) {} _urls.delete(x.id); }
      }
    });
  } catch (_) {}
}

/** Logout: ro'yxat va fayllarning hammasini o'chiradi */
export async function clearAll() {
  try {
    for (const u of _urls.values()) { try { URL.revokeObjectURL(u); } catch (_) {} }
    _urls.clear(); _inflight.clear();
    await tx('groups', 'readwrite', s => { s.clear(); });
    await tx('media', 'readwrite', s => { s.clear(); });
  } catch (_) {}
}
