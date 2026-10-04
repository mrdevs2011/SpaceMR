// test 5: diff uchun izoh
/**
 * MRdatabase — Client-side Router
 * Single Page Application router
 * Barchasi views rendered from modules/, no separate folders needed
 */

import { state } from './core/config.js';
import { $ } from './core/utils.js';

/* ═══════════════════════════════════════════════════════════════════════
   ROUTE CONFIGURATION
   Barchasi routes open at root (/) - no subpaths
   ═══════════════════════════════════════════════════════════════════════ */

const routes = {
  'home': {
    view: 'homeView',
    title: 'Bosh sahifa'
  },
  'profile': {
    view: 'profileView',
    title: 'Profil'
  },
  'chats': {
    view: 'chatsView',
    title: 'Suhbatlar'
  },
  'login': {
    view: 'loginView',
    title: 'Kirish'
  },
  'actions': {
    view: 'actionsView',
    title: 'Boshqaruv'
  },
  'saved': {
    view: 'savedView',
    title: 'Saqlanganlar'
  }
};

// Allowed route names for security
const ALLOWED_ROUTES = ['home', 'profile', 'chats', 'login', 'actions', 'saved'];

/* ═══════════════════════════════════════════════════════════════════════
   CURRENT STATE
   ═══════════════════════════════════════════════════════════════════════ */

let currentRoute = 'home';
let isInitialized = false;

/* ═══════════════════════════════════════════════════════════════════════
   NAVIGATE FUNCTION
   Barchasi routes at root (/) - no subpaths
   ═══════════════════════════════════════════════════════════════════════ */

export function navigateTo(routeName, pushState = true) {
  const route = routes[routeName];
  if (!route) {
    console.error('Manzil topilmadi:', routeName);
    return;
  }

  // URL ni url-router.js boshqaradi (holat -> URL sinxronlash, 'spacemr:route' hodisasi orqali)

  // Navigatsiya vaqtida barcha ochiq modal/overlay/panel larni yopamiz
  const modalsToClose = [
    // Profile & content
    'userProfileModal',
    'detailModal',
    // Chat & group threadlar
    'chatThreadModal',
    // Comments
    'cmtModal',
    // Upload
    'uploadOverlay',
    // Settings (fullscreen page / right-rail)
    'settingsOverlay',
    // Zoom
    'zoomModal',
    // Confirm dialog
    'confirmOverlay',
    // Group overlaylar
    'grpAddUserOverlay',
    'grpCreateFormOverlay',
    'grpInfoOverlay',
    'grpEditOverlay',
    // Search panel
    'sbSearchPanel',
    'searchOverlay',
  ];
  modalsToClose.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.remove('show', 'open');
  });
  // Call modallarini yopmaymiz — qo'ng'iroq davom etishi mumkin
  // chatThread yopilganda call buttonlarni tiklаymiz (group ochilganda yashirilgan bo'lishi mumkin)
  ['chatVoiceCallBtn','chatVideoCallBtn'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = '';
  });
  // chatThread state ni tozalaymiz
  if (state.currentChatKind && state.currentChatKind !== 'dm') {
    // group thread unsub ni async import orqali tozalaymiz
    import('./chat/groups.js').then(m => { try { m.closeGroupThread(); } catch(_){} }).catch(()=>{});
  }
  state.currentChatUid  = null;
  state.currentChatId   = null;
  state.currentChatKind = null;
  // userProfile state ni tozalaymiz
  if (state.currentViewingUserId) {
    state.currentViewingUserId    = null;
    state.currentViewingUserPosts = [];
  }
  // Scroll lock ni ham tozalaymiz
  document.body.style.overflow = '';
  document.documentElement.style.overflow = '';

  // Switch view (prevRoute'ni async destroy uchun saqlaymiz)
  switchView(currentRoute, routeName);

  // Update state — switchView chaqiruvidan KEYIN (destroyView uchun prev kerak)
  currentRoute = routeName;
  state.view = routeName;

  // Update document title
  if (!document.documentElement.hasAttribute('data-nf')) document.title = `${route.title} - SpaceMR`;

  // Update nav UI
  updateNavUI(routeName);

  // Scroll to top
  window.scrollTo({ top: 0, behavior: 'auto' });

  // URL sinxronlashtirilsin
  window.dispatchEvent(new Event('spacemr:route'));
}

/* ═══════════════════════════════════════════════════════════════════════
   SWITCH VIEW
   ═══════════════════════════════════════════════════════════════════════ */

async function switchView(prevRoute, routeName) {
  // Validate route name for security
  if (!ALLOWED_ROUTES.includes(routeName)) {
    console.error('Noto\'g\'ri manzil:', routeName);
    routeName = 'home';
  }

  // Destroy previous view (cleanup listeners, intervals, etc.)
  if (prevRoute && prevRoute !== routeName) {
    try {
      const prevController = await import(`./profile/view-${prevRoute}.js`);
      if (prevController.destroyView) {
        prevController.destroyView();
      }
    } catch (_) { /* eski view controller bo'lmasa — muammo emas */ }
  }

  // Hide all views
  document.querySelectorAll('.view').forEach(el => {
    el.classList.remove('on');
  });

  // Show target view — rAF orqali fade animatsiyasi ishlaydi (display:none -> block -> opacity)
  const targetView = $(`${routeName}View`);
  if (targetView) {
    // display:none holidan chiqarish uchun bir frame kutamiz, so'ng .on qo'shamiz
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        targetView.classList.add('on');
      });
    });
  }

  // Import and initialize view controller dynamically
  try {
    const controller = await import(`./profile/view-${routeName}.js`);
    if (controller.initView) {
      controller.initView();
    }
  } catch (err) {
    console.error(`Failed to load view controller for ${routeName}:`, err);
  }

  // Update header/sidebar visibility
  updateLayoutForRoute(routeName);

  // Hide navigation on login view
  const botNav = document.querySelector('.bot-nav');
  if (botNav) {
    botNav.style.display = routeName === 'login' ? 'none' : '';
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   UPDATE NAV UI
   ═══════════════════════════════════════════════════════════════════════ */

function updateNavUI(routeName) {
  // Update mobile bottom nav
  document.querySelectorAll('.bot-nav .nav-btn[data-v]').forEach(btn => {
    const isActive = btn.dataset.v === routeName;
    btn.classList.toggle('on', isActive);
  });

  // Update desktop sidebar (if exists)
  document.querySelectorAll('.sb-nav .nav-btn[data-v]').forEach(btn => {
    const isActive = btn.dataset.v === routeName;
    btn.classList.toggle('on', isActive);
  });
}

/* ═══════════════════════════════════════════════════════════════════════
   UPDATE LAYOUT FOR ROUTE
   ═══════════════════════════════════════════════════════════════════════ */

function updateLayoutForRoute(routeName) {
  const isActions = routeName === 'actions';

  // Header mobil/planshetda har tabda ochiq. Desktopda CSS yashiradi.
  const appHdr = $('appHdr');
  if (appHdr) appHdr.classList.remove('force-hide');

  const hdrSearchWrap  = $('hdrSearchWrap');
  const hdrSearchBtn   = $('hdrSearchBtn');
  const sbSearchToggle = $('sbSearchToggle');

  // Tooltip ni yangilaymiz (DOM strukturasiga tegmaymiz)
  const label = 'Kashf';
  if (hdrSearchBtn)   { hdrSearchBtn.setAttribute('aria-label', label); hdrSearchBtn.title = label; }
  if (sbSearchToggle) { sbSearchToggle.setAttribute('data-tip', label); }

  // Mobile: hdr search wrap ko'rinishi (actions va login da yashiriladi)
  if (hdrSearchWrap) {
    const hideSearch = routeName === 'actions' || routeName === 'login';
    hdrSearchWrap.classList.toggle('search-hidden', hideSearch);
  }

  // Desktop sbSearchToggle — har doim o'z joyida; bosilganda Explore qidiruv sahifasi ochiladi

  // Joriy aktiv route ni saqlаymiz — click handlerlar shu o'zgaruvchidan o'qiydi
    _activeRoute = routeName;

  // Right rail: faqat home/profile da
  import('./ui/right-rail.js').then(m => m.onRouteChange?.()).catch(() => {});
}

/** Joriy aktiv tab — search handlerlar shu orqali qaror qiladi */
let _activeRoute = 'home';

/** Bir marta bind qilinadi (initRouter da), tab o'zgarganda DOM ga tegmaymiz */
function _initSearchHandlers() {
  const hdrSearchBtn  = $('hdrSearchBtn');
  const sbSearchToggle = $('sbSearchToggle');

  function handleSearchClick(e) {
    e.stopPropagation();
    // Leftbar/header qidiruv — HAR DOIM alohida Explore/qidiruv sahifasini ochadi.
    // Tabga (chats/profile/home) bog'liq emas, suhbat inputini fokuslamaydi.
    const overlay = document.getElementById('searchOverlay');
    if (!overlay) return;
    if (overlay.classList.contains('open')) {
      overlay.classList.remove('open');
      sbSearchToggle?.classList.remove('search-active');
      hdrSearchBtn?.classList.remove('search-active');
      const si = document.getElementById('searchInput');
      if (si) si.value = '';
    } else {
      overlay.classList.add('open');
      sbSearchToggle?.classList.add('search-active');
      hdrSearchBtn?.classList.add('search-active');
      setTimeout(() => document.getElementById('searchInput')?.focus(), 60);
    }
    import('./ui/right-rail.js').then(m => m.onRouteChange?.()).catch(() => {});
  }

  if (hdrSearchBtn)   hdrSearchBtn.addEventListener('click', handleSearchClick);
  if (sbSearchToggle) sbSearchToggle.addEventListener('click', handleSearchClick);
}

/** Profile view da qidiruv inputini ochadi/yopadi */
function _toggleProfileSearch() {
  let wrap = document.getElementById('profileSearchWrap');
  if (!wrap) {
    // Birinchi marta — yaratamiz
    wrap = document.createElement('div');
    wrap.id = 'profileSearchWrap';
    wrap.style.cssText = [
      'display:flex', 'align-items:center', 'gap:8px',
      'margin:8px 16px 4px', 'padding:9px 14px',
      'background:var(--bg4,rgba(255,255,255,0.06))',
      'border:1.5px solid var(--line,rgba(255,255,255,0.10))',
      'border-radius:14px',
    ].join(';');
    wrap.innerHTML = `
      <img src="./svg/action/search-overlay.svg" alt="" class="icon" width="14" height="14" style="flex-shrink:0;opacity:.5">
      <input id="profileSearchInput" placeholder="Postlarni qidirish..."
        autocomplete="off" spellcheck="false"
        style="flex:1;min-width:0;background:transparent;border:none;outline:none;color:var(--text);font-size:14px">
      <button id="profileSearchClose" style="background:none;border:none;cursor:pointer;color:var(--text3);padding:0;display:flex;align-items:center">
        <img src="./svg/action/close.svg" alt="" class="icon" width="14" height="14">
      </button>`;

    // profileGrid tepasiga joylashtir
    const gridHdr = document.querySelector('.profile-grid-hdr');
    if (gridHdr) gridHdr.insertAdjacentElement('afterend', wrap);

    // Input event — profileGrid ni filter qiladi
    const inp = wrap.querySelector('#profileSearchInput');
    inp?.addEventListener('input', () => {
      const q = (inp.value || '').toLowerCase().trim();
      document.querySelectorAll('.profile-grid .post-card, .profile-grid .grid-item').forEach(card => {
        const txt = (card.dataset.caption || card.dataset.text || card.textContent || '').toLowerCase();
        card.style.display = (!q || txt.includes(q)) ? '' : 'none';
      });
    });

    // Close button
    wrap.querySelector('#profileSearchClose')?.addEventListener('click', () => {
      wrap.remove();
      // Filterni tozalash
      document.querySelectorAll('.profile-grid .post-card, .profile-grid .grid-item').forEach(c => c.style.display = '');
    });

    wrap.querySelector('#profileSearchInput')?.focus();
  } else {
    // Ikkinchi bosishda yopadi
    wrap.remove();
    document.querySelectorAll('.profile-grid .post-card, .profile-grid .grid-item').forEach(c => c.style.display = '');
  }
}

/* ═══════════════════════════════════════════════════════════════════════
   HANDLE BROWSER BACK/FORWARD
   ═══════════════════════════════════════════════════════════════════════ */

function handlePopState(event) {
  const routeName = event.state?.route || 'home';
  navigateTo(routeName, false);
}

/* ═══════════════════════════════════════════════════════════════════════
   INIT ROUTER
   ═══════════════════════════════════════════════════════════════════════ */

export function initRouter() {
  if (isInitialized) return;
  isInitialized = true;


  // Brauzer back/forward — url-router.js boshqaradi

  // Handle link clicks
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a');
    if (!link) return;

    const href = link.getAttribute('href');
    if (!href || href.startsWith('http') || href.startsWith('//') || href.startsWith('#')) {
      return;
    }

    // Check if it's a known route name (not a path)
    const routeName = href.replace('/', '');
    if (ALLOWED_ROUTES.includes(routeName)) {
      e.preventDefault();
      navigateTo(routeName);
    }
  });

  // Handle nav button clicks
  document.querySelectorAll('.nav-btn[data-v]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      navigateTo(btn.dataset.v);
    });
  });

  // Admin tab visibility
  applyAdminNav();

  // Search btn handlers — bir marta bind qilinadi, tab o'zgarganda DOM ga tegmaydi
  _initSearchHandlers();

  // Boshlang'ich tab URL yo'lidan (auth tugagach url-router.js to'liq tekshiradi: huquq, overlay, chat)
  const seg0 = (window.location.pathname.split('/').filter(Boolean)[0] || '').toLowerCase();
  const routeName = (seg0 === 'chats' || seg0 === 'profile' || seg0 === 'home') ? seg0
    : (seg0 === 'settings' ? 'profile' : 'home');
  navigateTo(routeName, false);
}

/* ═══════════════════════════════════════════════════════════════════════
   EXPORTS
   ═══════════════════════════════════════════════════════════════════════ */

export function getCurrentRoute() {
  return currentRoute;
}

export function getRoutePath(routeName) {
  return routes[routeName]?.path || '/';
}

/** Admin navbat tugmalarini ko'rsatish/yashirish */
export function applyAdminNav() {
  const isAdmin = !!state.me?.isAdmin;
  // Eski tugmalar (agar qolgan bo'lsa)
  const adminBtn = $('adminUsersNavBtn');
  if (adminBtn) adminBtn.classList.toggle('d-none', !isAdmin);
  // Yangi birlashtirilgan actions tugma
  const actionsBtn = $('adminActionsNavBtn');
  if (actionsBtn) actionsBtn.classList.toggle('d-none', !isAdmin);
  const hdrAdmin = $('hdrAdminBtn');
  if (hdrAdmin) hdrAdmin.classList.toggle('d-none', !isAdmin);

  // Real-vaqt bildirishnoma badge (faqat admin uchun)
  import('./admin/admin-badge.js').then(m => {
    if (isAdmin) m.initAdminBadge(); else m.destroyAdminBadge();
  }).catch(() => {});
}
