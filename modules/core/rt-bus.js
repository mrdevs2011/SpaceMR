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
export const onlineUids = new Set();   // presence bo'yicha hozir onlayn (kafolatlangan)
let pub = null, pubReady = false;
let me = null;
const chans = new Map();               // name → {ch, ready, q, at}
const MAX_CH = 40;

/* ── Presence qoidalari (ishonchli onlayn/oflayn) ──────────────────────
 *  1. Haqiqat manbai — faqat Realtime presence. last_seen faqat shina
 *     uzilgan paytda (isBusLive()=false) zaxira sifatida ishlatiladi.
 *  2. Toza chiqish (tab yashirildi / yopildi / logout) → darhol "leave".
 *  3. Qattiq uzilish (tarmoq yo'qoldi, telefon qotdi) → server o'chirguncha
 *     kutmaymiz: har BEAT_MS da qayta track({at,v:2}); STALE_MS ichida yangi
 *     "yurak urishi" ko'rinmasa — spoof/ghost deb oflayn hisoblanadi.
 *     (Vaqt faqat LOKAL soat bilan o'lchanadi — qurilmalar soati farqi xalaqit bermaydi.)
 *  4. Bir uid bir nechta tab/qurilmada: bittasi chiqsa qolgani onlayn qoladi.
 *  5. Shina "joined" holatida qotib qolsa — kanal avtomatik qayta ochiladi.
 */
const BEAT_MS   = 20_000;
const STALE_MS  = 55_000;
const SWEEP_MS  = 5_000;
const REOPEN_AFTER_MS = 20_000;
const _beat = new Map();               // uid → {at, seen(lokal ms)}
let _synced = false, _lastLive = false, _badSince = 0, _sched = 0, _restarting = false;
let _beatTimer = null, _sweepTimer = null;

const fire = (ev, payload) => { handlers.get(ev)?.forEach(fn => { try { fn(payload); } catch (e) { console.warn('[bus]', ev, e); } }); };

export function busOn(ev, fn) {
  if (!handlers.has(ev)) handlers.set(ev, new Set());
  handlers.get(ev).add(fn);
  return () => handlers.get(ev)?.delete(fn);
}

/** Shina haqiqatan tirikmi (kanal joined + birinchi sync kelgan) */
export function isBusLive() { return !!pub && pubReady && _synced; }

/** uid onlaynmi: shina tirik bo'lsa — faqat presence; aks holda last_seen zaxirasi */
export function isUidOnline(uid, lastSeenFallback) {
  if (isBusLive()) return onlineUids.has(uid);
  return !!lastSeenFallback;
}

function _schedule() { if (!_sched) _sched = setTimeout(_recompute, 0); }

function _recompute() {
  _sched = 0;
  const now = Date.now();
  const st = pub ? pub.presenceState() : {};
  const next = new Set();
  for (const uid of Object.keys(st)) {
    const metas = st[uid];
    if (!metas || !metas.length) continue;
    let at = 0, allV2 = true;
    for (const m of metas) { at = Math.max(at, +m.at || 0); if (!(m.v >= 2)) allV2 = false; }
    let b = _beat.get(uid);
    if (!b || b.at !== at) { b = { at, seen: now }; _beat.set(uid, b); }
    // eski versiyadagi klient yurak urishi yubormaydi — ularga stale qo'llanmaydi
    if (!allV2 || now - b.seen < STALE_MS) next.add(uid);
  }
  for (const uid of [..._beat.keys()]) if (!st[uid] || !st[uid].length) _beat.delete(uid);

  const live = isBusLive();
  let changed = live !== _lastLive || next.size !== onlineUids.size;
  if (!changed) for (const u of next) if (!onlineUids.has(u)) { changed = true; break; }
  _lastLive = live;
  if (!changed) return;
  onlineUids.clear();
  next.forEach(u => onlineUids.add(u));
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
  if (pub.state !== 'joined') return;
  try { await pub.track({ at: Date.now(), v: 2 }); } catch (_) {}
}

export async function untrackPresence() {
  if (!pub || !pubReady) return;
  try { await pub.untrack(); } catch (_) {}
}

function openPub() {
  const uid = me;
  if (!uid) return;
  const ch = sb.channel('pub', { config: { broadcast: { self: false }, presence: { key: uid } } });
  pub = ch;
  PUB_EVENTS.forEach(ev => ch.on('broadcast', { event: ev }, ({ payload }) => {
    if (payload && payload.from !== me) fire(ev, payload);
  }));
  // Hamma hodisadan keyin holat presenceState()dan qayta hisoblanadi (bir uid — bir necha tab xavfsiz)
  ch.on('presence', { event: 'sync' }, () => { if (pub === ch) { _synced = true; _schedule(); } });
  ch.on('presence', { event: 'join' },  () => { if (pub === ch) _schedule(); });
  ch.on('presence', { event: 'leave' }, () => { if (pub === ch) _schedule(); });
  ch.subscribe(async st => {
    if (pub !== ch) return;
    if (st === 'SUBSCRIBED') {
      pubReady = true; _badSince = 0;
      await trackPresence();
    } else {
      pubReady = false; _synced = false;
      if (!_badSince) _badSince = Date.now();
    }
    _schedule();
  });
}

/** Qotib qolgan/uzilgan kanalni to'liq qayta ochish */
async function restartPub() {
  if (_restarting || !me) return;
  _restarting = true;
  try {
    const old = pub;
    pub = null; pubReady = false; _synced = false; _badSince = 0;
    _beat.clear(); _recompute();
    if (old) { try { await sb.removeChannel(old); } catch (_) {} }
    openPub();
  } finally { _restarting = false; }
}

function _sweep() {
  if (!pub) return;
  _recompute();   // stale (ghost) larni vaqt o'tishi bilan olib tashlaydi
  const visible = document.visibilityState === 'visible';
  if (pub.state !== 'joined') {
    if (!visible || navigator.onLine === false) return;
    if (!_badSince) _badSince = Date.now();
    if (Date.now() - _badSince > REOPEN_AFTER_MS) restartPub();
  } else {
    _badSince = 0;
  }
}

function _beatTick() { if (document.visibilityState === 'visible') trackPresence(); }

// Uyg'onish / internet qaytishi: kanal tirikligini tekshirish va qayta track
function _onResync() {
  if (!pub) return;
  if (pub.state !== 'joined') _badSince = Date.now() - REOPEN_AFTER_MS + 3000;  // ~3s da ochilmasa — qayta ochiladi
  else trackPresence();
}

export function startBus() {
  const uid = state.me?.uid;
  if (!uid || pub) return;
  me = uid;
  openPub();
  _beatTimer = setInterval(_beatTick, BEAT_MS);
  _sweepTimer = setInterval(_sweep, SWEEP_MS);
  window.addEventListener('spacemr:resync', _onResync);
  window.addEventListener('online', _onResync);
  // Shaxsiy kirish qutisi
  chan('u-' + uid, 'inbox');
}

export function stopBus() {
  for (const c of chans.values()) { try { sb.removeChannel(c.ch); } catch (_) {} }
  chans.clear();
  clearInterval(_beatTimer); clearInterval(_sweepTimer); _beatTimer = _sweepTimer = null;
  window.removeEventListener('spacemr:resync', _onResync);
  window.removeEventListener('online', _onResync);
  if (pub) { const old = pub; pub = null; try { sb.removeChannel(old); } catch (_) {} }
  pubReady = false; _synced = false; me = null; _badSince = 0;
  _beat.clear();
  onlineUids.clear();
}
