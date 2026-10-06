/* attach-menu.js — umumiy skrepka menyusi: Kamera / Fayl / Media
   Chat, post composer, story upload — hammasi shu modulni ishlatadi.
   Kamera qurilmasi topilmasa "Kamera" bandi ko'rinmaydi. */
import { hasCameraDevice } from '../chat/camera-access.js';
import { openCameraCapture } from '../chat/camera-capture.js';

const _ico = p => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const ICONS = {
  camera: _ico('<path d="M20 7h-3l-1.5-2h-7L7 7H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1z"/><circle cx="12" cy="13" r="3.5"/>'),
  file: _ico('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>'),
  media: _ico('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5-5-8 9"/>'),
};

let _menu = null, _off = null;

export function closeAttachMenu() {
  if (_off) { _off(); _off = null; }
  _menu?.remove(); _menu = null;
}

/**
 * @param {object} opts
 * @param {HTMLElement} opts.btn — skrepka / attach tugmasi (yoki drop zona)
 * @param {HTMLInputElement} [opts.fileInput] — "Fayl" uchun (ixtiyoriy agar showFile=false)
 * @param {() => boolean} [opts.isBusy]
 * @param {(file: File) => void} opts.onPick
 * @param {boolean} [opts.showCamera=true]
 * @param {boolean} [opts.showFile=true]
 * @param {boolean} [opts.showMedia=true]
 * @param {string} [opts.mediaAccept='image/*,video/*']
 * @param {() => { showCamera?: boolean, showFile?: boolean, showMedia?: boolean, mediaAccept?: string }} [opts.getOptions]
 *        ochilishda dinamik (masalan story vs post)
 */
export function initAttachMenu({
  btn,
  fileInput = null,
  isBusy,
  onPick,
  showCamera = true,
  showFile = true,
  showMedia = true,
  mediaAccept = 'image/*,video/*',
  getOptions = null,
}) {
  if (!btn || typeof onPick !== 'function') return;

  const mediaInput = document.createElement('input');
  mediaInput.type = 'file';
  mediaInput.accept = mediaAccept;
  mediaInput.style.display = 'none';
  (fileInput?.parentNode || btn.parentNode || document.body).appendChild(mediaInput);
  mediaInput.addEventListener('change', () => {
    const f = mediaInput.files?.[0];
    mediaInput.value = '';
    if (f) onPick(f);
  });

  // fileInput change — agar tashqi ham bog'langan bo'lsa double-fire bo'lmasin;
  // caller o'zi listen qilishi mumkin, bu yerda faqat click ochamiz

  const actions = {
    camera: async () => { const f = await openCameraCapture(); if (f) onPick(f); },
    file: () => {
      if (!fileInput) return;
      fileInput.click();
    },
    media: () => mediaInput.click(),
  };

  function openMenu(opts) {
    closeAttachMenu();
    const cam = opts.showCamera !== false && opts._hasCam;
    const items = [];
    if (cam) items.push(['camera', 'Kamera']);
    if (opts.showFile !== false && fileInput) items.push(['file', 'Fayl']);
    if (opts.showMedia !== false) items.push(['media', 'Media']);
    if (!items.length) {
      // fallback: to'g'ridan-to'g'ri media
      mediaInput.accept = opts.mediaAccept || mediaAccept;
      mediaInput.click();
      return;
    }
    mediaInput.accept = opts.mediaAccept || mediaAccept;

    const m = document.createElement('div');
    m.className = 'attach-menu';
    m.setAttribute('role', 'menu');
    m.innerHTML = items.map(([k, t]) =>
      `<button type="button" class="am-item" role="menuitem" data-k="${k}">${ICONS[k]}<span>${t}</span></button>`
    ).join('');
    document.body.appendChild(m);
    const r = btn.getBoundingClientRect();
    const mw = m.offsetWidth, mh = m.offsetHeight;
    let left = Math.max(8, Math.min(r.left, window.innerWidth - mw - 8));
    // pastga yoki tepaga joylash
    const spaceBelow = window.innerHeight - r.bottom;
    if (spaceBelow >= mh + 12) {
      m.style.top = (r.bottom + 8) + 'px';
      m.style.bottom = 'auto';
    } else {
      m.style.bottom = (window.innerHeight - r.top + 8) + 'px';
      m.style.top = 'auto';
    }
    m.style.left = left + 'px';
    m.addEventListener('click', e => {
      const it = e.target.closest('.am-item');
      if (!it) return;
      const k = it.dataset.k;
      closeAttachMenu();
      actions[k]?.();
    });
    const onDown = e => { if (!m.contains(e.target) && !btn.contains(e.target)) closeAttachMenu(); };
    const onKey = e => { if (e.key === 'Escape') closeAttachMenu(); };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', closeAttachMenu);
    _off = () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', closeAttachMenu);
    };
    _menu = m;
  }

  const isDesktop = () =>
    window.matchMedia('(hover: hover) and (pointer: fine)').matches
    && window.matchMedia('(min-width: 900px)').matches;

  btn.addEventListener('click', async e => {
    e.preventDefault();
    e.stopPropagation();
    if (isBusy?.()) return;
    if (_menu) { closeAttachMenu(); return; }

    const dyn = (typeof getOptions === 'function' ? getOptions() : null) || {};
    const opts = {
      showCamera: dyn.showCamera ?? showCamera,
      showFile: dyn.showFile ?? showFile,
      showMedia: dyn.showMedia ?? showMedia,
      mediaAccept: dyn.mediaAccept ?? mediaAccept,
      _hasCam: false,
    };

    // Desktop: menyu yo'q — to'g'ridan-to'g'ri fayl tanlash
    if (isDesktop()) {
      mediaInput.accept = opts.mediaAccept || mediaAccept;
      if (opts.showFile !== false && fileInput) {
        // Barcha fayllar (chat/post/story)
        try { fileInput.click(); } catch (_) {}
        return;
      }
      // faqat media (image/video)
      mediaInput.click();
      return;
    }

    // Mobil: Kamera / Fayl / Media menyusi
    if (opts.showCamera) opts._hasCam = await hasCameraDevice();
    openMenu(opts);
  });
}
