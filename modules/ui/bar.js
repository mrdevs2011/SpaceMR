// test 2: diff uchun izoh
/**
 * MRdatabase — Navigation Bar Controller
 * Single source of truth for sidebar/bottom navigation
 * Fixed navigation that persists across all views
 */

import { state } from '../core/config.js';
import { $ } from '../core/utils.js';

/* ═══════════════════════════════════════════════════════════════════════
   NAVIGATION STATE
   ═══════════════════════════════════════════════════════════════════════ */

let currentView = 'home';

/* ═══════════════════════════════════════════════════════════════════════
   NAV BUTTON CLICK HANDLER
   ═══════════════════════════════════════════════════════════════════════ */

function handleNavClick(viewName) {
  const path = { home: '/home', explore: '/explore', notifs: '/notifications', chats: '/chats', apps: '/apps', saved: '/saved', profile: '/profile', actions: '/actions' }[viewName] || '/home';
  if (location.pathname !== path) {
    const st = history.state || {};
    history.pushState({ i: (st.i || 0) + 1, prev: location.pathname }, '', path);
  }
  import('../url-router.js').then(m => m.applyPath(path)).catch(() => import('../router.js').then(r => r.navigateTo(viewName, false)));
}

/* ═══════════════════════════════════════════════════════════════════════
   UPDATE ACTIVE STATE
   ═══════════════════════════════════════════════════════════════════════ */

export function updateActiveNav(viewName) {
  currentView = viewName;

  // Update mobile bottom nav
  document.querySelectorAll('.bot-nav .nav-btn[data-v]').forEach(btn => {
    const isActive = btn.dataset.v === viewName;
    btn.classList.toggle('on', isActive);
  });

  // Update desktop sidebar nav
  document.querySelectorAll('.sb-nav .nav-btn[data-v]').forEach(btn => {
    const isActive = btn.dataset.v === viewName;
    btn.classList.toggle('on', isActive);
  });
}

/* ═══════════════════════════════════════════════════════════════════════
   MANUAL NAVIGATION TRIGGER
   ═══════════════════════════════════════════════════════════════════════ */

export async function navigate(viewName) {
  await handleNavClick(viewName);
}

/* ═══════════════════════════════════════════════════════════════════════
   INIT NAVIGATION
   ═══════════════════════════════════════════════════════════════════════ */

let _navReady = false;
export function initNavigation() {
  if (_navReady) return;
  _navReady = true;

  // Note: nav-btn[data-v] click handlers are registered by router.js initRouter()
  // Do NOT add duplicate listeners here.

  // Logo (desktop sidebar) → home
  const sbLogoBtn = document.getElementById('sbLogoBtn');
  if (sbLogoBtn) {
    sbLogoBtn.addEventListener('click', () => handleNavClick('home'));
  }

  // Yaratish button (center)
  const createBtn = document.querySelector('.nav-center-btn');
  if (createBtn) {
    createBtn.addEventListener('click', (e) => {
      e.preventDefault();
      import('../feed/upload.js').then(m => m.openComposer?.()).catch(() => {
        const uploadOverlay = $('uploadOverlay');
        if (uploadOverlay) {
          uploadOverlay.classList.add('show');
          setTimeout(() => $('captionInput')?.focus(), 100);
        }
      });
    });
  }

  // Qidiruv toggle — router.js/_initSearchHandlers boshqaradi (bu yerda ikkinchi handler bo'lsa,
  // bittasi ochib, ikkinchisi darhol yopib qo'yardi).

  // Theme toggle o'chirilgan — faqat dark theme qo'llab-quvvatlanadi

  // Note: Initial nav state is handled by router.js
}

/* ═══════════════════════════════════════════════════════════════════════
   EXPORT CURRENT VIEW
   ═══════════════════════════════════════════════════════════════════════ */

export function getCurrentView() {
  return currentView;
}

/* ═══════════════════════════════════════════════════════════════════════
   AUTO-INIT
   ═══════════════════════════════════════════════════════════════════════ */

// Wait for DOM to be ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initNavigation);
} else {
  initNavigation();
}
