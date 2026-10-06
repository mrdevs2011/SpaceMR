/** admin-force-reload.js — "Update All users" tugmasi */
import { toast } from '../ui/toast.js';
import { showConfirm } from '../core/utils.js';
import { adminTriggerForceReload } from '../core/force-reload.js';

export function renderForceReloadBtn(anchor) {
  if (!anchor || document.getElementById('admForceReloadBtn')) return;

  const row = document.createElement('div');
  row.className = 'adm-force-row';
  row.innerHTML = `
    <div class="adm-force-text">
      <div class="adm-force-title">Update All users</div>
      <div class="adm-force-hint">Barcha foydalanuvchilarga hard refresh. Online — darhol; offline — keyingi kirishda.</div>
    </div>
    <button type="button" class="adm-force-btn" id="admForceReloadBtn">Update All</button>`;

  if (anchor.id === 'admSystemMount') anchor.appendChild(row);
  else anchor.appendChild(row);

  const btn = row.querySelector('#admForceReloadBtn');
  btn.addEventListener('click', () => {
    showConfirm(
      'Barcha userlar uchun hard refresh yuboriladi. Online userlar darhol yangilanadi. Davom etasizmi?',
      async () => {
        btn.disabled = true;
        const prev = btn.textContent;
        btn.textContent = 'Yuborilmoqda…';
        try {
          const v = await adminTriggerForceReload();
          toast('Update yuborildi (v' + String(v).slice(-6) + ')', 'success');
        } catch (e) {
          toast('Xato: ' + (e?.message || e), 'error');
        } finally {
          btn.disabled = false;
          btn.textContent = prev;
        }
      },
      'Update All users',
      'Yuborish'
    );
  });
}
