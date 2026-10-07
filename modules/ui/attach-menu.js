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

/** File picker uchun input — har doim body da, hech qachon display:none emas (iOS/Android). */
function _makePickerInput(accept) {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = accept || '';
  inp.setAttribute('aria-hidden', 'true');
  inp.tabIndex = -1;
  // display:none / d-none / overlay ichida — mobil dialog ochilmaydi
  inp.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0.001;overflow:hidden;z-index:2147483646;border:0;padding:0;margin:0;clip:rect(0,0,0,0);';
  document.body.appendChild(inp);
  return inp;
}

function _openPicker(inp) {
  if (!inp) return false;
  try {
    // Ba'zi brauzerlar showPicker ni qo'llab-quvvatlaydi
    if (typeof inp.showPicker === 'function') {
      inp.showPicker();
      return true;
    }
  } catch (_) {}
  try {
    inp.click();
    return true;
  } catch (_) {
    try {
      inp.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
      return true;
    } catch (_2) {
      return false;
    }
  }
}

/**
 * @param {object} opts
 * @param {HTMLElement} opts.btn
 * @param {HTMLInputElement} [opts.fileInput] — accept manbai / legacy change (ixtiyoriy)
 * @param {() => boolean} [opts.isBusy]
 * @param {(file: File) => void} opts.onPick
 * @param {boolean} [opts.showCamera=true]
 * @param {boolean} [opts.showFile=true]
 * @param {boolean} [opts.showMedia=true]
 * @param {string} [opts.mediaAccept='image/*,video/*']
 * @param {string} [opts.fileAccept=''] — bo'sh = barcha fayllar
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

  // Overlay / d-none ichidagi fileInput o'rniga body dagi mustaqil pickerlar
  const mediaPicker = _makePickerInput(mediaAccept);
  const filePicker = _makePickerInput(
    fileAccept || (fileInput?.getAttribute('accept') || '') || ''
  );

  mediaPicker.addEventListener('change', () => {
    const f = mediaPicker.files?.[0];
    mediaPicker.value = '';
    if (f) onPick(f);
  });
  filePicker.addEventListener('change', () => {
    const f = filePicker.files?.[0];
    filePicker.value = '';
    if (f) onPick(f);
  });

  // Legacy fileInput change ham ishlasin (agar tashqi kod bog'lagan bo'lsa) —
  // lekin biz uni click qilmaymiz (overlay ichida ishonchsiz)

  const actions = {
    camera: async () => {
      const f = await openCameraCapture();
      if (f) onPick(f);
    },
    file: () => {
      const dyn = (typeof getOptions === 'function' ? getOptions() : null) || {};
      const acc = dyn.fileAccept ?? fileAccept ?? fileInput?.getAttribute('accept') ?? '';
      filePicker.accept = acc || '';
      _openPicker(filePicker);
    },
    media: () => {
      const dyn = (typeof getOptions === 'function' ? getOptions() : null) || {};
      mediaPicker.accept = dyn.mediaAccept ?? mediaAccept;
      _openPicker(mediaPicker);
    },
  };

  function openMenu(opts) {
    closeAttachMenu();
    const cam = opts.showCamera !== false && opts._hasCam;
    const items = [];
    if (cam) items.push(['camera', 'Kamera']);
    if (opts.showFile !== false) items.push(['file', 'Fayl']);
    if (opts.showMedia !== false) items.push(['media', 'Media']);
    if (!items.length) {
      mediaPicker.accept = opts.mediaAccept || mediaAccept;
      _openPicker(mediaPicker);
      return;
    }

    const m = document.createElement('div');
    m.className = 'attach-menu';
    m.setAttribute('role', 'menu');
    // Overlay (z=200) va boshqa sheetlardan ustun
    m.style.zIndex = '100050';
    m.innerHTML = items.map(([k, t]) =>
      `<button type="button" class="am-item" role="menuitem" data-k="${k}">${ICONS[k]}<span>${t}</span></button>`
    ).join('');
    document.body.appendChild(m);

    const r = btn.getBoundingClientRect();
    const mw = m.offsetWidth, mh = m.offsetHeight;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - mw - 8));
    const spaceBelow = window.innerHeight - r.bottom;
    if (spaceBelow >= mh + 12) {
      m.style.top = (r.bottom + 8) + 'px';
      m.style.bottom = 'auto';
    } else {
      m.style.bottom = (window.innerHeight - r.top + 8) + 'px';
      m.style.top = 'auto';
    }
    m.style.left = left + 'px';

    let ran = false;
    const runItem = (k) => {
      if (!k || !actions[k] || ran) return;
      ran = true;
      // Fayl/media: dialogni gesture ichida ochamiz, menyuni KEYIN yopamiz
      if (k === 'file' || k === 'media') {
        actions[k]();
        // preventDefault qilmaymiz — ba'zi brauzerlarda dialogni buzadi
        requestAnimationFrame(() => closeAttachMenu());
      } else {
        closeAttachMenu();
        actions[k]();
      }
    };

    // pointerup — preventDefault siz (file picker gesture uchun ishonchliroq)
    m.addEventListener('pointerup', e => {
      const it = e.target.closest?.('.am-item');
      if (!it) return;
      e.stopPropagation();
      runItem(it.dataset.k);
    });
    m.addEventListener('click', e => {
      const it = e.target.closest?.('.am-item');
      if (!it) return;
      e.preventDefault();
      e.stopPropagation();
      runItem(it.dataset.k);
    });

    // Tashqariga bosilsa yopish — lekin item bosilishini kutib, bir tik kechiktiramiz
    const onDown = e => {
      if (m.contains(e.target) || btn.contains(e.target)) return;
      closeAttachMenu();
    };
    const onKey = e => { if (e.key === 'Escape') closeAttachMenu(); };
    // bubble phase — item pointerup avval ishlashi uchun capture=false
    setTimeout(() => {
      document.addEventListener('pointerdown', onDown, true);
    }, 0);
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

    if (isDesktop()) {
      // Desktop: post/story — media yoki file (accept bo'yicha)
      if (opts.showFile !== false && opts.showMedia === false) {
        filePicker.accept = opts.fileAccept || fileInput?.getAttribute('accept') || '';
        _openPicker(filePicker);
      } else if (opts.showMedia !== false) {
        mediaPicker.accept = opts.mediaAccept || mediaAccept;
        _openPicker(mediaPicker);
      } else {
        filePicker.accept = opts.fileAccept || '';
        _openPicker(filePicker);
      }
      return;
    }

    if (opts.showCamera) opts._hasCam = await hasCameraDevice();
    openMenu(opts);
  });
}
