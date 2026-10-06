/**
 * SpaceMR — URL router (path asosida).
 *
 *   /login                 kirish
 *   /home                  bosh sahifa (sayt ochilganda doim shu)
 *   /chats                 suhbatlar
 *   /chats/u/<username>    shaxsiy chat
 *   /chats/g/<ref>         guruh chati: ref = group username | id | 64-xonali maxfiy taklif kodi
 *                          (a'zo bo'lmagan ochiq guruhga / taklif kodi bilan avtomatik qo'shiladi)
 *   Eski ?g= ?u= ?join= ?join_group= havolalari ishlamaydi -> 404.
 *   Foydalanuvchi username lari va guruh username lari alohida nomlar fazosi (user 'mr' va guruh 'mr' birga yashaydi).
 *   /chats/groupcreate     "Yangi guruh" formasi
 *   /u/<username>          boshqa foydalanuvchi profili (hamma uchun ochiladi; o'zi ochsa /profile)
 *   /profile               profil
 *   /profile/settings      sozlamalar (/settings → shu yerga)
 *   /explore               qidiruv (Explore)
 *   /newpost               yangi post oynasi
 *   /actions               admin boshqaruvi (faqat admin)
 *   /saved                 saqlangan postlar
 *   /p/<id>                post (bosh sahifada shu postga o'tadi); /p/<id>#c-<izoh> — izoh ochilib yoritiladi
 *   /s/<username>          foydalanuvchi hikoyalari ko'rgichi
 *   /u/<user>/<tab>        profil tabi: photos | text | music  (/profile/<tab> — o'z profilim)
 *   /chats/g/<ref>/info    guruh ma'lumoti paneli
 *   /chats/u/<username>/profile   shaxsiy chatdan ochilgan suhbatdosh profili (chat ustida)
 *   /chats/(u|g)/<ref>#m-<id>  xabarga havola
 *   /explore?q=<so'z>      qidiruv natijasi
 *   /actions               admin panel — ichki URL YO'Q (faqat shu)
 *
 * Qoidalar:
 *  - Kirmagan foydalanuvchi har qanday manzilda DARHOL /login ga qaytariladi (index.html dagi
 *    inline skript sahifa yuklanmasdan oldin ham shuni qiladi); asl manzil kirgandan keyin ochiladi.
 *  - Kirgan foydalanuvchi uchun mavjud bo'lmagan manzil / user / guruh -> 404 sahifa.
 *  - Kirgan foydalanuvchi /login ni yozsa — oxirgi turgan joyiga (spacemr_last_path) qaytadi.
 *
 * Ikki tomonlama:
 *  - holat -> URL: ochiq overlay/chat/tab kuzatiladi, URL shunga moslanadi
 *  - URL -> holat: sahifa ochilganda va brauzer back/forward bosilganda
 */

import { state, sb } from './core/config.js';
import { navigateTo, getCurrentRoute } from './router.js';

const $ = id => document.getElementById(id);

const VIEW_PATH = { home: '/home', chats: '/chats', profile: '/profile', actions: '/actions', saved: '/saved', notifs: '/notifications' };
const NEXT_KEY = 'spacemr_next_path';
const PROFILE_TABS = ['photos', 'videos', 'text', 'music'];   // 'all' = sukut (URL da yo'q)
const LAST_KEY = 'spacemr_last_path'; // kirgan foydalanuvchining oxirgi joyi (/login yozsa shu yerga qaytadi)
const HEX64_RE = /^[0-9a-f]{64}$/i;
const LEGACY_QS_RE = /[?&](g|u|join|join_group)=/i; // eski query havolalar — endi 404
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let _auth = 'unknown';        // 'unknown' | 'in' | 'out'
let _fromLogin = false;       // hozirgina login qilindi (login ekranidan keldi)
let _suppressUntil = 0;       // shu vaqtgacha holat->URL sinxronlash to'xtatiladi
let _internalPop = false;     // history.back() ni o'zimiz chaqirganda popstate ni o'tkazib yuborish
let _replaceNext = false;     // keyingi sinxronlashda push emas, replace
let _raf = 0;
let _timer = 0;
let _applying = false;
let _inited = false;
const _unameCache = new Map(); // uid -> username

/* ── Yordamchilar ───────────────────────────────────────────────────── */

function cleanPath(p) {
  let s = String(p || '/').split('?')[0].split('#')[0];
  s = s.replace(/\/{2,}/g, '/');
  if (s.length > 1) s = s.replace(/\/+$/, '');
  return s || '/';
}

/** Yo'lni tahlil qiladi. Tanilmagan yo'l -> {kind:'notfound'} (kirgan userga 404 sahifa ko'rsatiladi) */
export function parsePath(rawPath) {
  const path = cleanPath(rawPath);
  const seg = path.split('/').filter(Boolean).map(s => { try { return decodeURIComponent(s); } catch (_) { return s; } });
  const a = (seg[0] || '').toLowerCase();
  const b = (seg[1] || '').toLowerCase();
  if (!seg.length) return { kind: 'root' };
  if (seg.length === 1 && (a === 'index.html' || a === 'index')) return { kind: 'root' };
  if (seg.length === 1) {
    if (a === 'login')    return { kind: 'login' };
    if (a === 'home')     return { kind: 'view', view: 'home' };
    if (a === 'chats')    return { kind: 'view', view: 'chats' };
    if (a === 'profile')  return { kind: 'view', view: 'profile' };
    if (a === 'actions')  return { kind: 'view', view: 'actions', admin: true };
    if (a === 'saved')    return { kind: 'view', view: 'saved' };
    if (a === 'notifications') return { kind: 'view', view: 'notifs' };
    if (a === 'settings') return { kind: 'redirect', to: isWideDesktop() ? '/profile' : '/profile/settings' };
    if (a === 'explore')  return { kind: 'overlay', overlay: 'explore', base: 'home' };
    if (a === 'newpost')  return { kind: 'overlay', overlay: 'newpost', base: 'home' };
  }
  if (a === 'p' && seg.length === 3 && UUID_RE.test(seg[1]) && (seg[2] || '').toLowerCase() === 'comments') return { kind: 'post', ref: seg[1].toLowerCase(), comments: true };
  if (a === 'p' && seg.length === 2 && UUID_RE.test(seg[1])) return { kind: 'post', ref: seg[1].toLowerCase() };
  if (a === 's' && seg.length === 2 && seg[1]) return { kind: 'story', ref: seg[1] };
  if (a === 'profile' && seg.length === 2 && PROFILE_TABS.includes(b)) return { kind: 'view', view: 'profile', tab: b };
  if (a === 'u' && seg.length === 3 && seg[1] && PROFILE_TABS.includes((seg[2] || '').toLowerCase())) {
    return { kind: 'userprofile', ref: seg[1], tab: seg[2].toLowerCase() };
  }
  if (a === 'chats' && b === 'g' && seg.length === 4 && seg[2] && (seg[3] || '').toLowerCase() === 'info') {
    return { kind: 'thread', thread: 'group', ref: seg[2], base: 'chats', info: true };
  }
  if (a === 'profile' && b === 'settings' && (seg.length === 2 || seg.length === 3)) {
    const sec = (seg[2] || '').toLowerCase();
    if (seg.length === 3 && !['general', 'email', 'password'].includes(sec)) return { kind: 'notfound' };
    // Desktop: sozlamalar o'ng panelda doim ochiq — alohida manzil kerak emas
    if (isWideDesktop()) return { kind: 'redirect', to: '/profile' };
    return { kind: 'overlay', overlay: 'settings', base: 'profile', section: sec || null };
  }
  if (a === 'u' && seg.length === 2 && seg[1]) {
    return { kind: 'userprofile', ref: seg[1] };
  }
  if (a === 'chats' && seg.length === 2 && b === 'groupcreate') {
    return { kind: 'overlay', overlay: 'groupcreate', base: 'chats' };
  }
  if (a === 'chats' && seg.length === 4 && b === 'u' && seg[2] && (seg[3] || '').toLowerCase() === 'profile') {
    return { kind: 'thread', thread: 'dm', ref: seg[2], base: 'chats', profile: true };
  }
  if (a === 'chats' && seg.length === 3 && b === 'u' && seg[2]) {
    return { kind: 'thread', thread: 'dm', ref: seg[2], base: 'chats' };
  }
  if (a === 'chats' && seg.length === 3 && b === 'g' && seg[2]) {
    return { kind: 'thread', thread: 'group', ref: seg[2], base: 'chats' };
  }
  return { kind: 'notfound' };
}

function isAdminUser() { return !!(state.me && state.me.isAdmin); }

function hasShow(id, cls = 'show') { return !!$(id)?.classList.contains(cls); }

function threadOpen() { return hasShow('chatThreadModal'); }

function userProfileOpen() { return hasShow('userProfileModal') && !!state.currentViewingUserId; }

/** Ochiq guruhga a'zo bo'lmagan foydalanuvchi: ?g= havolasidagidek avtomatik qo'shamiz. */
async function ensureGroupMember(gid) {
  try {
    const { data } = await sb.from('group_members').select('user_id')
      .eq('group_id', gid).eq('user_id', state.me.uid).maybeSingle();
    if (data) return true;
    const m = await import('./chat/groups.js');
    await m.joinGroup(gid);
    import('./ui/toast.js').then(t => t.toast("Guruhga qo'shildingiz", 'success')).catch(() => {});
    return true;
  } catch (_) { return false; }
}

const isWideDesktop = () => window.matchMedia('(min-width: 1200px)').matches;
function settingsPinned() { return document.body.classList.contains('desktop-settings-pinned'); }

// true = so'nggi qidiruv tarmoq/server xatosi bilan tugadi (bu "topilmadi" EMAS — 404 ko'rsatilmaydi)
let _lookupFailed = false;

async function uidByUsername(username) {
  _lookupFailed = false;
  try {
    const { data, error } = await sb.from('profiles').select('id, username').ilike('username', username).maybeSingle();
    if (error) { _lookupFailed = true; return null; }
    if (data?.id) { _unameCache.set(data.id, data.username); return data.id; }
  } catch (_) { _lookupFailed = true; }
  return null;
}

async function groupIdByRef(ref) {
  _lookupFailed = false;
  try {
    if (UUID_RE.test(ref)) {
      const { data, error } = await sb.from('groups').select('id').eq('id', ref).maybeSingle();
      if (error) { _lookupFailed = true; return null; }
      return data?.id || null;
    }
    const { data, error } = await sb.from('groups').select('id').ilike('username', ref).maybeSingle();
    if (error) { _lookupFailed = true; return null; }
    return data?.id || null;
  } catch (_) { _lookupFailed = true; return null; }
}

/** 64-xonali maxfiy taklif kodi bilan guruhga qo'shiladi -> group id. */
async function gidByInvite(token) {
  _lookupFailed = false;
  try {
    const { data, error } = await sb.rpc('join_group_by_token', { p_token: token });
    if (error) { _lookupFailed = true; return null; }
    if (data && data.success && data.group_id) {
      import('./ui/toast.js').then(t => t.toast("Guruhga qo'shildingiz", 'success')).catch(() => {});
      return data.group_id;
    }
  } catch (_) { _lookupFailed = true; }
  return null;
}

/** Qidiruv natijasi bo'sh: haqiqatan yo'q -> 404; tarmoq xatosi -> bosh sahifa (avvalgidek). */
function missing() { return _lookupFailed ? deny() : notFound(); }

/** DM URL uchun username. Hali noma'lum bo'lsa null qaytaradi va fonda yuklaydi. */
function dmToken(uid) {
  const cached = _unameCache.get(uid) || state._userCache?.[uid]?.username;
  if (cached) return cached;
  sb.from('profiles').select('username').eq('id', uid).maybeSingle().then(({ data }) => {
    if (data?.username) { _unameCache.set(uid, data.username); schedule(); }
  }).catch(() => {});
  return null;
}

const _gnameCache = new Map(); // gid -> group username (ommaviy) yoki null (maxfiy -> id ishlatiladi)
/** Guruh URL tokeni: ommaviy guruh = username, aks holda id. Hali noma'lum bo'lsa null va fonda yuklaydi. */
function groupToken(gid) {
  if (_gnameCache.has(gid)) return _gnameCache.get(gid) || gid;
  sb.from('groups').select('username, is_private').eq('id', gid).maybeSingle().then(({ data }) => {
    _gnameCache.set(gid, data && !data.is_private && data.username ? data.username : null);
    schedule();
  }).catch(() => {});
  return null;
}

/* ── Holat -> URL ───────────────────────────────────────────────────── */

/** Hozirgi holatga mos URL. null = hali aniq emas (kutamiz). */
function computeUrl() {
  if (_auth === 'out') return '/login';
  if (_auth !== 'in') return null;

  const gc = $('grpCreateFormOverlay');
  if (gc?.classList.contains('show') && !gc.dataset.addMode) return '/chats/groupcreate';

  const sv = $('storyViewer');
  if (sv && !sv.hidden && state.storyUid) {
    const t = dmToken(state.storyUid);
    return t ? `/s/${encodeURIComponent(t)}` : null;
  }

  if (hasShow('detailModal') && state.detailPostId) return `/p/${state.detailPostId}`;

  if (userProfileOpen()) {
    // 1v1 chatdan ochilgan suhbatdosh profili: /u/<user> emas, chat ichida — /chats/u/<user>/profile
    if (threadOpen() && state.currentChatKind === 'dm' && state.currentChatUid && state.currentChatUid === state.currentViewingUserId) {
      const ct = dmToken(state.currentChatUid);
      return ct ? `/chats/u/${encodeURIComponent(ct)}/profile` : null;
    }
    const t = dmToken(state.currentViewingUserId);
    const tab = document.querySelector('#upGridTabs .active[data-up-tab]')?.dataset.upTab;
    return t ? `/u/${encodeURIComponent(t)}${tab && tab !== 'all' ? '/' + tab : ''}` : null;
  }

  // Desktop (>=1200px) da sozlamalar o'ng panelga mahkamlangan — URL /profile bo'lib qoladi
  if (hasShow('settingsOverlay') && !settingsPinned() && !isWideDesktop()) {
    const open = document.querySelector('#settingsOverlay .pe-accordion.open');
    const key = open && open.getAttribute('data-pe-acc');
    const sec = { basic: 'general', email: 'email', password: 'password' }[key];
    return sec ? '/profile/settings/' + sec : '/profile/settings';
  }

  if (hasShow('uploadOverlay')) return '/newpost';
  if (hasShow('searchOverlay', 'open')) return '/explore' + (state.exploreQuery ? '?q=' + encodeURIComponent(state.exploreQuery) : '');

  if (threadOpen()) {
    const modal = $('chatThreadModal');
    if (state.currentChatKind === 'dm' && state.currentChatUid) {
      const t = dmToken(state.currentChatUid);
      return t ? `/chats/u/${encodeURIComponent(t)}` : null;
    }
    if (modal?.dataset?.gid) {
      const t = groupToken(modal.dataset.gid);
      return t ? `/chats/g/${encodeURIComponent(t)}${hasShow('grpInfoOverlay') ? '/info' : ''}` : null;
    }
    return null;
  }

  if (state.focusPostId && getCurrentRoute() === 'home') {
    const fid = state.focusPostId;
    const rp = $('rrCmtPanel');
    const cmtOpen = !!document.querySelector(`.post[data-id="${fid}"] .post-cmt-panel`)
      || (state.cmtPostId === fid && !!rp && !rp.hidden);
    return `/p/${fid}${cmtOpen ? '/comments' : ''}${state.focusCmtId ? '#c-' + state.focusCmtId : ''}`;
  }
  if (getCurrentRoute() === 'profile') {
    const tab = document.querySelector('#profileGridTabs .active[data-pg-tab]')?.dataset.pgTab;
    if (tab && tab !== 'all') return '/profile/' + tab;
  }

  return VIEW_PATH[getCurrentRoute()] || '/home';
}

/* Bir "oila" ichidagi o'zgarish (tab almashtirish, qidiruv so'zi, izoh havolasi) tarixga yangi yozuv qo'shmaydi */
const famOf = p => p.replace(/^(\/u\/[^/]+|\/profile)\/(photos|videos|text|music)$/, '$1').replace(/^(\/p\/[^/]+)\/comments$/i, '$1');

function setUrl(target, { replace = false } = {}) {
  const cur = location.pathname;
  const hasExtra = /[?#]/.test(target);
  const tpath = target.split(/[?#]/)[0];
  if (hasExtra ? target === cur + location.search + location.hash : tpath === cur) return;
  const st = history.state || {};
  const keepTail = !hasExtra && !cur.startsWith('/p/') && cur !== '/explore' && !/^#[cm]-/.test(location.hash);
  const tail = hasExtra ? '' : (keepTail ? location.search + location.hash : '');
  if (!replace && famOf(tpath) === famOf(cur) && (hasExtra || tpath !== cur)) replace = true;
  if (!replace && st.prev === tpath) {
    // Overlay yopildi — oldingi sahifaga qaytamiz (tarixga takror yozmaymiz)
    _internalPop = true;
    _suppressUntil = Date.now() + 250;
    history.back();
    return;
  }
  if (replace) {
    history.replaceState({ i: st.i || 0, prev: st.prev || null }, '', target + tail);
  } else {
    history.pushState({ i: (st.i || 0) + 1, prev: cur }, '', target + tail);
  }
}

/** Esc / orqaga: bitta oldingi URL ga (oldingi yozuv bo'lmasa — joriy tab ning o'ziga) */
export function goBack() {
  const st = history.state || {};
  if (st.prev) { history.back(); return; }
  state.focusPostId = null; state.focusCmtId = null;
  _replaceNext = true;
  schedule();
}

function schedule() {
  if (_raf) return;
  _raf = requestAnimationFrame(() => { _raf = 0; sync(); });
}

function sync() {
  if (_applying) return;
  if (nfShown()) return; // 404 ko'rinib turibdi — URL tegilmaydi
  const wait = _suppressUntil - Date.now();
  if (wait > 0) {
    clearTimeout(_timer);
    _timer = setTimeout(schedule, wait + 20);
    return;
  }
  const target = computeUrl();
  if (!target) return;
  const replace = _replaceNext || _auth === 'out';
  _replaceNext = false;
  setUrl(target, { replace });
  updateTitle(target);
  if (_auth === 'in' && target !== '/login') {
    try { localStorage.setItem(LAST_KEY, target); } catch (_) {}
  }
}

const TITLES = {
  '/login': 'Kirish', '/home': 'Bosh sahifa', '/chats': 'Suhbatlar', '/profile': 'Profil',
  '/settings': 'Sozlamalar', '/profile/settings': 'Sozlamalar', '/profile/settings/general': 'Sozlamalar', '/profile/settings/email': 'Sozlamalar', '/profile/settings/password': 'Sozlamalar', '/explore': 'Kashf', '/newpost': 'Yangi post', '/actions': 'Boshqaruv', '/saved': 'Saqlanganlar',
  '/chats/groupcreate': 'Yangi guruh',
};
function updateTitle(path) {
  const t = TITLES[path] || (path.startsWith('/chats/') ? 'Suhbatlar' : (path.startsWith('/u/') ? 'Profil' : (path.startsWith('/p/') ? 'Post' : (path.startsWith('/s/') ? 'Hikoya' : (path.startsWith('/profile/') ? 'Profil' : null)))));
  if (t) document.title = `${t} - SpaceMR`;
}

/* ── URL -> holat ───────────────────────────────────────────────────── */

function hasAnyOverlay() {
  return (hasShow('settingsOverlay') && !settingsPinned())
    || hasShow('uploadOverlay') || hasShow('searchOverlay', 'open')
    || (hasShow('grpCreateFormOverlay') && !$('grpCreateFormOverlay').dataset.addMode);
}

function closeEverythingExcept(keep) {
  if (hasShow('detailModal')) $('detailModal').classList.remove('show');
  const sv = $('storyViewer');
  if (keep !== 'story' && sv && !sv.hidden) import('./feed/stories.js').then(m => m.closeStoryViewer?.()).catch(() => {});
  if (keep !== 'userprofile' && hasShow('userProfileModal')) $('upBack')?.click();
  if (keep !== 'groupcreate' && hasShow('grpCreateFormOverlay')) $('grpFormCancelBtn')?.click();
  if (keep !== 'newpost' && hasShow('uploadOverlay')) $('cancelUpload')?.click();
  if (keep !== 'explore' && hasShow('searchOverlay', 'open')) $('searchOverlayClose')?.click();
  if (keep !== 'settings' && hasShow('settingsOverlay') && !settingsPinned()) $('closeSettingsBtn')?.click();
}

async function closeThreadIfOpen() {
  if (!threadOpen()) return;
  try {
    const m = await import('./chat/chat.js');
    m.closeChatThread();
  } catch (_) {
    $('chatThreadModal')?.classList.remove('show');
  }
}

/** Mavjud bo'lmagan manzil: 404 shu joyning o'zida ko'rsatiladi (URL o'zgarmaydi, /404.html ochilmaydi). */
const nfShown = () => document.documentElement.hasAttribute('data-nf');
function notFound() {
  document.documentElement.setAttribute('data-nf', '1');
  document.title = '404 - SpaceMR';
}

function deny() {
  history.replaceState({ i: (history.state?.i || 0), prev: null }, '', '/' + location.search + location.hash);
  return applyPath('/');
}

function openSettingsSection(section) {
  const map = { general: 'basic', email: 'email', password: 'password' };
  const key = map[section];
  document.querySelectorAll('#settingsOverlay .pe-accordion').forEach((acc) => {
    const on = !!key && acc.getAttribute('data-pe-acc') === key;
    acc.classList.toggle('open', on);
    acc.querySelector('.pe-acc-toggle')?.setAttribute('aria-expanded', on ? 'true' : 'false');
  });
}

async function openOverlay(name, section) {
  if (name === 'settings') {
    if (!hasShow('settingsOverlay')) $('settingsBtn')?.click();
    if (section) openSettingsSection(section);
    return;
  }
  if (name === 'explore') {
    if (!hasShow('searchOverlay', 'open')) ($('sbSearchToggle') || $('hdrSearchBtn'))?.click();
    return;
  }
  if (name === 'newpost') {
    if (!hasShow('uploadOverlay')) {
      const m = await import('./feed/upload.js');
      m.openComposer();
    }
    return;
  }
  if (name === 'groupcreate') {
    if (!hasShow('grpCreateFormOverlay')) {
      const m = await import('./chat/groups.js');
      m.openCreateForm('group');
    }
  }
}

/** Profil/foydalanuvchi profilidagi tabni (photos|videos|text|music|all) bosib tanlaydi — tugma chizilguncha kutadi. */
function pickTab(selector, key, tab) {
  let n = 0;
  const tick = () => {
    const btn = [...document.querySelectorAll(selector)].find(b => b.dataset[key] === tab);
    if (btn) { if (!btn.classList.contains('active')) btn.click(); return; }
    if (n++ < 20) setTimeout(tick, 150);
  };
  tick();
}

/** Xabarga havola (#m-<id>): xabargacha scroll + qisqa yoritish */
function scrollToMsg(id) {
  const q = CSS.escape(String(id));
  let n = 0;
  const tick = () => {
    const el = document.querySelector(`.chat-msg[data-msg-id="${q}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('msg-link-highlight');
      setTimeout(() => el.classList.remove('msg-link-highlight'), 3000);
      return;
    }
    if (n++ < 20) setTimeout(tick, 250);
  };
  setTimeout(tick, 300);
}

async function postExists(id) {
  _lookupFailed = false;
  try {
    const { data, error } = await sb.from('posts').select('id').eq('id', id).maybeSingle();
    if (error) { _lookupFailed = true; return false; }
    return !!data;
  } catch (_) { _lookupFailed = true; return false; }
}

/** URL ga qarab ilova holatini o'rnatadi. */
export async function applyPath(rawPath, { initial = false } = {}) {
  document.documentElement.removeAttribute('data-nf');
  _applying = true;
  _suppressUntil = Date.now() + 900;
  try {
    const route = parsePath(rawPath);
    const here = location.pathname;
    const tail = location.search + location.hash;

    /* Kirmagan foydalanuvchi: faqat /login */
    if (_auth !== 'in') {
      if (route.kind !== 'login' && route.kind !== 'root' && route.kind !== 'notfound') {
        try { sessionStorage.setItem(NEXT_KEY, cleanPath(rawPath)); } catch (_) {}
      }
      if (cleanPath(here) !== '/login') history.replaceState({ i: 0, prev: null }, '', '/login' + tail);
      updateTitle('/login');
      return;
    }

    /* Kirgan: mavjud bo'lmagan manzil -> 404 sahifa */
    if (route.kind === 'notfound' || LEGACY_QS_RE.test(location.search)) return notFound();

    /* Kirgan: /login va "/" -> saqlangan manzil yoki /home */
    if (route.kind === 'login' || route.kind === 'root') {
      const fromLogin = _fromLogin;
      _fromLogin = false;
      let next = null;
      try { next = sessionStorage.getItem(NEXT_KEY); sessionStorage.removeItem(NEXT_KEY); } catch (_) {}
      const nr = next ? parsePath(next) : null;
      // Kirmagan paytda mavjud bo'lmagan manzilga borgan edi — kirgandan keyin ham 404
      if (nr && nr.kind === 'notfound') return notFound();
      if (nr && nr.kind !== 'root' && nr.kind !== 'login' && nr.kind !== 'notfound') {
        history.replaceState({ i: 0, prev: null }, '', cleanPath(next) + tail);
        return applyPath(next, { initial: true });
      }
      // Allaqachon kirgan odam /login ni yozdi: oxirgi turgan joyiga qaytaramiz
      if (route.kind === 'login' && !fromLogin) {
        let last = null;
        try { last = localStorage.getItem(LAST_KEY); } catch (_) {}
        const lr = last ? parsePath(last) : null;
        if (lr && lr.kind !== 'root' && lr.kind !== 'login' && lr.kind !== 'notfound') {
          history.replaceState({ i: 0, prev: null }, '', cleanPath(last) + tail);
          return applyPath(last, { initial: true });
        }
      }
      history.replaceState({ i: 0, prev: null }, '', '/home' + tail);
      if (getCurrentRoute() !== 'home' || threadOpen()) navigateTo('home', false);
      closeEverythingExcept(null);
      updateTitle('/home');
      return;
    }

    /* Huquq tekshiruvi */
    if (route.admin && !isAdminUser()) return notFound();

    /* /p/<id> dan boshqa joyga o'tilsa — post fokusi tozalanadi */
    if (route.kind !== 'post') { state.focusPostId = null; state.focusCmtId = null; }

    /* Post: /p/<id>[#c-<izoh>] — bosh sahifada shu postga o'tadi, izoh bo'lsa izohni ochib yoritadi */
    if (route.kind === 'post') {
      if (!(await postExists(route.ref))) return missing();
      const cmt = (location.hash.match(/^#c-(.+)$/) || [])[1] || null;
      /* Shu post allaqachon ochiq (/p/<id> <-> /p/<id>/comments): lentani qayta chizmay, faqat izohlarni moslaymiz */
      if (state.focusPostId === route.ref && !cmt && getCurrentRoute() === 'home') {
        const cm = await import('./feed/comments.js');
        if (!!route.comments !== cm.isCmtOpen(route.ref)) await cm.openCmtModal(route.ref);
        updateTitle('/p/x');
        return;
      }
      closeEverythingExcept(null);
      await closeThreadIfOpen();
      const m = await import('./feed/feed.js');
      await m.openPostLink(route.ref, cmt, { comments: !!route.comments });
      updateTitle('/p/x');
      return;
    }

    /* Hikoya: /s/<username> */
    if (route.kind === 'story') {
      const uid = await uidByUsername(route.ref);
      if (!uid) return missing();
      closeEverythingExcept('story');
      await closeThreadIfOpen();
      if (getCurrentRoute() !== 'home') navigateTo('home', false);
      const m = await import('./feed/stories.js');
      const ok = await m.openStoriesOf(uid);
      if (!ok) return deny();   // hikoya yo'q (24 soatdan oshgan) -> bosh sahifa
      _replaceNext = true;
      updateTitle('/s/x');
      return;
    }

    /* Redirect (masalan /settings → /profile/settings) */
    if (route.kind === 'redirect' && route.to) {
      history.replaceState({ i: (history.state?.i || 0), prev: null }, '', route.to + tail);
      return applyPath(route.to);
    }

    /* Tab (view) */
    if (route.kind === 'view') {
      if (getCurrentRoute() !== route.view || threadOpen() || hasAnyOverlay()) {
        navigateTo(route.view, false);
      }
      closeEverythingExcept(null);
      await closeThreadIfOpen();
      if (route.view === 'profile') pickTab('#profileGridTabs [data-pg-tab]', 'pgTab', route.tab || 'all');
      updateTitle(cleanPath(rawPath));
      return;
    }

    /* Overlay: tagida joriy tab turadi (to'g'ridan-to'g'ri kirishda — base tab) */
    if (route.kind === 'overlay') {
      await closeThreadIfOpen();
      let baseView = route.overlay === 'groupcreate' ? 'chats'
        : (initial || getCurrentRoute() === 'actions' ? route.base : (getCurrentRoute() || route.base));
      if (route.overlay === 'settings' && window.matchMedia('(min-width: 1200px)').matches) baseView = 'profile';
      if (getCurrentRoute() !== baseView) navigateTo(baseView, false);
      closeEverythingExcept(route.overlay);
      await openOverlay(route.overlay, route.section);
      if (route.overlay === 'explore') {
        const q = new URLSearchParams(location.search).get('q') || '';
        setTimeout(() => window.dispatchEvent(new CustomEvent('explore:commit', { detail: q })), 60);
      }
      updateTitle(cleanPath(rawPath));
      return;
    }

    /* Boshqa foydalanuvchi profili: /u/<username> */
    if (route.kind === 'userprofile') {
      const uid = await uidByUsername(route.ref);
      if (!uid) return missing();
      if (uid === state.me.uid) {
        history.replaceState({ i: 0, prev: null }, '', '/profile' + tail);
        if (getCurrentRoute() !== 'profile' || threadOpen() || hasAnyOverlay()) navigateTo('profile', false);
        closeEverythingExcept(null);
        await closeThreadIfOpen();
        updateTitle('/profile');
        return;
      }
      if (initial && getCurrentRoute() !== 'home') navigateTo('home', false);
      closeEverythingExcept('userprofile');
      if (!(userProfileOpen() && state.currentViewingUserId === uid)) {
        const m = await import('./profile/profile.js');
        await m.openUserProfileModal(uid);
      }
      if (!userProfileOpen()) return deny();
      pickTab('#upGridTabs [data-up-tab]', 'upTab', route.tab || 'all');
      _replaceNext = true;
      updateTitle('/u/x');
      return;
    }

    /* Chat / guruh */
    if (route.kind === 'thread') {
      let ok = false, peerUid = null;
      if (route.thread === 'dm') {
        const uid = await uidByUsername(route.ref);
        peerUid = uid;
        if (!uid) return missing();
        if (uid === state.me.uid) {
          // O'ziga chat yo'q — o'z profiliga o'tamiz (havola hamma uchun ochiladi)
          history.replaceState({ i: 0, prev: null }, '', '/profile' + tail);
          return applyPath('/profile');
        }
        if (getCurrentRoute() !== 'chats') navigateTo('chats', false);
        closeEverythingExcept(route.profile ? 'userprofile' : null);
        if (!(threadOpen() && state.currentChatKind === 'dm' && state.currentChatUid === uid)) {
          await closeThreadIfOpen();
          const m = await import('./chat/chat.js');
          await m.openChatThread(uid);
        }
        ok = threadOpen();
      } else {
        const isInvite = HEX64_RE.test(route.ref);
        const gid = isInvite ? await gidByInvite(route.ref) : await groupIdByRef(route.ref);
        if (!gid) return missing();
        if (!isInvite && !(await ensureGroupMember(gid))) return deny();
        if (getCurrentRoute() !== 'chats') navigateTo('chats', false);
        closeEverythingExcept(null);
        if (!(threadOpen() && $('chatThreadModal')?.dataset?.gid === gid)) {
          await closeThreadIfOpen();
          const m = await import('./chat/groups.js');
          await m.openGroupThread(gid);
        }
        ok = threadOpen() && $('chatThreadModal')?.dataset?.gid === gid;
      }
      if (!ok) return deny();
      if (route.thread === 'dm' && route.profile && peerUid) {
        if (!(userProfileOpen() && state.currentViewingUserId === peerUid)) {
          const pm = await import('./profile/profile.js');
          await pm.openUserProfileModal(peerUid);
        }
      }
      if (route.thread === 'group' && route.info) {
        const gid = $('chatThreadModal')?.dataset?.gid;
        if (gid && !hasShow('grpInfoOverlay')) {
          const gm = await import('./chat/groups.js');
          gm.openGroupInfo(gid);
        }
      } else if (hasShow('grpInfoOverlay')) {
        $('grpInfoCloseBtn')?.click();
      }
      const mid = (location.hash.match(/^#m-(.+)$/) || [])[1];
      if (mid) scrollToMsg(mid);
      // URL ni haqiqiy username/id bilan to'g'rilab qo'yamiz
      _replaceNext = true;
      return;
    }
  } finally {
    _applying = false;
    _fromLogin = false;
    _suppressUntil = Date.now() + 150;
    schedule();
  }
}

/* ── Kirish holatini kuzatish ───────────────────────────────────────── */

function detectAuth() {
  let next = _auth;
  if ($('app')?.classList.contains('show') && state.me) next = 'in';
  else if ($('authWrap')?.classList.contains('show') && !$('app')?.classList.contains('show')) next = 'out';
  if (next === _auth) return;
  const prev = _auth;
  _auth = next;
  if (next === 'in') {
    _fromLogin = prev === 'out';
    // Kirish tugadi — joriy yo'l (yoki saqlangan manzil) ga ko'ra holatni o'rnatamiz
    applyPath(location.pathname, { initial: prev === 'unknown' });
  } else if (next === 'out') {
    if (prev === 'in') {
      history.replaceState({ i: 0, prev: null }, '', '/login');
      updateTitle('/login');
    } else {
      applyPath(location.pathname, { initial: true });
    }
  }
}

/* ── Init ───────────────────────────────────────────────────────────── */

export function initUrlRouter() {
  if (_inited) return;
  _inited = true;

  /* Kirmagan foydalanuvchi: history.pushState/replaceState orqali /login dan boshqa
     yo'lga o'tishga urinish bo'lsa — jimgina /login ga qaytariladi. */
  const _guardHistory = fn => function (st, title, url) {
    if (_auth === 'out' && url != null) {
      try {
        const u = new URL(url, location.href);
        if (u.origin === location.origin && cleanPath(u.pathname) !== '/login') {
          url = '/login' + u.search + u.hash;
        }
      } catch (_) { /* noto'g'ri URL — brauzerning o'zi xato beradi */ }
    }
    return fn.call(history, st, title, url);
  };
  history.pushState = _guardHistory(history.pushState);
  history.replaceState = _guardHistory(history.replaceState);

  /* #hash orqali ham authed sahifaga o'tib bo'lmaydi (kirmagan bo'lsa /login da qoladi) */
  window.addEventListener('hashchange', () => {
    if (_auth === 'out' && cleanPath(location.pathname) !== '/login') {
      history.replaceState({ i: 0, prev: null }, '', '/login');
    }
  });

  window.addEventListener('popstate', () => {
    if (_internalPop) { _internalPop = false; return; }
    if (_auth === 'unknown') return;
    if (_auth === 'out' && cleanPath(location.pathname) !== '/login') {
      history.replaceState({ i: 0, prev: null }, '', '/login');
      updateTitle('/login');
      return;
    }
    applyPath(location.pathname);
  });

  document.addEventListener('groupsUpdated', () => _gnameCache.clear());
  window.addEventListener('spacemr:route', schedule);

  const mo = new MutationObserver(() => { detectAuth(); schedule(); });
  mo.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class', 'data-gid', 'hidden'] });

  detectAuth();
}
