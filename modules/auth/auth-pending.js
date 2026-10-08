/**
 * auth-pending.js — ruxsat kutish / blok / offline-verify ekranlari
 */
import { sb, state } from '../core/config.js';
import { $, esc } from '../core/utils.js';

let _serverNow = () => Date.now();
let _onBlockExpired = null;
let _onPendingSignOut = null;

export function initAuthPending(opts = {}) {
  if (typeof opts.serverNow === 'function') _serverNow = opts.serverNow;
  _onBlockExpired = opts.onBlockExpired || null;
  _onPendingSignOut = opts.onPendingSignOut || null;
}

/* ── Ruxsat kutish ekrani ────────────────────────────────────────────── */
let _approvalListener = null;
let _noticeUnsubPending = null;

function _updatePendingNotice(noticeData) {
  const container = document.getElementById('pendingNoticeWrap');
  if (!container) return;
  if (!noticeData?.text) {
    container.style.display = 'none';
    container.textContent = '';
    return;
  }
  const t = noticeData.target || 'all';
  if (t === 'approved') {
    container.style.display = 'none';
    container.textContent = '';
    return;
  }

  container.style.display = 'flex';
  container.textContent = '';

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('width', '16'); svg.setAttribute('height', '16');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'var(--tg-primary-blue,#e7e9ea)');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
  svg.style.cssText = 'flex-shrink:0;margin-top:2px';
  const circle = document.createElementNS(svgNS, 'circle');
  circle.setAttribute('cx', '12'); circle.setAttribute('cy', '12'); circle.setAttribute('r', '10');
  const line1 = document.createElementNS(svgNS, 'line');
  line1.setAttribute('x1','12');line1.setAttribute('y1','8');line1.setAttribute('x2','12');line1.setAttribute('y2','12');
  const line2 = document.createElementNS(svgNS, 'line');
  line2.setAttribute('x1','12');line2.setAttribute('y1','16');line2.setAttribute('x2','12.01');line2.setAttribute('y2','16');
  svg.append(circle, line1, line2);

  const span = document.createElement('span');
  span.textContent = noticeData.text;

  container.append(svg, span);
}

function _startPendingNoticeWatcher() {
  if (_noticeUnsubPending) return;
  let dead = false, ch = null;
  const load = async () => {
    try {
      const { data } = await sb.from('admin_notice').select('text,target').eq('id', 'global').maybeSingle();
      if (!dead) _updatePendingNotice(data || null);
    } catch (e) { console.warn('[auth]', e?.message || e); }
  };
  load();
  try {
    ch = sb.channel('pending-notice')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'admin_notice' }, () => load())
      .subscribe();
  } catch (_) {}
  _noticeUnsubPending = () => { dead = true; if (ch) sb.removeChannel(ch); };
}

function _stopPendingNoticeWatcher() {
  if (_noticeUnsubPending) { _noticeUnsubPending(); _noticeUnsubPending = null; }
  _updatePendingNotice(null);
}

/* ── Blocked countdown timer ─────────────────────────────────────────── */
let _blockedCountdownInterval = null;

function _stopBlockedCountdown() {
  if (_blockedCountdownInterval) {
    clearInterval(_blockedCountdownInterval);
    _blockedCountdownInterval = null;
  }
}

function _startBlockedCountdown(blockedUntilMs, onExpire = null) {
  _stopBlockedCountdown();
  const el = document.getElementById('blockedCountdownWrap');
  if (!el) return;

  /* DOM elementlarini bir marta yaratamiz, keyin faqat textContent yangilaymiz */
  el.textContent = '';
  const label   = Object.assign(document.createElement('div'), { className: 'blocked-cd-label', textContent: 'Blok muddati tugashiga:' });
  const timer   = Object.assign(document.createElement('div'), { id: 'blockedCountdownTimer', className: 'blocked-cd-timer' });
  const untilEl = Object.assign(document.createElement('div'), { className: 'blocked-cd-until' });
  el.append(label, timer, untilEl);
  untilEl.textContent = `${new Date(blockedUntilMs).toLocaleString('uz-UZ')} gacha bloklangansiz`;

  const update = () => {
    const diff = blockedUntilMs - _serverNow();
    if (diff <= 0) {
      el.style.display = 'none';
      _stopBlockedCountdown();
      if (typeof onExpire === 'function') onExpire();
      return;
    }
    const totalSec = Math.ceil(diff / 1000);
    const d = Math.floor(totalSec / 86400);
    const h = Math.floor((totalSec % 86400) / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const parts = [];
    if (d > 0) parts.push(`${d} kun`);
    if (h > 0) parts.push(`${h} soat`);
    if (m > 0) parts.push(`${m} daqiqa`);
    parts.push(`${s} soniya`);
    timer.textContent = parts.join(' ');
  };

  el.style.display = 'block';
  update();
  _blockedCountdownInterval = setInterval(update, 1000);
}


export function showPendingScreen(reason = 'pending', blockedUntilMs = null) {
  const screen = $('pendingApprovalScreen');
  const app    = $('app');
  const authWrap = $('authWrap');

  // Matnni holatga qarab o'zgartirish
  const h2 = screen?.querySelector('h2');
  const p  = screen?.querySelector('p');
  const countdownWrap = document.getElementById('blockedCountdownWrap');

  _stopBlockedCountdown();
  if (countdownWrap) countdownWrap.style.display = 'none';

  if (reason === 'blocked') {
    if (h2) h2.textContent = 'Hisobingiz bloklangan';
    if (p) {
      p.textContent = '';
      if (blockedUntilMs && blockedUntilMs > _serverNow()) {
        const s1 = document.createElement('strong');
        s1.style.color = 'var(--red,#f4212e)';
        s1.textContent = 'bloklangansiz.';
        p.append('Siz admin tomonidan vaqtinchalik ', s1, document.createElement('br'), 'Muddat tugagach avtomatik ochilasiz.');
        _startBlockedCountdown(blockedUntilMs, async () => {
          hidePendingScreen();
          if (typeof _onBlockExpired === 'function') await _onBlockExpired();
        });
      } else {
        const s2 = document.createElement('strong');
        s2.style.color = 'var(--text,#e7e9ea)';
        s2.textContent = 'bloklangansiz.';
        p.append('Siz admin tomonidan ', s2, document.createElement('br'), "Qo'shimcha ma'lumot uchun administratorga murojaat qiling.");
        if (countdownWrap) countdownWrap.style.display = 'none';
      }
    }
  } else if (reason === 'rejected') {
    if (h2) h2.textContent = 'Arizangiz rad etildi';
    if (p) {
      p.textContent = '';
      const s = document.createElement('strong');
      s.style.color = 'var(--red,#f4212e)';
      s.textContent = 'rad etdi.';
      p.append('Afsuski, admin sizning arizangizni ', s, document.createElement('br'), "Qo'shimcha ma'lumot uchun administratorga murojaat qiling.");
    }
  } else if (reason === 'offline-verify') {
    if (h2) h2.textContent = 'Internetga ulaning';
    if (p) {
      p.textContent = '';
      p.append(
        "Hisobingiz holatini xavfsiz tekshirish uchun internet aloqasi kerak.",
        document.createElement('br'),
        "Uzoq vaqt oflayn holda ilovadan foydalanib bo'lmaydi — bu xavfsizlik cheklovi.",
        document.createElement('br'),
        "Internet qaytishi bilan avtomatik davom etadi."
      );
    }
  } else {
    if (h2) h2.textContent = 'Ruxsat kutilmoqda';
    if (p) {
      p.textContent = '';
      const s = document.createElement('strong');
      s.style.color = 'var(--text,#e7e9ea)';
      s.textContent = 'Administrator ruxsatini kuting.';
      p.append(
        "Hisobingiz muvaffaqiyatli yaratildi.", document.createElement('br'),
        s, document.createElement('br'),
        "Ruxsat berilgandan so'ng avtomatik kirasiz."
      );
    }
  }

  if (screen)   { screen.style.display = 'flex'; screen.dataset.reason = reason; }
  if (app)      { app.classList.remove('show'); }
  if (authWrap) { authWrap.classList.remove('show'); }
  if (reason === 'pending') _startPendingNoticeWatcher();
}

// Offline-verify ekrani ko'rsatilgan bo'lsa — internet qaytishi bilan avtomatik
// qayta tekshiramiz (to'liq reload — onAuthStateChanged qayta ishga tushib,
// haqiqiy serverdan yangi holatni oladi).
window.addEventListener('online', () => {
  const screen = $('pendingApprovalScreen');
  if (screen && screen.dataset.reason === 'offline-verify' && screen.style.display !== 'none') {
    location.reload();
  }
});

export function hidePendingScreen() {
  const screen = $('pendingApprovalScreen');
  if (screen) { screen.style.display = 'none'; }
  _stopPendingNoticeWatcher();
  _stopBlockedCountdown();
}

// "Chiqish" tugmasi — pending ekrandagi
const pendingSignOutBtn = $('pendingSignOutBtn');
if (pendingSignOutBtn) {
  pendingSignOutBtn.addEventListener('click', async () => {
    if (typeof _onPendingSignOut === 'function') await _onPendingSignOut();
    hidePendingScreen();
    try { await sb.auth.signOut(); } catch (_) {}
    try { document.cookie = 'sp_at=; Path=/; Max-Age=0; SameSite=Lax' + (location.protocol === 'https:' ? '; Secure' : ''); } catch (_) {}
    location.replace('/login');
  });
}

