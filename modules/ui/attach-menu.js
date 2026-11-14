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

const SVG = {
  camera: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
  gallery: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
  folder: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
  file: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>',
  poll: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
  location: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
  send: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>',
};

let _activeDrawer = null;
let _activeDropdown = null;
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

async function _makeThumbnail(file) {
  if (!file || !file.type || !file.type.startsWith('image/')) return '';
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
            if (h > maxDim) { w = Math.round((w * maxDim) / h); h = maxDim; }
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

async function _saveRecentMedia(files) {
  if (!Array.isArray(files) || !files.length) return;
  for (const f of files) {
    if (!f) continue;
    let thumbDataUrl = '';
    try {
      thumbDataUrl = await _makeThumbnail(f);
    } catch (_) {}

    const item = {
      id: 'am_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      name: f.name || 'media',
      type: f.type || 'image/jpeg',
      size: f.size || 0,
      thumbDataUrl: thumbDataUrl,
      file: f,
      time: Date.now(),
    };
    _memRecentFiles.unshift(item);
    if (_memRecentFiles.length > 48) _memRecentFiles.pop();
    try {
      const db = await _getAttachDb();
      const tx = db.transaction(ATTACH_STORE, 'readwrite');
      tx.objectStore(ATTACH_STORE).put(item);
    } catch (_) {
      // Agar File serialize bo'lmasa, thumbnail bilan saqlaymiz
      try {
        const db = await _getAttachDb();
        const tx = db.transaction(ATTACH_STORE, 'readwrite');
        tx.objectStore(ATTACH_STORE).put({ ...item, file: null });
      } catch (_2) {}
    }
  }
}

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

  /* ─────────── 2. Mobil & Planshet Attach Sheet (Telegram uslubida) ─────────── */
  async function openMobileDrawer(dynamicOpts = {}, preAcquiredStream = null, hasCamDevice = false) {
    closeAttachMenu();

    const hasCam = !!hasCamDevice && !!preAcquiredStream;
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

        <!-- Telegram uslubidagi Media Photos & Videos Gridi (Scroll bo'ladigan 3 ustun) -->
        <div class="attach-media-grid" id="amMediaGrid">
          ${hasCam ? `
            <div class="attach-grid-item live-cam-tile" id="amLiveCamTile" role="button" tabindex="0" title="Kamera">
              <video class="live-cam-video" autoplay playsinline muted></video>
              <div class="live-cam-fallback" style="display:none">${SVG.camera}</div>
            </div>
          ` : ''}

          ${canMedia ? `
            <div class="attach-grid-item gallery-picker-tile" id="amGalleryPickerTile" role="button" tabindex="0" title="Galereyadan tanlash">
              <div class="grid-tile-icon-wrap gallery-icon-wrap">
                ${SVG.gallery}
              </div>
              <span class="grid-tile-name">+ Galereya</span>
              <span class="grid-tile-hint">Boshqa rasmlar</span>
            </div>
          ` : ''}

          <!-- Media fotosuratlar va videolar shu yerga yuklanadi -->
          <div id="amMediaItemsSlot" style="display:contents;"></div>
        </div>

        <!-- Tanlangan media fayllarni Telegram kabi birdaniga yuborish paneli (Send Bar) -->
        <div class="attach-send-bar" id="amSendBar" style="display:none;">
          <button type="button" class="attach-send-clear-btn" id="amSendClearBtn">Bekor qilish</button>
          <button type="button" class="attach-send-submit-btn" id="amSendSubmitBtn">
            <span id="amSendSubmitText">Yuborish (0)</span>
            ${SVG.send}
          </button>
        </div>

        <!-- Pastki Telegram uslubidagi pill tugmalar (Fayl, So‘rovnoma, Joylashuv) -->
        <div class="attach-bottom-pills" id="amBottomPills">
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

    const gridItemsSlot = overlay.querySelector('#amMediaItemsSlot');
    const sendBar = overlay.querySelector('#amSendBar');
    const sendClearBtn = overlay.querySelector('#amSendClearBtn');
    const sendSubmitBtn = overlay.querySelector('#amSendSubmitBtn');
    const sendSubmitText = overlay.querySelector('#amSendSubmitText');
    const bottomPills = overlay.querySelector('#amBottomPills');
    const galleryTile = overlay.querySelector('#amGalleryPickerTile');

    // Tanlangan fayllar xaritasi (id -> File)
    const selectedMap = new Map();
    let currentMediaList = [];

    function updateSelectionUI() {
      const keys = Array.from(selectedMap.keys());
      const count = keys.length;

      currentMediaList.forEach(item => {
        const tile = overlay.querySelector(`.media-photo-tile[data-media-id="${item.id}"]`);
        if (!tile) return;
        const checkBtn = tile.querySelector('.media-tile-check');
        const selIdx = keys.indexOf(item.id);
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
        if (bottomPills) bottomPills.style.display = 'flex';
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
        selectedMap.set(item.id, item.file);
      }
      updateSelectionUI();
    }

    function renderMediaGridItems(items) {
      currentMediaList = items;
      if (!gridItemsSlot) return;

      if (!items.length) {
        gridItemsSlot.innerHTML = `
          <div class="attach-grid-item gallery-empty-tile" id="amGalleryPromptTile" role="button" tabindex="0">
            <div class="grid-tile-icon-wrap" style="background:rgba(29,155,240,0.16); color:var(--blue, #1d9bf0); width:40px; height:40px; border-radius:12px; display:flex; align-items:center; justify-content:center;">
              ${SVG.gallery}
            </div>
            <span class="grid-tile-name" style="font-size:12px; font-weight:600; color:#fff;">Galereyani ochish</span>
            <span class="grid-tile-hint" style="font-size:10.5px; color:rgba(255,255,255,0.7);">Barcha rasm va videolar</span>
          </div>
        `;
        overlay.querySelector('#amGalleryPromptTile')?.addEventListener('click', () => {
          galleryPicker.click();
        });
        return;
      }

      gridItemsSlot.innerHTML = items.map(item => {
        const isVid = (item.type || '').startsWith('video/');
        const selIdx = Array.from(selectedMap.keys()).indexOf(item.id);
        const isSel = selIdx >= 0;
        return `
          <div class="attach-grid-item media-photo-tile ${isSel ? 'selected' : ''}" data-media-id="${item.id}" role="button" tabindex="0">
            <img class="media-tile-thumb" src="${item.thumbUrl}" alt="media" loading="lazy">
            ${isVid ? `<div class="media-tile-vid-badge"><svg viewBox="0 0 24 24" width="10" height="10" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg> Video</div>` : ''}
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

    // Recent mediani IDB keshdan yuklash
    _loadRecentMedia().then(cachedList => {
      if (!_activeDrawer) return;
      const prepared = cachedList.map(rec => {
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
        };
      }).filter(x => !!x.thumbUrl);

      renderMediaGridItems(prepared);
    });

    // "+ Galereyadan tanlash" bosilganda file pickerni chaqirish
    galleryTile?.addEventListener('click', async e => {
      e.preventDefault();
      e.stopPropagation();
      try {
        galleryPicker.click();
      } catch (err) {
        console.warn('[AttachMenu] Gallery open error:', err);
        const { toast } = await import('./toast.js');
        toast('Galereyani ochishda xatolik yuz berdi', 'error');
      }
    });

    // File pickerdan fayllar tanlanganda ushbu drawer ichiga kiritish
    _drawerPickerCallback = async (pickedFiles) => {
      if (!pickedFiles.length) return;
      await _saveRecentMedia(pickedFiles);

      const newItems = pickedFiles.map(f => {
        let thumbUrl = '';
        try {
          thumbUrl = URL.createObjectURL(f);
          _activeObjectUrls.add(thumbUrl);
        } catch (_) {}
        const id = 'am_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
        // Yangi tanlanganlarni avtomatik belgilab qo'yish
        selectedMap.set(id, f);
        return {
          id,
          file: f,
          thumbUrl,
          type: f.type || 'image/jpeg',
          name: f.name || 'media',
        };
      }).filter(x => !!x.thumbUrl);

      const combined = [...newItems, ...currentMediaList];
      renderMediaGridItems(combined);
      updateSelectionUI();
    };

    // Yuborish tugmasi bosilganda
    sendSubmitBtn?.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      const filesToSend = Array.from(selectedMap.values());
      closeAttachMenu();
      filesToSend.forEach(f => {
        if (typeof onPick === 'function') onPick(f);
      });
    });

    // Bekor qilish tugmasi
    sendClearBtn?.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      selectedMap.clear();
      updateSelectionUI();
    });

    // 1-slot: Jonli Kamera oqimi
    if (hasCam && preAcquiredStream) {
      const camTile = overlay.querySelector('#amLiveCamTile');
      const camVideo = overlay.querySelector('.live-cam-video');
      const camFallback = overlay.querySelector('.live-cam-fallback');

      _liveStream = preAcquiredStream;
      if (camVideo) {
        camVideo.srcObject = preAcquiredStream;
        camVideo.style.display = 'block';
        if (camFallback) camFallback.style.display = 'none';
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

    overlay.querySelectorAll('label.attach-pill-btn').forEach(lbl => {
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

  btn.addEventListener('click', async e => {
    e.preventDefault();
    e.stopPropagation();
    if (typeof isBusy === 'function' && isBusy()) return;
    if (_activeDrawer || _activeDropdown) {
      closeAttachMenu();
      return;
    }
    const dyn = (typeof getOptions === 'function' ? getOptions() : null) || {};
    if (isMobileOrTabletDevice()) {
      let hasCam = false;
      const wantCam = dyn.showCamera ?? showCamera;
      if (wantCam) {
        try {
          hasCam = await hasCameraDevice();
        } catch (_) {
          hasCam = false;
        }
      }

      let acquiredStream = null;
      if (hasCam) {
        try {
          acquiredStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 480 } },
            audio: false,
          });
        } catch (err) {
          console.warn('[AttachMenu] Camera permission denied or not available:', err);
          hasCam = false;
          acquiredStream = null;
        }
      }

      // Panel har doim ochiladi — kamera ruxsat bermagan bo'lsa ham galereya va media ko'rinadi!
      openMobileDrawer(dyn, acquiredStream, hasCam);
    } else {
      openDesktopDropdown(dyn);
    }
  });
}
