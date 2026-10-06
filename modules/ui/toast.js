/**
 * Toast bildirishnomalari — #toast elementi + CSS (layers.css / mono-x.css).
 * @param {string} msg
 * @param {'success'|'error'|'info'|'warning'|''} [type]
 * @param {number} [dur] ms
 */
let _toastTimer = null;

export function toast(msg, type = '', dur = 2200) {
  const el = document.getElementById('toast');
  if (!el) {
    if (type === 'error') console.warn('[toast]', msg);
    return;
  }
  el.textContent = String(msg || '');
  el.className = type ? `toast-${type} show` : 'show';
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    el.classList.remove('show');
  }, Math.max(800, dur | 0));
}
