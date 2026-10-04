/**
 * admin-gate.js — admin parol oynasi (markazda, klassik modal).
 * Admin paneliga har kirishda va xavfli amallardan oldin so'raladi.
 * Tekshiruv serverda: RPC admin_verify_password (059 migratsiya).
 */
import { sb, state } from '../core/config.js';

let _open = null; // bir vaqtda faqat bitta oyna

/** Ochiq oynani bekor qilib yopadi (sahifadan chiqilganda) */
export function closeAdminGate() { _open?.cancel(); }

function build({ title, sub, okLabel, danger }) {
  const wrap = document.createElement('div');
  wrap.className = 'adm-gate';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  wrap.innerHTML = `
    <form class="adm-gate-card" novalidate>
      <div class="adm-gate-title"></div>
      <div class="adm-gate-sub"></div>
      <input class="field" type="password" name="p" placeholder="Admin paroli" autocomplete="current-password">
      <div class="adm-gate-err" aria-live="polite"></div>
      <div class="adm-gate-actions">
        <button type="button" class="adm-gate-btn adm-gate-cancel">Bekor qilish</button>
        <button type="submit" class="adm-gate-btn adm-gate-ok"></button>
      </div>
    </form>`;
  wrap.querySelector('.adm-gate-title').textContent = title;
  wrap.querySelector('.adm-gate-sub').textContent = sub || '';
  const ok = wrap.querySelector('.adm-gate-ok');
  ok.textContent = okLabel || 'Kirish';
  if (danger) ok.classList.add('is-danger');
  return wrap;
}

/**
 * Admin parolini so'raydi (username joriy profildan olinadi) va serverda tekshiradi.
 * @returns {Promise<string|null>} to'g'ri parol (keyingi RPC uchun) yoki null (bekor qilindi)
 */
export function askAdmin({ title = 'Admin paneli', sub = 'Davom etish uchun admin parolini kiriting.', okLabel = 'Kirish', danger = false } = {}) {
  if (_open) _open.cancel();
  return new Promise(resolve => {
    const el = build({ title, sub, okLabel, danger });
    const form = el.querySelector('form');
    const p = form.elements.p;
    const err = el.querySelector('.adm-gate-err');
    const okBtn = el.querySelector('.adm-gate-ok');

    const finish = (val) => {
      document.removeEventListener('keydown', onKey, true);
      el.remove();
      _open = null;
      resolve(val);
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); finish(null); } };
    _open = { cancel: () => finish(null) };

    el.querySelector('.adm-gate-cancel').onclick = () => finish(null);
    form.onsubmit = async (e) => {
      e.preventDefault();
      err.textContent = '';
      if (!p.value) { err.textContent = 'Parolni kiriting.'; return; }
      okBtn.disabled = true;
      try {
        const { data, error } = await sb.rpc('admin_verify_password', { p_username: state.me?.username || '', p_password: p.value });
        if (error) throw error;
        if (data === true) { finish(p.value); return; }
        err.textContent = 'Parol noto\'g\'ri.';
        p.value = ''; p.focus();
      } catch (ex) {
        err.textContent = /admin_verify_password/.test(ex?.message || '')
          ? 'Serverda 059 migratsiya ishga tushirilmagan.'
          : 'Tekshirib bo\'lmadi: ' + (ex?.message || 'xato');
      } finally {
        okBtn.disabled = false;
      }
    };

    document.addEventListener('keydown', onKey, true);
    document.body.appendChild(el);
    setTimeout(() => p.focus(), 30);
  });
}
