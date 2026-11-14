/**
 * modules/settings/permissions.js
 * SpaceMR ilova ruxsatlari boshqaruvi va App-Level Permission Guard
 */
import { toast } from '../ui/toast.js';
import { haptic } from '../core/utils.js';
import { areNotificationsEnabled, setNotificationsEnabled } from '../push.js';
import {
  getSavedGalleryDirHandle,
  saveGalleryDirHandle,
  isAllowedGalleryFolder,
} from '../ui/gallery-fs.js';

export const PERMISSIONS_CONFIG = {
  microphone: {
    id: 'microphone',
    name: 'Mikrofon',
    shortDesc: "Ovozli xabarlar, audio va video qo'ng'iroqlar uchun",
    fullDesc: "Ovozli xabarlar yuborish, audio va video qo'ng'iroqlarda gaplashish uchun.",
    securityNote: "SpaceMR mikrofonni faqat siz tugmani bosib gapirganingizda yoki qo'ng'iroq paytida ishlatadi. Fonda yashirin yozib olinmaydi.",
    icon: './svg/media/mic.svg',
    badgeClass: 'perm-badge-mic',
    queryName: 'microphone',
    async request() {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Brauzeringiz mikrofonga ruxsatni qo'llab-quvvatlamaydi");
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
      return true;
    }
  },
  camera: {
    id: 'camera',
    name: 'Kamera',
    shortDesc: "Video qo'ng'iroqlar, hikoyalar va video xabarlar uchun",
    fullDesc: "Video qo'ng'iroqlar, hikoyalar (stories) olish, video xabar (dumaloq video rolik) va chatda suratga tushirish uchun.",
    securityNote: "Faqat siz kamera ochganingizda faollashadi. Fonda yashirin ishlatilmaydi.",
    icon: './svg/media/camera.svg',
    badgeClass: 'perm-badge-cam',
    queryName: 'camera',
    async request() {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Brauzeringiz kameraga ruxsatni qo'llab-quvvatlamaydi");
      }
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach(t => t.stop());
      return true;
    }
  },
  notifications: {
    id: 'notifications',
    name: 'Bildirishnomalar',
    shortDesc: "Xabarlar, qo'ng'iroqlar va reaksiyalar bildirishnomasi",
    fullDesc: "Yangi xabarlar, kiruvchi qo'ng'iroqlar, reaksiyalar va muhim yangiliklar haqida ekran yopiq bo'lsa ham tezkor xabar berish.",
    securityNote: "Xabarlarni o'tkazib yubormaslik uchun juda muhim. Istalgan vaqtda o'chirib qo'yish mumkin.",
    icon: './svg/ui/bell.svg',
    badgeClass: 'perm-badge-bell',
    queryName: 'notifications',
    async request() {
      if (!('Notification' in window)) {
        throw new Error("Brauzeringiz bildirishnomalarni qo'llab-quvvatlamaydi");
      }
      const res = await setNotificationsEnabled(true);
      if (!res && Notification.permission !== 'granted') {
        throw new Error("Bildirishnomalarga ruxsat berilmadi");
      }
      return true;
    }
  },
  geolocation: {
    id: 'geolocation',
    name: 'Joylashuv',
    shortDesc: "Chatda joylashuv va xarita koordinatalarini ulashish",
    fullDesc: "Chatda yoki guruhda o'z jonli/aniq joylashuvingizni (geolokatsiya) xarita orqali ulashish uchun.",
    securityNote: "Faqat siz «Joylashuv yuborish» tugmasini bosganingizda koordinatangiz olinadi. Harakatingiz doimiy kuzatilmaydi.",
    icon: './svg/action/pin.svg',
    badgeClass: 'perm-badge-geo',
    queryName: 'geolocation',
    async request() {
      if (!('geolocation' in navigator)) {
        throw new Error("Brauzeringiz geolokatsiyani qo'llab-quvvatlamaydi");
      }
      return new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          pos => resolve(true),
          err => {
            if (err.code === 1) reject(new Error("Joylashuvga ruxsat rad etildi"));
            else reject(new Error("Joylashuvni aniqlab bo'lmadi"));
          },
          { timeout: 10000, enableHighAccuracy: true }
        );
      });
    }
  },
  clipboard: {
    id: 'clipboard',
    name: 'Klipbord',
    shortDesc: "Matn, havola va mediani nusxalash va tezkor joylash",
    fullDesc: "Matn, havola, media va kod parchalarini bir bosishda nusxalash va chatga tezkor joylash (paste).",
    securityNote: "Qulaylik yaratadi, shaxsiy ma'lumotlaringiz tashqariga chiqmaydi.",
    icon: './svg/action/copy.svg',
    badgeClass: 'perm-badge-clip',
    queryName: 'clipboard-read',
    async request() {
      if (navigator.clipboard?.readText) {
        try {
          await navigator.clipboard.readText();
          return true;
        } catch (e) {
          if (e.name === 'NotAllowedError') throw new Error("Klipbordga ruxsat berilmadi");
          return true; // Bo'sh bo'lsa yoki boshqa DOMException
        }
      }
      return true;
    }
  },
  storage: {
    id: 'storage',
    name: 'Fayllar va Media (Galareya)',
    shortDesc: "Qurilma galareyasidagi (DCIM) rasm va videolarni chatda ko'rish",
    fullDesc: "Attach (fayl biriktirish) menyusi ochilganda qurilmadagi barcha foto va videolarni Telegram kabi ko'rish imkoniyati.",
    securityNote: "Faqat siz tanlagan rasm yoki video chatga yuboriladi. SpaceMR fayllaringizni yashirin o'qimaydi va o'zboshimchalik bilan serverga jo'natmaydi.",
    icon: './svg/media/gallery.svg',
    badgeClass: 'perm-badge-storage',
    queryName: null,
    async request() {
      if (!('showDirectoryPicker' in window)) {
        throw new Error("Brauzeringiz File System Access API ni qo'llab-quvvatlamaydi");
      }
      const dirHandle = await window.showDirectoryPicker({ mode: 'read', startIn: 'pictures' });
      if (!isAllowedGalleryFolder(dirHandle)) {
        throw new Error("Iltimos, ichki xotiradagi DCIM yoki Pictures papkasini tanlang");
      }
      await saveGalleryDirHandle(dirHandle);
      return true;
    }
  }
};

const PERM_KEY_PREFIX = 'smr_perm_';

/**
 * App-Level Guard: Foydalanuvchi SpaceMR sozlamalarida ruxsatni o'chirib qo'yganmi?
 * Agar 'off' bo'lsa — funksiya chaqirilmaydi.
 */
export function isPermissionAllowed(permId) {
  try {
    const val = localStorage.getItem(PERM_KEY_PREFIX + permId);
    if (val === 'off') return false;
    if (permId === 'notifications') {
      const notifDisabled = localStorage.getItem('spacemrNotifsEnabled') === '0' ||
                            localStorage.getItem('mrspaceNotifsEnabled') === '0';
      if (notifDisabled) return false;
    }
  } catch (_) {}
  return true;
}

/**
 * Funksiyani chaqirishdan oldin ruxsatni tekshirish.
 * Taqiqlangan bo'lsa, ogohlantirish beradi va false qaytaradi.
 */
export function requirePermission(permId, onAllowed) {
  if (!isPermissionAllowed(permId)) {
    if (permId === 'storage') {
      toast("Sozlamalar → Ruxsatlar bo'limidan galareyaga ruxsat bering", 'warn');
    } else {
      const conf = PERMISSIONS_CONFIG[permId];
      const name = conf?.name || permId;
      toast(`Sozlamalar → Ruxsatlar bo'limidan ${name.toLowerCase()}ga ruxsat bering`, 'warn');
    }
    return false;
  }
  if (typeof onAllowed === 'function') {
    onAllowed();
  }
  return true;
}

/**
 * SpaceMR ichki holatini o'rnatish ('off' yoki 'granted' / '')
 */
export function setAppPermissionState(permId, isAllowed) {
  try {
    if (isAllowed) {
      localStorage.removeItem(PERM_KEY_PREFIX + permId);
      localStorage.setItem(PERM_KEY_PREFIX + permId, 'granted');
    } else {
      localStorage.setItem(PERM_KEY_PREFIX + permId, 'off');
      if (permId === 'notifications') {
        try { setNotificationsEnabled(false); } catch (_) {}
      }
    }
  } catch (_) {}
}

/**
 * Brauzerdagi haqiqiy ruxsat holatini so'rash
 */
export async function queryBrowserPermission(permId) {
  const conf = PERMISSIONS_CONFIG[permId];
  if (!conf) return 'prompt';

  if (permId === 'notifications') {
    if (!('Notification' in window)) return 'unsupported';
    return Notification.permission; // 'granted' | 'denied' | 'default'
  }

  if (permId === 'storage') {
    if (!('showDirectoryPicker' in window)) return 'unsupported';
    try {
      const handle = await getSavedGalleryDirHandle();
      if (handle && typeof handle.queryPermission === 'function') {
        const state = await handle.queryPermission({ mode: 'read' });
        return state; // 'granted' | 'prompt' | 'denied'
      }
    } catch (_) {}
    if (localStorage.getItem(PERM_KEY_PREFIX + 'storage') === 'granted') {
      return 'granted';
    }
    return 'prompt';
  }

  if (navigator.permissions?.query && conf.queryName) {
    try {
      const q = await navigator.permissions.query({ name: conf.queryName });
      return q.state; // 'granted' | 'denied' | 'prompt'
    } catch (_) {
      // Ba'zi brauzerlar camera / microphone ni permissions.query da qo'llamagan
    }
  }

  // Fallback: agar ilgari ruxsat olingan bo'lsa
  try {
    if (localStorage.getItem(PERM_KEY_PREFIX + permId) === 'granted') {
      return 'granted';
    }
  } catch (_) {}

  return 'prompt';
}

/**
 * Birlashgan ruxsat holati (Brauzer + SpaceMR ilova darajasi)
 */
export async function getCombinedPermissionState(permId) {
  const appAllowed = isPermissionAllowed(permId);
  const browserState = await queryBrowserPermission(permId);

  if (!appAllowed) {
    return {
      state: 'off',
      granted: false,
      text: "SpaceMR da o'chirilgan",
      badgeClass: 'perm-state-off',
    };
  }

  if (browserState === 'denied') {
    return {
      state: 'denied',
      granted: false,
      text: "Brauzerda bloklangan",
      badgeClass: 'perm-state-denied',
    };
  }

  if (browserState === 'granted') {
    return {
      state: 'granted',
      granted: true,
      text: "Ruxsat berilgan",
      badgeClass: 'perm-state-granted',
    };
  }

  return {
    state: 'prompt',
    granted: false,
    text: "Ruxsat berilmagan",
    badgeClass: 'perm-state-prompt',
  };
}

/**
 * Ruxsatlar UI ini yaratish / yangilash
 */
export async function renderPermissionsUI() {
  const container = document.getElementById('permissionsList');
  if (!container) return;

  const permEntries = Object.values(PERMISSIONS_CONFIG);
  let html = '';

  for (const p of permEntries) {
    html += `
      <div class="perm-card" id="permCard_${p.id}" data-perm-id="${p.id}">
        <div class="perm-card-main">
          <div class="perm-icon-wrap ${p.badgeClass}">
            <img src="${p.icon}" alt="" class="icon" width="20" height="20">
          </div>
          <div class="perm-info">
            <div class="perm-name-row">
              <span class="perm-name">${p.name}</span>
              <span class="perm-status-chip" id="permStatusChip_${p.id}">
                <span class="perm-dot"></span>
                <span class="perm-status-label" id="permStatusText_${p.id}">Tekshirilmoqda...</span>
              </span>
            </div>
            <div class="perm-short-desc">${p.shortDesc}</div>
          </div>
          <button class="switch-toggle perm-switch" id="permToggle_${p.id}" type="button" role="switch" aria-checked="false" aria-label="${p.name} ruxsati">
            <span class="switch-knob"></span>
          </button>
        </div>

        <div class="perm-details">
          <div class="perm-detail-row">
            <span class="perm-detail-label">Nega kerak:</span>
            <span class="perm-detail-val">${p.fullDesc}</span>
          </div>
          <div class="perm-detail-row perm-detail-sec">
            <span class="perm-detail-label">Maxfiylik:</span>
            <span class="perm-detail-val">${p.securityNote}</span>
          </div>
        </div>
      </div>
    `;
  }

  container.innerHTML = html;

  // Har bir switch ga hodisalarni ulash va holatlarni yangilash
  for (const p of permEntries) {
    await updatePermissionRowUI(p.id);
    wirePermissionToggle(p.id);
  }
}

/**
 * Bitta ruxsat qatorining UI holatini yangilash
 */
export async function updatePermissionRowUI(permId) {
  const toggle = document.getElementById(`permToggle_${permId}`);
  const statusChip = document.getElementById(`permStatusChip_${permId}`);
  const statusText = document.getElementById(`permStatusText_${permId}`);
  if (!toggle) return;

  const info = await getCombinedPermissionState(permId);

  toggle.classList.toggle('on', info.granted);
  toggle.setAttribute('aria-checked', String(info.granted));

  if (statusChip && statusText) {
    statusChip.className = `perm-status-chip ${info.badgeClass}`;
    statusText.textContent = info.text;
  }
}

/**
 * Toggle tugmasiga klik hodisasini ulash
 */
function wirePermissionToggle(permId) {
  const toggle = document.getElementById(`permToggle_${permId}`);
  if (!toggle || toggle._smrWired) return;
  toggle._smrWired = true;

  toggle.addEventListener('click', async (e) => {
    e.stopPropagation();
    haptic.medium();

    if (toggle.classList.contains('disabled')) return;

    const conf = PERMISSIONS_CONFIG[permId];
    if (!conf) return;

    const currentlyOn = toggle.classList.contains('on');

    if (currentlyOn) {
      // O'chirish (SpaceMR darajasida taqiqlash)
      setAppPermissionState(permId, false);
      toast(`${conf.name} SpaceMR da o'chirildi`, 'info');
      await updatePermissionRowUI(permId);
      return;
    }

    // Yoqish (Brauzerdan ruxsat so'rash)
    toggle.classList.add('disabled');
    const prevText = document.getElementById(`permStatusText_${permId}`)?.textContent;
    const statusTextEl = document.getElementById(`permStatusText_${permId}`);
    if (statusTextEl) statusTextEl.textContent = "So'ralmoqda...";

    try {
      await conf.request();
      setAppPermissionState(permId, true);
      toast(`${conf.name}ga muvaffaqiyatli ruxsat berildi!`, 'success');
    } catch (err) {
      console.warn('[Permissions] request error:', err);
      const isDenied = (await queryBrowserPermission(permId)) === 'denied';
      if (isDenied) {
        toast(`Brauzer ${conf.name.toLowerCase()}ga ruxsatni bloklagan. Manzil satridagi qulf orqali yoqing.`, 'error');
      } else {
        toast(`Ruxsat berilmadi: ${err.message || 'Rad etildi'}`, 'error');
      }
    } finally {
      toggle.classList.remove('disabled');
      await updatePermissionRowUI(permId);
    }
  });
}

/**
 * Modulni initsializatsiya qilish
 */
export function initPermissionsModule() {
  const settingsBtn = document.getElementById('settingsBtn');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      renderPermissionsUI();
    });
  }

  // Accordion ochilganda ham yangilanadi
  const permAcc = document.querySelector('[data-pe-acc="permissions"] .pe-acc-toggle');
  if (permAcc) {
    permAcc.addEventListener('click', () => {
      renderPermissionsUI();
    });
  }
}
