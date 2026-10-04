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

/* ── CSS ── */
function _injectCSS() {
  if (document.getElementById('actions-view-css')) return;
  const s = document.createElement('style');
  s.id = 'actions-view-css';
  s.textContent = `
#actionsView { background: var(--bg); }

.actions-divider {
  display: flex; align-items: center; gap: 10px;
  padding: 20px 16px 10px; margin-top: 4px;
}
.actions-divider::before, .actions-divider::after {
  content: ''; flex: 1; height: 1px; background: var(--line);
}
.actions-divider-label {
  font-size: 12px; font-weight: 700; color: var(--text2);
  letter-spacing: 0.3px; white-space: nowrap; padding: 0 4px;
}

/* ── Broadcast UI ── */
.bc-wrap {
  margin: 0 16px 8px;
  background: var(--bg2);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.bc-row {
  display: flex; gap: 8px; align-items: center; flex-wrap: wrap;
}
.bc-input {
  flex: 1; min-width: 0;
  background: var(--bg3);
  border: 1px solid var(--line2);
  border-radius: 8px;
  color: var(--text);
  font-family: var(--font);
  font-size: 13px;
  padding: 9px 12px;
  outline: none;

}
.bc-input:focus { border-color: var(--blue); }
.bc-input::placeholder { color: var(--text3); }
.bc-select {
  background: var(--bg3);
  border: 1px solid var(--line2);
  border-radius: 8px;
  color: var(--text2);
  font-family: var(--font);
  font-size: 12px;
  padding: 9px 10px;
  outline: none;
  cursor: pointer;
}
.bc-send-btn {
  display: flex; align-items: center; gap: 6px;
  background: var(--blue);
  color: #e7e9ea;
  border: none;
  border-radius: 8px;
  font-family: var(--font);
  font-size: 13px;
  font-weight: 600;
  padding: 9px 16px;
  cursor: pointer;

  white-space: nowrap;
}
.bc-send-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.bc-send-btn svg { width: 15px; height: 15px; flex-shrink: 0; }
.bc-result {
  font-size: 12px;
  color: var(--text3);
  min-height: 16px;
}
.bc-result.ok  { color: var(--green); }
.bc-result.err { color: var(--red); }

/* ── Bo'sh holat ── */
.bc-empty {
  background: var(--bg2);
  border: 1px solid var(--line);
  border-radius: 14px;
  padding: 18px 16px;
  text-align: center;
  color: var(--text3);
  font-size: 13px;
}
`;
  document.head.appendChild(s);
}

/* ── initView ── */
export async function initView() {
  if (!isAdmin()) return;
  _injectCSS();

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
  const anchor = document.getElementById('actionsBroadcastSection');
  const st = await import('../admin/admin-storage.js').catch(() => null);
  st?.renderStorageUsage(anchor);
  import('../admin/admin-wipe.js').then(m => m.renderWipePanel(document.getElementById('actionsStorageInfo') || anchor, () => {
    st?.removeStorageUsage();
    st?.renderStorageUsage(anchor);
  })).catch(() => {});
  import('../admin/admin-keys.js').then(m => m.renderKeysCheck(anchor)).catch(() => {});

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

  // Extra CSS
  if (!document.getElementById('bc-notice-css')) {
    const s = document.createElement('style');
    s.id = 'bc-notice-css';
    s.textContent = `
.bc-textarea { resize: vertical; min-height: 70px; }
.bc-current-wrap {
  margin: 0 16px 12px;
  background: color-mix(in srgb, var(--blue) 10%, var(--bg2));
  border: 1px solid color-mix(in srgb, var(--blue) 30%, transparent);
  border-radius: 12px;
  padding: 12px 14px;
  display: flex; flex-direction: column; gap: 8px;
}
.bc-current-label { font-size: 11px; font-weight: 700; color: var(--text2); text-transform: uppercase; letter-spacing: 0.4px; }
.bc-current-card { font-size: 13px; color: var(--text); line-height: 1.45; word-break: break-word; }
.bc-current-target { font-size: 11px; color: var(--blue); margin-top: 4px; }
.bc-del-btn {
  display: flex; align-items: center; gap: 6px;
  align-self: flex-start;
  background: color-mix(in srgb, var(--red,#f4212e) 15%, transparent);
  color: var(--red,#f4212e);
  border: 1px solid color-mix(in srgb, var(--red,#f4212e) 35%, transparent);
  border-radius: 8px;
  font-family: var(--font); font-size: 12px; font-weight: 600;
  padding: 6px 12px; cursor: pointer;

}
.bc-del-btn:hover { opacity: 0.75; }
`;
    document.head.appendChild(s);
  }

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
  import('../admin/admin-gate.js').then(m => m.closeAdminGate()).catch(() => {});
}
