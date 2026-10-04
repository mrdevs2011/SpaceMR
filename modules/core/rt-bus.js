/* ── rt-bus.js — global tezkor shina (WebSocket broadcast + presence) ─────
 * postgres_changes (WAL → Realtime → RLS) 200–500ms olishi mumkin; broadcast
 * esa yozuvchidan to'g'ridan-to'g'ri qabul qiluvchiga (~30–100ms) boradi.
 * Baza baribir haqiqat manbai — bu shina faqat "ko'rsatish"ni tezlashtiradi,
 * keyin kelgan postgres hodisasi qiymatni to'g'rilaydi.
 *
 *  - pub        : hamma uchun ochiq hodisalar (like, izoh, post) + presence (onlayn)
 *  - u-<uid>    : shaxsiy kirish qutisi (DM ro'yxati/unread uchun)
 *  - g-<id>     : guruh kirish qutisi (guruh ro'yxati/unread uchun)
 * Katta/shaxsiy ma'lumot bu yerda yuborilmaydi: faqat ko'rsatish uchun minimal qism.
 */
import { sb, state } from './config.js';

const handlers = new Map();            // event → Set<fn>
export const onlineUids = new Set();   // presence bo'yicha hozir onlayn
const _left = new Set();               // yaqinda chiqib ketganlar (isOnline 100s kutmasin)
let pub = null, pubReady = false;
let me = null;
const chans = new Map();               // name → {ch, ready, q, at}
const MAX_CH = 40;

const fire = (ev, payload) => { handlers.get(ev)?.forEach(fn => { try { fn(payload); } catch (e) { console.warn('[bus]', ev, e); } }); };

export function busOn(ev, fn) {
  if (!handlers.has(ev)) handlers.set(ev, new Set());
  handlers.get(ev).add(fn);
  return () => handlers.get(ev)?.delete(fn);
}

/** uid onlaynmi: presence bo'lsa ha; yaqinda chiqqan bo'lsa yo'q; aks holda last_seen */
export function isUidOnline(uid, lastSeenFallback) {
  if (onlineUids.has(uid)) return true;
  if (_left.has(uid)) return false;
  return !!lastSeenFallback;
}

function presenceSync() {
  if (!pub) return;
  const st = pub.presenceState();
  const now = new Set(Object.keys(st));
  for (const u of onlineUids) if (!now.has(u)) _left.add(u);
  for (const u of now) _left.delete(u);
  onlineUids.clear();
  now.forEach(u => onlineUids.add(u));
  document.dispatchEvent(new CustomEvent('presenceChanged'));
}

/** Shaxsiy/guruh kanallari: kerak bo'lganda ochiladi, keshlanadi, LRU bilan cheklanadi */
function chan(name, listen) {
  let c = chans.get(name);
  if (c) { c.at = Date.now(); return c; }
  if (chans.size >= MAX_CH) {
    let oldest = null;
    for (const [k, v] of chans) if (!v.keep && (!oldest || v.at < chans.get(oldest).at)) oldest = k;
    if (oldest) { try { sb.removeChannel(chans.get(oldest).ch); } catch (_) {} chans.delete(oldest); }
  }
  const ch = sb.channel(name, { config: { broadcast: { self: false } } });
  c = { ch, ready: false, q: [], at: Date.now(), keep: !!listen };
  if (listen) ch.on('broadcast', { event: 'inb' }, ({ payload }) => fire(listen, payload));
  ch.subscribe(st => {
    c.ready = st === 'SUBSCRIBED';
    if (c.ready) { const q = c.q; c.q = []; q.forEach(p => ch.send({ type: 'broadcast', event: 'inb', payload: p })); }
  });
  chans.set(name, c);
  return c;
}

function sendTo(name, payload) {
  const c = chan(name);
  if (c.ready) c.ch.send({ type: 'broadcast', event: 'inb', payload });
  else c.q.push(payload);
}

/** DM: peer'ning kirish qutisiga yuborish (suhbat ochilganda oldindan isitiladi) */
export const inboxWarm = (uid) => { if (uid && uid !== me) chan('u-' + uid); };
export const inboxSend = (uid, payload) => { if (uid && uid !== me) sendTo('u-' + uid, payload); };
/** Guruh: a'zo bo'lgan guruhlarni tinglash/yuborish */
export const groupJoin = (gid) => { if (gid) chan('g-' + gid, 'ginbox'); };
export const groupInboxSend = (gid, payload) => { if (gid) sendTo('g-' + gid, payload); };

/** Hamma uchun ochiq hodisa (like/izoh/post) */
export function busEmit(ev, payload) {
  if (!pub) return;
  const msg = { type: 'broadcast', event: ev, payload: { ...payload, from: me } };
  pub.send(msg);
}

const PUB_EVENTS = ['like', 'cmt', 'post', 'story'];

/** Tab ko'rinsa onlayn, yashirilsa darhol offline */
export async function trackPresence() {
  if (!pub || !pubReady || !me) return;
  if (document.visibilityState !== 'visible') return;
  try { await pub.track({ at: Date.now() }); } catch (_) {}
}

export async function untrackPresence() {
  if (!pub || !pubReady) return;
  try { await pub.untrack(); } catch (_) {}
}

export function startBus() {
  const uid = state.me?.uid;
  if (!uid || pub) return;
  me = uid;
  pub = sb.channel('pub', { config: { broadcast: { self: false }, presence: { key: uid } } });
  PUB_EVENTS.forEach(ev => pub.on('broadcast', { event: ev }, ({ payload }) => {
    if (payload && payload.from !== me) fire(ev, payload);
  }));
  // sync + join/leave — offline/online darhol
  pub.on('presence', { event: 'sync' }, presenceSync);
  pub.on('presence', { event: 'join' }, ({ key, newPresences }) => {
    if (!key) return;
    onlineUids.add(key);
    _left.delete(key);
    document.dispatchEvent(new CustomEvent('presenceChanged'));
  });
  pub.on('presence', { event: 'leave' }, ({ key }) => {
    if (!key) return;
    onlineUids.delete(key);
    _left.add(key);
    document.dispatchEvent(new CustomEvent('presenceChanged'));
  });
  pub.subscribe(async st => {
    pubReady = st === 'SUBSCRIBED';
    if (pubReady) await trackPresence();
  });
  // Shaxsiy kirish qutisi
  chan('u-' + uid, 'inbox');
}

export function stopBus() {
  for (const c of chans.values()) { try { sb.removeChannel(c.ch); } catch (_) {} }
  chans.clear();
  if (pub) { try { sb.removeChannel(pub); } catch (_) {} pub = null; }
  pubReady = false; me = null;
  onlineUids.clear(); _left.clear();
}
