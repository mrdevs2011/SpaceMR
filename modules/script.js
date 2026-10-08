/**
 * MRdatabase v3 — main entry point.
 * Single Page Application - all views rendered from modules/
 */

import { state } from './core/config.js';
import { $ } from './core/utils.js';
import { setRenderCallbacks } from './auth/auth.js';
import { renderFeed, patchCounts } from './feed/feed.js';
import { renderProfile, renderUserProfileModal } from './profile/profile.js';
import { initRouter, navigateTo } from './router.js';
import { initUrlRouter } from './url-router.js';
import { initNavigation } from './ui/bar.js';
import './explore.js';
import './ui/emoji-dom.js';   // ekrandagi hamma emoji -> 2D PNG (post, izoh, story, bio, ism...)
import './ui/spacemr-group-chip.js'; // SpaceMR Group tugmasi (mobil header + desktop chap panel)

/* ── Splash: min 0.8s, max 2s; ma'lumot tayyor bo'lguncha kutadi ── */
const _splashT0 = Date.now();
const SPLASH_MIN_MS = 200;
const SPLASH_MAX_MS = 2000;
let _splashDone = false;

export function hideSplash(reason) {
  if (_splashDone) return;
  _splashDone = true;
  try { mark('splash-hide' + (reason ? ':' + reason : '')); } catch (_) {}
  const elapsed = Date.now() - _splashT0;
  const wait = Math.max(0, SPLASH_MIN_MS - elapsed);
  setTimeout(() => {
    $('splash')?.classList.add('out');
    setTimeout(() => {
      const splash = $('splash');
      if (splash) splash.style.display = 'none';
      const aw = document.getElementById('authWrap');
      if (aw) aw.style.display = '';
      /* Qora ekran qo'riqchisi: splash yopildi, lekin ilova ham, login ham ko'rinmadi va sessiya yo'q → loginni ochamiz */
      setTimeout(() => {
        try {
          const app = $('app');
          if (app?.classList.contains('show') || aw?.classList.contains('show')) return;
          const has = !!(localStorage.getItem('spacemr-auth') || localStorage.getItem('mrspace-auth'));
          if (!has && aw) { aw.classList.add('show'); aw.style.display = ''; }
        } catch (_) {}
      }, 1500);
    }, 350);
  }, wait);
  if (reason) console.debug('[splash] hide:', reason);
}

// Hech narsa kelmasa ham yopiladi (login ekrani / offline)
setTimeout(() => hideSplash('timeout'), SPLASH_MAX_MS);

// Boshqa modullar chaqirishi uchun
window.__spacemrHideSplash = hideSplash;
window.__mrspaceHideSplash = hideSplash;

/* ── Wire auth → render callbacks ────────────────────────────────────── */
setRenderCallbacks({
  renderFeed,
  renderProfile,
  renderUserProfileModal,
  patchCounts,
});

/* ── Router ──────────────────────────────────────────────────────────── */
initRouter();
initUrlRouter();

/* ── Navigation Bar ──────────────────────────────────────────────────── */
initNavigation();

/* ── Lazy-import modules ─────────────────────────────────────────────── */
import('./feed/upload.js');
import('./core/video-hold-speed.js');
import('./ui/shortcuts.js');
import('./ui/sidebar.js');
import('./ui/notifs.js');
import('./ui/right-rail.js');
import('./chat/chats-x.js');

/* ── iOS 27 Haptic — global touch feedback ── */
import { haptic, addHapticTouch } from './core/utils.js';
import { scheduleIdle, mark } from './core/perf.js';
import './ui/install-guide.js'; // yo'riqnoma (sozlamalar)

(function initGlobalHaptics() {
  // Nav buttons — select haptic
  document.querySelectorAll('.nav-btn').forEach(el => addHapticTouch(el, 'select'));

  // All primary/ghost/danger buttons — medium haptic
  document.addEventListener('pointerdown', e => {
    const btn = e.target.closest(
      '.btn-primary, .btn-ghost, .btn-danger, ' +
      '.hdr-icon-btn, .hdr-new-post-btn, .theme-btn, ' +
      '.like-btn, .cmt-like-btn, .post-share-btn, .link-btn, ' +
      '.sheet-close-btn, [data-haptic]'
    );
    if (!btn) return;
    const type = btn.dataset.haptic ||
      (btn.classList.contains('btn-danger') ? 'heavy' :
       btn.classList.contains('btn-primary') ? 'medium' : 'light');
    haptic[type]?.();
  }, { passive: true });

  // Like double-tap — success haptic (MutationObserver on like-btn.on)
  const likeObs = new MutationObserver(muts => {
    for (const m of muts) {
      if (m.target.classList.contains('on')) haptic.success();
    }
  });
  document.querySelectorAll('.like-btn').forEach(el =>
    likeObs.observe(el, { attributes: true, attributeFilter: ['class'] })
  );

  // Form submit success/error — hook into auth button
  const authBtn = document.getElementById('authBtn');
  if (authBtn) {
    authBtn.addEventListener('click', () => haptic.medium());
  }
})();


/* Past prioritet: birinchi interactiondan keyin og'ir modul preload */
scheduleIdle(() => {
  import('./chat/chat.js').catch(() => {});
  import('./call/call.js').catch(() => {});
}, 2500);
