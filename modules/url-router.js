/**
 * SpaceMR — URL router (path asosida).
 *
 *   /login                 kirish
 *   /home                  bosh sahifa (sayt ochilganda doim shu)
 *   /chats                 suhbatlar
 *   /chats/u/<username>    shaxsiy chat
 *   /chats/g/<groupId>     guruh chati (group_username ham qabul qilinadi; a'zo bo'lmagan ochiq guruhga avtomatik qo'shiladi)
 *   /chats/groupcreate     "Yangi guruh" formasi
 *   /u/<username>          boshqa foydalanuvchi profili (hamma uchun ochiladi; o'zi ochsa /profile)
 *   /profile               profil
 *   /profile/settings      sozlamalar (/settings → shu yerga)
 *   /explore               qidiruv (Explore)
 *   /newpost               yangi post oynasi
 *   /actions               admin boshqaruvi (faqat admin)
 *   /saved                 saqlangan postlar
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

const VIEW_PATH = { home: '/home', chats: '/chats', profile: '/profile', actions: '/actions', saved: '/saved' };
const NEXT_KEY = 'spacemr_next_path';
const LAST_KEY = 'spacemr_last_path'; // kirgan foydalanuvchining oxirgi joyi (/login yozsa shu yerga qaytadi)
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
    if (a === 'settings') return { kind: 'redirect', to: '/profile/settings' };
    if (a === 'explore')  return { kind: 'overlay', overlay: 'explore', base: 'home' };
    if (a === 'newpost')  return { kind: 'overlay', overlay: 'newpost', base: 'home' };
  }
  if (a === 'profile' && b === 'settings' && (seg.length === 2 || seg.length === 3)) {
    const sec = (seg[2] || '').toLowerCase();
    if (seg.length === 3 && !['general', 'email', 'password'].includes(sec)) return { kind: 'notfound' };
    return { kind: 'overlay', overlay: 'settings', base: 'profile', section: sec || null };
  }
  if (a === 'u' && seg.length === 2 && seg[1]) {
    return { kind: 'userprofile', ref: seg[1] };
  }
  if (a === 'chats' && seg.length === 2 && b === 'groupcreate') {
    return { kind: 'overlay', overlay: 'groupcreate', base: 'chats' };
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
    const { data, error } = await sb.from('groups').select('id').ilike('group_username', ref).maybeSingle();
    if (error) { _lookupFailed = true; return null; }
    return data?.id || null;
  } catch (_) { _lookupFailed = true; return null; }
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

/* ── Holat -> URL ───────────────────────────────────────────────────── */

/** Hozirgi holatga mos URL. null = hali aniq emas (kutamiz). */
function computeUrl() {
  if (_auth === 'out') return '/login';
  if (_auth !== 'in') return null;

  const gc = $('grpCreateFormOverlay');
  if (gc?.classList.contains('show') && !gc.dataset.addMode) return '/chats/groupcreate';

  if (userProfileOpen()) {
    const t = dmToken(state.currentViewingUserId);
    return t ? `/u/${encodeURIComponent(t)}` : null;
  }

  if (hasShow('settingsOverlay')) {
    const open = document.querySelector('#settingsOverlay .pe-accordion.open');
    const key = open && open.getAttribute('data-pe-acc');
    const sec = { basic: 'general', email: 'email', password: 'password' }[key];
    return sec ? '/profile/settings/' + sec : '/profile/settings';
  }

  if (hasShow('uploadOverlay')) return '/newpost';
  if (hasShow('searchOverlay', 'open')) return '/explore';

  if (threadOpen()) {
    const modal = $('chatThreadModal');
    if (state.currentChatKind === 'dm' && state.currentChatUid) {
      const t = dmToken(state.currentChatUid);
      return t ? `/chats/u/${encodeURIComponent(t)}` : null;
    }
    if (modal?.dataset?.gid) return `/chats/g/${encodeURIComponent(modal.dataset.gid)}`;
    return null;
  }

  return VIEW_PATH[getCurrentRoute()] || '/home';
}

function setUrl(target, { replace = false } = {}) {
  const cur = location.pathname;
  if (target === cur) return;
  const st = history.state || {};
  const tail = location.search + location.hash;
  if (!replace && st.prev === target) {
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
  const t = TITLES[path] || (path.startsWith('/chats/') ? 'Suhbatlar' : (path.startsWith('/u/') ? 'Profil' : null));
  if (t) document.title = `${t} - SpaceMR`;
}

/* ── URL -> holat ───────────────────────────────────────────────────── */

function hasAnyOverlay() {
  return (hasShow('settingsOverlay') && !settingsPinned())
    || hasShow('uploadOverlay') || hasShow('searchOverlay', 'open')
    || (hasShow('grpCreateFormOverlay') && !$('grpCreateFormOverlay').dataset.addMode);
}

function closeEverythingExcept(keep) {
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
    if (route.kind === 'notfound') return notFound();

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
      _replaceNext = true;
      updateTitle('/u/x');
      return;
    }

    /* Chat / guruh */
    if (route.kind === 'thread') {
      let ok = false;
      if (route.thread === 'dm') {
        const uid = await uidByUsername(route.ref);
        if (!uid) return missing();
        if (uid === state.me.uid) {
          // O'ziga chat yo'q — o'z profiliga o'tamiz (havola hamma uchun ochiladi)
          history.replaceState({ i: 0, prev: null }, '', '/profile' + tail);
          return applyPath('/profile');
        }
        if (getCurrentRoute() !== 'chats') navigateTo('chats', false);
        closeEverythingExcept(null);
        if (!(threadOpen() && state.currentChatKind === 'dm' && state.currentChatUid === uid)) {
          await closeThreadIfOpen();
          const m = await import('./chat/chat.js');
          await m.openChatThread(uid);
        }
        ok = threadOpen();
      } else {
        const gid = await groupIdByRef(route.ref);
        if (!gid) return missing();
        if (!(await ensureGroupMember(gid))) return deny();
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

  window.addEventListener('spacemr:route', schedule);

  const mo = new MutationObserver(() => { detectAuth(); schedule(); });
  mo.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class', 'data-gid'] });

  detectAuth();
}
