import { busEmit } from '../core/rt-bus.js';
import { getCachedProfile } from '../core/local-cache.js';
import { sb, state, MAX_FILE, uploadViaController, mapPost } from '../core/config.js';
import { compressImage } from './compress.js';
import { $, esc, fmtSz, lockScroll, unlockScroll, defAvi } from '../core/utils.js';
import { toast }                                   from '../ui/toast.js';
import { initAttachMenu }                          from '../ui/attach-menu.js';
import { isAllowedUpload, isImageFile, isVideoFile, UPLOAD_DENIED_MSG, STORY_DENIED_MSG, ALLOWED_UPLOAD_ACCEPT } from '../core/upload-policy.js';
import { getFileTypeInfo } from '../core/file-icons.js';
import { prepareVideo, ensureVideoDuration, hardenVideoPlayback } from '../core/video-policy.js';
import { show as floatBarShow, update as floatBarUpdate, done as floatBarDone, hide as floatBarHide } from '../ui/float-progress.js';
import { getDraft, setDraft, clearDraft } from '../core/drafts.js';

/* ═══════════════════════════════════════════════════════════════════════
   FILE TYPE → SVG icon + label + accent color
   ═══════════════════════════════════════════════════════════════════════ */
/* getFileTypeInfo → modules/core/file-icons.js */
export { getFileTypeInfo } from '../core/file-icons.js';

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
   Story ham xuddi shu composer kartasida ochiladi — qisqa izoh, rasm yoki video, tugma "Story".
   Video (yuklangan yoki kameradan) core/video-policy.js orqali kamera standartiga keltiriladi:
   1 daqiqa, 720p, 30 fps, 2.5 Mbps, 30 MB. */
const STORY_CAPTION_MAX = 200;
const _POST_ACCEPT = $('fileInput').accept;
const _POST_PLACEHOLDER = $('captionInput').placeholder;
let _composerMode = 'post';

function _setComposerMode(mode) {
  _composerMode = mode;
  const story = mode === 'story';
  const cap = $('captionInput');
  cap.placeholder = story ? "Hikoya 24 soat davomida ko'rinadi. Izoh yozing (ixtiyoriy)…" : _POST_PLACEHOLDER;
  if (story) cap.maxLength = STORY_CAPTION_MAX; else cap.removeAttribute('maxlength');
  $('fileInput').accept = story ? 'image/*,video/*' : (ALLOWED_UPLOAD_ACCEPT || '');
  $('uploadDrop').setAttribute('aria-label', story ? 'Hikoya uchun rasm yoki video tanlash' : "Rasm, video yoki fayl qo'shish");
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
  $('uploadBtn').textContent = 'Joylash';
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
  const video = isVideoFile(f);
  // Post va story: video ruxsat. Yuklashdan oldin prepareVideo kamera chekloviga keltiradi.
  if (!video && !isAllowedUpload(f)) {
    toast(UPLOAD_DENIED_MSG, 'error');
    $('fileInput').value = '';
    return;
  }
  if (_composerMode === 'story' && !video && !isImageFile(f)) {
    toast(STORY_DENIED_MSG, 'error');
    $('fileInput').value = '';
    return;
  }
  // Video hajmi oldindan kesilmaydi: 100000000 Mbps / juda yuqori fps bo'lsa ham
  // prepareVideo uni 1 daqiqa / 1080p / 30fps standartiga tushiradi.
  if (!video && f.size > MAX_FILE) {
    const limTxt = '49.9 MB';
    $('sizeWarn').textContent = `Fayl ${fmtSz(f.size)} — limit ${limTxt}`;
    toast(`Fayl hajmi ${limTxt} dan oshmasligi kerak`, 'error');
    return;
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
      <img src="./svg/action/close.svg" alt="" class="icon" width="12" height="12">
    </button></div>`;
  } else if (video) {
    $('previewArea').innerHTML = `<div class="preview-wrap"><video src="${esc(state._objUrl)}" controls playsinline muted style="width:100%;max-height:280px;background:#000;display:block" onloadedmetadata="window.__fixVidDur&&window.__fixVidDur(this)"></video><button class="preview-clear" data-action="clear-file">
      <img src="./svg/action/close.svg" alt="" class="icon" width="12" height="12">
    </button><div class="fs-11px c-text3-theme" style="padding:6px 8px">Kamera standarti: 1 daqiqa · 1080p · 30 fps</div></div>`;
  } else {
    const info = getFileTypeInfo(f.name, f.type);
    const ext = (String(f.name || '').split('.').pop() || info.label || 'FILE').toUpperCase().slice(0, 5);
    const name = f.name || 'Fayl';
    const short = name.length > 28 ? name.slice(0, 26) + '…' : name;
    $('previewArea').innerHTML = `<div class="preview-file preview-file--card">
      <button type="button" class="preview-clear" data-action="clear-file" aria-label="Olib tashlash">
        <img src="./svg/action/close.svg" alt="" class="icon" width="12" height="12">
      </button>
      <div class="pf-body">
        <div class="pf-icon">${info.svg}</div>
        <div class="pf-name" title="${esc(name)}">${esc(short)}</div>
        <div class="pf-meta">${esc(fmtSz(f.size))}</div>
        <div class="pf-badge">${esc(ext)}</div>
      </div>
    </div>`;
  }
  refreshPostBtn();
}

/* ── Caption input → enable/disable Post btn ─────────────────────────── */
$('captionInput').addEventListener('input', () => { refreshPostBtn(); setDraft(_composerMode === 'story' ? 'story' : 'post', $('captionInput').value); });

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
async function _prepareUploadFile(file, label, mode = 'post') {
  if (!file) return file;
  const isStory = mode === 'story';
  // Video — kamera yozgan fayl tayyor bo'lsa qayta kodlanmaydi; story: 720p tez preset
  if (isVideoFile(file)) {
    const nameEl = $('ufbName');
    if (nameEl) nameEl.textContent = isStory ? 'Story video tayyorlanmoqda' : 'Video standartga keltirilmoqda';
    const res = await prepareVideo(file, {
      onProgress: p => floatBarUpdate(Math.round((p || 0) * 40)),
      preset: isStory ? 'story' : 'post',
    });
    if (res.truncated) toast('Video 1 daqiqadan oshdi — faqat dastlabki 60 soniya olindi', 'info');
    console.info('[video] standart:', fmtSz(file.size), '→', fmtSz(res.file.size), res.file.type, isStory ? '(story)' : '');
    return res.file;
  }
  // Rasm — story uchun kuchliroq siqish
  if (file.type.startsWith('image/')) {
    try {
      const compressed = await compressImage(file, { preset: isStory ? 'story' : 'post' });
      if (compressed !== file) console.info('[compress] image:', fmtSz(file.size), '→', fmtSz(compressed.size), compressed.type);
      return compressed;
    } catch (e) {
      console.warn('[compress] image failed, original:', e?.message || e);
      return file;
    }
  }
  return file;
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
      mediaType: isVideoFile(file) ? 'video' : 'image',
      caption: caption || '',
      createdAt: new Date().toISOString(),
    },
  });

  $('uploadBtn').disabled    = true;
  $('uploadBtn').textContent = 'Yuklanmoqda…';
  $('uploadOverlay').classList.remove('show');
  unlockScroll('uploadOverlay');
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

  try {
    file = await _prepareUploadFile(fileRef, fileRef.name.length > 28 ? fileRef.name.slice(0, 26) + '…' : fileRef.name, 'story');
    floatBarUpdate(8);
    const { path } = await uploadViaController(file, 'stories', {
      onProgress: (r) => floatBarUpdate(8 + Math.round(Math.min(1, r) * 86)),
    });
    floatBarUpdate(96);

    const row = {
      user_id:    state.me.uid,
      media_path: path,
      media_type: isVideoFile(file) ? 'video' : 'image',
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
    try { clearDraft('story'); } catch (_) {}
    toast(captionLost ? 'Story qo\'shildi, lekin izoh saqlanmadi (DB da caption ustuni yo\'q)' : 'Story qo\'shildi',
          captionLost ? 'info' : 'success');
    // Serverdagi haqiqiy story — boshqalarga + o'zimni yangilash
    busEmit('story', { op: 'new' });
    import('./stories.js').then(m => m.loadStories()).catch(() => {});
    // blob endi kerak emas
    if (blobKeep) try { URL.revokeObjectURL(blobKeep); } catch (_) {}
  } catch (err) {
    floatBarDone(false);
    toast('Hikoya yuklanmadi: ' + (err.message || 'Noma\'lum xatolik'), 'error');
    if (blobKeep) try { URL.revokeObjectURL(blobKeep); } catch (_) {}
    import('./stories.js').then(m => m.loadStories()).catch(() => {});
  } finally {
    $('uploadBtn').disabled = false;
    $('uploadBtn').textContent = 'Joylash';
  }
}

let _submitBusy = false;
export async function submitPost() {
  if (_submitBusy) return;
  _submitBusy = true;
  try {
    if (_composerMode === 'story') return await submitStory();
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
  unlockScroll('uploadOverlay');
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
      file = await _prepareUploadFile(file, fileRef.name.length > 28 ? fileRef.name.slice(0, 26) + '…' : fileRef.name, 'post');
      floatBarUpdate(0);

      floatBarUpdate(8);
      const result = await uploadViaController(file, 'posts', {
        onProgress: (r) => floatBarUpdate(8 + Math.round(Math.min(1, r) * 86)),
      });
      floatBarUpdate(96);

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

    _clearPostDraft();
    if (hasFile) floatBarDone(true);
    else toast('Yuklandi!', 'success');

    // blob endi server URL bilan almashtirilgan — biroz kutib revoke
    if (localBlob) setTimeout(() => { try { URL.revokeObjectURL(localBlob); } catch (_) {} }, 8000);
  } catch (err) {
    // Optimistic postni olib tashlash; matn qoralama sifatida saqlanadi (ROADMAP 4)
    busEmit('post', { op: 'del', id: tempId });
    if (caption) {
      _savePostDraft(caption);
      const home = $('homeComposerInput');
      if (home && !home.value.trim()) { home.value = caption; _syncHomeUi(); }
      const capEl = $('captionInput');
      if (capEl && !capEl.value.trim()) capEl.value = caption;
    }
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    const msg = offline
      ? "Internet yo'q — matn qoralama sifatida saqlandi"
      : (hasFile ? 'Yuklash amalga oshmadi' : 'Post joylanmadi');
    if (hasFile) floatBarDone(false);
    toast(msg, 'error');
    if (localBlob) try { URL.revokeObjectURL(localBlob); } catch (_) {}
  } finally {
    _submitBusy = false;
    $('uploadBtn').disabled = false;
    $('uploadBtn').textContent = 'Joylash';
  }
  } finally {
    _submitBusy = false;
  }
}

$('uploadBtn').onclick = () => { submitPost(); };

/* Composer kartasidagi o'z avatarim */
function loadComposerAvi() {
  const box = $('composerAvi');
  if (!box || !state.me) return;
  const name = state.me.displayName || state.me.username || 'U';
  const fb = defAvi(name);
  let instant = '';
  try {
    const cached = getCachedProfile?.(state.me.uid);
    if (cached?.avatar) instant = cached.avatar;
  } catch (_) {}
  if (!instant) instant = state.me.photoURL || '';
  const paint = (src) => {
    box.innerHTML = `<img src="${esc(src || fb)}" alt="" loading="eager" decoding="async" onerror="this.onerror=null;this.src='${esc(fb)}'">`;
  };
  paint(instant || fb);
  Promise.resolve(sb.from('profiles').select('full_name,avatar').eq('id', state.me.uid).maybeSingle())
    .then(({ data }) => {
      if (data?.avatar) {
        try { state.me.photoURL = data.avatar; } catch (_) {}
        paint(data.avatar);
      }
    })
    .catch(() => {});
}

/* ── Overlay open/close ──────────────────────────────────────────────── */
function raiseUploadOverlay() {
  const ov = $('uploadOverlay');
  if (!ov) return null;
  if (ov.parentElement !== document.body) document.body.appendChild(ov);
  ov.style.position = 'fixed';
  ov.style.inset = '0';
  ov.style.zIndex = '2147483000';
  ov.style.alignItems = 'center';
  ov.style.justifyContent = 'center';
  ov.style.justifyContent = 'center';
  return ov;
}

export function openComposer() {
  const ov = raiseUploadOverlay();
  if (!ov) return;
  ov.classList.add('show');
  lockScroll('uploadOverlay');
  resetUpload();
  loadComposerAvi();
  try { window.dispatchEvent(new CustomEvent('spacemr:route')); } catch (_) {}
}
/* Story "+" bosilganda: fayl menejerini darhol ochmaymiz — post kabi composer kartasi ochiladi */
export function openStoryComposer() {
  try {
    const sd = getDraft('story');
    const cap = $('captionInput');
    if (sd && cap && !cap.value.trim()) cap.value = sd;
  } catch (_) {}

  if (!state.me) return;
  const ov = raiseUploadOverlay();
  if (!ov) return;
  ov.classList.add('show');
  lockScroll('uploadOverlay');
  resetUpload();
  _setComposerMode('story');
  const ub = $('uploadBtn');
  if (ub) ub.textContent = 'Hikoya';
  loadComposerAvi();
  try { window.dispatchEvent(new CustomEvent('spacemr:route')); } catch (_) {}
}
$('createBtn').onclick     = openComposer;
$('hdrNewPostBtn').onclick = openComposer;

/* Inline home composer — joyida yoziladi, modal ochilmaydi */
let _homeAviSig = '';
let _homeFocused = false;

const DRAFT_KEY = 'spacemr_post_draft';

function _savePostDraft(text) {
  try { setDraft('post', text || ''); } catch (_) {}
  try {
    const t = String(text || '').trim();
    if (!t) { localStorage.removeItem(DRAFT_KEY); return; }
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ text: t, at: Date.now() }));
  } catch (_) {}
}

function _loadPostDraft() {
  try {
    const acc = getDraft('post');
    if (acc) return acc;
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    return o && typeof o.text === 'string' ? o.text : null;
  } catch (_) { return null; }
}

function _clearPostDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch (_) {}
  try { clearDraft('post'); } catch (_) {}
}

function _restorePostDraft() {
  const t = _loadPostDraft();
  if (!t) return;
  const home = $('homeComposerInput');
  if (home && !home.value.trim()) {
    home.value = t;
    _syncHomeUi();
  }
  const cap = $('captionInput');
  if (cap && !cap.value.trim()) cap.value = t;
}

function _fillHomeComposerAvi() {
  const box = $('homeComposerAvi');
  if (!box) return;
  const me = state.me;
  if (!me?.uid) return;
  const name = me.displayName || me.username || 'U';
  const fb = defAvi(name);
  /* 1) kesh 2) state 3) default — darhol, tarmoq kutmasdan */
  let av = '';
  try {
    const cached = getCachedProfile?.(me.uid);
    if (cached?.avatar) av = cached.avatar;
  } catch (_) {}
  if (!av) av = me.photoURL || '';
  if (!av) av = fb;
  const sig = me.uid + '|' + av;
  if (sig === _homeAviSig && box.querySelector('img')) return;
  _homeAviSig = sig;
  box.innerHTML = `<img src="${esc(av)}" alt="" loading="eager" decoding="async" onerror="this.onerror=null;this.src='${esc(fb)}'">`;
  /* background: agar state bo'sh edi — DB dan bir marta yangilash */
  if (!me.photoURL || av === fb) {
    Promise.resolve(sb.from('profiles').select('avatar,full_name').eq('id', me.uid).maybeSingle())
      .then(({ data }) => {
        if (data?.avatar && data.avatar !== av) {
          try { me.photoURL = data.avatar; } catch (_) {}
          _homeAviSig = '';
          _fillHomeComposerAvi();
        }
      })
      .catch(() => {});
  }
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
  } else if (f.type.startsWith('video/')) {
    inner = `<video src="${esc(url)}#t=0.1" muted playsinline preload="metadata" class="hc-vid"></video>`;
  } else {
    const ext = (String(f.name || '').split('.').pop() || 'FILE').toUpperCase().slice(0, 5);
    const name = f.name || 'Fayl';
    const short = name.length > 28 ? name.slice(0, 26) + '…' : name;
    inner = `<div class="hc-file hc-file--card">
      <div class="hc-file-name" title="${esc(name)}">${esc(short)}</div>
      <div class="hc-file-meta">${esc(fmtSz(f.size))}</div>
      <div class="hc-file-badge">${esc(ext)}</div>
    </div>`;
  }
  prev.innerHTML = inner + `<button type="button" class="hc-clear" data-action="hc-clear" aria-label="O'chirish">
    <img src="./svg/action/close.svg" alt="" class="icon" width="12" height="12">
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
    if (hbtn) hbtn.textContent = 'Joylash';
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
  inp.addEventListener('input', () => { _syncHomeUi(); _savePostDraft(inp.value); });
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
  // Umumiy skrepka menyusi (Kamera / Fayl / Media) — chat bilan bir xil
  initAttachMenu({
    btn: $('homeComposerAttach'),
    fileInput: $('homeComposerFile'),
    onPick: f => _pickHomeFile(f),
    showCamera: true,
    showFile: true,
    showMedia: true,
    mediaAccept: 'image/*,video/*',
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
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') _fillHomeComposerAvi();
  });
  /* Modul yuklanganda state.me hali yo'q bo'ladi (avatar bo'sh qolardi) — kirish tugagach va profil yangilanganda qayta chizamiz */
  document.addEventListener('meUpdated', () => { _homeAviSig = ''; _fillHomeComposerAvi(); });
  document.addEventListener('profilesPreloaded', () => _fillHomeComposerAvi());
  _restorePostDraft();
}
_bindHomeComposer();

$('cancelUpload').onclick = () => { $('uploadOverlay').classList.remove('show'); unlockScroll('uploadOverlay'); resetUpload(); };
$('uploadOverlay').onclick = e => {
  if (e.target === $('uploadOverlay')) { $('uploadOverlay').classList.remove('show'); unlockScroll('uploadOverlay'); resetUpload(); }
};

/* ── File input / drop / paste ───────────────────────────────────────── */
// Upload overlay: skrepka menyusi (post + story)
initAttachMenu({
  btn: $('uploadDrop'),
  fileInput: $('fileInput'),
  onPick: f => pickFile(f),
  showCamera: true,
  showFile: true,
  showMedia: true,
  mediaAccept: 'image/*,video/*',
  getOptions: () => {
    const story = _composerMode === 'story';
    return {
      showFile: !story,           // story: rasm/video/kamera
      showMedia: true,
      mediaAccept: 'image/*,video/*',
      showCamera: true,
    };
  },
});
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

/* Ctrl+V + mobil buffer (clipboard) — rasm/fayl:
     1) suhbat (DM yoki guruh) ochiq → chatga biriktiriladi
     2) post / story composer → shu rejimga
     3) Home inline composer → home post
   Mobil: clipboardData.items ba'zan bo'sh — Clipboard API read() fallback. */
const _PASTE_BLOCKERS = [
  'chatThreadModal', 'userProfileModal', 'detailModal', 'settingsOverlay',
  'cmtModal', 'zoomModal', 'grpInfoOverlay', 'grpEditOverlay', 'confirmOverlay',
];
function _pasteTarget() {
  if (!state.me) return null;
  if (_chatCtx()) return 'chat';
  if (_isOpenEl('uploadOverlay')) return 'composer';  // post yoki story (_composerMode)
  if (_PASTE_BLOCKERS.some(_isOpenEl)) return null;
  if (state.view === 'home' && $('homeComposer')) return 'home';
  return null;
}

/** Paste event dan fayllarni yig'ish (desktop + mobil) */
function _filesFromPasteEvent(e) {
  const out = [];
  const seen = new Set();
  const add = (f) => {
    if (!f || !(f.size > 0)) return;
    const key = `${f.name}|${f.size}|${f.type}|${f.lastModified || 0}`;
    if (seen.has(key)) return;
    seen.add(key);
    // Nom yo'q (mobil) — image.png qilib qo'yamiz
    if (!f.name || f.name === 'image.png' || f.name === 'blob') {
      const ext = (f.type || 'image/png').split('/')[1]?.split(';')[0] || 'png';
      out.push(new File([f], `clipboard-${Date.now()}.${ext}`, { type: f.type || 'image/png', lastModified: Date.now() }));
    } else {
      out.push(f);
    }
  };
  const cd = e.clipboardData;
  if (!cd) return out;
  try {
    for (const item of (cd.items || [])) {
      // kind=file yoki type=image/* (ba'zi mobil brauzerlar)
      if (item.kind === 'file' || (item.type && item.type.startsWith('image/'))) {
        try { add(item.getAsFile()); } catch (_) {}
      }
    }
  } catch (_) {}
  try {
    if (cd.files && cd.files.length) {
      for (let i = 0; i < cd.files.length; i++) add(cd.files[i]);
    }
  } catch (_) {}
  return out;
}

/** Mobil: navigator.clipboard.read() — paste eventda items bo'sh bo'lganda */
async function _filesFromClipboardApi() {
  if (!navigator.clipboard?.read) return [];
  try {
    const items = await navigator.clipboard.read();
    const out = [];
    for (const item of items) {
      for (const type of item.types) {
        if (!type.startsWith('image/') && !type.startsWith('video/')) continue;
        try {
          const blob = await item.getType(type);
          const ext = type.split('/')[1]?.split(';')[0] || 'png';
          out.push(new File([blob], `clipboard-${Date.now()}.${ext}`, {
            type: blob.type || type,
            lastModified: Date.now(),
          }));
        } catch (_) {}
      }
    }
    return out;
  } catch (_) {
    // NotAllowedError / no permission — jim
    return [];
  }
}

function _routePastedFile(f) {
  const target = _pasteTarget();
  if (!target || !f) return false;
  if (target === 'chat') _toChat(f);
  else if (target === 'composer') pickFile(f);
  else {
    _pickHomeFile(f);
    $('homeComposerInput')?.focus({ preventScroll: true });
  }
  return true;
}

function _onPasteMedia(e) {
  const files = _filesFromPasteEvent(e);
  if (files.length) {
    if (!_pasteTarget()) return; // matn paste ishlasin
    e.preventDefault();
    _routePastedFile(files[0]);
    return;
  }
  // Mobil fallback: eventda fayl yo'q, lekin bufferda rasm bor bo'lishi mumkin
  const target = _pasteTarget();
  if (!target) return;
  _filesFromClipboardApi().then(list => {
    if (list[0]) _routePastedFile(list[0]);
  });
}

window.addEventListener('paste', _onPasteMedia, true); // capture — input ichida ham

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
