import { busEmit } from '../core/rt-bus.js';
import { sb, state, MAX_FILE, uploadViaController, mapPost } from '../core/config.js';
import { compressImage } from './compress.js';
import { $, esc, fmtSz, lockScroll, unlockScroll, defAvi } from '../core/utils.js';
import { toast }                                   from '../ui/toast.js';
import { isAllowedUpload, isImageFile, UPLOAD_DENIED_MSG, STORY_DENIED_MSG, ALLOWED_UPLOAD_ACCEPT } from '../core/upload-policy.js';

/* ═══════════════════════════════════════════════════════════════════════
   FILE TYPE → SVG icon + label + accent color
   ═══════════════════════════════════════════════════════════════════════ */
function getFileTypeInfo(name = '', mime = '') {
  const ext = (name.split('.').pop() || '').toLowerCase();
  const m   = (mime || '').toLowerCase();

  /* ── Audio / Music ── */
  if (m.startsWith('audio') || ['mp3','wav','ogg','aac','flac','m4a','wma','opus','aiff','mid','midi'].includes(ext))
    return {
      label: ext.toUpperCase() || 'AUDIO', color: '#ffffff',
      svg: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="48" height="48" rx="10" fill="rgba(255, 255, 255,0.12)"/>
        <path d="M18 34V18l16-4v16" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
        <circle cx="15" cy="34" r="3" fill="#ffffff"/>
        <circle cx="31" cy="30" r="3" fill="#ffffff"/>
        <path d="M20 22l12-3" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round" opacity=".5"/>
      </svg>`
    };

  /* ── HTML ── */
  if (['html','htm'].includes(ext) || m === 'text/html')
    return {
      label: 'HTML', color: '#f97316',
      svg: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="48" height="48" rx="10" fill="rgba(249,115,22,0.12)"/>
        <text x="24" y="29" text-anchor="middle" font-family="monospace" font-weight="700" font-size="10" fill="#f97316">&lt;/&gt;</text>
        <path d="M14 18l-5 6 5 6" stroke="#f97316" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M34 18l5 6-5 6" stroke="#f97316" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
        <line x1="28" y1="14" x2="20" y2="34" stroke="#f97316" stroke-width="2" stroke-linecap="round" opacity=".6"/>
      </svg>`
    };

  /* ── TypeScript ── */
  if (['ts','tsx'].includes(ext))
    return {
      label: 'TS', color: '#ffffff',
      svg: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="48" height="48" rx="10" fill="rgba(255, 255, 255,0.12)"/>
        <rect x="10" y="10" width="28" height="28" rx="5" fill="#ffffff"/>
        <text x="24" y="30" text-anchor="middle" font-family="monospace" font-weight="800" font-size="14" fill="white">TS</text>
      </svg>`
    };

  /* ── JavaScript / JSX ── */
  if (['js','mjs','cjs','jsx'].includes(ext) || m.includes('javascript'))
    return {
      label: ext === 'jsx' ? 'JSX' : 'JS', color: '#eab308',
      svg: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="48" height="48" rx="10" fill="rgba(234,179,8,0.12)"/>
        <rect x="10" y="10" width="28" height="28" rx="5" fill="#eab308"/>
        <text x="24" y="30" text-anchor="middle" font-family="monospace" font-weight="800" font-size="${ext==='jsx'?'10':'14'}" fill="currentColor">${ext === 'jsx' ? 'JSX' : 'JS'}</text>
      </svg>`
    };

  /* ── PDF ── */
  if (ext === 'pdf' || m === 'application/pdf')
    return {
      label: 'PDF', color: '#ef4444',
      svg: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="48" height="48" rx="10" fill="rgba(239,68,68,0.12)"/>
        <path d="M13 8h16l8 8v24a2 2 0 0 1-2 2H13a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z" stroke="#ef4444" stroke-width="2"/>
        <path d="M29 8v8h8" stroke="#ef4444" stroke-width="2" stroke-linecap="round"/>
        <text x="24" y="34" text-anchor="middle" font-family="monospace" font-weight="700" font-size="9" fill="#ef4444">PDF</text>
      </svg>`
    };

  /* ── ZIP / Archive ── */
  if (['zip','rar','7z','tar','gz','bz2','xz','lz','lzma'].includes(ext))
    return {
      label: ext.toUpperCase(), color: '#ffffff',
      svg: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="48" height="48" rx="10" fill="rgba(255, 255, 255,0.12)"/>
        <rect x="12" y="16" width="24" height="20" rx="3" stroke="#ffffff" stroke-width="2"/>
        <path d="M12 22h24" stroke="#ffffff" stroke-width="2"/>
        <path d="M12 28h24" stroke="#ffffff" stroke-width="1.4" opacity=".5"/>
        <rect x="20" y="8" width="8" height="8" rx="2" stroke="#ffffff" stroke-width="2"/>
        <line x1="24" y1="8" x2="24" y2="16" stroke="#ffffff" stroke-width="2"/>
        <line x1="21" y1="11" x2="27" y2="11" stroke="#ffffff" stroke-width="1.5" opacity=".6"/>
        <line x1="21" y1="13" x2="27" y2="13" stroke="#ffffff" stroke-width="1.5" opacity=".6"/>
      </svg>`
    };

  /* ── Word / DOC ── */
  if (['doc','docx'].includes(ext) || m.includes('msword') || m.includes('wordprocessingml'))
    return {
      label: 'DOCX', color: '#ffffff',
      svg: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="48" height="48" rx="10" fill="rgba(255, 255, 255,0.12)"/>
        <path d="M13 8h16l8 8v24a2 2 0 0 1-2 2H13a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z" stroke="#ffffff" stroke-width="2"/>
        <path d="M29 8v8h8" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>
        <line x1="16" y1="26" x2="32" y2="26" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>
        <line x1="16" y1="31" x2="28" y2="31" stroke="#ffffff" stroke-width="2" stroke-linecap="round" opacity=".6"/>
        <text x="24" y="23" text-anchor="middle" font-family="sans-serif" font-weight="800" font-size="8" fill="#ffffff">W</text>
      </svg>`
    };

  /* ── Excel / CSV / Spreadsheet ── */
  if (['xls','xlsx','csv','ods'].includes(ext) || m.includes('spreadsheet') || m.includes('excel') || m === 'text/csv')
    return {
      label: ext.toUpperCase(), color: '#16a34a',
      svg: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="48" height="48" rx="10" fill="rgba(22,163,74,0.12)"/>
        <rect x="9" y="14" width="30" height="22" rx="3" stroke="#16a34a" stroke-width="2"/>
        <line x1="9" y1="22" x2="39" y2="22" stroke="#16a34a" stroke-width="1.5"/>
        <line x1="9" y1="29" x2="39" y2="29" stroke="#16a34a" stroke-width="1.5" opacity=".6"/>
        <line x1="21" y1="14" x2="21" y2="36" stroke="#16a34a" stroke-width="1.5" opacity=".7"/>
        <line x1="30" y1="14" x2="30" y2="36" stroke="#16a34a" stroke-width="1.5" opacity=".5"/>
      </svg>`
    };

  /* ── Python ── */
  if (ext === 'py' || m === 'text/x-python')
    return {
      label: 'PY', color: '#ffffff',
      svg: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="48" height="48" rx="10" fill="rgba(255, 255, 255,0.10)"/>
        <path d="M18 10h8a4 4 0 0 1 4 4v4H18a4 4 0 0 1-4-4v-2a2 2 0 0 1 2-2z" fill="#ffffff"/>
        <path d="M18 38h8a4 4 0 0 0 4-4v-4H18a4 4 0 0 0-4 4v2a2 2 0 0 0 2 2z" fill="#eab308"/>
        <circle cx="22" cy="16" r="1.5" fill="white"/>
        <circle cx="26" cy="32" r="1.5" fill="white"/>
      </svg>`
    };

  /* ── JSON ── */
  if (ext === 'json' || m === 'application/json')
    return {
      label: 'JSON', color: '#f59e0b',
      svg: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="48" height="48" rx="10" fill="rgba(245,158,11,0.12)"/>
        <text x="10" y="30" font-family="monospace" font-weight="700" font-size="18" fill="#f59e0b">{}</text>
        <text x="10" y="20" font-family="monospace" font-size="9" fill="#f59e0b" opacity=".7">"key":</text>
      </svg>`
    };

  /* ── CSS / SCSS ── */
  if (['css','scss','sass','less'].includes(ext))
    return {
      label: ext.toUpperCase(), color: '#ffffff',
      svg: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="48" height="48" rx="10" fill="rgba(255, 255, 255,0.12)"/>
        <rect x="10" y="10" width="28" height="28" rx="5" fill="#ffffff"/>
        <text x="24" y="30" text-anchor="middle" font-family="monospace" font-weight="800" font-size="11" fill="white">CSS</text>
      </svg>`
    };

  /* ── Markdown ── */
  if (['md','mdx','markdown'].includes(ext))
    return {
      label: 'MD', color: '#767676',
      svg: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="48" height="48" rx="10" fill="rgba(118, 118, 118,0.12)"/>
        <path d="M8 14h32v20H8z" stroke="#767676" stroke-width="2" rx="3"/>
        <text x="24" y="29" text-anchor="middle" font-family="monospace" font-weight="700" font-size="11" fill="#767676">M↓</text>
      </svg>`
    };

  /* ── Plain Text / TXT / LOG ── */
  if (['txt','log','ini','cfg','conf'].includes(ext) || m === 'text/plain')
    return {
      label: ext.toUpperCase() || 'TXT', color: '#a6a6a6',
      svg: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
        <rect width="48" height="48" rx="10" fill="rgba(166, 166, 166,0.10)"/>
        <path d="M13 8h16l8 8v24a2 2 0 0 1-2 2H13a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z" stroke="#a6a6a6" stroke-width="2"/>
        <path d="M29 8v8h8" stroke="#a6a6a6" stroke-width="2" stroke-linecap="round"/>
        <line x1="16" y1="22" x2="32" y2="22" stroke="#a6a6a6" stroke-width="1.8" stroke-linecap="round"/>
        <line x1="16" y1="27" x2="32" y2="27" stroke="#a6a6a6" stroke-width="1.8" stroke-linecap="round" opacity=".7"/>
        <line x1="16" y1="32" x2="26" y2="32" stroke="#a6a6a6" stroke-width="1.8" stroke-linecap="round" opacity=".5"/>
      </svg>`
    };

  /* ── Default / unknown ── */
  return {
    label: (ext || 'FILE').toUpperCase(), color: '#ffffff',
    svg: `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="48" height="48" rx="10" fill="rgba(255, 255, 255,0.10)"/>
      <path d="M13 8h16l8 8v24a2 2 0 0 1-2 2H13a2 2 0 0 1-2-2V10a2 2 0 0 1 2-2z" stroke="#ffffff" stroke-width="2"/>
      <path d="M29 8v8h8" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>
      <line x1="16" y1="24" x2="32" y2="24" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" opacity=".6"/>
      <line x1="16" y1="30" x2="28" y2="30" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" opacity=".4"/>
    </svg>`
  };
}

/* export so feed.js can use it too */
export { getFileTypeInfo };

/* ── FIX: Object URL ni tozalash helper ──────────────────────────────── */
function revokeObjUrl() {
  if (state._objUrl) { URL.revokeObjectURL(state._objUrl); state._objUrl = null; }
  state._selMediaW = null;
  state._selMediaH = null;
}

/* Rasm tanlanganda haqiqiy o'lchamini (width/height) o'lchab olamiz —
   shu orqali feed'da post-card media joyi hali yuklanmasdan turib ham
   TO'G'RI aspect-ratio bilan ochilib turadi (blur bilan), layout sakramaydi. */
function _measureSelectedMedia(file, objUrl) {
  state._selMediaW = null;
  state._selMediaH = null;
  if (file.type.startsWith('image')) {
    const img = new Image();
    img.onload = () => {
      // Foydalanuvchi shu orada faylni almashtirgan/tozalagan bo'lishi mumkin
      if (state._objUrl !== objUrl) return;
      state._selMediaW = img.naturalWidth  || null;
      state._selMediaH = img.naturalHeight || null;
    };
    img.src = objUrl;
  }
}

/* ── Composer rejimi: 'post' (odatiy) yoki 'story' (24 soatlik hikoya) ──
   Story ham xuddi shu composer kartasida ochiladi — faqat matn maydoni o'rniga
   qisqa izoh, faqat rasm, tugma "Story". */
const STORY_CAPTION_MAX = 200;
const _POST_ACCEPT = $('fileInput').accept;
const _POST_PLACEHOLDER = $('captionInput').placeholder;
let _composerMode = 'post';

function _setComposerMode(mode) {
  _composerMode = mode;
  const story = mode === 'story';
  const cap = $('captionInput');
  cap.placeholder = story ? "Story 24 soat davomida ko'rinadi. Izoh yozing (ixtiyoriy)…" : _POST_PLACEHOLDER;
  if (story) cap.maxLength = STORY_CAPTION_MAX; else cap.removeAttribute('maxlength');
  $('fileInput').accept = story ? 'image/*' : ALLOWED_UPLOAD_ACCEPT;
  $('uploadDrop').setAttribute('aria-label', story ? 'Story uchun rasm tanlash' : "Rasm yoki fayl qo'shish");
}

/* ── Button enable/disable check ────────────────────────────────────── */
function refreshPostBtn() {
  const hasFile = !!state.selFile;
  if (_composerMode === 'story') { $('uploadBtn').disabled = !hasFile; return; }
  const hasText = !!($('captionInput').value.trim());
  $('uploadBtn').disabled = !(hasText || hasFile);
}

/* ── Reset ───────────────────────────────────────────────────────────── */
export function resetUpload() {
  _setComposerMode('post');
  revokeObjUrl();
  state.selFile = null;
  $('fileInput').value = '';
  $('previewArea').style.display = 'none';
  $('previewArea').innerHTML = '';
  $('captionInput').value = '';
  $('uploadBtn').disabled = true;
  $('uploadBtn').textContent = 'Yuklash';
  $('sizeWarn').textContent = '';
  hideProgress();
}

/* ── Progress helpers ────────────────────────────────────────────────── */
function showProgress(pct) {
  const bar   = $('uploadProgress');
  const fill  = $('uploadProgressFill');
  const label = $('uploadProgressPct');
  if (!bar) return;
  bar.classList.add('active');
  fill.style.width = pct + '%';
  label.textContent = pct.toFixed(1) + '%';
}

function hideProgress() {
  const bar = $('uploadProgress');
  if (bar) bar.classList.remove('active');
  const fill = $('uploadProgressFill');
  if (fill) fill.style.width = '0%';
}

/* ── File pick ───────────────────────────────────────────────────────── */
export function pickFile(f) {
  if (!isAllowedUpload(f)) {
    toast(UPLOAD_DENIED_MSG, 'error');
    $('fileInput').value = '';
    return;
  }
  if (_composerMode === 'story' && !isImageFile(f)) {
    toast(STORY_DENIED_MSG, 'error');
    $('fileInput').value = '';
    return;
  }
  {
    if (f.size > MAX_FILE) {
      const limTxt = '49.9 MB';
      $('sizeWarn').textContent = `Fayl ${fmtSz(f.size)} — limit ${limTxt}`;
      toast(`Fayl hajmi ${limTxt} dan oshmasligi kerak`, 'error');
      return;
    }
  }
  $('sizeWarn').textContent = '';
  revokeObjUrl();
  state.selFile = f;
  state._objUrl = URL.createObjectURL(f);
  _measureSelectedMedia(f, state._objUrl);
  $('uploadBtn').disabled = false;
  $('previewArea').style.display = 'block';

  if (f.type.startsWith('image')) {
    $('previewArea').innerHTML = `<div class="preview-wrap"><img src="${esc(state._objUrl)}"><button class="preview-clear" data-action="clear-file">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
    </button></div>`;
  } else {
    const info = getFileTypeInfo(f.name, f.type);
    $('previewArea').innerHTML = `<div class="preview-file">
      <div class="preview-file-icon w-44px h-44px flex-shrink-0">${info.svg}</div>
      <div class="flex-1 min-w-0">
        <div class="fs-13px fw-500 ws-nowrap overflow-hidden text-ellipsis">${esc(f.name)}</div>
        <div class="fs-11px c-text3-theme mt-2px">${info.label} · ${fmtSz(f.size)}</div>
      </div>
      <button class="bg-transparent border-none c-text3-theme cursor-pointer d-flex items-center flex-shrink-0" data-action="clear-file">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>`;
  }
  refreshPostBtn();
}

/* ── Caption input → enable/disable Post btn ─────────────────────────── */
$('captionInput').addEventListener('input', refreshPostBtn);

/* ── Preview clear ───────────────────────────────────────────────────── */
$('previewArea').addEventListener('click', e => {
  if (e.target.closest('[data-action="clear-file"]')) clearFile();
});

function clearFile() {
  revokeObjUrl();
  state.selFile = null;
  $('previewArea').style.display = 'none';
  $('previewArea').innerHTML = '';
  $('fileInput').value = '';
  refreshPostBtn();
}

/* ── Yuklash / Post ───────────────────────────────────────────────────── */
/* ── Float bar helpers ───────────────────────────────────────────────── */

/* Rasm kerak bo'lganda siqadi (compress.js). Float bar'da foiz ko'rsatiladi. */
async function _prepareUploadFile(file, label) {
  if (!file) return file;
  // Rasm — shaffoflikni saqlagan holda siqish
  if (file.type.startsWith('image/')) {
    try {
      const compressed = await compressImage(file);
      if (compressed !== file) console.info('[compress] image:', fmtSz(file.size), '→', fmtSz(compressed.size), compressed.type);
      return compressed;
    } catch (e) {
      console.warn('[compress] image failed, original:', e?.message || e);
      return file;
    }
  }
  return file;
}

function floatBarShow(kind) {
  const bar = $('uploadFloatBar');
  if (!bar) return;
  const label = kind === 'story' ? 'Story yuklanmoqda'
    : kind === 'post' ? 'Post yuklanmoqda'
    : 'Yuklanmoqda';
  $('ufbName').textContent = label;
  const fill = $('ufbFill');
  if (fill) { fill.style.width = '0%'; fill.classList.remove('indeterminate'); }
  $('ufbPct').textContent = '0%';
  const icon = bar.querySelector('.ufb-icon');
  if (icon) {
    icon.classList.remove('done', 'fail');
    icon.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>';
  }
  bar.classList.remove('d-none');
  bar.style.display = 'flex';
}

function floatBarUpdate(pct) {
  const fill = $('ufbFill');
  const pctEl = $('ufbPct');
  if (!fill) return;
  if (pct >= 95) {
    fill.classList.add('indeterminate');
    if (pctEl) pctEl.textContent = '…';
  } else {
    fill.classList.remove('indeterminate');
    fill.style.width = pct + '%';
    if (pctEl) pctEl.textContent = Math.round(pct) + '%';
  }
}

function floatBarDone(success) {
  const bar  = $('uploadFloatBar');
  const icon = bar?.querySelector('.ufb-icon');
  const fill = $('ufbFill');
  if (!bar) return;
  fill?.classList.remove('indeterminate');
  if (fill) fill.style.width = '100%';
  $('ufbPct').textContent = success ? '✓' : '!';
  $('ufbName').textContent = success ? 'Tayyor' : 'Xato';
  if (icon) {
    icon.classList.remove('done', 'fail');
    icon.classList.add(success ? 'done' : 'fail');
    icon.innerHTML = success
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>'
      : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
  }
  setTimeout(() => {
    if (bar) { bar.style.display = 'none'; bar.classList.add('d-none'); }
    if (icon) {
      icon.classList.remove('done', 'fail');
      icon.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>';
    }
  }, 1800);
}

/* ── Yuklash / Post ───────────────────────────────────────────────────── */
/* ── Story yuklash (composer 'story' rejimida) ─────────────────────── */
async function submitStory() {
  let file = state.selFile;
  if (!file || !state.me) return;
  const caption = $('captionInput').value.trim().slice(0, STORY_CAPTION_MAX);

  const { rateOk } = await import('../core/rate-limit.js');
  if (!rateOk('story', 3, 60000)) {
    const { toast } = await import('../ui/ui.js');
    toast('Juda ko\'p story yukladingiz', 'warning');
    return;
  }

  // 0ms: o'zimga darhol ko'rsatish (local blob)
  const tempId = (crypto.randomUUID && crypto.randomUUID()) || ('tmp_' + Date.now());
  const localBlob = state._objUrl || null;
  busEmit('story', {
    op: 'opt',
    item: {
      id: tempId,
      mediaUrl: localBlob,
      mediaType: 'image',
      caption: caption || '',
      createdAt: new Date().toISOString(),
    },
  });

  $('uploadBtn').disabled    = true;
  $('uploadBtn').textContent = 'Yuklanmoqda…';
  $('uploadOverlay').classList.remove('show');
  unlockScroll();
  floatBarShow('story');
  // Composer tozalanadi, lekin blob URL revoke qilinmaydi (optimistic ko'rinish uchun)
  const fileRef = file;
  const blobKeep = localBlob;
  state.selFile = null;
  state._objUrl = null; // revoke qilmaymiz
  state._selMediaW = null;
  state._selMediaH = null;
  _setComposerMode('post');
  try {
    const fi = $('fileInput'); if (fi) fi.value = '';
    const prev = $('filePreview'); if (prev) prev.innerHTML = '';
    const cap = $('captionInput'); if (cap) cap.value = '';
  } catch (_) {}

  let simInterval;
  try {
    let simPct = 0;
    file = await _prepareUploadFile(fileRef, fileRef.name.length > 28 ? fileRef.name.slice(0, 26) + '…' : fileRef.name);
    floatBarUpdate(0);
    simInterval = setInterval(() => {
      const step = Math.max(0.3, (3 - (file.size / (10 * 1024 * 1024))) * Math.random());
      simPct = Math.min(simPct + step, 88);
      floatBarUpdate(simPct);
    }, 200);
    const { path } = await uploadViaController(file, 'stories');
    clearInterval(simInterval);
    floatBarUpdate(100);

    const row = {
      user_id:    state.me.uid,
      media_path: path,
      media_type: 'image',
      expires_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
    };
    if (caption) row.caption = caption;
    let { error } = await sb.from('stories').insert(row);
    let captionLost = false;
    if (error && caption && /caption/i.test(error.message || '')) {
      delete row.caption;
      captionLost = true;
      ({ error } = await sb.from('stories').insert(row));
    }
    if (error) throw error;

    floatBarDone(true);
    toast(captionLost ? 'Story qo\'shildi, lekin izoh saqlanmadi (DB da caption ustuni yo\'q)' : 'Story qo\'shildi',
          captionLost ? 'info' : 'success');
    // Serverdagi haqiqiy story — boshqalarga + o'zimni yangilash
    busEmit('story', { op: 'new' });
    import('./stories.js').then(m => m.loadStories()).catch(() => {});
    // blob endi kerak emas
    if (blobKeep) try { URL.revokeObjectURL(blobKeep); } catch (_) {}
  } catch (err) {
    clearInterval(simInterval);
    floatBarDone(false);
    toast('Story yuklanmadi: ' + (err.message || 'Noma\'lum xatolik'), 'error');
    if (blobKeep) try { URL.revokeObjectURL(blobKeep); } catch (_) {}
    import('./stories.js').then(m => m.loadStories()).catch(() => {});
  } finally {
    $('uploadBtn').disabled = false;
    $('uploadBtn').textContent = 'Yuklash';
  }
}

export async function submitPost() {
  if (_composerMode === 'story') return submitStory();
  const caption      = $('captionInput').value.trim();
  const isPublic     = true;
  if (!state.me) return;
  if (!caption && !state.selFile) return;

  const { rateOk } = await import('../core/rate-limit.js');
  if (!rateOk('post', 3, 60000)) {
    const { toast } = await import('../ui/ui.js');
    toast('Juda ko\'p post yozdingiz. Biroz kuting', 'warning');
    return;
  }

  const hasFile = !!state.selFile;
  const fileRef = state.selFile;
  const localBlob = state._objUrl || null;
  const mediaW = state._selMediaW || null;
  const mediaH = state._selMediaH || null;
  const tempId = (crypto.randomUUID && crypto.randomUUID()) || ('tmp_' + Date.now());
  const displayName = state.me.displayName || state._userCache?.[state.me.uid]?.fullName || 'Foydalanuvchi';

  // ── 0ms: o'zimga darhol feedda ko'rsatish ───────────────────────────
  const optimistic = {
    id: tempId,
    userId: state.me.uid,
    userFullName: displayName,
    text: caption || null,
    mediaPath: null,
    mediaUrl: localBlob,
    mediaType: fileRef?.type || null,
    mediaWidth: mediaW,
    mediaHeight: mediaH,
    fileName: fileRef?.name || null,
    fileSize: fileRef?.size || null,
    isPublic: true,
    isMaxPrivate: false,
    likes: 0,
    commentCount: 0,
    createdAt: Date.now(),
    _optimistic: true,
  };
  busEmit('post', { op: 'opt', post: optimistic });

  $('uploadBtn').disabled    = true;
  $('uploadBtn').textContent = 'Yuklanmoqda…';
  $('uploadOverlay').classList.remove('show');
  unlockScroll();
  if (hasFile) floatBarShow('post');
  _clearHomeComposerUi();
  // Composer tozalash — blob revoke YO'Q (optimistic media uchun)
  state.selFile = null;
  state._objUrl = null;
  state._selMediaW = null;
  state._selMediaH = null;
  _setComposerMode('post');
  try {
    const fi = $('fileInput'); if (fi) fi.value = '';
    const prev = $('filePreview'); if (prev) prev.innerHTML = '';
    const cap = $('captionInput'); if (cap) cap.value = '';
  } catch (_) {}

  try {
    const { data: ud } = await sb.from('profiles').select('full_name').eq('id', state.me.uid).maybeSingle();
    let mediaPath = null;
    let mediaType = null;
    let fileName  = null;
    let fileSize  = null;

    if (hasFile && fileRef) {
      let file = fileRef;
      file = await _prepareUploadFile(file, fileRef.name.length > 28 ? fileRef.name.slice(0, 26) + '…' : fileRef.name);
      floatBarUpdate(0);

      let simPct = 0;
      const simInterval = setInterval(() => {
        const step = Math.max(0.3, (3 - (file.size / (10 * 1024 * 1024))) * Math.random());
        simPct = Math.min(simPct + step, 88);
        floatBarUpdate(simPct);
      }, 200);

      const result = await uploadViaController(file, 'posts');
      clearInterval(simInterval);
      floatBarUpdate(100);

      mediaPath = result.path;
      mediaType = file.type;
      fileName  = file.name;
      fileSize  = file.size;
    }

    const { data: _newPost, error: postErr } = await sb.from('posts').insert({
      user_id:        state.me.uid,
      user_full_name: ud?.full_name || displayName,
      text:           caption || null,
      media_path:     mediaPath,
      media_type:     mediaType,
      media_width:    hasFile ? mediaW : null,
      media_height:   hasFile ? mediaH : null,
      file_name:      fileName,
      file_size:      fileSize,
      is_public:      !!isPublic,
    }).select('*').maybeSingle();
    if (postErr) {
      if (mediaPath) sb.storage.from('media').remove([mediaPath]).catch(() => {});
      throw postErr;
    }

    // Haqiqiy post → temp o'rniga; boshqalarga ham
    if (_newPost) busEmit('post', { op: 'new', row: _newPost, replaceId: tempId });

    if (hasFile) floatBarDone(true);
    else toast('Yuklandi!', 'success');

    // blob endi server URL bilan almashtirilgan — biroz kutib revoke
    if (localBlob) setTimeout(() => { try { URL.revokeObjectURL(localBlob); } catch (_) {} }, 8000);
  } catch (err) {
    // Optimistic postni olib tashlash
    busEmit('post', { op: 'del', id: tempId });
    if (hasFile) {
      floatBarDone(false);
      toast('Yuklash amalga oshmadi: ' + (err.message || 'Noma\'lum xatolik'), 'error');
    } else {
      toast('Xatolik: ' + (err.message || 'Noma\'lum xatolik'), 'error');
    }
    if (localBlob) try { URL.revokeObjectURL(localBlob); } catch (_) {}
  } finally {
    $('uploadBtn').disabled = false;
    $('uploadBtn').textContent = 'Yuklash';
  }
}

$('uploadBtn').onclick = () => { submitPost(); };

/* ── Overlay open/close ──────────────────────────────────────────────── */
export function openComposer() {
  $('uploadOverlay').classList.add('show');
  lockScroll();
  resetUpload();
  loadComposerAvi();
}
/* Story "+" bosilganda: fayl menejerini darhol ochmaymiz — post kabi composer kartasi ochiladi */
export function openStoryComposer() {
  if (!state.me) return;
  $('uploadOverlay').classList.add('show');
  lockScroll();
  resetUpload();
  _setComposerMode('story');
  $('uploadBtn').textContent = 'Story';
  loadComposerAvi();
}
$('createBtn').onclick     = openComposer;
$('hdrNewPostBtn').onclick = openComposer;

/* Inline home composer — joyida yoziladi, modal ochilmaydi */
let _homeAviSig = '';
let _homeFocused = false;

function _fillHomeComposerAvi() {
  const box = $('homeComposerAvi');
  if (!box) return;
  const me = state.me;
  if (!me?.uid) return;
  const name = me.displayName || me.username || 'U';
  const av = me.photoURL || defAvi(name);
  const sig = me.uid + '|' + av;
  if (sig === _homeAviSig) return;
  _homeAviSig = sig;
  box.innerHTML = `<img src="${esc(av)}" alt="" onerror="this.src='${esc(defAvi(name))}';this.onerror=null">`;
}

function _homeHasContent() {
  const inp = $('homeComposerInput');
  const text = !!(inp && inp.value.trim());
  const file = !!state.selFile;
  return text || file;
}

function _syncHomeUi() {
  const row = $('homeComposer');
  const inp = $('homeComposerInput');
  const attach = $('homeComposerAttach');
  const btn = $('homeComposerBtn');
  if (!row || !inp) return;

  const has = _homeHasContent();

  row.classList.toggle('is-active', _homeFocused);
  row.classList.toggle('has-content', has);

  // attach doim ko'rinadi
  if (attach) attach.removeAttribute('hidden');
  if (btn) btn.disabled = !has;

  // textarea auto-height: bo'sh bo'lganda doimiy 30px (layout 2px sakramasligi uchun)
  if (!inp.value) {
    inp.style.height = '30px';
  } else {
    inp.style.height = 'auto';
    inp.style.height = Math.max(30, Math.min(inp.scrollHeight || 30, 160)) + 'px';
  }
}

function _clearHomeFile() {
  revokeObjUrl();
  state.selFile = null;
  const fi = $('homeComposerFile');
  if (fi) fi.value = '';
  const prev = $('homeComposerPreview');
  if (prev) {
    prev.classList.add('d-none');
    prev.innerHTML = '';
  }
  // modal preview ham tozalansin
  const pa = $('previewArea');
  if (pa) { pa.style.display = 'none'; pa.innerHTML = ''; }
  _syncHomeUi();
}

function _renderHomePreview(f) {
  const prev = $('homeComposerPreview');
  if (!prev || !f) return;
  const url = state._objUrl;
  let inner = '';
  if (f.type.startsWith('image/')) {
    inner = `<img src="${esc(url)}" alt="">`;
  } else {
    inner = `<div class="hc-file"><span>📎</span><span>${esc(f.name)} · ${fmtSz(f.size)}</span></div>`;
  }
  prev.innerHTML = inner + `<button type="button" class="hc-clear" data-action="hc-clear" aria-label="O'chirish">
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
  </button>`;
  prev.classList.remove('d-none');
}

function _pickHomeFile(f) {
  if (!f) return;
  // mavjud pickFile logikasidan foydalanamiz (limit, preview state)
  pickFile(f);
  if (state.selFile) _renderHomePreview(state.selFile);
  _syncHomeUi();
}

function _clearHomeComposerUi() {
  const inp = $('homeComposerInput');
  if (inp) {
    inp.value = '';
    inp.style.height = '30px';
  }
  const prev = $('homeComposerPreview');
  if (prev) { prev.classList.add('d-none'); prev.innerHTML = ''; }
  const hcf = $('homeComposerFile');
  if (hcf) hcf.value = '';
  _homeFocused = false;
  _syncHomeUi();
  inp?.blur();
}

async function _submitHomePost() {
  const inp = $('homeComposerInput');
  if (!inp || !state.me) return;
  const caption = inp.value.trim();
  if (!caption && !state.selFile) return;

  const cap = $('captionInput');
  if (cap) cap.value = caption;

  // home Post tugmasini vaqtincha o'chiramiz
  const hbtn = $('homeComposerBtn');
  if (hbtn) { hbtn.disabled = true; hbtn.textContent = 'Yuklanmoqda…'; }

  try {
    await submitPost();
  } finally {
    if (hbtn) hbtn.textContent = 'Post';
    _syncHomeUi();
  }
}

function _bindHomeComposer() {
  const row = $('homeComposer');
  const inp = $('homeComposerInput');
  if (!row || !inp || row._bound) return;
  row._bound = true;

  inp.addEventListener('focus', () => {
    _homeFocused = true;
    _syncHomeUi();
  });
  inp.addEventListener('blur', () => {
    // blur kechikishi — attach bosilganda file dialog ochilishi uchun
    setTimeout(() => {
      _homeFocused = document.activeElement === inp;
      _syncHomeUi();
    }, 150);
  });
  inp.addEventListener('input', () => _syncHomeUi());
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (_homeHasContent()) _submitHomePost();
    }
    // Shift+Enter — yangi qator (default)
  });

  $('homeComposerAttach')?.addEventListener('mousedown', e => {
    // blur oldin ishlashi uchun
    e.preventDefault();
  });
  $('homeComposerAttach')?.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    $('homeComposerFile')?.click();
  });

  $('homeComposerFile')?.addEventListener('change', e => {
    const f = e.target.files?.[0];
    if (f) _pickHomeFile(f);
  });

  $('homeComposerPreview')?.addEventListener('click', e => {
    if (e.target.closest('[data-action="hc-clear"]')) {
      e.preventDefault();
      _clearHomeFile();
    }
  });

  $('homeComposerBtn')?.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    if (_homeHasContent()) _submitHomePost();
  });

  _fillHomeComposerAvi();
  _syncHomeUi();
  setInterval(_fillHomeComposerAvi, 1500);
}
_bindHomeComposer();

$('cancelUpload').onclick = () => { $('uploadOverlay').classList.remove('show'); unlockScroll(); resetUpload(); };
$('uploadOverlay').onclick = e => {
  if (e.target === $('uploadOverlay')) { $('uploadOverlay').classList.remove('show'); unlockScroll(); resetUpload(); }
};

/* ── File input / drop / paste ───────────────────────────────────────── */
$('uploadDrop').onclick = () => $('fileInput').click();
$('fileInput').onchange = e => { if (e.target.files[0]) pickFile(e.target.files[0]); };

$('uploadDrop').addEventListener('dragover', e => {
  e.preventDefault();
  $('uploadDrop').classList.add('drag-over');
});
$('uploadDrop').addEventListener('dragleave', () => $('uploadDrop').classList.remove('drag-over'));
$('uploadDrop').addEventListener('drop', e => {
  e.preventDefault();
  $('uploadDrop').classList.remove('drag-over');
  const f = e.dataTransfer.files[0]; if (f) pickFile(f);
});

/* Suhbat (chat) ochiq bo'lsa, paste / drag-drop qilingan fayl post composer'iga emas, shu suhbatga biriktiriladi.
   Chat ustida boshqa oyna (profil, izoh, sozlamalar...) ochiq bo'lsa — oddiy holat (composer). */
const _isOpenEl = id => { const el = $(id); return !!el && (el.classList.contains('show') || el.classList.contains('open')); };
const _chatCtx = () => _isOpenEl('chatThreadModal') && ![
  'uploadOverlay', 'userProfileModal', 'detailModal', 'settingsOverlay',
  'cmtModal', 'zoomModal', 'grpInfoOverlay', 'grpEditOverlay', 'confirmOverlay',
].some(_isOpenEl);
const _toChat = f => document.dispatchEvent(new CustomEvent('chat:attach-file', { detail: { file: f } }));

window.addEventListener('paste', e => {
  for (const item of (e.clipboardData?.items || [])) {
    if (item.kind === 'file') {
      const f = item.getAsFile();
      if (!f) continue;
      if (_chatCtx()) { e.preventDefault(); _toChat(f); break; }
      pickFile(f); $('uploadOverlay').classList.add('show'); lockScroll(); break;
    }
  }
});

/* ── Sahifaning istalgan joyiga fayl tashlash → composer ochiladi ───── */
let _dragDepth = 0;
const _hasFiles = e => Array.from(e.dataTransfer?.types || []).includes('Files');
const _endGlobalDrag = () => { _dragDepth = 0; document.body.classList.remove('file-dragging'); };

window.addEventListener('dragenter', e => {
  if (!_hasFiles(e) || !state.me) return;
  e.preventDefault();
  _dragDepth++;
  document.body.classList.add('file-dragging');
});
window.addEventListener('dragover', e => {
  if (!_hasFiles(e)) return;
  e.preventDefault(); // brauzer faylni ochib yubormasin
});
window.addEventListener('dragleave', e => {
  if (!_hasFiles(e)) return;
  _dragDepth = Math.max(0, _dragDepth - 1);
  if (_dragDepth === 0) document.body.classList.remove('file-dragging');
});
window.addEventListener('drop', e => {
  if (!_hasFiles(e)) return;
  e.preventDefault();
  _endGlobalDrag();
  if (e.defaultPrevented && e.target.closest?.('#uploadDrop')) return; // uploadDrop o'zi hal qildi
  if (!state.me) return;
  const f = e.dataTransfer.files[0];
  if (!f) return;
  if (_chatCtx()) { _toChat(f); return; } // suhbat ochiq — post composer ochilmaydi
  if (!$('uploadOverlay').classList.contains('show')) openComposer();
  pickFile(f);
  setTimeout(() => $('captionInput')?.focus({ preventScroll: true }), 50);
});
