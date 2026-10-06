/**
 * SpaceMR — Admin Foydalanuvchilar Panel
 * Faqat admin (profiles.is_admin) uchun
 */

import { sb, state, isAdmin, fetchAllRows, mapProfile, mapPost, ts, purgeUserMedia } from '../core/config.js';
import { $, esc } from '../core/utils.js';
import { toast } from '../ui/toast.js';
import { adminResetPassword } from '../admin/admin-reset-password.js';

async function _updateProfile(uid, patch) {
  const { error } = await sb.from('profiles').update(patch).eq('id', uid);
  if (error) throw error;
}

// Cache invalidation + feed refresh helper
async function _invalidateAndRefreshFeed(uid) {
  try {
    // User cache ni tozalaymiz
    if (state._userCache && uid) delete state._userCache[uid];
    // Feed ni qayta render qilamiz (agar home view da bo'lsa)
    if (state.view === 'home') {
      const { renderFeed } = await import('../feed/feed.js');
      renderFeed();
    }
    // Suhbatlar (kontaktlar) ro'yxati keshini ham bekor qilamiz — aks holda
    // o'chirilgan/bloklangan user "Yangi suhbat boshlash" ro'yxatida hali
    // ham ko'rinib turadi (5 daqiqagacha eski keshdan o'qilardi).
    const { invalidateChatsUsersCache } = await import('../chat/chat.js');
    await invalidateChatsUsersCache();
  } catch (e) { console.warn('[view-users]', e?.message || e); }
}

let _unsubUsers = null;
let _initialized = false;

/* ── Parol bilan ochish (har gal panel ochilganda qayta yopiq holatda
 * boshlanadi — admin hisobiga kirgan boshqa kishi parolni bilmasa
 * hech narsa ko'ra olmaydi, hatto username ham) ───────────────────────── */
let _lastUsers = [];
let _searchQuery = '';
let _statusFilter = 'all';

/* ── Modal state ────────────────────────────────────────────────────── */
let _pendingAction = null; // { type: 'delete'|'block'|'unblock', uid, name }

/* ── Admin panel blok countdown ─────────────────────────────────────── */
let _blockDur = 'perm';
const BLOCK_DURATIONS = {
  '1h':   { label: '1 soat',  ms: 3600e3 },
  '1d':   { label: '1 kun',   ms: 86400e3 },
  '7d':   { label: '7 kun',   ms: 7 * 86400e3 },
  'perm': { label: 'Doimiy',  ms: 0 },
};

/* ── initView ───────────────────────────────────────────────────────── */
export function initView() {
  if (!isAdmin()) {
    const wrap = $('usersAdminList');
    if (wrap) wrap.innerHTML = '<p style="padding:24px;color:var(--text2)">Ruxsat yo\'q.</p>';
    return;
  }
  _ensureModal();
  _ensureSearchFilter();
  // Har doim yangi onSnapshot ulaymiz — destroyView() uni to'xtatgan bo'lishi mumkin
  _initialized = true;
  _loadUsers();
}

/* ── Qidiruv va status filtri ──────────────────────────────────────── */
function _ensureSearchFilter() {
  const searchEl = $('uaSearchInput');
  const filterEl = $('uaStatusFilter');
  if (!searchEl || !filterEl) return;

  // Panelga har safar kirishda qidiruv/filtr tozalanadi
  searchEl.value = '';
  filterEl.value = 'all';
  _searchQuery = '';
  _statusFilter = 'all';

  if (!searchEl.dataset.wired) {
    searchEl.dataset.wired = '1';
    let debounceT = null;
    searchEl.addEventListener('input', () => {
      clearTimeout(debounceT);
      debounceT = setTimeout(() => {
        _searchQuery = searchEl.value;
        _renderList();
      }, 150);
    });
  }
  if (!filterEl.dataset.wired) {
    filterEl.dataset.wired = '1';
    filterEl.addEventListener('change', () => {
      _statusFilter = filterEl.value;
      _renderList();
    });
  }
}

/* ── Filtrlangan ro'yxatni hisoblash ──────────────────────────────── */
function _applyFilters(users) {
  let out = users;

  if (_statusFilter === 'pending') {
    out = out.filter(u => u.approved === false && !u.blocked);
  } else if (_statusFilter === 'approved') {
    out = out.filter(u => u.approved === true && !u.blocked);
  } else if (_statusFilter === 'blocked') {
    out = out.filter(u => u.blocked === true);
  } else if (_statusFilter === 'rejected') {
    out = out.filter(u => u.approved === 'rejected');
  }

  const q = _searchQuery.trim().toLowerCase();
  if (q) {
    out = out.filter(u => {
      const name  = (u.fullName  || '').toLowerCase();
      const uname = (u.username  || '').toLowerCase();
      const email = (u.email     || '').toLowerCase();
      const uid   = (u.uid || u.id || '').toLowerCase();
      return name.includes(q) || uname.includes(q) || email.includes(q) || uid.includes(q);
    });
  }

  return out;
}

/* ── Ro'yxatni (mini-pending + asosiy) qayta chizish ──────────────── */
function _renderList() {
  const wrap = $('usersAdminList');
  if (!wrap) return;
  _renderPendingMini(_lastUsers);
  const filtered = _applyFilters(_lastUsers);
  if ((_searchQuery.trim() || _statusFilter !== 'all') && !filtered.length) {
    wrap.innerHTML = '<p style="padding:24px;color:var(--text2)">Mos foydalanuvchi topilmadi.</p>';
    return;
  }
  _render(wrap, filtered);
}

/* ── Yagona modal (delete + block uchun) ────────────────────────────── */
function _ensureModal() {
  if ($('uaActionModal')) return;

  const modal = document.createElement('div');
  modal.id = 'uaActionModal';
  modal.className = 'ua-modal-overlay';
  modal.innerHTML = `
    <div class="ua-modal">
      <div class="ua-modal-icon" id="uaModalIcon"></div>
      <div class="ua-modal-title" id="uaModalTitle"></div>
      <div class="ua-modal-body" id="uaModalBody"></div>
      <div class="ua-modal-btns">
        <button class="ua-modal-cancel" id="uaModalCancel">Bekor qilish</button>
        <button class="ua-modal-confirm" id="uaModalConfirm">
          <span id="uaModalConfirmTxt"></span>
        </button>
      </div>
    </div>`;
  document.body.appendChild(modal);

  $('uaModalCancel').addEventListener('click', _closeModal);
  modal.addEventListener('click', e => { if (e.target === modal) _closeModal(); });
  $('uaModalConfirm').addEventListener('click', _confirmAction);
}

function _openDeleteModal(uid, name) {
  _pendingAction = { type: 'delete', uid, name };
  $('uaModalIcon').innerHTML     = _svgTrash();
  $('uaModalTitle').textContent  = "O'chiramizmi?";
  $('uaModalBody').innerHTML     = `<strong>${_esc(name)}</strong> ni ro'yxatdan butunlay o'chirasizmi?<br>
    <span class="ua-modal-warn">Diqqat, buni qaytarib bo'lmaydi!</span>`;
  $('uaModalConfirmTxt').textContent = "O'chirish";
  $('uaModalConfirm').className  = 'ua-modal-confirm ua-modal-confirm--danger';
  $('uaModalConfirm').disabled   = false;
  $('uaActionModal').classList.add('show');
}

function _openBlockModal(uid, name, isBlocked) {
  _pendingAction = { type: isBlocked ? 'unblock' : 'block', uid, name };
  if (isBlocked) {
    $('uaModalIcon').innerHTML    = _svgUnlock();
    $('uaModalTitle').textContent  = "Blokdan chiqaramizmi?";
    $('uaModalBody').innerHTML     = `<strong>${_esc(name)}</strong> ga qayta kirish ruxsati berilsinmi?`;
    $('uaModalConfirmTxt').textContent = "Blokdan chiqarish";
    $('uaModalConfirm').className  = 'ua-modal-confirm ua-modal-confirm--safe';
  } else {
    $('uaModalIcon').innerHTML    = _svgLock();
    $('uaModalTitle').textContent  = "Bloklaymizmi?";

    _blockDur = 'perm';
    $('uaModalBody').innerHTML = `<strong>${_esc(name)}</strong> bloklansinmi?<br>
      <span class="ua-modal-warn">Muddatni tanlang:</span>
      <div id="uaBlockDur" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:12px;">
        ${Object.entries(BLOCK_DURATIONS).map(([k, d]) =>
          `<button type="button" class="ua-dur-btn" data-dur="${k}">${d.label}</button>`).join('')}
      </div>`;
    const _paintDur = () => document.querySelectorAll('#uaBlockDur .ua-dur-btn').forEach(b => {
      const on = b.dataset.dur === _blockDur;
      b.style.cssText = 'flex:1;min-width:70px;padding:8px 10px;border-radius: 28px;cursor:pointer;font:inherit;font-size:13px;'
        + 'border:1px solid ' + (on ? 'var(--blue)' : 'var(--line2)') + ';'
        + 'background:' + (on ? 'var(--blue)' : 'var(--bg3)') + ';color:' + (on ? '#e7e9ea' : 'var(--text2)') + ';';
      b.onclick = () => { _blockDur = b.dataset.dur; _paintDur(); };
    });
    _paintDur();
    $('uaModalConfirmTxt').textContent = "Bloklash";
    $('uaModalConfirm').className  = 'ua-modal-confirm ua-modal-confirm--warn';
  }
  $('uaModalConfirm').disabled = false;
  $('uaActionModal').classList.add('show');
}

function _closeModal() {
  _pendingAction = null;
  const modal = $('uaActionModal');
  if (modal) modal.classList.remove('show');
}

async function _confirmAction() {
  if (!_pendingAction) return;
  const { type, uid, name } = _pendingAction;

  const confirmBtn = $('uaModalConfirm');
  const confirmTxt = $('uaModalConfirmTxt');
  confirmBtn.disabled = true;
  confirmTxt.textContent = '...';

  try {
    if (type === 'delete') {
      // Foydalanuvchi hozir saytda bo'lsa, o'sha zahotiyoq logout qilish uchun jonli signal
      try {
        const kickCh = sb.channel('user-session-' + uid);
        kickCh.subscribe(status => {
          if (status === 'SUBSCRIBED') {
            kickCh.send({
              type: 'broadcast',
              event: 'account_deleted',
              payload: { uid }
            }).finally(() => {
              setTimeout(() => sb.removeChannel(kickCh), 1000);
            });
          }
        });
      } catch (e) {
        console.warn('[view-users] Kick signal yuborilmadi:', e);
      }

      await purgeUserMedia(uid);
      const { error: delErr } = await sb.rpc('admin_delete_user', { p_uid: uid });
      if (delErr) throw delErr;
      toast(`${name} butunlay o'chirildi`, 'success');
      await _invalidateAndRefreshFeed(uid);

    } else if (type === 'block') {
      const selectedMs = (BLOCK_DURATIONS[_blockDur] || BLOCK_DURATIONS.perm).ms;
      const untilDate = selectedMs > 0 ? new Date(Date.now() + selectedMs) : null;
      await _updateProfile(uid, {
        blocked: true,
        approval: 'pending',
        blocked_until: untilDate ? untilDate.toISOString() : null,
      });
      const untilMsg = untilDate
        ? ` (${untilDate.toLocaleString('uz-UZ')} gacha)` : ' (doimiy)';
      toast(`${name} bloklandi${untilMsg}`, 'info');
      await _invalidateAndRefreshFeed(uid);

    } else if (type === 'unblock') {
      await _updateProfile(uid, { blocked: false, blocked_until: null, approval: 'approved' });
      toast(`${name} blokdan chiqarildi `, 'success');
      await _invalidateAndRefreshFeed(uid);
    }
    _closeModal();
  } catch (err) {
    console.error('Action error:', err);
    toast('Xatolik: ' + err.message, 'error');
    confirmBtn.disabled = false;
    confirmTxt.textContent = type === 'delete' ? "O'chirish" : type === 'block' ? 'Bloklash' : 'Blokdan chiqarish';
  }
}

/* ── Foydalanuvchilar ro'yxati (Supabase + realtime) ─────────────────── */
function _loadUsers() {
  const wrap = $('usersAdminList');
  if (!wrap) return;

  wrap.innerHTML = '<div class="spin-wrap"><div class="spinner"></div></div>';
  if (_unsubUsers) { _unsubUsers(); _unsubUsers = null; }

  let dead = false, timer = null;
  const load = async () => {
    try {
      const rows = await fetchAllRows('profiles', '*', 'created_at'); // yangi → eski
      if (dead) return;
      _lastUsers = rows.map(mapProfile).filter(u => u.id !== state.me?.uid);
      _renderList();
    } catch (err) {
      if (dead) return;
      wrap.innerHTML = `<p style="padding:24px;color:var(--red)">Xatolik: ${esc(err?.message || err)}</p>`;
    }
  };
  const schedule = () => { clearTimeout(timer); timer = setTimeout(load, 300); };
  const ch = sb.channel('admin-users-list')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, schedule)
    .subscribe();
  _unsubUsers = () => { dead = true; clearTimeout(timer); sb.removeChannel(ch); };
  load();
}

/* ── Parol modal (admin o'zining joriy parolini qayta kiritadi) ──────── */
/* ── Helpers ────────────────────────────────────────────────────────── */
function _statusBadge(user) {
  if (user.blocked === true)
    return `<span class="ua-badge ua-badge--blocked">Bloklangan</span>`;
  const a = user.approved;
  if (a === true)       return `<span class="ua-badge ua-badge--approved">Ruxsat berilgan</span>`;
  if (a === false)      return `<span class="ua-badge ua-badge--pending">Kutilmoqda</span>`;
  if (a === 'rejected') return `<span class="ua-badge ua-badge--rejected">Rad etilgan</span>`;
  return `<span class="ua-badge ua-badge--legacy">Eski foydalanuvchi</span>`;
}

function _approveBtn(user) {
  if (user.blocked) return '';
  const a = user.approved;
  if (a === true || a === undefined) return '';
  return `<button class="ua-approve-btn" data-uid="${user.uid||user.id}">Ruxsat berish</button>`;
}

function _rejectBtn(user) {
  if (user.blocked) return '';
  const a = user.approved;
  if (a === 'rejected' || a === true || a === undefined) return '';
  return `<button class="ua-reject-btn" data-uid="${user.uid||user.id}">Rad etish</button>`;
}

/* ── Approve/Reject — asosiy ro'yxat va "Kutayotganlar" mini-bo'limi
 * ikkalasi tomonidan ham ishlatiladigan umumiy funksiyalar ── */
async function _doApprove(btn, uid, name) {
  btn.disabled = true; btn.textContent = '...';
  try {
    await _updateProfile(uid, { approval: 'approved' });
    toast('Ruxsat berildi ', 'success');
    await _invalidateAndRefreshFeed(uid);
  } catch (err) {
    toast('Xatolik: ' + err.message, 'error');
    btn.disabled = false; btn.textContent = 'Ruxsat berish';
  }
}

async function _doReject(btn, uid, name) {
  btn.disabled = true; btn.textContent = '...';
  try {
    await _updateProfile(uid, { approval: 'rejected' });
    toast('Rad etildi', 'info');
    await _invalidateAndRefreshFeed(uid);
  } catch (err) {
    toast('Xatolik: ' + err.message, 'error');
    btn.disabled = false; btn.textContent = 'Rad etish';
  }
}

/* ── "Kutayotgan foydalanuvchilar" tezkor mini-bo'lim ──
 * actionsView boshida — scroll qilmasdan tasdiqlash/rad etish uchun.
 * ── */
function _ensurePendingMiniCSS() {
  if (document.getElementById('pending-mini-css')) return;
  const s = document.createElement('style');
  s.id = 'pending-mini-css';
  s.textContent = `
.pmini-wrap { margin: 0 16px 8px; display: flex; flex-direction: column; gap: 8px; }
.pmini-empty {
  background: var(--bg2); border: 1px solid var(--line); border-radius: 28px;
  padding: 16px; text-align: center; color: var(--text3); font-size: 13px;
}
.pmini-locked {
  background: var(--bg2); border: 1px solid var(--line); border-radius: 28px;
  padding: 14px 16px; display: flex; align-items: center; justify-content: space-between;
  gap: 10px; cursor: pointer;
}
.pmini-locked-count { font-size: 13px; font-weight: 700; color: var(--text); }
.pmini-locked-hint { font-size: 12px; color: var(--blue,#e7e9ea); font-weight: 600; white-space: nowrap; }
.pmini-card {
  background: var(--bg2); border: 1px solid var(--line); border-radius: 28px;
  padding: 12px; display: flex; align-items: center; gap: 10px;
}
.pmini-avi { width: 40px; height: 40px; border-radius: 50%; object-fit: cover; flex-shrink: 0; background: var(--bg3); }
.pmini-avi-placeholder {
  width: 40px; height: 40px; border-radius: 50%; flex-shrink: 0;
  background: var(--bg3); color: var(--text2); display: flex; align-items: center;
  justify-content: center; font-weight: 700; font-size: 15px;
}
.pmini-info { flex: 1; min-width: 0; }
.pmini-name { font-size: 13px; font-weight: 700; color: var(--text); }
.pmini-sub { font-size: 11.5px; color: var(--text3); margin-top: 1px; }
.pmini-actions { display: flex; gap: 6px; flex-shrink: 0; }
.pmini-approve-btn, .pmini-reject-btn {
  border: none; border-radius: 28px; font-family: var(--font); font-size: 12px; font-weight: 600;
  padding: 7px 11px; cursor: pointer;  white-space: nowrap;
}
.pmini-approve-btn { background: var(--green,#00ba7c); color: #e7e9ea; }
.pmini-reject-btn { background: color-mix(in srgb, var(--red,#f4212e) 15%, transparent); color: var(--red,#f4212e); }
.pmini-approve-btn:disabled, .pmini-reject-btn:disabled { opacity: 0.5; cursor: not-allowed; }
`;
  document.head.appendChild(s);
}

function _renderPendingMini(users) {
  const section = document.getElementById('actionsPendingSection');
  if (!section) return;
  _ensurePendingMiniCSS();

  const pending = (users || []).filter(u => u.approved === false && !u.blocked);

  if (!pending.length) {
    section.innerHTML = `<div class="pmini-wrap"><div class="pmini-empty">Kutayotgan foydalanuvchilar yo'q</div></div>`;
    return;
  }

  section.innerHTML = `<div class="pmini-wrap">${pending.map(u => {
    const uid  = u.uid || u.id;
    const name = u.fullName || u.username || uid;
    const uname = u.username ? `@${u.username}` : (u.email || '');
    const created = u.createdAt ? new Date(u.createdAt).toLocaleString('uz-UZ') : '';
    return `
      <div class="pmini-card" data-uid="${uid}">
        <div class="pmini-info">
          <div class="pmini-name">${_esc(name)}</div>
          <div class="pmini-sub">${_esc(uname)}${created ? ' · ' + created : ''}</div>
        </div>
        <div class="pmini-actions">
          <button class="pmini-approve-btn" data-uid="${uid}" data-name="${_esc(name)}">Tasdiqlash</button>
          <button class="pmini-reject-btn" data-uid="${uid}" data-name="${_esc(name)}">Rad etish</button>
        </div>
      </div>`;
  }).join('')}</div>`;

  section.querySelectorAll('.pmini-approve-btn').forEach(btn => {
    btn.addEventListener('click', () => _doApprove(btn, btn.dataset.uid, btn.dataset.name));
  });
  section.querySelectorAll('.pmini-reject-btn').forEach(btn => {
    btn.addEventListener('click', () => _doReject(btn, btn.dataset.uid, btn.dataset.name));
  });
}

/* ── Render ─────────────────────────────────────────────────────────── */
function _rowStatusClass(u) {
  if (u.blocked === true) return 'ua-row--blocked';
  if (u.approved === false || u.approved === 'rejected') return 'ua-row--pending';
  return 'ua-row--approved';
}

function _needsApprove(u) {
  if (u.blocked) return false;
  return u.approved === false;
}

function _render(wrap, users) {
  if (!users.length) {
    wrap.innerHTML = '<p style="padding:24px;color:var(--text2)">Foydalanuvchilar yo\'q.</p>';
    return;
  }

  wrap.innerHTML = users.map(u => {
    const name = u.fullName || u.username || u.uid || u.id;
    const uname = u.username ? `@${u.username}` : '';
    const uid = u.uid || u.id;
    const isBlocked = u.blocked === true;
    const blockedUntil = u.blockedUntil ? new Date(u.blockedUntil).toLocaleString('uz-UZ') : '';
    const blockLabel = isBlocked ? 'Blokdan chiqarish' : 'Bloklash';
    const st = _rowStatusClass(u);
    const showApprove = _needsApprove(u);

    return `
    <div class="ua-row ${st}" data-uid="${uid}">
      <div class="ua-row-top">
        <div class="ua-info">
          <span class="ua-name">${_esc(name)}</span>
          ${uname ? `<span class="ua-uname">${_esc(uname)}</span>` : ''}
          ${blockedUntil ? `<span class="ua-date">blok: ${_esc(blockedUntil)}</span>` : ''}
        </div>
        <div class="ua-hover-tools">
          ${showApprove ? `<button type="button" class="ua-approve-btn" data-uid="${uid}">Ruxsat berish</button>` : ''}
          <div class="ua-more-wrap">
            <button type="button" class="ua-more-btn" data-uid="${uid}" aria-label="Menyu" title="Menyu">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>
            </button>
            <div class="ua-more-menu" hidden>
              <button type="button" class="ua-menu-item ${isBlocked ? 'ua-unblock-btn' : 'ua-block-btn'}" data-uid="${uid}" data-name="${_esc(name)}" data-blocked="${isBlocked}">${blockLabel}</button>
              <button type="button" class="ua-menu-item ua-reset-pwd-btn" data-uid="${uid}" data-name="${_esc(name)}" data-username="${_esc(u.username||'')}" data-recemail="${_esc(u.recovery_email||'')}">Parolni tiklash</button>
              ${showApprove ? `<button type="button" class="ua-menu-item ua-reject-btn" data-uid="${uid}">Rad etish</button>` : ''}
              <button type="button" class="ua-menu-item ua-menu-danger ua-delete-btn" data-uid="${uid}" data-name="${_esc(name)}">O'chirish</button>
            </div>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');

  wrap.querySelectorAll('.ua-more-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const menu = btn.parentElement?.querySelector('.ua-more-menu');
      if (!menu) return;
      const wasOpen = !menu.hidden;
      wrap.querySelectorAll('.ua-more-menu').forEach(m => { m.hidden = true; });
      menu.hidden = wasOpen;
    });
  });
  if (!wrap._uaMenuCloser) {
    wrap._uaMenuCloser = (e) => {
      if (e.target.closest('.ua-more-wrap')) return;
      wrap.querySelectorAll('.ua-more-menu').forEach(m => { m.hidden = true; });
    };
    document.addEventListener('click', wrap._uaMenuCloser);
  }

  wrap.querySelectorAll('.ua-approve-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const uid = btn.dataset.uid;
      const row = btn.closest('.ua-row');
      btn.disabled = true;
      btn.textContent = '...';
      try {
        await _updateProfile(uid, { approval: 'approved' });
        toast('Ruxsat berildi', 'success');
        await _invalidateAndRefreshFeed(uid);
        btn.classList.add('ua-approve-out');
        setTimeout(() => {
          btn.remove();
          row?.classList.remove('ua-row--pending');
          row?.classList.add('ua-row--approved');
          row?.querySelector('.ua-reject-btn')?.remove();
        }, 220);
        const u = _lastUsers.find(x => (x.uid || x.id) === uid);
        if (u) u.approved = true;
      } catch (err) {
        toast('Xatolik: ' + err.message, 'error');
        btn.disabled = false;
        btn.textContent = 'Ruxsat berish';
      }
    });
  });

  wrap.querySelectorAll('.ua-reject-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const uid = btn.dataset.uid;
      const row = btn.closest('.ua-row');
      btn.closest('.ua-more-menu')?.setAttribute('hidden', '');
      try {
        await _updateProfile(uid, { approval: 'rejected' });
        toast('Rad etildi', 'info');
        await _invalidateAndRefreshFeed(uid);
        row?.querySelector('.ua-approve-btn')?.remove();
        const u = _lastUsers.find(x => (x.uid || x.id) === uid);
        if (u) u.approved = 'rejected';
      } catch (err) {
        toast('Xatolik: ' + err.message, 'error');
      }
    });
  });

  wrap.querySelectorAll('.ua-block-btn, .ua-unblock-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      btn.closest('.ua-more-menu')?.setAttribute('hidden', '');
      _openBlockModal(btn.dataset.uid, btn.dataset.name, btn.dataset.blocked === 'true');
    });
  });

  wrap.querySelectorAll('.ua-delete-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      btn.closest('.ua-more-menu')?.setAttribute('hidden', '');
      _openDeleteModal(btn.dataset.uid, btn.dataset.name);
    });
  });

  wrap.querySelectorAll('.ua-reset-pwd-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      btn.closest('.ua-more-menu')?.setAttribute('hidden', '');
      adminResetPassword(btn.dataset.uid, btn.dataset.name, {
        username: btn.dataset.username,
        recoveryEmail: btn.dataset.recemail
      });
    });
  });
}

function _svgTrash() {
  return `<img src="./svg/extra/icon-34ff153eec4e.svg" alt="" class="icon" width="34" height="34" style="color:var(--red)">`;
}
function _svgLock() {
  return `<img src="./svg/extra/icon-e42dbb86abcd.svg" alt="" class="icon" width="34" height="34" style="color:var(--amber)">`;
}
function _svgUnlock() {
  return `<img src="./svg/extra/icon-dfb40720ae6a.svg" alt="" class="icon" width="34" height="34" style="color:var(--green)">`;
}
function _esc(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

export function destroyView() {
  if (_unsubUsers) { _unsubUsers(); _unsubUsers = null; }
  _initialized = false;
}
