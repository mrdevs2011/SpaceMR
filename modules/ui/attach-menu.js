/* attach-menu.js — Biriktirma menyusi:
   - Mobil va Planshet (Mobile & Tablet): Telegram uslubidagi pastdan ochiluvchi Attach Sheet / Drawer:
     * 1-slot: Jonli Kamera stream tile (hech qanday yozuvlarsiz toza video oqim)
     * 2-slot: "+ Galereya" / "+ Boshqa rasmlar" (telefon galereyasidan tanlash)
     * Qolgan slotlar: Haqiqiy fotosuratlar va videolar (3 ustunli qulay scroll bo'ladigan grid)
     * Burchagida Telegram kabi doiraviy tanlash indikatori (1, 2, 3...) bilan belgilash
     * Tanlanganlarni birdaniga yuborish uchun pastda Telegram uslubidagi Yuborish tugmasi
     * Pastki paneldagi qulay pill tugmalar: Fayl, So‘rovnoma, Joylashuv
   - Desktop (Kompyuter / Noutbuk): Skrepka tugmasi ustida ochiluvchi ixcham dropdown. */

import { hasCameraDevice } from '../chat/camera-access.js';
import { openCameraCapture } from '../chat/camera-capture.js';
import { openPollModal } from './poll-dialog.js';
import { requestAndSendLocation } from './location-helper.js';
import { isPermissionAllowed, requirePermission } from '../settings/permissions.js';
import {
  isAndroidMobile,
  getSavedGalleryDirHandle,
  saveGalleryDirHandle,
  scanDirectory,
  pickAndValidateGalleryDirectory,
  showInvalidFolderModal,
} from './gallery-fs.js';
import { toast } from './toast.js';

const SVG = {
  camera: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
  gallery: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
  folder: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
  file: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>',
  poll: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
  location: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
  send: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
  audio: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
};

let _activeDrawer = null;
let _activeDropdown = null;

async function _resolveFile(item) {
  if (!item) return null;
  if (item.file instanceof File || item.file instanceof Blob) {
    return item.file;
  }
  if (item.thumbDataUrl && item.thumbDataUrl.startsWith('data:')) {
    try {
      const res = await fetch(item.thumbDataUrl);
      const blob = await res.blob();
      const ext = (blob.type || '').includes('png') ? 'png' : ((blob.type || '').includes('webp') ? 'webp' : 'jpg');
      return new File([blob], item.name || `photo_${Date.now()}.${ext}`, { type: blob.type || item.type || 'image/jpeg' });
    } catch (_) {}
  }
  if (item.thumbUrl) {
    try {
      const res = await fetch(item.thumbUrl, { mode: 'cors' });
      const blob = await res.blob();
      const ext = (blob.type || '').includes('png') ? 'png' : ((blob.type || '').includes('webp') ? 'webp' : 'jpg');
      const name = item.name || `photo_${Date.now()}.${ext}`;
      return new File([blob], name, { type: blob.type || item.type || 'image/jpeg' });
    } catch (_) {}
  }
  return null;
}

let _liveStream = null;
let _uid = 0;
let _drawerPickerCallback = null;
const _activeObjectUrls = new Set();

/* ── IndexedDB Cache for Recent Media Photos & Videos ── */
const ATTACH_DB_NAME = 'spacemr_attach_db';
const ATTACH_DB_VER = 1;
const ATTACH_STORE = 'recent_media';
const _memRecentFiles = [];

let _attachDbPromise = null;
function _getAttachDb() {
  if (_attachDbPromise) return _attachDbPromise;
  _attachDbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no-idb'));
    const req = indexedDB.open(ATTACH_DB_NAME, ATTACH_DB_VER);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(ATTACH_STORE)) {
        db.createObjectStore(ATTACH_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('blocked'));
  }).catch(err => {
    _attachDbPromise = null;
    throw err;
  });
  return _attachDbPromise;
}

function _formatDuration(sec) {
  if (!sec || isNaN(sec) || sec <= 0) return '';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

async function _getVideoDuration(file) {
  if (!file || !file.type || !file.type.startsWith('video/')) return 0;
  return new Promise(resolve => {
    try {
      const url = URL.createObjectURL(file);
      const v = document.createElement('video');
      v.preload = 'metadata';
      const timer = setTimeout(() => {
        try { URL.revokeObjectURL(url); } catch (_) {}
        resolve(0);
      }, 1200);
      v.onloadedmetadata = () => {
        clearTimeout(timer);
        const d = Math.round(v.duration || 0);
        try { URL.revokeObjectURL(url); } catch (_) {}
        resolve(d);
      };
      v.onerror = () => {
        clearTimeout(timer);
        try { URL.revokeObjectURL(url); } catch (_) {}
        resolve(0);
      };
      v.src = url;
    } catch (_) {
      resolve(0);
    }
  });
}

async function _makeThumbnail(file) {
  if (!file || !file.type) return '';

  if (file.type.startsWith('image/')) {
    return new Promise(resolve => {
      try {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
          try {
            URL.revokeObjectURL(url);
            const maxDim = 200;
            let w = img.width || 100, h = img.height || 100;
            if (w > h) {
              if (w > maxDim) { h = Math.round((h * maxDim) / w); w = maxDim; }
            } else {
              if (h > maxDim) { w = Math.round((h * maxDim) / h); h = maxDim; }
            }
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, w, h);
            resolve(canvas.toDataURL('image/jpeg', 0.7));
          } catch (_) {
            resolve('');
          }
        };
        img.onerror = () => {
          try { URL.revokeObjectURL(url); } catch (_) {}
          resolve('');
        };
        img.src = url;
      } catch (_) {
        resolve('');
      }
    });
  }

  if (file.type.startsWith('video/')) {
    return new Promise(resolve => {
      try {
        const url = URL.createObjectURL(file);
        const video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.preload = 'metadata';
        let done = false;
        const cleanup = () => {
          if (done) return;
          done = true;
          try { URL.revokeObjectURL(url); } catch (_) {}
          try { video.removeAttribute('src'); video.load(); } catch (_) {}
        };
        const timer = setTimeout(() => {
          cleanup();
          resolve('');
        }, 1400);

        video.onloadeddata = () => {
          try {
            video.currentTime = Math.min(0.5, (video.duration || 1) / 2);
          } catch (_) {}
        };
        video.onseeked = () => {
          try {
            clearTimeout(timer);
            const maxDim = 200;
            let w = video.videoWidth || 160, h = video.videoHeight || 90;
            if (w > h) {
              if (w > maxDim) { h = Math.round((h * maxDim) / w); w = maxDim; }
            } else {
              if (h > maxDim) { w = Math.round((h * maxDim) / h); h = maxDim; }
            }
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0, w, h);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
            cleanup();
            resolve(dataUrl);
          } catch (_) {
            cleanup();
            resolve('');
          }
        };
        video.onerror = () => {
          clearTimeout(timer);
          cleanup();
          resolve('');
        };
        video.src = url;
      } catch (_) {
        resolve('');
      }
    });
  }

  return '';
}

async function _loadRecentMedia() {
  try {
    const db = await _getAttachDb();
    const rows = await new Promise((resolve, reject) => {
      const tx = db.transaction(ATTACH_STORE, 'readonly');
      const req = tx.objectStore(ATTACH_STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    rows.sort((a, b) => (b.time || 0) - (a.time || 0));
    return rows.slice(0, 48);
  } catch (_) {
    return _memRecentFiles.slice(0, 48);
  }
}

// Boshlang'ich keshni xotiraga tezkor 0ms yuklash
if (typeof indexedDB !== 'undefined') {
  _loadRecentMedia().then(cached => {
    if (Array.isArray(cached) && cached.length) {
      _memRecentFiles.length = 0;
      _memRecentFiles.push(...cached);
    }
  }).catch(() => {});
}

async function _saveRecentMedia(files) {
  if (!Array.isArray(files) || !files.length) return;
  for (const f of files) {
    if (!f) continue;
    let thumbDataUrl = '';
    let duration = 0;
    try {
      thumbDataUrl = await _makeThumbnail(f);
      if (f.type && f.type.startsWith('video/')) {
        duration = await _getVideoDuration(f);
      }
    } catch (_) {}

    const item = {
      id: 'am_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      name: f.name || 'media',
      type: f.type || 'image/jpeg',
      size: f.size || 0,
      duration: duration || 0,
      durationText: _formatDuration(duration),
      thumbDataUrl: thumbDataUrl,
      file: f,
      time: Date.now(),
    };

    // Dublikatlarni tozalash
    const existIdx = _memRecentFiles.findIndex(m => m.name === item.name && m.size === item.size);
    if (existIdx >= 0) _memRecentFiles.splice(existIdx, 1);

    _memRecentFiles.unshift(item);
    if (_memRecentFiles.length > 48) _memRecentFiles.pop();

    try {
      const db = await _getAttachDb();
      const tx = db.transaction(ATTACH_STORE, 'readwrite');
      tx.objectStore(ATTACH_STORE).put(item);
    } catch (_) {
      try {
        const db = await _getAttachDb();
        const tx = db.transaction(ATTACH_STORE, 'readwrite');
        tx.objectStore(ATTACH_STORE).put({ ...item, file: null });
      } catch (_2) {}
    }
  }
}

/** Mobil yoki planshet qurilma ekanligini aniqlash */
export function isMobileOrTabletDevice() {
  if (typeof window === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const isTouchUa = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Tablet/i.test(ua);
  const isSmallTouch = window.matchMedia('(max-width: 1024px) and (pointer: coarse)').matches;
  return isTouchUa || isSmallTouch;
}

/** Yopish va barcha oqimlarni to‘xtatish */
export function closeAttachMenu() {
  _drawerPickerCallback = null;
  if (_liveStream) {
    try {
      _liveStream.getTracks().forEach(t => t.stop());
    } catch (_) {}
    _liveStream = null;
  }
  for (const u of _activeObjectUrls) {
    try { URL.revokeObjectURL(u); } catch (_) {}
  }
  _activeObjectUrls.clear();

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
    if (typeof _drawerPickerCallback === 'function') {
      _drawerPickerCallback(files);
      return;
    }
    const mediaFiles = files.filter(f => f && (f.type?.startsWith('image/') || f.type?.startsWith('video/')));
    if (mediaFiles.length) _saveRecentMedia(mediaFiles);
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
  const audioPicker = _createHiddenInput('audio/*', true, onPick);

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

  /**
   * Tabiiy jismoniy kuch (Physics Touch Swipe-to-Dismiss / Expand) harakatlari:
   * - Chat:
   *   * Yuqoriga sursa: full-height (92vh)
   *   * Pastga sursa: half-height (50vh)
   *   * Yana pastga sursa: 0 height (yopiladi)
   * - Post Upload va Story Upload:
   *   * 1 ta tabiiy jismoniy surish (swipe down / slide down) bilan silliq pastga tushib butunlay yopilsin (0 height).
   *   * touchstart, touchmove, touchend da transform: translateY(...) va inersiya
   *     (velocity > 0.4 yoki drag masofasi > 100px) bilan tabiiy animatsiyada pastga sirg'alib yopilsin.
   */
  function _bindDrawerGestures(drawer, overlay, ctx) {
    if (!drawer || !overlay) return;

    const isStory = ctx === 'story' || ctx === 'story_camera';
    const isPost = ctx === 'post';

    // Chat holat mashinasi: 'half' (50vh) va 'full' (92vh)
    let chatState = 'half';

    let startY = 0;
    let startX = 0;
    let startTime = 0;
    let lastY = 0;
    let lastTime = 0;
    let isDragging = false;
    let dragLocked = false;
    let isHandleTouch = false;
    let scrollContainer = null;

    function onTouchStart(e) {
      if (!e.touches || e.touches.length !== 1) return;
      const touch = e.touches[0];
      startY = touch.clientY;
      startX = touch.clientX;
      startTime = performance.now();
      lastY = startY;
      lastTime = startTime;
      isDragging = false;
      dragLocked = false;

      isHandleTouch = !!e.target.closest('.attach-drawer-handle, .attach-bottom-pills, .attach-send-bar');
      scrollContainer = e.target.closest('.attach-media-grid, .am-gallery-panel, #amDcimGrid');
    }

    function onTouchMove(e) {
      if (dragLocked || !e.touches || e.touches.length !== 1) return;
      const touch = e.touches[0];
      const currentY = touch.clientY;
      const currentX = touch.clientX;
      const currentTime = performance.now();
      const deltaY = currentY - startY;
      const deltaX = currentX - startX;

      // Gorizontal harakat ustun bo'lsa, vertikal drawer gestureni qulflaymiz
      if (!isDragging) {
        if (Math.abs(deltaX) > Math.abs(deltaY) + 5 && Math.abs(deltaX) > 10) {
          dragLocked = true;
          return;
        }

        if (isStory || isPost) {
          // Story yoki Post drawer:
          // Handle yoki pastki bar bosilsa to'g'ridan-to'g'ri drag
          if (isHandleTouch) {
            if (Math.abs(deltaY) > 5) isDragging = true;
          } else if (scrollContainer) {
            // Kontent yuqori chegarada bo'lsa va pastga tortilsa drag boshlanadi
            if (deltaY > 6 && scrollContainer.scrollTop <= 0) {
              isDragging = true;
            } else if (deltaY < 0) {
              // Kontent ichida pastga scroll qilishga yo'l beramiz
              dragLocked = true;
              return;
            }
          } else {
            if (deltaY > 6) isDragging = true;
          }
        } else {
          // Chat drawer (3 bosqichli: 92vh <-> 50vh <-> 0):
          if (isHandleTouch) {
            if (Math.abs(deltaY) > 5) isDragging = true;
          } else if (chatState === 'half') {
            // Half holatda: yuqoriga sursa full-height (92vh) ga ochiladi;
            // pastga sursa 0 height ga qarab yopiladi
            if (deltaY < -6) {
              isDragging = true;
            } else if (deltaY > 6 && (!scrollContainer || scrollContainer.scrollTop <= 0)) {
              isDragging = true;
            }
          } else if (chatState === 'full') {
            // Full holatda: kontent boshida pastga sursa half-height (50vh) ga tushadi
            if (deltaY > 6 && (!scrollContainer || scrollContainer.scrollTop <= 0)) {
              isDragging = true;
            } else if (deltaY < -6) {
              if (!isHandleTouch) {
                dragLocked = true;
                return;
              }
              isDragging = true;
            }
          }
        }
      }

      if (isDragging) {
        if (e.cancelable) e.preventDefault();
        drawer.style.transition = 'none';

        if (isStory || isPost) {
          // Post & Story: transform translateY orqali real vaqtda suriladi
          if (deltaY > 0) {
            drawer.style.transform = `translateY(${deltaY}px)`;
            const progress = Math.min(1, deltaY / (window.innerHeight * 0.85));
            overlay.style.opacity = String(Math.max(0, 1 - progress * 0.85));
          } else {
            // Yuqoriga tortganda tabiiy rubber-band qarshilik
            drawer.style.transform = `translateY(${deltaY * 0.18}px)`;
          }
        } else {
          // Chat:
          if (chatState === 'half') {
            if (deltaY < 0) {
              // Yuqoriga surish -> 92vh ga qarab balandlik silliq o'sadi
              drawer.style.transform = 'translateY(0)';
              const baseH = window.innerHeight * 0.50;
              const maxH = window.innerHeight * 0.92;
              const newH = Math.min(maxH, baseH - deltaY);
              drawer.style.height = `${newH}px`;
            } else {
              // Pastga surish -> 0 height ga qarab yopilish
              drawer.style.height = '50vh';
              drawer.style.transform = `translateY(${deltaY}px)`;
              const progress = Math.min(1, deltaY / (window.innerHeight * 0.5));
              overlay.style.opacity = String(Math.max(0, 1 - progress * 0.85));
            }
          } else if (chatState === 'full') {
            if (deltaY > 0) {
              // Pastga surish -> 50vh ga qarab balandlik silliq qisqaradi
              drawer.style.transform = 'translateY(0)';
              const baseH = window.innerHeight * 0.92;
              const minH = window.innerHeight * 0.50;
              const newH = Math.max(minH, baseH - deltaY);
              drawer.style.height = `${newH}px`;
            } else {
              // Yuqoriga tortganda qarshilik
              drawer.style.height = '92vh';
              drawer.style.transform = `translateY(${deltaY * 0.15}px)`;
            }
          }
        }

        lastY = currentY;
        lastTime = currentTime;
      }
    }

    function onTouchEnd(e) {
      if (!isDragging) return;
      isDragging = false;

      const touch = (e.changedTouches && e.changedTouches[0]) || (e.touches && e.touches[0]);
      const endY = touch ? touch.clientY : lastY;
      const totalDeltaY = endY - startY;
      const totalTime = Math.max(1, performance.now() - startTime);
      const recentTime = Math.max(1, performance.now() - lastTime);
      const recentVelocity = (endY - lastY) / Math.max(10, recentTime); // px/ms (pastga > 0, yuqoriga < 0)
      const overallVelocity = totalDeltaY / totalTime;
      const maxVelocity = Math.max(recentVelocity, overallVelocity);

      if (isStory || isPost) {
        // Post Upload va Story Upload:
        // 1 ta tabiiy jismoniy surish bilan silliq pastga tushib butunlay yopilsin (0 height).
        // inersiya (velocity > 0.4 yoki drag masofasi > 100px) bilan tabiiy animatsiyada pastga sirg'alib yopilsin.
        const shouldDismiss = totalDeltaY > 100 || maxVelocity > 0.4;
        if (shouldDismiss) {
          drawer.style.transition = 'transform 0.28s cubic-bezier(0.22, 1, 0.36, 1)';
          drawer.style.transform = 'translateY(100%)';
          overlay.style.transition = 'opacity 0.26s linear';
          overlay.style.opacity = '0';
          setTimeout(() => closeAttachMenu(), 280);
        } else {
          // Orqaga qaytish (bekor qilish)
          drawer.style.transition = 'transform 0.22s cubic-bezier(0.22, 1, 0.36, 1)';
          drawer.style.transform = 'translateY(0)';
          overlay.style.transition = 'opacity 0.2s linear';
          overlay.style.opacity = '1';
        }
      } else {
        // Chat attach drawer:
        // Yuqoriga sursa full-height (92vh).
        // Pastga sursa half-height (50vh).
        // Yana pastga sursa 0 height (yopiladi).
        if (chatState === 'half') {
          const wantsFull = totalDeltaY < -60 || recentVelocity < -0.35 || overallVelocity < -0.35;
          const wantsDismiss = totalDeltaY > 100 || recentVelocity > 0.4 || overallVelocity > 0.4;

          if (wantsFull) {
            // Yuqoriga sursa full-height (92vh)
            chatState = 'full';
            drawer.classList.remove('attach-drawer--half');
            drawer.classList.add('attach-drawer--full');
            drawer.style.transition = 'height 0.28s cubic-bezier(0.16, 1, 0.3, 1), transform 0.24s cubic-bezier(0.16, 1, 0.3, 1)';
            drawer.style.height = '92vh';
            drawer.style.transform = 'translateY(0)';
            overlay.style.transition = 'opacity 0.2s linear';
            overlay.style.opacity = '1';
          } else if (wantsDismiss) {
            // Yana pastga sursa 0 height (yopiladi)
            drawer.style.transition = 'transform 0.26s cubic-bezier(0.2, 0.9, 0.3, 1)';
            drawer.style.transform = 'translateY(100%)';
            overlay.style.transition = 'opacity 0.24s linear';
            overlay.style.opacity = '0';
            setTimeout(() => closeAttachMenu(), 260);
          } else {
            // Snap back to half (50vh)
            drawer.style.transition = 'height 0.22s cubic-bezier(0.16, 1, 0.3, 1), transform 0.22s cubic-bezier(0.16, 1, 0.3, 1)';
            drawer.style.height = '50vh';
            drawer.style.transform = 'translateY(0)';
            overlay.style.transition = 'opacity 0.2s linear';
            overlay.style.opacity = '1';
          }
        } else if (chatState === 'full') {
          const wantsHalf = totalDeltaY > 60 || recentVelocity > 0.35 || overallVelocity > 0.35;

          if (wantsHalf) {
            // Pastga sursa half-height (50vh)
            chatState = 'half';
            drawer.classList.remove('attach-drawer--full');
            drawer.classList.add('attach-drawer--half');
            drawer.style.transition = 'height 0.28s cubic-bezier(0.16, 1, 0.3, 1), transform 0.24s cubic-bezier(0.16, 1, 0.3, 1)';
            drawer.style.height = '50vh';
            drawer.style.transform = 'translateY(0)';
            overlay.style.transition = 'opacity 0.2s linear';
            overlay.style.opacity = '1';
          } else {
            // Snap back to full (92vh)
            drawer.style.transition = 'height 0.22s cubic-bezier(0.16, 1, 0.3, 1), transform 0.22s cubic-bezier(0.16, 1, 0.3, 1)';
            drawer.style.height = '92vh';
            drawer.style.transform = 'translateY(0)';
            overlay.style.transition = 'opacity 0.2s linear';
            overlay.style.opacity = '1';
          }
        }
      }
    }

    drawer.addEventListener('touchstart', onTouchStart, { passive: false });
    drawer.addEventListener('touchmove', onTouchMove, { passive: false });
    drawer.addEventListener('touchend', onTouchEnd, { passive: true });
    drawer.addEventListener('touchcancel', onTouchEnd, { passive: true });
  }

  /* ─────────── 2. Mobil & Planshet Attach Sheet (Telegram uslubida) ─────────── */
  function openMobileDrawer(dynamicOpts = {}) {
    closeAttachMenu();

    const canMedia = dynamicOpts.showMedia ?? showMedia;
    const canFile = dynamicOpts.showFile ?? showFile;
    const canPoll = dynamicOpts.showPoll ?? showPoll;
    const canLoc = dynamicOpts.showLocation ?? showLocation;

    // Kontekstni aniqlash: Story vs Post vs Chat vs Story Camera
    let ctx = dynamicOpts.context;
    if (!ctx) {
      if (dynamicOpts.isStoryCamera) {
        ctx = 'story_camera';
      } else if (
        dynamicOpts.isStory ||
        btn?.closest?.('#storyUpload') ||
        btn?.id === 'storyUpload' ||
        document.getElementById('storyUpload')?.classList.contains('show') ||
        document.getElementById('uploadOverlay')?.getAttribute('data-composer-mode') === 'story' ||
        document.getElementById('uploadOverlay')?.getAttribute('data-mode') === 'story' ||
        (btn?.closest?.('#uploadOverlay') && document.getElementById('uploadOverlay')?.classList.contains('story-mode'))
      ) {
        ctx = 'story';
      } else if (
        dynamicOpts.isPost ||
        btn?.closest?.('#uploadOverlay, .composer-sheet, #homeComposer')
      ) {
        ctx = 'post';
      } else {
        ctx = 'chat';
      }
    }

    const isStoryCamera = ctx === 'story_camera' || !!dynamicOpts.isStoryCamera;
    const isStory = ctx === 'story' || isStoryCamera;
    const isPost = ctx === 'post';
    const isFullscreen = isStory || isPost || dynamicOpts.fullscreen || (dynamicOpts.mode === 'fullscreen');

    let drawerClass = 'attach-drawer';
    if (isStoryCamera) {
      drawerClass += ' attach-drawer--story attach-drawer--story-camera attach-drawer--fullscreen';
    } else if (isStory) {
      drawerClass += ' attach-drawer--story attach-drawer--fullscreen';
    } else if (isPost) {
      drawerClass += ' attach-drawer--post attach-drawer--fullscreen';
    } else {
      drawerClass += ' attach-drawer--chat attach-drawer--half';
    }

    const isAndroid = isAndroidMobile();

    const overlay = document.createElement('div');
    overlay.className = 'attach-drawer-overlay';

    overlay.innerHTML = `
      <div class="${drawerClass}" role="dialog" aria-label="Biriktirish paneli" data-context="${ctx}">
        <div class="attach-drawer-handle" title="Pastga surib yopish"></div>

        ${isAndroid ? `
          <div class="am-nav-tabs-wrapper">
            <div class="am-nav-tabs" role="tablist">
              <button type="button" class="am-nav-tab active" id="amTabRecents" role="tab" aria-selected="true">
                <span>Oxirgilar</span>
              </button>
              <button type="button" class="am-nav-tab" id="amTabGallery" role="tab" aria-selected="false">
                <span>Galareya</span>
              </button>
            </div>
          </div>
        ` : ''}

        <!-- 1. Oxirgilar Gridi -->
        <div class="attach-media-grid" id="amRecentsPanel">
          ${!isStoryCamera ? `
          <div class="attach-grid-item live-cam-tile" id="amLiveCamTile" role="button" tabindex="0" title="Kamera">
            <video class="live-cam-video" autoplay playsinline muted style="display:none;"></video>
            <div class="live-cam-fallback">${SVG.camera}</div>
          </div>
          ` : ''}

          <!-- 2-slot: Galereyadan tanlash plitkasi -->
          <div class="attach-grid-item gallery-picker-tile am-gallery-entry-tile" id="amGalleryPickerTile" role="button" tabindex="0" title="Galereyadan tanlash">
            <div class="grid-tile-icon-wrap">${SVG.gallery}</div>
            <div class="grid-tile-name">Galereya</div>
            <div class="grid-tile-hint">Barcha media</div>
          </div>

          <!-- Media fotosuratlar va videolar shu yerga yuklanadi -->
          <div id="amMediaItemsSlot" style="display:contents;"></div>
        </div>

        <!-- 2. Galareya (DCIM) Paneli (Faqat Android uchun) -->
        ${isAndroid ? `
          <div class="am-gallery-panel" id="amGalleryPanel" style="display:none;">
            <div class="am-gallery-toolbar" id="amGalleryToolbar" style="display:none;">
              <span class="am-gallery-folder-badge" id="amGalleryFolderBadge">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                <span id="amGalleryFolderName">DCIM</span>
              </span>
              <button type="button" class="am-gallery-change-btn" id="amGalleryChangeBtn">Papkani o'zgartirish</button>
            </div>

            <!-- DCIM media fotosuratlar va videolar gridi -->
            <div class="attach-media-grid" id="amDcimGrid" style="display:none;"></div>

            <div class="am-gallery-loading-box" id="amGalleryLoader" style="display:none;">
              <div class="am-gallery-spinner"></div>
              <span>Galareyadagi fayllar o'qilmoqda...</span>
            </div>

            <div class="am-gallery-empty-box" id="amGalleryConnectPrompt" style="display:none;">
              <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.8" opacity="0.6">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <polyline points="21 15 16 10 5 21"/>
              </svg>
              <p style="margin:4px 0 0;line-height:1.4;">DCIM yoki Pictures papkasini ulab barcha foto va videolarni Telegram kabi ko'ring</p>
              <button type="button" class="am-gallery-connect-btn" id="amGalleryConnectBtn">DCIM papkasini tanlash</button>
            </div>

            <div class="am-gallery-empty-box" id="amGalleryEmpty" style="display:none;">
              <span>Tanlangan papkada hech qanday foto yoki video topilmadi</span>
            </div>
          </div>
        ` : ''}

        <!-- Tanlangan media fayllarni Telegram kabi birdaniga yuborish paneli (Send Bar) -->
        <div class="attach-send-bar" id="amSendBar" style="display:none;">
          <button type="button" class="attach-send-clear-btn" id="amSendClearBtn">Bekor qilish</button>
          <button type="button" class="attach-send-submit-btn" id="amSendSubmitBtn">
            <span id="amSendSubmitText">Yuborish (0)</span>
            ${SVG.send}
          </button>
        </div>

        <!-- Pastki Telegram uslubidagi 5 ta rangli doira tugmalar (Galereya, Fayl, Joylashuv, So‘rovnoma, Musiqa) -->
        <div class="attach-bottom-pills" id="amBottomPills" ${isStory ? 'style="display:none !important;"' : ''}>
          ${canMedia ? `
            <button type="button" class="attach-pill-btn" id="amPillGallery">
              <div class="pill-btn-icon pill-icon-gallery">${SVG.gallery}</div>
              <span class="pill-btn-text">Galereya</span>
            </button>
          ` : ''}

          ${canFile ? `
            <label class="attach-pill-btn" for="${filePicker.id}">
              <div class="pill-btn-icon pill-icon-file">${SVG.file}</div>
              <span class="pill-btn-text">Fayl</span>
            </label>
          ` : ''}

          ${canLoc ? `
            <button type="button" class="attach-pill-btn" id="amPillLocation">
              <div class="pill-btn-icon pill-icon-loc">${SVG.location}</div>
              <span class="pill-btn-text">Joylashuv</span>
            </button>
          ` : ''}

          ${canPoll ? `
            <button type="button" class="attach-pill-btn" id="amPillPoll">
              <div class="pill-btn-icon pill-icon-poll">${SVG.poll}</div>
              <span class="pill-btn-text">So‘rovnoma</span>
            </button>
          ` : ''}

          <button type="button" class="attach-pill-btn" id="amPillAudio">
            <div class="pill-btn-icon pill-icon-audio">${SVG.audio}</div>
            <span class="pill-btn-text">Musiqa</span>
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    _activeDrawer = overlay;

    const drawer = overlay.querySelector('.attach-drawer');
    _bindDrawerGestures(drawer, overlay, ctx);

    requestAnimationFrame(() => {
      overlay.classList.add('open');
    });
      overlay.classList.add('open');
    });

    const gridItemsSlot = overlay.querySelector('#amMediaItemsSlot');
    const sendBar = overlay.querySelector('#amSendBar');
    const sendClearBtn = overlay.querySelector('#amSendClearBtn');
    const sendSubmitBtn = overlay.querySelector('#amSendSubmitBtn');
    const sendSubmitText = overlay.querySelector('#amSendSubmitText');
    const bottomPills = overlay.querySelector('#amBottomPills');
    const galleryTile = overlay.querySelector('#amGalleryPickerTile');

    const recentsPanel = overlay.querySelector('#amRecentsPanel');
    const galleryPanel = overlay.querySelector('#amGalleryPanel');
    const tabRecents = overlay.querySelector('#amTabRecents');
    const tabGallery = overlay.querySelector('#amTabGallery');
    const dcimGrid = overlay.querySelector('#amDcimGrid');
    const galleryLoader = overlay.querySelector('#amGalleryLoader');
    const galleryConnectPrompt = overlay.querySelector('#amGalleryConnectPrompt');
    const galleryEmpty = overlay.querySelector('#amGalleryEmpty');
    const galleryToolbar = overlay.querySelector('#amGalleryToolbar');
    const galleryFolderName = overlay.querySelector('#amGalleryFolderName');
    const galleryChangeBtn = overlay.querySelector('#amGalleryChangeBtn');
    const galleryConnectBtn = overlay.querySelector('#amGalleryConnectBtn');

    galleryTile?.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      galleryPicker.click();
    });

    // Tanlangan fayllar xaritasi (id -> File)
    const selectedMap = new Map();
    let currentMediaList = [];
    let dcimMediaList = [];
    let isDcimLoaded = false;
    let isDcimLoading = false;

    function updateSelectionUI() {
      const keys = Array.from(selectedMap.keys());
      const count = keys.length;

      // Recents va DCIM gridlaridagi barcha tanlov plitkalarini sinxron yangilash
      overlay.querySelectorAll('.media-photo-tile').forEach(tile => {
        const id = tile.getAttribute('data-media-id');
        const checkBtn = tile.querySelector('.media-tile-check');
        const selIdx = keys.indexOf(id);
        if (selIdx >= 0) {
          tile.classList.add('selected');
          if (checkBtn) {
            checkBtn.classList.add('checked');
            checkBtn.innerHTML = `<span class="check-num">${selIdx + 1}</span>`;
          }
        } else {
          tile.classList.remove('selected');
          if (checkBtn) {
            checkBtn.classList.remove('checked');
            checkBtn.innerHTML = '';
          }
        }
      });

      if (count > 0) {
        if (bottomPills) bottomPills.style.display = 'none';
        if (sendBar) sendBar.style.display = 'flex';
        if (sendSubmitText) sendSubmitText.textContent = `Yuborish (${count})`;
      } else {
        if (sendBar) sendBar.style.display = 'none';
        if (bottomPills) bottomPills.style.display = isStory ? 'none' : 'flex';
      }
    }

    function toggleSelectItem(item) {
      if (selectedMap.has(item.id)) {
        selectedMap.delete(item.id);
      } else {
        if (selectedMap.size >= 10) {
          import('./toast.js').then(m => m.toast('Maksimal 10 ta fayl', 'warning'));
          return;
        }
        selectedMap.set(item.id, item);
      }
      updateSelectionUI();
    }

    function renderDcimMediaItems(items) {
      if (!dcimGrid) return;
      dcimGrid.innerHTML = items.map(item => {
        const isVid = (item.type || '').startsWith('video/');
        const selIdx = Array.from(selectedMap.keys()).indexOf(item.id);
        const isSel = selIdx >= 0;
        const durText = item.durationText || (isVid ? 'Video' : '');
        return `
          <div class="attach-grid-item media-photo-tile ${isSel ? 'selected' : ''}" data-media-id="${item.id}" role="button" tabindex="0">
            <img class="media-tile-thumb" src="${item.thumbUrl}" alt="${item.name || 'media'}" loading="lazy">
            ${isVid ? `<div class="media-tile-vid-badge"><svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg> <span class="vid-dur-text">${durText}</span></div>` : ''}
            <button type="button" class="media-tile-check ${isSel ? 'checked' : ''}" aria-label="Tanlash">
              ${isSel ? `<span class="check-num">${selIdx + 1}</span>` : ''}
            </button>
          </div>
        `;
      }).join('');

      items.forEach(item => {
        const tile = dcimGrid.querySelector(`.media-photo-tile[data-media-id="${item.id}"]`);
        if (!tile) return;
        tile.addEventListener('click', e => {
          e.preventDefault();
          e.stopPropagation();
          toggleSelectItem(item);
        });
      });
    }

    async function loadDcimGalleryMedia(forcePick = false) {
      if (!isPermissionAllowed('storage')) {
        toast("Sozlamalar → Ruxsatlar bo'limidan galareyaga ruxsat bering", 'warn');
        if (tabRecents && tabGallery) {
          tabRecents.classList.add('active');
          tabRecents.setAttribute('aria-selected', 'true');
          tabGallery.classList.remove('active');
          tabGallery.setAttribute('aria-selected', 'false');
          if (recentsPanel) recentsPanel.style.display = 'grid';
          if (galleryPanel) galleryPanel.style.display = 'none';
        }
        return;
      }

      if (!galleryLoader || !dcimGrid) return;
      if (isDcimLoading) return;
      isDcimLoading = true;

      galleryLoader.style.display = 'flex';
      dcimGrid.style.display = 'none';
      if (galleryConnectPrompt) galleryConnectPrompt.style.display = 'none';
      if (galleryEmpty) galleryEmpty.style.display = 'none';

      let handle = forcePick ? null : await getSavedGalleryDirHandle();

      if (handle) {
        try {
          if (typeof handle.queryPermission === 'function') {
            let perm = await handle.queryPermission({ mode: 'read' });
            if (perm === 'prompt' && typeof handle.requestPermission === 'function') {
              perm = await handle.requestPermission({ mode: 'read' });
            }
            if (perm !== 'granted') {
              handle = null;
            }
          }
        } catch (_) {
          handle = null;
        }
      }

      if (!handle) {
        if (!('showDirectoryPicker' in window)) {
          galleryLoader.style.display = 'none';
          isDcimLoading = false;
          toast("Brauzeringiz File System Access API ni qo'llab-quvvatlamaydi", 'info');
          galleryPicker.click();
          return;
        }

        try {
          const pickRes = await pickAndValidateGalleryDirectory({
            onInvalidFolder: () => {
              galleryLoader.style.display = 'none';
              if (galleryConnectPrompt) galleryConnectPrompt.style.display = 'flex';
              showInvalidFolderModal({
                onRetry: () => loadDcimGalleryMedia(true),
                onCancel: () => {
                  if (galleryConnectPrompt) galleryConnectPrompt.style.display = 'flex';
                }
              });
            }
          });

          if (pickRes && pickRes.valid) {
            handle = pickRes.dirHandle;
          } else {
            galleryLoader.style.display = 'none';
            isDcimLoading = false;
            if (!pickRes || !pickRes.invalid) {
              if (galleryConnectPrompt) galleryConnectPrompt.style.display = 'flex';
            }
            return;
          }
        } catch (err) {
          galleryLoader.style.display = 'none';
          isDcimLoading = false;
          if (galleryConnectPrompt) galleryConnectPrompt.style.display = 'flex';
          return;
        }
      }

      try {
        if (galleryFolderName) galleryFolderName.textContent = handle.name || 'DCIM';
        if (galleryToolbar) galleryToolbar.style.display = 'flex';

        const mediaEntries = await scanDirectory(handle, 3, 120);

        if (!mediaEntries.length) {
          galleryLoader.style.display = 'none';
          isDcimLoading = false;
          if (galleryEmpty) galleryEmpty.style.display = 'flex';
          return;
        }

        dcimMediaList = mediaEntries.map((m, idx) => {
          let thumbUrl = '';
          try {
            thumbUrl = URL.createObjectURL(m.file);
            _activeObjectUrls.add(thumbUrl);
          } catch (_) {}
          const isVid = (m.type || '').startsWith('video/');
          return {
            id: 'am_dcim_' + (m.lastModified || Date.now()) + '_' + (m.size || idx),
            file: m.file,
            thumbUrl,
            type: m.type,
            name: m.name,
            duration: 0,
            durationText: isVid ? 'Video' : '',
          };
        });

        renderDcimMediaItems(dcimMediaList);
        isDcimLoaded = true;
        galleryLoader.style.display = 'none';
        dcimGrid.style.display = 'grid';
        updateSelectionUI();

        // Video davomiyliklarini asinxron o'qib yangilash
        dcimMediaList.forEach(async (it) => {
          if (it.file && it.type && it.type.startsWith('video/')) {
            try {
              const dur = await _getVideoDuration(it.file);
              if (dur > 0) {
                it.duration = dur;
                it.durationText = _formatDuration(dur);
                const badgeTxt = dcimGrid.querySelector(`.media-photo-tile[data-media-id="${it.id}"] .vid-dur-text`);
                if (badgeTxt) badgeTxt.textContent = it.durationText;
              }
            } catch (_) {}
          }
        });
      } catch (err) {
        console.warn('[AttachMenu] scan DCIM error:', err);
        galleryLoader.style.display = 'none';
        if (galleryConnectPrompt) galleryConnectPrompt.style.display = 'flex';
      } finally {
        isDcimLoading = false;
      }
    }

    tabRecents?.addEventListener('click', e => {
      e.preventDefault();
      tabRecents.classList.add('active');
      tabRecents.setAttribute('aria-selected', 'true');
      tabGallery?.classList.remove('active');
      tabGallery?.setAttribute('aria-selected', 'false');
      if (recentsPanel) recentsPanel.style.display = 'grid';
      if (galleryPanel) galleryPanel.style.display = 'none';
    });

    tabGallery?.addEventListener('click', async e => {
      e.preventDefault();
      if (!isPermissionAllowed('storage')) {
        toast("Sozlamalar → Ruxsatlar bo'limidan galareyaga ruxsat bering", 'warn');
        return;
      }

      tabGallery.classList.add('active');
      tabGallery.setAttribute('aria-selected', 'true');
      tabRecents?.classList.remove('active');
      tabRecents?.setAttribute('aria-selected', 'false');
      if (recentsPanel) recentsPanel.style.display = 'none';
      if (galleryPanel) galleryPanel.style.display = 'flex';

      if (!isDcimLoaded) {
        await loadDcimGalleryMedia();
      }
    });

    galleryChangeBtn?.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      loadDcimGalleryMedia(true);
    });

    galleryConnectBtn?.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      loadDcimGalleryMedia(true);
    });

    function renderMediaGridItems(items) {
      currentMediaList = items;
      if (!gridItemsSlot) return;

      gridItemsSlot.innerHTML = items.map(item => {
        const isVid = (item.type || '').startsWith('video/');
        const selIdx = Array.from(selectedMap.keys()).indexOf(item.id);
        const isSel = selIdx >= 0;
        const durText = item.durationText || (isVid ? 'Video' : '');
        return `
          <div class="attach-grid-item media-photo-tile ${isSel ? 'selected' : ''}" data-media-id="${item.id}" role="button" tabindex="0">
            <img class="media-tile-thumb" src="${item.thumbUrl}" alt="${item.name || 'media'}" loading="lazy">
            ${isVid ? `<div class="media-tile-vid-badge"><svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg> <span>${durText}</span></div>` : ''}
            <button type="button" class="media-tile-check ${isSel ? 'checked' : ''}" aria-label="Tanlash">
              ${isSel ? `<span class="check-num">${selIdx + 1}</span>` : ''}
            </button>
          </div>
        `;
      }).join('');

      items.forEach(item => {
        const tile = gridItemsSlot.querySelector(`.media-photo-tile[data-media-id="${item.id}"]`);
        if (!tile) return;
        tile.addEventListener('click', e => {
          e.preventDefault();
          e.stopPropagation();
          toggleSelectItem(item);
        });
      });
    }

    function prepareItems(rawList) {
      return (rawList || []).map(rec => {
        const f = rec.file || rec;
        let thumbUrl = rec.thumbDataUrl || '';
        if (!thumbUrl && rec.file) {
          try {
            thumbUrl = URL.createObjectURL(rec.file);
            _activeObjectUrls.add(thumbUrl);
          } catch (_) {
            thumbUrl = '';
          }
        }
        return {
          id: rec.id || ('am_' + Math.random().toString(36).slice(2, 7)),
          file: rec.file,
          thumbUrl,
          type: rec.type || (rec.file && rec.file.type) || 'image/jpeg',
          name: rec.name || (rec.file && rec.file.name) || 'media',
          duration: rec.duration || 0,
          durationText: rec.durationText || _formatDuration(rec.duration),
        };
      }).filter(x => !!x.thumbUrl);
    }

    // 0ms da xotiradagi keshni chizamiz
    if (_memRecentFiles.length > 0) {
      renderMediaGridItems(prepareItems(_memRecentFiles));
    }

    // Recent mediani IDB keshdan darhol chizish / yangilash
    _loadRecentMedia().then(cachedList => {
      if (!_activeDrawer) return;
      if (Array.isArray(cachedList) && cachedList.length) {
        _memRecentFiles.length = 0;
        _memRecentFiles.push(...cachedList);
        const prepared = prepareItems(cachedList);
        const selectedArr = Array.from(selectedMap.values());
        const merged = [...selectedArr, ...prepared.filter(p => !selectedMap.has(p.id))];
        renderMediaGridItems(merged.length ? merged : prepared);
        updateSelectionUI();
      }
    });

    // File pickerdan fayllar tanlanganda ushbu drawer ichiga kiritish
    _drawerPickerCallback = async (pickedFiles) => {
      if (!pickedFiles || !pickedFiles.length) return;
      await _saveRecentMedia(pickedFiles);

      const newItems = [];
      for (const f of pickedFiles) {
        let thumbUrl = '';
        try {
          thumbUrl = URL.createObjectURL(f);
          _activeObjectUrls.add(thumbUrl);
        } catch (_) {}
        let duration = 0;
        if (f.type && f.type.startsWith('video/')) {
          try { duration = await _getVideoDuration(f); } catch (_) {}
        }
        const id = 'am_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        const itemObj = {
          id,
          file: f,
          thumbUrl,
          type: f.type || 'image/jpeg',
          name: f.name || 'media',
          duration,
          durationText: _formatDuration(duration),
        };
        // Yangi tanlanganlarni avtomatik belgilab qo'yish (maksimal 10 ta)
        if (selectedMap.size < 10) {
          selectedMap.set(id, itemObj);
        }
        newItems.push(itemObj);
      }

      const filteredCurrent = currentMediaList.filter(
        c => !newItems.some(n => n.name === c.name && n.file?.size === c.file?.size)
      );
      const combined = [...newItems, ...filteredCurrent];
      renderMediaGridItems(combined);
      updateSelectionUI();
    };

    // Yuborish tugmasi bosilganda
    sendSubmitBtn?.addEventListener('click', async e => {
      e.preventDefault();
      e.stopPropagation();
      const itemsToSend = Array.from(selectedMap.values());
      closeAttachMenu();
      for (const it of itemsToSend) {
        const file = await _resolveFile(it);
        if (file && typeof onPick === 'function') {
          onPick(file);
        }
      }
    });

    // Bekor qilish tugmasi
    sendClearBtn?.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      selectedMap.clear();
      updateSelectionUI();
    });

    // 1-slot: Jonli Kamera oqimini asinxron fonda yuklaymiz (drawer ochilishini to'xtatmaydi)
    const camTile = overlay.querySelector('#amLiveCamTile');
    const camVideo = overlay.querySelector('.live-cam-video');
    const camFallback = overlay.querySelector('.live-cam-fallback');

    if (navigator.mediaDevices?.getUserMedia) {
      navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 480 } },
        audio: false,
      }).then(stream => {
        if (!_activeDrawer || !camVideo) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        _liveStream = stream;
        camVideo.srcObject = stream;
        camVideo.style.display = 'block';
        if (camFallback) camFallback.style.display = 'none';
      }).catch(err => {
        console.warn('[AttachMenu] camera stream not available:', err);
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

    overlay.querySelectorAll('label.attach-pill-btn').forEach(lbl => {
      lbl.addEventListener('click', () => {
        setTimeout(() => closeAttachMenu(), 250);
      });
    });

    // Galereya doiraviy tugmasi — drawer ochiq qolib, tanlangan fayllar bevosita drawer gridiga keladi
    const galBtn = overlay.querySelector('#amPillGallery');
    galBtn?.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      galleryPicker.click();
    });

    // Musiqa doiraviy tugmasi
    const audioBtn = overlay.querySelector('#amPillAudio');
    audioBtn?.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      audioPicker.click();
      closeAttachMenu();
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
      // 0ms da darhol ochiladi (kutish yo'q!)
      openMobileDrawer(dyn);
    } else {
      openDesktopDropdown(dyn);
    }
  });
}
