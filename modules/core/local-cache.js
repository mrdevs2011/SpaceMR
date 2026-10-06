/**
 * local-cache.js — Chat, profil va feed ma'lumotlari uchun IndexedDB kesh.
 *
 * Hamma katta ma'lumot (chatlar ro'yxati, thread xabarlari, profil, postlar) IndexedDB'da saqlanadi.
 * localStorage'da faqat juda kichik narsalar qoladi (masalan "kirgan" belgisi, sozlama bayroqlari).
 *
 * Sinxron API (get*): IDB fonda hydrate qilinadi (top-level await YO'Q — boot bloklanmaydi).
 * whenReady() promise orqali kutish mumkin; tayyor bo'lguncha get* null/undefined qaytarishi mumkin.
 * O'qish sinxron (mem), yozish xotiraga darhol + IDB'ga fonda.
 *
 * Eslatma: bu kesh faqat "barqaror" ma'lumot uchun. Tez o'zgaradigan narsa (oxirgi xabar, o'qilmagan soni)
 * ro'yxatga keshdan chizilmaydi — aks holda eski ma'lumot bir zum ko'rinib qoladi.
 */

import { isStoreV2Enabled, putProfile, putPosts, putThread, putChatsList, clearStore, setUid as storeSetUid } from './store/store.js';
import { isEphemeralDevice } from './store/flags.js';
import { clearMediaCache } from './store/media-cache.js';
import { cacheHit, cacheMiss } from './perf.js';

const DB_NAME = 'spacemr_data';
const DB_VER = 1;
const STORE = 'kv';
const LEGACY_PREFIX = 'mrg_c_';          // eski localStorage kesh kalitlari — tozalanadi
const MAX_MSGS_PER_CHAT = 50;            // Har bir chat uchun kesh qilinadigan xabarlar soni
const MAX_CACHED_THREADS = 25;           // Nechta chat threadi keshda saqlanadi
const MAX_CACHED_POSTS = 40;
const HYDRATE_TIMEOUT_MS = 1500;         // IndexedDB javob bermasa ilovani kutdirmaymiz

const mem = new Map();                   // key -> { v, t }
const pending = new Map();               // key -> rec | null (null = o'chirish)
let _flushT = null;
let _dbp = null;

function _open() {
  if (_dbp) return _dbp;
  _dbp = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no-idb'));
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'k' }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('idb-blocked'));
  });
  _dbp.catch(() => { _dbp = null; });
  return _dbp;
}

function _clone(v) {
  if (v == null || typeof v !== 'object') return v;
  try { return structuredClone(v); } catch { try { return JSON.parse(JSON.stringify(v)); } catch { return null; } }
}

async function _hydrate() {
  const d = await _open();
  const rows = await new Promise((res, rej) => {
    const r = d.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    r.onsuccess = () => res(r.result || []);
    r.onerror = () => rej(r.error);
  });
  for (const row of rows) if (row && row.k) mem.set(row.k, { v: row.v, t: row.t || 0 });
}

function _flush() {
  _flushT = null;
  if (!pending.size) return;
  const batch = [...pending]; pending.clear();
  _open().then(d => {
    const st = d.transaction(STORE, 'readwrite').objectStore(STORE);
    for (const [k, rec] of batch) { if (rec) st.put({ k, v: rec.v, t: rec.t }); else st.delete(k); }
  }).catch(() => {});
}
function _queue(key, rec) {
  pending.set(key, rec);
  if (!_flushT) _flushT = setTimeout(_flush, 50);
}
// Sahifa yopilayotganda navbatdagi yozuvlar ketib qolsin
try { addEventListener('pagehide', () => { if (_flushT) { clearTimeout(_flushT); _flush(); } }); } catch (_) {}

function safeSet(key, value) {
  const rec = { v: _clone(value), t: Date.now() };
  mem.set(key, rec);
  if (!isEphemeralDevice()) _queue(key, rec); // Phase 8: umumiy qurilma — diskka yozilmaydi
  return true;
}
function safeGet(key) {
  const rec = mem.get(key);
  return rec ? _clone(rec.v) : null;
}
function safeRemove(key) {
  mem.delete(key);
  _queue(key, null);
}

/** Phase 2 shadow dual-write — UI hali local-cache o'qiydi */
function _shadowWrite(kind, a, b) {
  if (isEphemeralDevice() || !isStoreV2Enabled()) return;
  try {
    if (kind === 'profile') putProfile(a, b);
    else if (kind === 'posts') putPosts(b);
    else if (kind === 'thread') putThread('dm', a, b);
    else if (kind === 'chats') { storeSetUid(a); putChatsList(b); }
  } catch (_) {}
}

/* ── Thread ro'yxatini LRU tarzda cheklash (joy tejash) ─────────────── */
function _touchThreadIndex(chatId) {
  const idxKey = 'thread_index';
  let list = safeGet(idxKey) || [];
  list = list.filter(id => id !== chatId);
  list.unshift(chatId);
  if (list.length > MAX_CACHED_THREADS) {
    list.slice(MAX_CACHED_THREADS).forEach(id => safeRemove(`thread_${id}`));
    list = list.slice(0, MAX_CACHED_THREADS);
  }
  safeSet(idxKey, list);
}

/* ══ Chatlar ro'yxati (foydalanuvchilar: ism/avatar — barqaror ma'lumot) ═══
   chatMap (oxirgi xabar, o'qilmagan soni) ATAYLAB saqlanmaydi: u tez eskiradi va ro'yxatda
   "eski content" bir zum ko'rinib qolishiga sabab bo'lardi. U har doim serverdan olinadi. */
export function cacheChatsList(uid, users) {
  if (!uid || !users) return;
  const payload = { users, chatMap: {} };
  safeSet(`chats_${uid}`, payload);
  _shadowWrite('chats', uid, payload);
}
export function getCachedChatsList(uid) {
  if (!uid) return null;
  const v = safeGet(`chats_${uid}`);
  if (v) cacheHit('chats'); else cacheMiss('chats');
  return v;
}
/** O'chirilgan/bloklangan userdan keyin joriy qurilmadagi keshni majburan eskirtirish. */
export function invalidateChatsListCache(uid) {
  if (!uid) return;
  safeRemove(`chats_${uid}`);
}
/** Keshning necha millisekund oldin saqlanganini qaytaradi (yo'q bo'lsa null). */
export function getCachedChatsListAgeMs(uid) {
  if (!uid) return null;
  const rec = mem.get(`chats_${uid}`);
  return rec && typeof rec.t === 'number' && rec.t ? Date.now() - rec.t : null;
}

/* ══ Chat thread xabarlari ═══════════════════════════════════════════ */
export function cacheThreadMessages(chatId, msgs) {
  if (!chatId || !Array.isArray(msgs)) return;
  const list = msgs.filter(m => m && m.status !== 'sending').slice(-MAX_MSGS_PER_CHAT);
  safeSet(`thread_${chatId}`, list);
  _touchThreadIndex(chatId);
  _shadowWrite('thread', chatId, list);
}
export function getCachedThreadMessages(chatId) {
  if (!chatId) return null;
  const v = safeGet(`thread_${chatId}`);
  if (v) cacheHit('thread'); else cacheMiss('thread');
  return v;
}

/* ══ Profil ma'lumotlari ═════════════════════════════════════════════ */
export function cacheProfile(uid, data) {
  if (!uid || !data) return;
  safeSet(`profile_${uid}`, data);
  _shadowWrite('profile', uid, data);
}
export function getCachedProfile(uid) {
  if (!uid) return null;
  const v = safeGet(`profile_${uid}`);
  if (v) cacheHit('profile'); else cacheMiss('profile');
  return v;
}

/* ══ Feed postlari (bosh sahifa) ═════════════════════════════════════ */
export function cachePosts(uid, posts) {
  if (!uid || !Array.isArray(posts)) return;
  const list = posts.slice(0, MAX_CACHED_POSTS);
  safeSet(`posts_${uid}`, list);
  try { storeSetUid(uid); } catch (_) {}
  _shadowWrite('posts', uid, list);
}
export function getCachedPosts(uid) {
  if (!uid) return null;
  const v = safeGet(`posts_${uid}`);
  if (v) cacheHit('posts'); else cacheMiss('posts');
  return v;
}

/* ══ Tozalash (logout paytida chaqiriladi) ═══════════════════════════ */
export function clearAllCache() {
  mem.clear(); pending.clear();
  clearTimeout(_flushT); _flushT = null;
  _open().then(d => { d.transaction(STORE, 'readwrite').objectStore(STORE).clear(); }).catch(() => {});
  // Story keshi (ro'yxat + fayllar) ham — boshqa akkaunt oldingisining story'larini ko'rmasin
  import('../feed/story-cache.js').then(m => m.clearAll?.()).catch(() => {});
  // Phase 2 store (I-8)
  try { clearStore(); } catch (_) {}
  try { clearMediaCache(); } catch (_) {}
  try { Object.keys(localStorage).filter(k => k.startsWith(LEGACY_PREFIX)).forEach(k => localStorage.removeItem(k)); } catch {}
}

/** Service Worker'ning RUNTIME keshini tozalaydi — "Sozlamalar → Kesh/xotirani tozalash" shu funksiyani chaqiradi. */
export async function clearRuntimeCache() {
  if (!('caches' in window)) return 0;
  try {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));
    return keys.length;
  } catch {
    return 0;
  }
}

// Eski localStorage keshini (katta JSON) bir marta o'chiramiz — endi hammasi IndexedDB'da
try { Object.keys(localStorage).filter(k => k.startsWith(LEGACY_PREFIX)).forEach(k => localStorage.removeItem(k)); } catch {}

// IndexedDB fonda hydrate — boot yo'lida await yo'q (I-6)
let _readyResolve;
const _readyP = new Promise(r => { _readyResolve = r; });
let _ready = false;
export function whenReady() { return _readyP; }
export function isCacheReady() { return _ready; }

Promise.race([
  _hydrate().catch(() => {}),
  new Promise(r => setTimeout(r, HYDRATE_TIMEOUT_MS)),
]).then(() => {
  _ready = true;
  _readyResolve();
});
