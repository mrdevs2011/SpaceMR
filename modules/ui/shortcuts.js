/**
 * Klaviatura shortcutlari.
 *  Esc            — eng ustki ochiq oyna/modalni yopadi
 *  Enter          — composer'da postni yuboradi (Shift+Enter = yangi qator,
 *                   faqat sichqonchali qurilmada; telefonda Enter = yangi qator)
 *  Ctrl/Cmd+Enter — composer'da har doim yuboradi
 *  Enter          — kirish/ro'yxat, profil tahriri, guruh formalari, tasdiq oynasida asosiy amal
 *  Enter          — izoh inputida izohni yuboradi
 *  N              — yangi post (composer)
 *  /              — qidiruv
 */
import { $, unlockScroll } from '../core/utils.js';
import { state } from '../core/config.js';
import { closeChatThread } from '../chat/chat.js';
import { escLocals } from './esc-stack.js';

const isOpen = el => !!el && (el.classList.contains('show') || el.classList.contains('open') || el.style.display === 'flex' || el.style.display === 'block' || el.id === 'chatCtxOverlay' || el.classList.contains('chat-ctx-overlay'));

/* Backdrop bosilganda yopiladigan overlaylar uchun */
const backdrop = id => () => {
  const el = $(id);
  if (!el) return;
  el.click();
  if (isOpen(el)) { el.classList.remove('show', 'open'); unlockScroll(); }
};

/* Ochiq oynalar. Qaysi biri ustda ekani z-index bo'yicha ish vaqtida aniqlanadi (closeTopmost) */
const CLOSERS = [
  ['chatCtxOverlay',         () => $('chatCtxOverlay')?.remove()],
  ['confirmOverlay',         () => $('confirmCancelBtn')?.click()],
  ['zoomModal',              () => $('zoomClose')?.click()],
  ['grpAddUserOverlay',      backdrop('grpAddUserOverlay')],
  ['grpCreateFormOverlay',   backdrop('grpCreateFormOverlay')],
  ['grpInfoOverlay',         backdrop('grpInfoOverlay')],
  ['grpEditOverlay',         backdrop('grpEditOverlay')],
  ['uploadOverlay',          () => $('cancelUpload')?.click()],
  ['cmtModal',               () => $('cmtModalClose')?.click()],
  ['reelCapSheet',           backdrop('reelCapSheet')],
  ['settingsOverlay',        backdrop('settingsOverlay')],
  ['searchOverlay',          () => $('searchOverlayClose')?.click()],
  ['userProfileModal',       () => $('upBack')?.click()],
  ['detailModal',            () => $('detailModal')?.classList.remove('show')],
  ['sbSearchPanel',          () => $('sbSearchPanel')?.classList.remove('show')],
  ['settingsMoreMenu',       () => $('settingsMoreMenu')?.classList.remove('show')],
  ['chatThreadModal',        () => closeChatThread()],
  ['regRecoveryModal',       () => $('regRecoverySkipBtn')?.click()],
  ['mandatoryPwdOverlay',    () => $('mandatoryPwdSignOutBtn')?.click()],
  ['adminResetPwdOverlay',   () => $('adminResetCancelBtn')?.click()],
];

const zOf = el => { const z = parseInt(getComputedStyle(el).zIndex, 10); return Number.isFinite(z) ? z : 0; };

/* Esc: butun ilova bo'yicha faqat ENG USTKI narsani yopadi — ochiq oyna ham, ichki holat (menyu, tanlash, emoji panel...) ham.
   Hech narsa yopilmasa false qaytaradi (Esc hech narsani buzmaydi, chatdan ham chiqarmaydi). */
function closeTopmost() {
  const items = escLocals().map(l => ({ z: l.z, run: l.fn }));
  for (const [id, close] of CLOSERS) {
    const el = $(id);
    if (isOpen(el)) items.push({ z: zOf(el), run: () => { close(); return true; } });
  }
  items.sort((a, b) => b.z - a.z); // tenglikda ichki holatlar (oldin qo'shilgan) birinchi
  for (const it of items) { if (it.run()) return true; }
  return false;
}

const anyOpen = () => CLOSERS.some(([id]) => isOpen($(id)));
const isTyping = t => !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
const hasMouse = () => window.matchMedia?.('(pointer: fine)').matches ?? true;

/* ── Esc + bir harfli shortcutlar ────────────────────────────────────── */
document.addEventListener('keydown', e => {
  if (e.isComposing) return;

  if (e.key === 'Escape') {
    if (closeTopmost()) { e.preventDefault(); return; }
    // Hech narsa ochiq emas, lekin /p/<id> fokusida — bitta oldingi URL ga
    if (state.focusPostId && !isTyping(e.target)) {
      e.preventDefault();
      import('../url-router.js').then(m => m.goBack());
    }
    return;
  }

  if (e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
  if (!state.me?.uid || anyOpen()) return;

  if (e.key === 'n' || e.key === 'N') {
    e.preventDefault();
    ($('createBtn') || $('hdrNewPostBtn'))?.click();
  } else if (e.key === '/') {
    e.preventDefault();
    $('hdrSearchBtn')?.click();
  }
});

/* ── Enter: ochiq oyna / forma holatiga qarab asosiy amalni bajaradi (butun ilova bo'yicha) ──────────────
   Chat, izoh, qidiruv, composer o'zining Enter'ini boshqaradi (preventDefault qiladi) — ularga tegmaymiz.
   Quyidagilar esa Enter'siz edi: kirish/ro'yxatdan o'tish, profil tahriri, guruh formalari, tasdiq oynasi. */
const visible = el => !!el && el.offsetParent !== null && !el.disabled;

// fields — tartib bilan; next:true bo'lsa Enter avval keyingi BO'SH maydonga o'tadi, hammasi to'lgan bo'lsa yuboradi
const FORMS = [
  { fields: ['aFullname', 'aRecoveryEmail', 'aUsername', 'aPassword', 'aConfirm'], btn: 'authBtn', next: true },
  { fields: ['editName', 'editUsername', 'editRecoveryEmail', 'editOldPassword', 'editNewPassword', 'editNewPassword2'], btn: 'saveProfileBtn' },
  { fields: ['grpAddUserInput'], btn: 'grpAddUserSubmitBtn' },
  { fields: ['grpFormName'], btn: 'grpFormCreateBtn' },
  { fields: ['grpEditName'], btn: 'grpEditSaveBtn' },
];
// Ko'p qatorli maydonlarda Enter = yangi qator, Ctrl/Cmd+Enter = yuborish
const MULTILINE = [
  { field: 'editBioInput', btn: 'saveProfileBtn' },
  { field: 'grpFormDesc',  btn: 'grpFormCreateBtn' },
  { field: 'grpEditDesc',  btn: 'grpEditSaveBtn' },
  { field: 'bcBody',       btn: 'bcSendBtn' },
];
const NON_TEXT = ['checkbox', 'radio', 'file', 'button', 'submit', 'range', 'color'];

document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || e.isComposing || e.defaultPrevented || e.altKey) return;
  const t = e.target;
  const onButton = t instanceof HTMLButtonElement || !!t.closest?.('a, button');

  // Tasdiq oynasi / modallar: Enter = asosiy tugma
  if (!onButton) {
    if (isOpen($('confirmOverlay'))) { e.preventDefault(); $('confirmOkBtn')?.click(); return; }
    if (isOpen($('regRecoveryModal'))) {
      e.preventDefault();
      const inputStep = $('regRecoveryStepInput');
      if (inputStep && inputStep.style.display !== 'none') {
        $('regRecoverySubmitBtn')?.click();
      } else {
        $('regRecoveryAddBtn')?.click();
      }
      return;
    }
  }

  if (t.tagName === 'INPUT' && !NON_TEXT.includes(t.type)) {
    const f = FORMS.find(x => x.fields.includes(t.id));
    if (!f) return;
    e.preventDefault();
    if (f.next) {
      const els = f.fields.map($).filter(visible);
      const nextEmpty = els.slice(els.indexOf(t) + 1).find(x => !x.value);
      if (nextEmpty) { nextEmpty.focus(); return; }
    }
    const btn = $(f.btn);
    if (visible(btn)) btn.click();
  } else if (t.tagName === 'TEXTAREA' && (e.ctrlKey || e.metaKey)) {
    const m = MULTILINE.find(x => x.field === t.id);
    if (!m) return;
    e.preventDefault();
    const btn = $(m.btn);
    if (visible(btn)) btn.click();
  }
});

/* ── Composer: Enter = Post ──────────────────────────────────────────── */
$('captionInput')?.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || e.isComposing) return;
  const force = e.ctrlKey || e.metaKey;
  if (!force && (e.shiftKey || !hasMouse())) return; // yangi qator
  e.preventDefault();
  const btn = $('uploadBtn');
  if (btn && !btn.disabled) btn.click();
});

/* ── Izoh: Enter = yuborish ──────────────────────────────────────────── */
$('cmtModalInput')?.addEventListener('keydown', e => {
  if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
  e.preventDefault();
  $('cmtModalSend')?.click();
});
