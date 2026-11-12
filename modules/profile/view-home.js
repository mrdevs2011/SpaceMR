/**
 * MRdatabase — Bosh sahifa View Controller
 * Handles feed rendering and home view specific logic
 */

import { state } from '../core/config.js';
import { renderFeed, setupPullToRefresh, setupFeedScrollSensitivity } from '../feed/feed.js';
import { initStories, loadStories } from '../feed/stories.js';
import { navigateTo } from '../router.js';

let _homeReady = false;
let _authTimer = null;

export function initView() {

  // Pull-to-refresh va scroll sensitivity faqat bir marta o'rnatiladi
  if (!_homeReady) {
    setupPullToRefresh();
    setupFeedScrollSensitivity();
    document.getElementById('hdrSavedBtn')?.addEventListener('click', () => navigateTo('saved'));
    _homeReady = true;
  }

  // Feed + stories — me hali kelmagan bo'lsa ham keyinroq uriniladi
  const boot = () => {
    if (state.view !== 'home' || !state.me) return false;
    state.visibleN = 10;
    initStories();
    renderFeed();
    return true;
  };
  if (!boot()) {
    if (_authTimer) clearInterval(_authTimer);
    let n = 0;
    _authTimer = setInterval(() => {
      n++;
      if (state.view !== 'home') { clearInterval(_authTimer); _authTimer = null; return; }
      if (boot() || n >= 15) { clearInterval(_authTimer); _authTimer = null; }
    }, 200);
  }
}

export function destroyView() {
  if (_authTimer) { clearInterval(_authTimer); _authTimer = null; }
  // Scroll listener'ni o'chirish — boshqa view'da trigger bo'lmasin
  window.onscroll = null;
}
