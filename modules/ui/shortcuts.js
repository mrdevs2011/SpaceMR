/**
 * Klaviatura shortcutlari.
 *  Esc            — eng ustki ochiq oyna/modalni yopadi
 *  Enter          — composer'da postni yuboradi (Shift+Enter = yangi qator,
 *                   faqat sichqonchali qurilmada; telefonda Enter = yangi qator)
 *  Ctrl/Cmd+Enter — composer'da har doim yuboradi
 *  Enter          — kirish/ro'yxat, profil tahriri, guruh formalari, tasdiq oynasida asosiy amal
 *  Enter          — izoh inputida izohni yuboradi
 *  N              — yangi post (composer)
 *  /              — qidiruv (Kashf)
 *  H              — Bosh sahifa
 *  C              — Suhbatlar
 *  P              — Profil
 *  Ctrl/Cmd+K     — Qidiruv
 *  Ctrl/Cmd+,     — Sozlamalar
 *  Ctrl/Cmd+1…9/0 — Home / Explore / Notifs / Chats / Apps / Saved / Profil / Group / Shikoyat / Post
 *  Ctrl/Cmd+Shift+0 — Story upload
 *  Delete         — tanlangan o'z xabarlarini o'chirish (chat)
 */
import { $, unlockScroll } from '../core/utils.js';
import { state, isUploading } from '../core/config.js';
import { toast } from './toast.js';
import { closeChatThread } from '../chat/chat.js';
import { escLocals } from './esc-stack.js';

const isOpen = el => !!el && (el.classList.contains('show') || el.classList.contains('open') || el.style.display === 'flex' || el.style.display === 'block' || el.id === 'chatCtxOverlay' || el.classList.contains('chat-ctx-overlay'));

/* Backdrop bosilganda yopiladigan overlaylar uchun */
const backdrop = id => () => {
  const el = $(id);
  if (!el) return;
  el.click();
  if (isOpen(el)) { el.classList.remove('show', 'open'); unlockScroll(id); }
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
/** Mobil/planshet: Ctrl+1…0, H/C/P/N va h.k. ishlamasin. Esc va Enter saqlanadi. */
const navShortcutsOn = () => {
  try {
    if (window.matchMedia('(max-width: 1099px)').matches) return false;
    if (window.matchMedia('(pointer: coarse)').matches) return false;
    if (window.matchMedia('(hover: none)').matches && !window.matchMedia('(pointer: fine)').matches) return false;
    return true;
  } catch (_) { return true; }
};

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

  // Mobil / tablet — navigatsiya shortcutlari o'chirilgan
  if (!navShortcutsOn()) return;

  // Ctrl/Cmd navigatsiya — input fokusida HAM ishlaydi (aks holda Ctrl+2 → qidiruv
  // fokuslanadi va Ctrl+3/4… bloklanadi). Ctrl+A/C/V/X/Z kabi tahrir shortcutlari
  // faqat o'ziga tegishli — ularga tegmaymiz.
  const mod = e.ctrlKey || e.metaKey;
  if (e.altKey) return;
  if (!state.me?.uid) return;

  // Ctrl/Cmd shortcutlar — bir marta, mustaqil (e.repeat yo'q)
  if (mod) {
    if (e.repeat) return;
    // Brauzer tahrir shortcutlari — inputda o'tkazib yuboramiz
    const kl0 = (e.key || '').toLowerCase();
    if (isTyping(e.target) && ['a','c','v','x','z','y','r','f','p','s','u','i','b'].includes(kl0) && !/^Digit/.test(e.code||'')) {
      return;
    }

    const k = e.key;
    const kl = (k || '').toLowerCase();
    const codeDigit = /^Digit([0-9])$/.exec(e.code || '');
    const digit = codeDigit ? codeDigit[1]
      : (k === '0' || k === ')') ? '0'
      : (k >= '1' && k <= '9') ? k
      : null;

    const stop = () => { e.preventDefault(); e.stopPropagation(); };
    const path = (p) => import('../url-router.js').then(m => m.applyPath(p)).catch(() => {});
    const go = (route) => import('../router.js').then(m => m.navigateTo(route)).catch(() => {});

    if (kl === 'k') {
      stop();
      path('/explore');
      return;
    }
    if (k === ',') {
      stop();
      const s = $('settingsBtn') || $('rrSettingsBtn');
      if (s) s.click();
      return;
    }

    if (digit !== null) {
      stop();
      // Bitta raqam = bitta amal (zanjir/click dublikat yo'q)
      switch (digit) {
        case '1': path('/home'); break;
        case '2': path('/explore'); break;
        case '3': path('/notifications'); break;
        case '4': path('/chats'); break;
        case '5': path('/apps'); break;
        case '6': path('/saved'); break;
        case '7': path('/profile'); break;
        case '8': path('/chats/g/spacemr'); break;
        case '9': path('/report'); break;
        case '0':
          if (e.shiftKey) {
            import('../feed/upload.js').then(m => m.openStoryComposer?.()).catch(() => {});
          } else {
            import('../feed/upload.js').then(m => m.openComposer?.()).catch(() => {});
          }
          break;
        default: break;
      }
      return;
    }
    return; // boshqa Ctrl kombinatsiyalar (Ctrl+R va h.k.) — tegmaymiz
  }

  if (mod || isTyping(e.target)) return;
  if (e.repeat) return;
  if (anyOpen()) return;

  // Bir harfli — Ctrl/Cmd bilan aralashmaydi
  if (e.key === 'n' || e.key === 'N') {
    e.preventDefault();
    import('../feed/upload.js').then(m => m.openComposer?.()).catch(() => {
      ($('createBtn') || $('hdrNewPostBtn'))?.click();
    });
  } else if (e.key === '/') {
    e.preventDefault();
    import('../url-router.js').then(m => m.applyPath('/explore')).catch(() => {});
  } else if (e.key === 'c' || e.key === 'C') {
    e.preventDefault();
    import('../url-router.js').then(m => m.applyPath('/chats')).catch(() => {});
  } else if (e.key === 'h' || e.key === 'H') {
    e.preventDefault();
    import('../url-router.js').then(m => m.applyPath('/home')).catch(() => {});
  } else if (e.key === 'p' || e.key === 'P') {
    e.preventDefault();
    import('../url-router.js').then(m => m.applyPath('/profile')).catch(() => {});
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

/* ── Upload paytida Ctrl+R / F5 / Cmd+R ni bloklash ─────────────────────── */
document.addEventListener('keydown', e => {
  if (!isUploading()) return;
  const key = e.key;
  const isF5 = key === 'F5';
  const isReload = (e.ctrlKey || e.metaKey) && (key === 'r' || key === 'R');
  if (!isF5 && !isReload) return;
  e.preventDefault();
  e.stopPropagation();
  toast('Yuklanmoqda… Sahifani yangilamang', 'info', 2800);
}, true);

window.addEventListener('beforeunload', e => {
  if (!isUploading()) return;
  e.preventDefault();
  e.returnValue = '';
});
