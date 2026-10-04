import { esc } from '../core/utils.js';
/**
 * auth-settings.js — sozlamalar sheet (notif, kesh, hisob o'chirish)
 * auth.js dan ehtiyotkor ajratilgan.
 */
import { sb, state, purgeUserMedia } from '../core/config.js';
import { $, defAvi, lockScroll, unlockScroll, showConfirm } from '../core/utils.js';
import { toast } from '../ui/toast.js';
import { removePushToken, areNotificationsEnabled, setNotificationsEnabled } from '../push.js';
import { clearAllCache, clearRuntimeCache, getCachedProfile } from '../core/local-cache.js';

/* ── Sozlamalar (Settings) sheet — bildirishnoma + hisobni o'chirish ── */

function applyNotifToggleUI() {
  const toggle = $('notifToggle');
  const hint   = $('notifHint');
  if (!toggle) return;
  const denied = ('Notification' in window) && Notification.permission === 'denied';
  const on     = areNotificationsEnabled();
  toggle.classList.toggle('on', on);
  toggle.classList.toggle('disabled', denied);
  toggle.setAttribute('aria-checked', String(on));
  if (hint) {
    hint.textContent = denied
      ? "Brauzer bildirishnomalarni bloklagan — brauzer sozlamalaridan yoqing"
      : "Yangi xabar, izoh va qo'ng'iroqlar haqida xabar bering";
  }
}

/** Sozlamalar sahifasi tepasidagi profil kartasini to'ldiradi
 *  (avatar, ism, username) — keshdan darhol, tarmoqni kutmasdan. */
export function paintSettingsProfileCard() {
  if (!state.me) return;
  const cached = getCachedProfile(state.me.uid) || {};
  const fn = cached.fullName || state.me.displayName || 'Foydalanuvchi';
  const av = cached.avatar || defAvi(fn);

  const aviEl = $('settingsAvi');
  if (aviEl) aviEl.innerHTML = `<img src="${esc(av)}" onerror="this.style.display='none'">`;

  const nameEl = $('settingsName');
  if (nameEl) nameEl.textContent = fn;

  const userEl = $('settingsUsername');
  if (userEl) userEl.textContent = cached.username ? '@' + cached.username : "Foydalanuvchi nomi yo'q";
}

/** Sozlamalardagi Zaxira email qatorini yangilaydi */
export function paintSettingsRecoveryRow() {
  if (!state.me) return;
  const hintEl = $('settingsRecoveryHint');
  if (!hintEl) return;
  const rec = state.me.recoveryEmail;
  if (rec) {
    hintEl.textContent = `Faol: ${rec}`;
    hintEl.style.color = 'var(--green, #00ba7c)';
  } else {
    hintEl.textContent = "O'rnatilmagan (parolni tiklash uchun qo'shing)";
    hintEl.style.color = 'var(--tg-primary-blue, #1d9bf0)';
  }
}

let _populateProfileForm = null;

export function initAuthSettings(opts = {}) {
  _populateProfileForm = opts.populateProfileForm || null;
}

const settingsBtn = $('settingsBtn');
if (settingsBtn) {
  settingsBtn.onclick = () => {
    if (typeof _populateProfileForm === 'function') _populateProfileForm();
    applyNotifToggleUI();
    $('settingsMoreMenu')?.classList.remove('show');
    const settingsOverlay = $('settingsOverlay');
    if (settingsOverlay) {
      settingsOverlay.classList.add('show');
      // Desktopda scroll qulflanmasin (side panel)
      if (!window.matchMedia('(min-width: 1200px)').matches) lockScroll();
    }
  };
}

function isDesktopSettingsPinned() {
  return window.matchMedia('(min-width: 1200px)').matches &&
    (state.view === 'profile' || document.body.classList.contains('desktop-settings-pinned'));
}

const closeSettingsBtn = $('closeSettingsBtn');
if (closeSettingsBtn) {
  closeSettingsBtn.onclick = () => {
    // Desktop profil: sozlamalar doimo ochiq — yopilmaydi
    if (isDesktopSettingsPinned()) return;
    $('settingsMoreMenu')?.classList.remove('show');
    const settingsOverlay = $('settingsOverlay');
    if (settingsOverlay) { settingsOverlay.classList.remove('show'); unlockScroll(); }
  };
}

const settingsOverlay = $('settingsOverlay');
if (settingsOverlay) {
  settingsOverlay.onclick = e => {
    if (e.target === settingsOverlay) {
      if (isDesktopSettingsPinned()) return;
      $('settingsMoreMenu')?.classList.remove('show');
      settingsOverlay.classList.remove('show');
      unlockScroll();
    }
  };
}

/* Settings accordion: bosilsa ochiladi / yopiladi */
(function initPeAccordions() {
  const root = document.getElementById('settingsOverlay');
  if (!root) return;
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('.pe-acc-toggle');
    if (!btn || !root.contains(btn)) return;
    const acc = btn.closest('.pe-accordion');
    if (!acc) return;
    const open = !acc.classList.contains('open');
    root.querySelectorAll('.pe-accordion').forEach((el) => {
      const on = open && el === acc;
      el.classList.toggle('open', on);
      el.querySelector('.pe-acc-toggle')?.setAttribute('aria-expanded', on ? 'true' : 'false');
    });
  });
})();

const notifToggle = $('notifToggle');
if (notifToggle) {
  notifToggle.onclick = async () => {
    if (notifToggle.classList.contains('disabled')) {
      toast('Bildirishnomalar brauzer sozlamalaridan bloklangan', 'error');
      return;
    }
    const turningOn = !notifToggle.classList.contains('on');
    notifToggle.classList.add('disabled'); // ishlov tugaguncha qayta bosilmasin
    try {
      const finalState = await setNotificationsEnabled(turningOn);
      applyNotifToggleUI();
      if (turningOn && !finalState) {
        toast('Ruxsat berilmadi — brauzer bildirishnomalarni bloklagan bo\'lishi mumkin', 'error');
      } else {
        toast(finalState ? 'Bildirishnomalar yoqildi' : "Bildirishnomalar o'chirildi", 'success');
      }
    } catch (e) {
      toast('Xato: ' + e.message, 'error');
      applyNotifToggleUI();
    }
  };
}

const clearCacheBtn = $('clearCacheBtn');
if (clearCacheBtn) {
  clearCacheBtn.onclick = async () => {
    clearCacheBtn.disabled = true;
    try {
      clearAllCache();
      await clearRuntimeCache();
      toast('Kesh tozalandi', 'success');
    } catch (e) {
      toast('Xato: ' + e.message, 'error');
    } finally {
      clearCacheBtn.disabled = false;
    }
  };
}

/* Yordam tugmasi — manzil index.html dagi #helpBtn[data-href] da (Telegram t.me/... yoki mailto:...) */
const helpBtn = $('helpBtn');
if (helpBtn) {
  helpBtn.onclick = () => {
    const href = (helpBtn.dataset.href || '').trim();
    if (!href) { toast('Yordam manzili hali sozlanmagan', 'error'); return; }
    window.open(href, '_blank', 'noopener');
  };
}

/* "..." menyusi — nozik/ko'rinmasroq joyda, tasodifan bosilib ketmasligi
 * uchun hisobni o'chirish shu menyu ichida yashiringan. */
const settingsMoreBtn  = $('settingsMoreBtn');
const settingsMoreMenu = $('settingsMoreMenu');
if (settingsMoreBtn && settingsMoreMenu) {
  settingsMoreBtn.onclick = (e) => {
    e.stopPropagation();
    settingsMoreMenu.classList.toggle('show');
  };
  document.addEventListener('click', (e) => {
    if (!settingsMoreMenu.classList.contains('show')) return;
    if (e.target === settingsMoreBtn || settingsMoreMenu.contains(e.target)) return;
    settingsMoreMenu.classList.remove('show');
  });
}

const _purgeMyMedia = () => purgeUserMedia(state.me?.uid);

const deleteAccountBtn = $('deleteAccountBtn');
if (deleteAccountBtn) {
  deleteAccountBtn.onclick = () => {
    if (!state.me) return;
    settingsMoreMenu?.classList.remove('show');
    showConfirm(
      "Hisobingiz, barcha postlaringiz, xabarlaringiz va izohlaringiz BUTUNLAY o'chiriladi. Bu amalni ortga qaytarib bo'lmaydi. Davom etasizmi?",
      async () => {
        deleteAccountBtn.disabled = true;
        toast("Hisob o'chirilmoqda...", 'info');
        try {
          await _purgeMyMedia();
          const { error: delErr } = await sb.rpc('delete_my_account');
          if (delErr) throw delErr;
          await removePushToken().catch(() => {});
          clearAllCache();
          try { await sb.auth.signOut(); } catch (_) {}
          try { localStorage.removeItem('spacemr-auth'); localStorage.removeItem('mrspace-auth'); } catch (_) {}
          location.replace('/');
        } catch (e) {
          deleteAccountBtn.disabled = false;
          toast('Xato: ' + e.message, 'error');
        }
      },
      "Hisobni o'chirish"
    );
  };
}



