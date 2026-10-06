/**
 * SpaceMR — live.js: "refresh yo'q" qatlami.
 *  1) Resync: ilova uyg'onganda (tab ko'rinadi), internet qaytganda, realtime socket qayta ulanganda
 *     `spacemr:resync` hodisasi yuboriladi — har modul o'z ma'lumotini qayta yuklaydi
 *     (uxlab yotgan telefonda o'tkazib yuborilgan hodisalar to'ldiriladi).
 *  2) Jonli: hikoyalar, bildirishnomalar, saqlanganlar, boshqalarning ism/avatar o'zgarishi.
 * Lenta, izohlar, like, chat, guruh, qo'ng'iroq, admin — o'z modullarida allaqachon jonli.
 */
import { sb, state, mapProfile } from './config.js';
import { defAvi } from './utils.js';

const $ = id => document.getElementById(id);
const visible = el => !!el && el.getClientRects().length > 0;
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

/* ── Resync dispatcher ─────────────────────────────────────────────── */
let _lastSync = 0, _hiddenAt = 0, _sockOpens = 0, _wired = false;
export function requestResync(reason) {
  const now = Date.now();
  if (now - _lastSync < 1500) return;
  _lastSync = now;
  window.dispatchEvent(new CustomEvent('spacemr:resync', { detail: { reason } }));
}
function wireResync() {
  if (_wired) return;
  _wired = true;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) _hiddenAt = Date.now();
    else if (Date.now() - _hiddenAt > 3000) requestResync('visible');
  });
  window.addEventListener('online', () => requestResync('online'));
  window.addEventListener('pageshow', e => { if (e.persisted) requestResync('pageshow'); });
  try {
    sb.realtime.stateChangeCallbacks.open.push(() => { if (_sockOpens++ > 0) requestResync('socket'); });
  } catch (_) {}
}

/* ── Boshqalarning ism/avatar o'zgarishi: lenta va izohlardagi DOM shu zahoti yangilanadi ── */
const _seenProf = new Map();
function paintProfile(row) {
  const u = mapProfile(row);
  if (!u?.uid) return;
  const sig = `${u.fullName}|${u.username}|${u.avatar || ''}`;
  if (_seenProf.get(u.uid) === sig) return;           // last_seen heartbeat va h.k. — e'tiborsiz
  const first = !_seenProf.has(u.uid);
  _seenProf.set(u.uid, sig);
  const uid = CSS.escape(u.uid);
  const av = u.avatar || defAvi(u.fullName || 'U');
  document.querySelectorAll(`.post-head .avi[data-uid="${uid}"] img, .cmt-avi[data-uid="${uid}"] img`).forEach(i => {
    if (i.getAttribute('src') !== av) i.src = av;
    i.style.display = '';
  });
  document.querySelectorAll(`.post-meta[data-uid="${uid}"]`).forEach(m => {
    const n = m.querySelector('.post-name'); if (n && u.fullName) n.textContent = u.fullName;
    const un = m.querySelector('.post-user'); if (un && u.username) un.textContent = '@' + u.username;
  });
  document.querySelectorAll(`.cmt-avi[data-uid="${uid}"]`).forEach(a => {
    const n = a.closest('.cmt-row')?.querySelector('.cmt-name'); if (n && u.fullName) n.textContent = u.fullName;
  });
  if (first) return;
  // Kesh chat moduli o'z farqini hisoblab bo'lgandan keyin yangilanadi
  setTimeout(() => {
    const c = state._userCache?.[u.uid];
    if (c) { c.fullName = u.fullName; c.username = u.username; c.avatar = u.avatar; }
  }, 400);
}

/* ── Start / stop ──────────────────────────────────────────────────── */
let _chans = [], _tick = null, _uid = null, _offResync = null;

export function stopLive() {
  _chans.forEach(c => { try { sb.removeChannel(c); } catch (_) {} });
  _chans = [];
  if (_tick) { clearInterval(_tick); _tick = null; }
  if (_offResync) { _offResync(); _offResync = null; }
  _uid = null;
}

export function initLive() {
  const me = state.me?.uid;
  if (!me) return;
  if (_uid === me) return;
  stopLive();
  _uid = me;
  wireResync();

  const reloadStories = debounce(() => import('../feed/stories.js').then(m => m.loadStories()).catch(() => {}), 600);
  const reloadNotifs  = debounce(() => {
    if (visible($('notifsList'))) import('../ui/notifs.js').then(m => m.loadNotifs({ silent: true })).catch(() => {});
  }, 400);
  const reloadSaved   = debounce(() => {
    if (state.view === 'saved') import('../profile/view-saved.js').then(m => m.initView()).catch(() => {});
  }, 300);

  // Hikoyalar: yangi/o'chirilgan hikoya va (ko'rgich ochiq bo'lsa) ko'rishlar
  _chans.push(sb.channel('live-stories')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'stories' }, reloadStories)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'story_views' }, () => { if (visible($('storyViewer'))) reloadStories(); })
    .subscribe());

  // Bildirishnomalar: yangi/o'qilgan xabar (DM va guruh) — ro'yxat ochiq bo'lsa jimgina yangilanadi
  _chans.push(sb.channel('live-notifs')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, reloadNotifs)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'group_messages' }, reloadNotifs)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'group_members', filter: `user_id=eq.${me}` }, reloadNotifs)
    .subscribe());

  // Saqlanganlar: boshqa qurilmada saqlash/olib tashlash
  _chans.push(sb.channel('live-saved')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'saved_posts', filter: `user_id=eq.${me}` }, p => {
      const pid = p.new?.post_id || p.old?.post_id;
      if (pid) {
        const on = p.eventType !== 'DELETE';
        if (!(state.mySavedPosts instanceof Set)) state.mySavedPosts = new Set();
        if (on) state.mySavedPosts.add(pid); else state.mySavedPosts.delete(pid);
        document.querySelectorAll(`.save-btn[data-id="${CSS.escape(pid)}"]`).forEach(b => {
          b.classList.toggle('saved', on);
          b.setAttribute('aria-pressed', String(on));
          const im = b.querySelector('img.icon');
          if (im && (im.getAttribute('src') || '').includes('/bookmark')) {
            im.setAttribute('src', on ? './svg/social/bookmark-filled.svg' : './svg/social/bookmark-outline.svg');
          }
        });
      }
      reloadSaved();
    })
    .subscribe());

  // Boshqalarning ism/avatar o'zgarishi
  _chans.push(sb.channel('live-profiles')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'profiles' }, p => paintProfile(p.new))
    .subscribe());

  // Uyg'onish / qayta ulanish: o'tkazib yuborilganlarni to'ldirish
  const onRs = () => { reloadStories(); reloadNotifs(); reloadSaved(); };
  window.addEventListener('spacemr:resync', onRs);
  _offResync = () => window.removeEventListener('spacemr:resync', onRs);

  // Hikoya muddati tugashi ko'rinib borsin (24 soat) — 5 daqiqada bir, faqat ko'rinib turganda
  _tick = setInterval(() => { if (!document.hidden) reloadStories(); }, 5 * 60e3);
}
