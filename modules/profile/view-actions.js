/**
 * SpaceMR — Admin Actions Panel
 * Statistika, Foydalanuvchilar va Broadcast birlashtirilgan panel
 * Faqat admin (ADMIN_UID) uchun
 */

import { sb, state, isAdmin } from '../core/config.js';
import { toast } from '../ui/toast.js';
import { showConfirm, esc } from '../core/utils.js';

let _initialized = false;
let _noticeUnsub    = null;

/* ── initView ── */
export async function initView() {
  if (!isAdmin()) return;

  // Har kirishda admin login + parol (server tekshiradi). Bekor qilinsa — bosh sahifa.
  const view = document.getElementById('actionsView');
  view?.classList.remove('adm-unlocked');
  const { askAdmin } = await import('../admin/admin-gate.js');
  const ok = await askAdmin();
  if (state.view !== 'actions') return;
  if (!ok) { (await import('../router.js')).navigateTo('home'); return; }
  view?.classList.add('adm-unlocked');

  _initBroadcast();
  await _initUsers();
  // Desktop: users listni right-rail ga majburan ko'chir
  try {
    const rr = await import('../ui/right-rail.js');
    const place = () => rr.placeUsersAdmin?.(true, 'actions');
    place();
    requestAnimationFrame(place);
    setTimeout(place, 50);
    setTimeout(place, 300);
  } catch (_) {}
  const sys = document.getElementById('admSystemMount') || document.getElementById('actionsBroadcastSection');
  const st = await import('../admin/admin-storage.js').catch(() => null);
  st?.renderStorageUsage(sys);
  import('../admin/admin-wipe.js').then(m => m.renderWipePanel(document.getElementById('actionsStorageInfo') || sys, () => {
    st?.refreshStorageUsage?.() || (st?.removeStorageUsage(), st?.renderStorageUsage(sys));
  })).catch(() => {});
  import('../admin/admin-keys.js').then(m => m.renderKeysCheck(sys)).catch(() => {});
  import('../admin/admin-force-reload.js').then(m => m.renderForceReloadBtn(sys)).catch(() => {});

  _initialized = true;
}

/* ── Broadcast / Admin Notice ── */
function _initBroadcast() {
  const section = document.getElementById('actionsBroadcastSection');
  if (!section || section.dataset.ready) return;
  section.dataset.ready = '1';

  section.innerHTML = `
    <div class="bc-wrap">
      <div class="bc-row">
        <textarea class="bc-input bc-textarea" id="bcBody" placeholder="Xabar matni… (maslan: Bugun vaqtim yo'q, ertaga ochib qo'yaman)" maxlength="300" rows="3"></textarea>
      </div>
      <div class="bc-row">
        <select class="bc-select" id="bcTarget">
          <option value="all">Barchaga (chat + kutayotganlar)</option>
          <option value="approved">Faqat tasdiqlanganlarga (chat)</option>
          <option value="pending">Faqat kutayotganlarga (ularning ekranida)</option>
        </select>
        <button class="bc-send-btn" id="bcSendBtn">
          <img src="./svg/action/send.svg" alt="" class="icon" width="15" height="15">
          E'lon qilish
        </button>
      </div>
      <div class="bc-result" id="bcResult"></div>
    </div>
    <div class="bc-current-wrap" id="bcCurrentWrap" style="display:none;">
      <div class="bc-current-label">Faol e'lon:</div>
      <div class="bc-current-card" id="bcCurrentCard"></div>
      <button class="bc-del-btn" id="bcDelBtn">
        <img src="./svg/extra/icon-43bf503445c5.svg" alt="" class="icon" width="14" height="14">
        E'lonni o'chirish
      </button>
    </div>
  `;

  const bodyEl   = document.getElementById('bcBody');
  const targetEl = document.getElementById('bcTarget');
  const sendBtn  = document.getElementById('bcSendBtn');
  const resultEl = document.getElementById('bcResult');
  const currentWrap = document.getElementById('bcCurrentWrap');
  const currentCard = document.getElementById('bcCurrentCard');
  const delBtn   = document.getElementById('bcDelBtn');

  const TARGET_LABELS = {
    all: 'Barchaga (chat + kutayotganlar)',
    approved: 'Faqat tasdiqlanganlarga',
    pending: 'Faqat kutayotganlarga',
  };

  // Real-time: faol e'lonni ko'rsat
  if (_noticeUnsub) { _noticeUnsub(); _noticeUnsub = null; }
  let _noticeDead = false;
  const _paintNotice = d => {
    if (d) {
      currentWrap.style.display = 'flex';
      currentCard.innerHTML = `
        <div>${esc(d.text || '').replace(/\n/g,'<br>')}</div>
        <div class="bc-current-target"><img src="./svg/extra/icon-c9b87fab5705.svg" alt="" class="icon" width="16" height="16"> ${esc(TARGET_LABELS[d.target] || d.target)}</div>
      `;
    } else {
      currentWrap.style.display = 'none';
      currentCard.innerHTML = '';
    }
  };
  const _loadNotice = async () => {
    const { data } = await sb.from('admin_notice').select('*').eq('id', 'global').maybeSingle();
    if (!_noticeDead) _paintNotice(data || null);
  };
  _loadNotice();
  const _noticeCh = sb.channel('admin-notice-panel')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'admin_notice' }, () => _loadNotice())
    .subscribe();
  _noticeUnsub = () => { _noticeDead = true; sb.removeChannel(_noticeCh); };

  // Yuborish
  sendBtn.addEventListener('click', async () => {
    const body   = bodyEl.value.trim();
    const target = targetEl.value;

    if (!body) { bodyEl.focus(); return; }

    sendBtn.disabled = true;
    sendBtn.textContent = 'Saqlanmoqda…';
    resultEl.textContent = '';
    resultEl.className = 'bc-result';

    try {
      const { error: noticeErr } = await sb.from('admin_notice')
        .upsert({ id: 'global', text: body, target, admin_id: state.me.uid, created_at: new Date().toISOString() });
      if (noticeErr) throw noticeErr;
      bodyEl.value = '';
      resultEl.textContent = 'E\'lon muvaffaqiyatli chop etildi';
      resultEl.className = 'bc-result ok';
      toast('E\'lon chop etildi', 'success');
    } catch (err) {
      resultEl.textContent = `Xatolik: ${err.message}`;
      resultEl.className = 'bc-result err';
      toast('Xatolik: ' + err.message, 'error');
    } finally {
      sendBtn.disabled = false;
      sendBtn.innerHTML = `
        <img src="./svg/action/send.svg" alt="" class="icon" width="15" height="15">
        E'lon qilish`;
    }
  });

  // O'chirish
  delBtn.addEventListener('click', () => {
    showConfirm("E'lonni o'chirasizmi?", async () => {
      try {
        const { error: delErr } = await sb.from('admin_notice').delete().eq('id', 'global');
        if (delErr) throw delErr;
        toast('E\'lon o\'chirildi', 'success');
      } catch (err) {
        toast('O\'chirishda xatolik: ' + err.message, 'error');
      }
    }, "O'chirish", "O'chirish");
  });

}

/* ── Users ── */
async function _initUsers() {
  try {
    const { initView: usersInit } = await import('./view-users.js');
    usersInit();
  } catch (err) {
    console.error('[Actions] Users init error:', err);
  }
}

export function destroyView() {
  _initialized = false;
  const section = document.getElementById('actionsBroadcastSection');
  if (section) delete section.dataset.ready;
  if (_noticeUnsub) { _noticeUnsub(); _noticeUnsub = null; }
  document.getElementById('actionsStorageInfo')?.remove();
  document.getElementById('actionsWipe')?.remove();
  document.getElementById('actionsView')?.classList.remove('adm-unlocked');
  document.body.classList.remove('rr-admin-users');
  // Users blockni mobil hostga qaytar
  import('../ui/right-rail.js').then(m => m.placeUsersAdmin?.(false, 'home')).catch(() => {});
  import('../admin/admin-gate.js').then(m => m.closeAdminGate()).catch(() => {});
}
