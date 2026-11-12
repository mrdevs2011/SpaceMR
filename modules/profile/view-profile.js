/**
 * MRdatabase — Profil View Controller
 * Handles profile rendering and profile view specific logic
 */

import { state } from '../core/config.js';
import { renderProfile } from './profile.js';

let _authTimer = null;

export function initView() {
  if (state.me) {
    renderProfile();
    return;
  }
  if (_authTimer) clearInterval(_authTimer);
  let n = 0;
  _authTimer = setInterval(() => {
    n++;
    if (state.view !== 'profile') { clearInterval(_authTimer); _authTimer = null; return; }
    if (state.me) {
      clearInterval(_authTimer);
      _authTimer = null;
      renderProfile();
    } else if (n >= 15) {
      clearInterval(_authTimer);
      _authTimer = null;
    }
  }, 200);
}

export function destroyView() {
  if (_authTimer) { clearInterval(_authTimer); _authTimer = null; }
  // Profile scroll listener'ni tozalash
  window.onscroll = null;
}
