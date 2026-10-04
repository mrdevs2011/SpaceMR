/**
 * install-guide.js — "Ilovani o'rnating + bildirishnomani yoqing" yo'riqnomasi.
 *  • Sozlamalarda "Yo'riqnoma" tugmasi (#guideOpenBtn) → pastdan chiqadigan oyna
 *  • Kirgandan keyin mobil qurilmada BIR MARTALIK yopiladigan karta
 * Platformaga qarab matn o'zgaradi: iPhone / Android / kompyuter.
 * iPhone'da bildirishnoma faqat bosh ekrandan ochilgan ilovada ishlaydi (iOS 16.4+).
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
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private rejim */ } };

const I = {
  share: '<svg viewBox="0 0 24 24"><path d="M12 3v12"/><path d="m8 7 4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/></svg>',
  menu: '<svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>',
  install: '<svg viewBox="0 0 24 24"><path d="M12 3v12"/><path d="m7 11 5 5 5-5"/><path d="M5 21h14"/></svg>',
  open: '<svg viewBox="0 0 24 24"><rect x="5" y="2" width="14" height="20" rx="3"/><path d="M11 18h2"/></svg>',
  bell: '<svg viewBox="0 0 24 24"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="m5 12 5 5L20 7"/></svg>',
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

let overlay = null;

function ensureOverlay() {
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.className = 'ig-overlay';
  overlay.id = 'guideOverlay';
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeGuide(); });
  document.body.appendChild(overlay);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay?.classList.contains('show')) closeGuide();
  });
  return overlay;
}

function renderGuide() {
  const standalone = isStandalone();
  const steps = buildSteps();
  const denied = 'Notification' in window && Notification.permission === 'denied';
  const canEnableHere = 'Notification' in window && Notification.permission === 'default' && (!IS_IOS || standalone);

  const title = standalone ? 'Bildirishnomani yoqing' : "Ilovani o'rnating";
  const sub = standalone
    ? 'Yangi xabar, izoh va qo\'ng\'iroqlar haqida darhol xabar olasiz.'
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

  overlay.innerHTML = `
    <div class="ig-sheet" role="dialog" aria-modal="true" aria-label="${title}">
      <div class="ig-bell">${standalone ? I.bell : I.install}</div>
      <h2 class="ig-title">${title}</h2>
      <p class="ig-sub">${sub}</p>
      <ol class="ig-steps">${stepsHtml}</ol>
      ${note}${warn}
      ${_deferredInstall && !standalone ? '<button type="button" class="pw-btn" id="igInstallBtn">Ilovani o\'rnatish</button>' : ''}
      ${canEnableHere ? `<button type="button" class="${_deferredInstall && !standalone ? 'pw-ghost' : 'pw-btn'}" id="igNotifBtn">Bildirishnomani yoqish</button>` : ''}
      <button type="button" class="${(_deferredInstall && !standalone) || canEnableHere ? 'pw-link' : 'pw-btn'}" id="igCloseBtn">Tushundim</button>
    </div>`;

  $('igCloseBtn').onclick = closeGuide;
  const inst = $('igInstallBtn');
  if (inst) inst.onclick = async () => {
    try {
      _deferredInstall.prompt();
      await _deferredInstall.userChoice;
    } catch { /* foydalanuvchi bekor qildi */ }
    _deferredInstall = null;
    closeGuide();
  };
  const nb = $('igNotifBtn');
  if (nb) nb.onclick = () => enableNotifs(nb);
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

export function openGuide() {
  ensureOverlay();
  dismissCard();
  renderGuide();
  overlay.classList.add('show');
}
export function closeGuide() { overlay?.classList.remove('show'); }

/* ── Bir martalik karta (faqat telefonda) ── */
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
    if (card || overlay?.classList.contains('show')) return;
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
      if (isInstall) { openGuide(); return; }
      dismissCard();
      await enableNotifs(null);
    };
  }, 8000);
}

/* ── Sozlamalardagi "Yo'riqnoma" tugmasi ── */
export function initInstallGuide() {
  const btn = $('guideOpenBtn');
  if (btn) btn.onclick = openGuide;
}
initInstallGuide();
