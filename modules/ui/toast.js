/**
 * Toast bildirishnomalari — foydalanuvchiga faqat tushunarli, aniq o'zbekcha matn.
 * Texnik tafsilot (Failed to fetch, e.message, SQL) hech qachon ekranga chiqmaydi.
 */
let _toastTimer = null;

import { friendly, isTechnical } from '../core/friendly-error.js';

function _logTech(raw) {
  try {
    import('../core/error-log.js').then(m => m?.logError?.(raw, 'toast')).catch(() => {});
  } catch (_) {}
  try { console.warn('[toast]', raw); } catch (_) {}
}

export function toast(msg, type = 'info', dur = 2400) {
  const raw = String(msg || '').trim();
  if (!raw) return;

  let displayMsg = raw;
  let toastType = type || 'info';

  // Texnik gap (Supabase, Storage, HTTP, SQL...) hech qachon ekranga chiqmaydi
  const rawEnglishErr = toastType === 'error' && /error|exception|fail/i.test(raw) && !/[a-z]'/i.test(raw);
  if (isTechnical(raw) || rawEnglishErr) {
    displayMsg = friendly(isTechnical(raw) ? raw : 'xato: failed');
    toastType = 'error';
    _logTech(raw);
  }

  const el = document.getElementById('toast');
  if (!el) {
    console.warn('[toast]', raw);
    return;
  }
  el.textContent = displayMsg;
  el.className = `toast-${toastType} show`;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    el.classList.remove('show');
  }, Math.max(800, dur | 0));
}
