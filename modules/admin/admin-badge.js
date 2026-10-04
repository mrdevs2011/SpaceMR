/**
 * SpaceMR — Admin Badge (real-vaqt bildirishnoma)
 * Bottom-nav'dagi "Boshqaruv" (Actions) tugmasida — admin boshqa
 * bo'limda bo'lsa ham — yangi pending foydalanuvchi paydo bo'lganda
 * qizil badge ko'rsatadi.
 */

import { sb } from '../core/config.js';

let _pendingUnsub = null;
let _pendingCount = 0;
let _running      = false;

function _paint(id) {
  const badge = document.getElementById(id);
  if (!badge) return;
  const total = _pendingCount;
  if (total > 0) {
    badge.textContent = total > 99 ? '99+' : String(total);
    badge.classList.remove('d-none');
  } else {
    badge.textContent = '';
    badge.classList.add('d-none');
  }
}
function _updateBadge() {
  _paint('adminActionsBadge');
  _paint('hdrAdminBadge');
}

/** Admin tasdiqlangandan keyin bir marta chaqiriladi (idempotent) */
export function initAdminBadge() {
  if (_running) return; // allaqachon ishlamoqda — qayta ulamaymiz
  _running = true;

  let dead = false, timer = null;
  const recount = async () => {
    try {
      const { count, error } = await sb.from('profiles')
        .select('id', { count: 'exact', head: true }).eq('approval', 'pending');
      if (error || dead) return;
      _pendingCount = count || 0;
      _updateBadge();
    } catch (e) { console.warn('[admin-badge]', e?.message || e); }
  };
  const schedule = ev => { clearTimeout(timer); timer = setTimeout(recount, ev === 'UPDATE' ? 3000 : 300); };
  recount();
  const ch = sb.channel('admin-badge')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, p => schedule(p.eventType))
    .subscribe();
  _pendingUnsub = () => { dead = true; clearTimeout(timer); sb.removeChannel(ch); };
}

/** Admin bo'lmagan foydalanuvchi kirsa yoki chiqib ketsa to'xtatiladi */
export function destroyAdminBadge() {
  if (_pendingUnsub) { _pendingUnsub(); _pendingUnsub = null; }
  _pendingCount = 0;
  _running      = false;
  ['adminActionsBadge', 'hdrAdminBadge'].forEach((id) => {
    const badge = document.getElementById(id);
    if (badge) { badge.textContent = ''; badge.classList.add('d-none'); }
  });
}
