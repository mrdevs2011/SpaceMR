/**
 * install-guide.js — "Ilovani o'rnating + bildirishnomani yoqing" yo'riqnomasi.
 *  • Login: #loginGuideBtn / #loginInstallBtn → auth-card ICHIDA (float emas)
 *  • Sozlamalar: #guideOpenBtn → pastdan chiqadigan overlay
 *  • Kirgandan keyin mobil: bir martalik karta
 */
import { $ } from '../core/utils.js';
import { toast } from './toast.js';
import { setNotificationsEnabled } from '../push.js';

const LS_CARD = 'spacemrGuideCardSeen';
const LS_NOTIF_CARD = 'spacemrNotifCardSeen';

const ua = navigator.userAgent || '';
const IS_IOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const IS_ANDROID = /Android/i.test(ua);
const IS_MOBILE = IS_IOS || IS_ANDROID;
const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;

let _deferredInstall = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); _deferredInstall = e; });
window.addEventListener('appinstalled', () => { _deferredInstall = null; closeGuide(); });

const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private */ } };

const I = {
  share: '<img src="./svg/extra/icon-9157214ed9c4.svg" alt="" class="icon" width="20" height="20">',
  plus: '<img src="./svg/extra/icon-96495123cb1b.svg" alt="" class="icon" width="18" height="18">',
  menu: '<img src="./svg/ui/dots-vertical.svg" alt="" class="icon" width="20" height="20">',
  install: '<img src="./svg/extra/icon-649766ef725f.svg" alt="" class="icon" width="20" height="20">',
  open: '<img src="./svg/extra/icon-651dd2923a10.svg" alt="" class="icon" width="14" height="20">',
  bell: '<img src="./svg/extra/icon-615b4dff4d09.svg" alt="" class="icon" width="20" height="20">',
  check: '<img src="./svg/extra/icon-36ae445873ad.svg" alt="" class="icon" width="20" height="20">',
};

function buildSteps() {
  const standalone = isStandalone();
  const notif = { i: I.bell, t: "Sozlamalar → <b>Push bildirishnomalar</b> ni yoqing" };
  if (standalone) {
    return [notif, { i: I.check, t: "Brauzer ruxsat so'rasa — <b>Ruxsat berish</b> ni bosing" }];
  }
  if (IS_IOS) {
    return [
      { i: I.share, t: "Safari'da pastdagi <b>Ulashish</b> tugmasini bosing" },
      { i: I.plus, t: "<b>Bosh ekranga qo'shish</b> ni tanlang va «Qo'shish» ni bosing" },
      { i: I.open, t: "Bosh ekrandagi <b>SpaceMR</b> belgisini oching" },
      notif,
    ];
  }
  if (IS_ANDROID) {
    return [
      { i: I.menu, t: "Chrome'da yuqoridagi <b>⋮</b> menyusini oching" },
      { i: I.install, t: "<b>Ilovani o'rnatish</b> (yoki «Bosh ekranga qo'shish») ni tanlang" },
      { i: I.open, t: "Bosh ekrandagi <b>SpaceMR</b> belgisini oching" },
      notif,
    ];
  }
  return [
    { i: I.install, t: "Manzil qatoridagi <b>o'rnatish</b> belgisini bosing (ixtiyoriy)" },
    notif,
    { i: I.check, t: "Brauzer ruxsat so'rasa — <b>Ruxsat berish</b> ni bosing" },
  ];
}

/* ── Overlay (faqat sozlamalar / app ichida) ── */
let overlay = null;
let _mode = 'overlay'; // 'overlay' | 'auth'

function ensureOverlay() {
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.className = 'ig-overlay';
  overlay.id = 'guideOverlay';
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeGuide(); });
  document.body.appendChild(overlay);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isGuideOpen()) closeGuide();
  });
  return overlay;
}

function isGuideOpen() {
  if (_mode === 'auth') {
    return !!document.getElementById('authGuideInline');
  }
  return !!overlay?.classList.contains('show');
}

function guideBodyHtml() {
  const standalone = isStandalone();
  const steps = buildSteps();
  const denied = 'Notification' in window && Notification.permission === 'denied';
  const canEnableHere = 'Notification' in window && Notification.permission === 'default' && (!IS_IOS || standalone);

  const title = standalone ? 'Bildirishnomani yoqing' : "Ilovani o'rnating";
  const sub = standalone
    ? "Yangi xabar, izoh va qo'ng'iroqlar haqida darhol xabar olasiz."
    : "Bosh ekranga qo'shsangiz SpaceMR ilova kabi ochiladi va bildirishnomalar keladi.";

  const stepsHtml = steps.map((s, i) => `
    <li class="ig-step">
      <span class="ig-num">${i + 1}</span>
      <span class="ig-txt">${s.t}</span>
      <span class="ig-ico">${s.i}</span>
    </li>`).join('');

  const note = IS_IOS && !standalone
    ? `<div class="ig-note">iPhone'da bildirishnomalar faqat bosh ekrandan ochilgan ilovada ishlaydi (iOS 16.4 va yuqori).</div>` : '';
  const warn = denied
    ? `<div class="ig-note ig-warn">Bildirishnoma bloklangan. Brauzer yoki telefon sozlamalaridan SpaceMR uchun ruxsat bering.</div>` : '';

  return `
    <div class="ig-bell">${standalone ? I.bell : I.install}</div>
    <h2 class="ig-title">${title}</h2>
    <p class="ig-sub">${sub}</p>
    <ol class="ig-steps">${stepsHtml}</ol>
    ${note}${warn}
    ${_deferredInstall && !standalone ? '<button type="button" class="pw-btn" id="igInstallBtn">Ilovani o\'rnatish</button>' : ''}
    ${canEnableHere ? `<button type="button" class="${_deferredInstall && !standalone ? 'pw-ghost' : 'pw-btn'}" id="igNotifBtn">Bildirishnomani yoqish</button>` : ''}
    <button type="button" class="${(_deferredInstall && !standalone) || canEnableHere ? 'pw-link' : 'pw-btn'}" id="igCloseBtn">Tushundim</button>`;
}

function bindGuideButtons() {
  const closeBtn = document.getElementById('igCloseBtn');
  if (closeBtn) closeBtn.onclick = closeGuide;
  const inst = document.getElementById('igInstallBtn');
  if (inst) inst.onclick = async () => {
    try {
      _deferredInstall.prompt();
      await _deferredInstall.userChoice;
    } catch { /* bekor */ }
    _deferredInstall = null;
    closeGuide();
  };
  const nb = document.getElementById('igNotifBtn');
  if (nb) nb.onclick = () => enableNotifs(nb);
}

/* ── Auth-card ichida (login) ── */
const AUTH_HIDE_SEL = [
  '#nameRow', '#aUsername', '#aPassword', '#confirmRow',
  '#forgotPasswordWrap', '#authErr', '#authBtn',
  '.auth-switch', '.auth-install', '#authTitle',
].join(',');

function openGuideInAuth() {
  const card = document.querySelector('#authWrap .auth-card');
  if (!card) { openGuideOverlay(); return; }

  // Allaqachon ochiq bo'lsa qayta ochma
  if (document.getElementById('authGuideInline')) return;

  _mode = 'auth';
  dismissCard();

  // Login formani yashirish
  card.querySelectorAll(AUTH_HIDE_SEL).forEach((el) => {
    el.dataset.igPrevDisplay = el.style.display || '';
    el.style.display = 'none';
  });

  const panel = document.createElement('div');
  panel.id = 'authGuideInline';
  panel.className = 'ig-sheet ig-sheet--inline';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', "Yo'riqnoma");
  panel.innerHTML = guideBodyHtml();
  card.appendChild(panel);
  bindGuideButtons();
}

function closeGuideInAuth() {
  const panel = document.getElementById('authGuideInline');
  panel?.remove();
  const card = document.querySelector('#authWrap .auth-card');
  if (card) {
    card.querySelectorAll(AUTH_HIDE_SEL).forEach((el) => {
      if (el.dataset.igPrevDisplay !== undefined) {
        el.style.display = el.dataset.igPrevDisplay;
        delete el.dataset.igPrevDisplay;
      } else {
        el.style.display = '';
      }
    });
  }
  _mode = 'overlay';
}

/* ── Overlay (sozlamalar) ── */
function openGuideOverlay() {
  _mode = 'overlay';
  ensureOverlay();
  dismissCard();
  overlay.innerHTML = `<div class="ig-sheet" role="dialog" aria-modal="true">${guideBodyHtml()}</div>`;
  bindGuideButtons();
  overlay.classList.add('show');
}

async function enableNotifs(btn) {
  if (btn) { btn.disabled = true; btn.textContent = 'Yoqilmoqda...'; }
  try {
    const ok = await setNotificationsEnabled(true);
    toast(ok ? 'Bildirishnomalar yoqildi' : "Ruxsat berilmadi — brauzer bloklagan bo'lishi mumkin", ok ? 'success' : 'error');
    if (ok) closeGuide();
  } catch (e) {
    toast('Xato: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Bildirishnomani yoqish'; }
  }
}

export function openGuide(opts = {}) {
  const inAuth = opts.inAuth === true ||
    (document.getElementById('authWrap') &&
      document.getElementById('authWrap').style.display !== 'none' &&
      opts.fromLogin);
  if (inAuth || opts.fromLogin) openGuideInAuth();
  else openGuideOverlay();
}

export function closeGuide() {
  if (_mode === 'auth' || document.getElementById('authGuideInline')) {
    closeGuideInAuth();
  }
  overlay?.classList.remove('show');
}

/* ── Bir martalik karta (faqat telefonda, app ichida) ── */
let card = null;
function dismissCard() { card?.remove(); card = null; }

export function maybeShowGuideCard() {
  if (!IS_MOBILE || card) return;
  const standalone = isStandalone();
  let kind = null;
  if (!standalone && !lsGet(LS_CARD)) kind = 'install';
  else if (standalone && 'Notification' in window && Notification.permission === 'default' && !lsGet(LS_NOTIF_CARD)) kind = 'notif';
  if (!kind) return;

  setTimeout(() => {
    if (card || isGuideOpen()) return;
    // Auth ekranida ko'rsatma
    if (document.getElementById('authWrap')?.style.display !== 'none') return;
    card = document.createElement('div');
    card.className = 'ig-card';
    const isInstall = kind === 'install';
    card.innerHTML = `
      <div class="ig-card-ico">${isInstall ? I.install : I.bell}</div>
      <div class="ig-card-txt">
        <strong>${isInstall ? "Ilovani o'rnating" : 'Bildirishnomani yoqing'}</strong>
        <span>${isInstall ? "Tezroq ochiladi, bildirishnoma keladi" : "Xabar va qo'ng'iroqlarni o'tkazib yubormang"}</span>
      </div>
      <button type="button" class="ig-card-go">${isInstall ? "Ko'rsatma" : 'Yoqish'}</button>
      <button type="button" class="ig-card-x" aria-label="Yopish">✕</button>`;
    document.body.appendChild(card);
    const mark = () => lsSet(isInstall ? LS_CARD : LS_NOTIF_CARD, '1');
    card.querySelector('.ig-card-x').onclick = () => { mark(); dismissCard(); };
    card.querySelector('.ig-card-go').onclick = async () => {
      mark();
      if (isInstall) { openGuideOverlay(); return; }
      dismissCard();
      await enableNotifs(null);
    };
  }, 8000);
}

/* ── Init ── */
let _igInited = false;
export function initInstallGuide() {
  if (_igInited) return;
  _igInited = true;
  document.addEventListener('click', (e) => {
    const loginBtn = e.target.closest?.('#loginInstallBtn, #loginGuideBtn');
    if (loginBtn) {
      e.preventDefault();
      e.stopPropagation();
      openGuide({ fromLogin: true });
      return;
    }
    const t = e.target.closest?.('#guideOpenBtn');
    if (t) {
      e.preventDefault();
      e.stopPropagation();
      openGuideOverlay();
    }
  });
}
initInstallGuide();
