/**
 * recent-media.js — "Oxirgilar": HISOBGA bog'langan (qurilmaga emas) oldin yuborilgan media.
 * Manba: foydalanuvchining o'zi yuborgan xabarlar — shaxsiy chatlar (messages) va guruhlar (group_messages) BIRGA, bitta ro'yxat.
 * Gridda faqat serverdagi URL'lar ko'rsatiladi (preview). Qayta yuborilganda fayl Supabase'ga qayta yuklanmaydi:
 * mavjud media_path bilan yangi xabar yoziladi (core/config.js: makeRemoteMediaFile).
 */
import { sb, state, mediaPublicUrl } from '../core/config.js';
import { cacheRecentMedia, getCachedRecentMedia } from '../core/local-cache.js';

const LIMIT = 36;

function _shape(r) {
  const path = r.media_path;
  const mime = String(r.media_type || '').toLowerCase();
  return {
    id: 'rm_' + path,
    path,
    url: mediaPublicUrl(path),
    type: mime || 'application/octet-stream',
    name: r.file_name || String(path).split('/').pop() || 'media',
    size: Number(r.file_size) || 0,
    duration: Number(r.duration) || 0,
    at: r.created_at,
  };
}

/** Xotiradagi/IndexedDB keshdan darhol (0ms, oflaynda ham) */
export function getRecentsSync() {
  const uid = state.me?.uid;
  const c = uid ? getCachedRecentMedia(uid) : null;
  return Array.isArray(c) ? c : [];
}

/** Serverdan yangilaydi (chat + guruh), keshga yozadi */
export async function fetchAccountRecents() {
  const uid = state.me?.uid;
  if (!uid) return [];
  const cols = 'media_path, media_type, file_name, file_size, duration, type, created_at';
  const q = (tbl) => sb.from(tbl).select(cols)
    .eq('sender_id', uid).not('media_path', 'is', null)
    .order('created_at', { ascending: false }).limit(80);
  let rows = [];
  try {
    const [a, b] = await Promise.all([q('messages'), q('group_messages')]);
    rows = [...(a.data || []), ...(b.data || [])];
    if (a.error && b.error) return getRecentsSync();
  } catch (_) { return getRecentsSync(); }
  rows.sort((x, y) => new Date(y.created_at) - new Date(x.created_at));
  const seen = new Set();
  const out = [];
  for (const r of rows) {
    if (!r.media_path || seen.has(r.media_path)) continue;
    if (r.type === 'voice' || String(r.media_type || '').startsWith('audio/')) continue;
    seen.add(r.media_path);
    out.push(_shape(r));
    if (out.length >= LIMIT) break;
  }
  try { cacheRecentMedia(uid, out); } catch (_) {}
  return out;
}

// Eski qurilma-lokal "Oxirgilar" bazasi (fayllar nusxasi) endi kerak emas — bir marta o'chiramiz
try { if (typeof indexedDB !== 'undefined') indexedDB.deleteDatabase('spacemr_attach_db'); } catch (_) {}
