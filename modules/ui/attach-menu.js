/* attach-menu.js — Biriktirma menyusi:
   - Mobil va Planshet (Mobile & Tablet): Telegram uslubidagi pastdan ochiluvchi Attach Sheet / Drawer (Jonli Kamera stream tile, Galereya, Fayllar, So‘rovnoma va Joylashuv).
   - Desktop (Kompyuter / Noutbuk): Skrepka tugmasi ustida ochiluvchi ixcham dropdown. Agar kamerasi bo'lmasa, kamera tugmasi chiqmaydi. */

import { hasCameraDevice } from '../chat/camera-access.js';
import { openCameraCapture } from '../chat/camera-capture.js';
import { openPollModal } from './poll-dialog.js';
import { requestAndSendLocation } from './location-helper.js';

const SVG = {
  camera: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
  gallery: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
  folder: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
  file: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>',
  poll: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
  location: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
};

let _activeDrawer = null;
let _activeDropdown = null;
let _liveStream = null;
let _uid = 0;

/** Mobil yoki planshet qurilma ekanligini aniqlash */
function isMobileOrTabletDevice() {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isTouchUa = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Tablet/i.test(ua);
  const isSmallTouch = window.matchMedia('(max-width: 1024px) and (pointer: coarse)').matches;
  return isTouchUa || isSmallTouch;
}

/** Yopish va barcha oqimlarni to‘xtatish */
export function closeAttachMenu() {
  if (_liveStream) {
    try {
      _liveStream.getTracks().forEach(t => t.stop());
    } catch (_) {}
    _liveStream = null;
  }
  if (_activeDrawer) {
    _activeDrawer.classList.remove('open');
    const d = _activeDrawer;
    _activeDrawer = null;
    setTimeout(() => {
      try { d.remove(); } catch (_) {}
    }, 240);
  }
  if (_activeDropdown) {
    try { _activeDropdown.remove(); } catch (_) {}
    _activeDropdown = null;
  }
}

/** Yashirin input yaratish */
function _createHiddenInput(accept, multiple, onPick) {
  const inp = document.createElement('input');
  inp.type = 'file';
  inp.accept = accept || '';
  if (multiple) inp.multiple = true;
  inp.id = 'am-input-' + (++_uid);
  inp.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;opacity:0.01;z-index:-1;pointer-events:none;';
  document.body.appendChild(inp);
  inp.addEventListener('change', () => {
    const files = [...(inp.files || [])];
    inp.value = '';
    files.forEach(f => {
      if (typeof onPick === 'function') onPick(f);
    });
  });
  return inp;
}

export function initAttachMenu({
  btn,
  fileInput = null,
  isBusy,
  onPick,
  showCamera = true,
  showFile = true,
  showMedia = true,
  showPoll = false,
  showLocation = false,
  onLocation = null,
  onPoll = null,
  mediaAccept = 'image/*,video/*',
  fileAccept = '',
  getOptions = null,
}) {
  if (!btn || typeof onPick !== 'function') return;

  const galleryPicker = _createHiddenInput(mediaAccept, true, onPick);
  const filePicker = _createHiddenInput(fileAccept || fileInput?.getAttribute('accept') || '', true, onPick);

  /* ─────────── 1. Desktop Dropdown (Kompyuterlar uchun) ─────────── */
  async function openDesktopDropdown(dynamicOpts = {}) {
    closeAttachMenu();

    let hasCam = false;
    const wantCam = dynamicOpts.showCamera ?? showCamera;
    if (wantCam) {
      try { hasCam = await hasCameraDevice(); } catch (_) { hasCam = false; }
    }

    const canMedia = dynamicOpts.showMedia ?? showMedia;
    const canFile = dynamicOpts.showFile ?? showFile;
    const canPoll = dynamicOpts.showPoll ?? showPoll;
    const canLoc = dynamicOpts.showLocation ?? showLocation;

    const items = [];
    if (hasCam) {
      items.push({ k: 'camera', t: 'Kamera', svg: SVG.camera });
    }
    if (canMedia) {
      items.push({ k: 'media', t: 'Rasm yoki video', svg: SVG.gallery, forId: galleryPicker.id });
    }
    if (canFile) {
      items.push({ k: 'file', t: 'Hujjat / Fayl', svg: SVG.file, forId: filePicker.id });
    }
    if (canPoll) {
      items.push({ k: 'poll', t: 'So‘rovnoma', svg: SVG.poll });
    }
    if (canLoc) {
      items.push({ k: 'location', t: 'Joylashuv', svg: SVG.location });
    }

    if (!items.length) {
      try { galleryPicker.click(); } catch (_) {}
      return;
    }

    const menu = document.createElement('div');
    menu.className = 'attach-menu';
    menu.setAttribute('role', 'menu');
    menu.style.zIndex = '2147483001';

    menu.innerHTML = items.map(({ k, t, svg, forId }) => {
      if (forId) {
        return `<label class="am-item" role="menuitem" data-k="${k}" for="${forId}">${svg}<span>${t}</span></label>`;
      }
      return `<button type="button" class="am-item" role="menuitem" data-k="${k}">${svg}<span>${t}</span></button>`;
    }).join('');

    document.body.appendChild(menu);
    _activeDropdown = menu;

    // Joylashuvni hisoblash (tugma ustida yoki tagida)
    const r = btn.getBoundingClientRect();
    const mw = menu.offsetWidth || 190;
    const mh = menu.offsetHeight || 140;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - mw - 8));
    const spaceBelow = window.innerHeight - r.bottom;
    const openUp = spaceBelow < mh + 12 || !!btn.closest('#uploadOverlay, .composer-sheet');

    if (openUp) {
      menu.style.bottom = (window.innerHeight - r.top + 8) + 'px';
      menu.style.top = 'auto';
    } else {
      menu.style.top = (r.bottom + 8) + 'px';
      menu.style.bottom = 'auto';
    }
    menu.style.left = left + 'px';

    // Tugmalar hodisalari
    menu.querySelectorAll('button.am-item[data-k="camera"]').forEach(el => {
      el.addEventListener('click', async e => {
        e.preventDefault();
        e.stopPropagation();
        closeAttachMenu();
        try {
          const f = await openCameraCapture();
          if (f) onPick(f);
        } catch (err) {
          console.warn('[AttachMenu] camera error:', err);
        }
      });
    });

    menu.querySelectorAll('button.am-item[data-k="poll"]').forEach(el => {
      el.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        closeAttachMenu();
        openPollModal(pollData => {
          if (typeof onPoll === 'function') onPoll(pollData);
        });
      });
    });

    menu.querySelectorAll('button.am-item[data-k="location"]').forEach(el => {
      el.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        closeAttachMenu();
        requestAndSendLocation(locData => {
          if (typeof onLocation === 'function') onLocation(locData);
        });
      });
    });

    menu.querySelectorAll('label.am-item').forEach(lbl => {
      lbl.addEventListener('click', () => {
        setTimeout(() => closeAttachMenu(), 250);
      });
    });

    const onDown = e => {
      if (menu.contains(e.target) || btn.contains(e.target)) return;
      if (e.target === galleryPicker || e.target === filePicker) return;
      closeAttachMenu();
      document.removeEventListener('pointerdown', onDown, true);
    };
    setTimeout(() => document.addEventListener('pointerdown', onDown, true), 60);

    const onKey = e => {
      if (e.key === 'Escape') {
        closeAttachMenu();
        document.removeEventListener('keydown', onKey, true);
      }
    };
    document.addEventListener('keydown', onKey, true);
  }

  /* ─────────── 2. Mobil & Planshet Attach Sheet ─────────── */
  async function openMobileDrawer(dynamicOpts = {}) {
    closeAttachMenu();

    let hasCam = false;
    const wantCam = dynamicOpts.showCamera ?? showCamera;
    if (wantCam) {
      try { hasCam = await hasCameraDevice(); } catch (_) { hasCam = false; }
    }

    const canMedia = dynamicOpts.showMedia ?? showMedia;
    const canFile = dynamicOpts.showFile ?? showFile;
    const canPoll = dynamicOpts.showPoll ?? showPoll;
    const canLoc = dynamicOpts.showLocation ?? showLocation;
    const isFullscreen = dynamicOpts.fullscreen ?? (dynamicOpts.mode === 'fullscreen' || !!btn.closest('#uploadOverlay, .composer-sheet, #homeComposer'));

    const overlay = document.createElement('div');
    overlay.className = 'attach-drawer-overlay';

    overlay.innerHTML = `
      <div class="attach-drawer ${isFullscreen ? 'attach-drawer--fullscreen' : ''}" role="dialog" aria-label="Biriktirish paneli">
        <div class="attach-drawer-handle"></div>

        <!-- Yuqori Media Qism (Jonli Kamera & Galereya & Fayllar) -->
        <div class="attach-media-grid">
          ${hasCam ? `
            <div class="attach-grid-item live-cam-tile" id="amLiveCamTile" role="button" tabindex="0" title="Kamerani ochish">
              <video class="live-cam-video" autoplay playsinline muted></video>
              <div class="live-cam-fallback">
                ${SVG.camera}
                <span>Kamera</span>
              </div>
              <div class="live-cam-badge">
                <span class="live-cam-dot"></span>
                <span>Jonli</span>
              </div>
              <div class="live-cam-overlay-label">
                ${SVG.camera}
                <span>Kamerani ochish</span>
              </div>
            </div>
          ` : ''}

          ${canMedia ? `
            <label class="attach-grid-item gallery-tile" for="${galleryPicker.id}" title="Galereyani ochish">
              <div class="grid-tile-icon-wrap gallery-icon-wrap">
                ${SVG.gallery}
              </div>
              <span class="grid-tile-name">Galereya</span>
              <span class="grid-tile-hint">Rasm va video</span>
            </label>
          ` : ''}

          ${canFile ? `
            <label class="attach-grid-item folder-tile" for="${filePicker.id}" title="Fayllar va ichki xotira">
              <div class="grid-tile-icon-wrap folder-icon-wrap">
                ${SVG.folder}
              </div>
              <span class="grid-tile-name">Barcha fayllar</span>
              <span class="grid-tile-hint">Ichki xotira</span>
            </label>
          ` : ''}
        </div>

        <!-- Pastki Telegram uslubidagi yassi doiraviy / pill tugmalar paneli -->
        <div class="attach-bottom-pills">
          ${canFile ? `
            <label class="attach-pill-btn" for="${filePicker.id}">
              <div class="pill-btn-icon pill-icon-file">${SVG.file}</div>
              <span class="pill-btn-text">Fayl</span>
            </label>
          ` : ''}

          ${canPoll ? `
            <button type="button" class="attach-pill-btn" id="amPillPoll">
              <div class="pill-btn-icon pill-icon-poll">${SVG.poll}</div>
              <span class="pill-btn-text">So‘rovnoma</span>
            </button>
          ` : ''}

          ${canLoc ? `
            <button type="button" class="attach-pill-btn" id="amPillLocation">
              <div class="pill-btn-icon pill-icon-loc">${SVG.location}</div>
              <span class="pill-btn-text">Joylashuv</span>
            </button>
          ` : ''}
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    _activeDrawer = overlay;

    requestAnimationFrame(() => {
      overlay.classList.add('open');
    });

    const camTile = overlay.querySelector('#amLiveCamTile');
    const camVideo = overlay.querySelector('.live-cam-video');
    const camFallback = overlay.querySelector('.live-cam-fallback');

    if (hasCam && camVideo) {
      if (navigator.mediaDevices?.getUserMedia) {
        navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 480 } },
          audio: false,
        }).then(stream => {
          if (!_activeDrawer) {
            stream.getTracks().forEach(t => t.stop());
            return;
          }
          _liveStream = stream;
          camVideo.srcObject = stream;
          camVideo.style.display = 'block';
          if (camFallback) camFallback.style.display = 'none';
        }).catch(err => {
          console.warn('[AttachMenu] live cam preview:', err);
          if (camVideo) camVideo.style.display = 'none';
          if (camFallback) camFallback.style.display = 'flex';
        });
      }

      camTile?.addEventListener('click', async e => {
        e.preventDefault();
        e.stopPropagation();
        closeAttachMenu();
        try {
          const f = await openCameraCapture();
          if (f) onPick(f);
        } catch (err) {
          console.warn('[AttachMenu] camera capture error:', err);
        }
      });
    }

    overlay.querySelectorAll('label.attach-grid-item, label.attach-pill-btn').forEach(lbl => {
      lbl.addEventListener('click', () => {
        setTimeout(() => closeAttachMenu(), 250);
      });
    });

    const pollBtn = overlay.querySelector('#amPillPoll');
    pollBtn?.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      closeAttachMenu();
      openPollModal(pollData => {
        if (typeof onPoll === 'function') onPoll(pollData);
      });
    });

    const locBtn = overlay.querySelector('#amPillLocation');
    locBtn?.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      closeAttachMenu();
      requestAndSendLocation(locData => {
        if (typeof onLocation === 'function') onLocation(locData);
      });
    });

    overlay.addEventListener('click', e => {
      if (e.target === overlay) closeAttachMenu();
    });

    const onKey = e => {
      if (e.key === 'Escape') {
        closeAttachMenu();
        document.removeEventListener('keydown', onKey);
      }
    };
    document.addEventListener('keydown', onKey);
  }

  btn.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    if (typeof isBusy === 'function' && isBusy()) return;
    if (_activeDrawer || _activeDropdown) {
      closeAttachMenu();
      return;
    }
    const dyn = (typeof getOptions === 'function' ? getOptions() : null) || {};
    if (isMobileOrTabletDevice()) {
      openMobileDrawer(dyn);
    } else {
      openDesktopDropdown(dyn);
    }
  });
}
