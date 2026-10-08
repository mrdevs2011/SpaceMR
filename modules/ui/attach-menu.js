/* attach-menu.js — umumiy skrepka menyusi: Kamera / Fayl / Media
   Chat, post, story. Media/Fayl: <label for=input> (mobil file dialog ishonchli). */
import { hasCameraDevice } from '../chat/camera-access.js';
import { openCameraCapture } from '../chat/camera-capture.js';

const _ico = p => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const ICONS = {
  camera: _ico('<path d="M20 7h-3l-1.5-2h-7L7 7H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1z"/><circle cx="12" cy="13" r="3.5"/>'),
  file: _ico('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>'),
  media: _ico('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5-5-8 9"/>'),
};

let _menu = null, _off = null;
let _uid = 0;

export function closeAttachMenu() {
  if (_off) { _off(); _off = null; }
  _menu?.remove(); _menu = null;
}

/** Ko'rinmas lekin mobil uchun yaroqli file input (display:none emas). */
function _stylePicker(inp) {
  inp.style.cssText = [
    'position:fixed',
    'right:0',
    'bottom:0',
    'width:48px',
    'height:48px',
    'opacity:0.01',
    'overflow:hidden',
    'z-index:2147483646',
    'border:0',
    'padding:0',
    'margin:0',
    'font-size:16px', // iOS zoom oldini olish
  ].join(';');
}

function _makePicker(accept, onFile) {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = accept || '';
  inp.id = 'am-pick-' + (++_uid);
  inp.setAttribute('aria-hidden', 'true');
  _stylePicker(inp);
  document.body.appendChild(inp);
  inp.addEventListener('change', () => {
    const f = inp.files?.[0];
    inp.value = '';
    if (f) onFile(f);
  });
  return inp;
}

/**
 * @param {object} opts
 * @param {HTMLElement} opts.btn
 * @param {HTMLInputElement} [opts.fileInput]
 * @param {() => boolean} [opts.isBusy]
 * @param {(file: File) => void} opts.onPick
 * @param {boolean} [opts.showCamera=true]
 * @param {boolean} [opts.showFile=true]
 * @param {boolean} [opts.showMedia=true]
 * @param {string} [opts.mediaAccept='image/*,video/*']
 * @param {string} [opts.fileAccept='']
 * @param {() => object} [opts.getOptions]
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
  fileAccept = '',
  getOptions = null,
}) {
  if (!btn || typeof onPick !== 'function') return;

  const mediaPicker = _makePicker(mediaAccept, onPick);
  const filePicker = _makePicker(
    fileAccept || fileInput?.getAttribute('accept') || '',
    onPick
  );

  function openMenu(opts) {
    closeAttachMenu();

    const cam = opts.showCamera !== false && opts._hasCam;
    const wantFile = opts.showFile !== false;
    const wantMedia = opts.showMedia !== false;

    mediaPicker.accept = opts.mediaAccept || mediaAccept;
    filePicker.accept = opts.fileAccept || fileAccept || fileInput?.getAttribute('accept') || '';

    // Faqat bitta variant — to'g'ridan-to'g'ri label yo'q, lekin input click label bilan bir xil emas;
    // shu holda yashirin label yaratamiz va dasturiy emas, user click kerak.
    // Agar faqat 1 ta item bo'lsa ham menyu ko'rsatamiz (anigligi uchun).

    const items = [];
    if (cam) items.push({ k: 'camera', t: 'Kamera' });
    if (wantFile) items.push({ k: 'file', t: 'Fayl', forId: filePicker.id });
    if (wantMedia) items.push({ k: 'media', t: 'Media', forId: mediaPicker.id });

    if (!items.length) {
      // Hech narsa yo'q — media ochishga urinish (edge)
      try { mediaPicker.click(); } catch (_) {}
      return;
    }

    const m = document.createElement('div');
    m.className = 'attach-menu';
    m.setAttribute('role', 'menu');
    m.style.zIndex = '2147483001';

    m.innerHTML = items.map(({ k, t, forId }) => {
      if (forId) {
        // LABEL — mobil Chrome/Safari file dialog uchun eng ishonchli
        return `<label class="am-item" role="menuitem" data-k="${k}" for="${forId}">${ICONS[k]}<span>${t}</span></label>`;
      }
      return `<button type="button" class="am-item" role="menuitem" data-k="${k}">${ICONS[k]}<span>${t}</span></button>`;
    }).join('');

    // Overlay ichida bo'lsa ham body ga — lekin z-index yuqori
    document.body.appendChild(m);

    const r = btn.getBoundingClientRect();
    const mw = m.offsetWidth || 180;
    const mh = m.offsetHeight || 120;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - mw - 8));
    const inComposer = !!btn.closest('#uploadOverlay, .composer-sheet');
    const spaceBelow = window.innerHeight - r.bottom;
    const openUp = inComposer || spaceBelow < mh + 12;
    if (openUp) {
      m.style.bottom = (window.innerHeight - r.top + 8) + 'px';
      m.style.top = 'auto';
    } else {
      m.style.top = (r.bottom + 8) + 'px';
      m.style.bottom = 'auto';
    }
    m.style.left = left + 'px';

    // Kamera tugmasi
    m.querySelectorAll('button.am-item[data-k="camera"]').forEach(el => {
      el.addEventListener('click', async e => {
        e.preventDefault();
        e.stopPropagation();
        closeAttachMenu();
        try {
          const f = await openCameraCapture();
          if (f) onPick(f);
        } catch (err) {
          console.warn('[attach] camera', err);
        }
      });
    });

    // Label bosilganda: file dialog ochiladi, keyin menyuni yopamiz
    m.querySelectorAll('label.am-item').forEach(el => {
      el.addEventListener('click', e => {
        // default label→input ishlashi kerak — preventDefault QILMAYMIZ
        e.stopPropagation();
        // dialog ochilgach menyuni yopish
        setTimeout(() => closeAttachMenu(), 300);
      });
    });

    const onDown = e => {
      if (m.contains(e.target) || btn.contains(e.target)) return;
      // input o'zi (label orqali) — yopmaslik
      if (e.target === mediaPicker || e.target === filePicker) return;
      closeAttachMenu();
    };
    const onKey = e => { if (e.key === 'Escape') closeAttachMenu(); };
    setTimeout(() => document.addEventListener('pointerdown', onDown, true), 50);
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
      fileAccept: dyn.fileAccept ?? fileAccept,
      _hasCam: false,
    };

    // Desktop: to'g'ridan-to'g'ri media/file (menyu shart emas)
    if (isDesktop()) {
      if (opts.showMedia !== false) {
        mediaPicker.accept = opts.mediaAccept || mediaAccept;
        mediaPicker.click();
      } else if (opts.showFile !== false) {
        filePicker.accept = opts.fileAccept || fileAccept || '';
        filePicker.click();
      }
      return;
    }

    // Mobil: menyu. hasCameraDevice await — gesture uziladi, lekin KEYINGI bosish yangi gesture.
    if (opts.showCamera) {
      try { opts._hasCam = await hasCameraDevice(); } catch (_) { opts._hasCam = false; }
    }
    openMenu(opts);
  });
}
