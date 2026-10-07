/**
 * chat-voice-record.js — hold-to-talk yozish, mikrofon ruxsati, pulse UI
 * chat.js dan ehtiyotkor ajratilgan. Playback/waveform chat.js da qoladi.
 */
import { $ } from '../core/utils.js';
import { videoNoteFileName } from './components/video-note.js';
import { mediaErrorKind, trackSupportsTorch, trackMaybeTorch, setTorch, probeInputDevices, listCameras, waitTrackTorchReady } from './camera-access.js';
import { toast } from '../ui/toast.js';

let _onVoiceRecorded = null;
let _isComposerBusy = null;
let _onSendAction = null;
let _onVideoRecorded = null;
let _voiceUiBound = false;

/* ── Voice recording (Telegram-style push-to-talk & live 3-ring pulse) ────
 * Mikrofonga BOSIB TURIB gapiriladi (hold to record).
 * Qo'yib yuborilganda — ovoz darhol ketadi.
 * Chapga surilsa — bekor qilinadi.
 * Gapirilayotganda tugma atrofida Telegram'dagi kabi 3 qavatli jonli to'lqin
 * halqalari (#cvPulse1, #cvPulse2, #cvPulse3) ovoz balandligiga mos ravishda kengayadi. */
let _isHoldingVoice    = false;
let _voiceCancelled    = false;
let _voiceStartX       = 0;
let _voiceStartY       = 0;
let _voiceStartTime    = 0;
let _voiceJustHandled  = false;
let _activePointerId   = null;
let _recTimerInterval  = null;
let _recStartTs        = 0;
let _mediaRec          = null;
let _recChunks         = [];
let _mediaStream       = null;
let _pulseCtx          = null;
let _pulseAnalyser     = null;
let _pulseRaf          = null;
let _pulseLevel        = 0;
let _voiceStopRequested = false;
let _segTimer = null;
let _voiceTail = Promise.resolve();   // bo'laklar TARTIB bilan yuborilishi uchun navbat
/* Bitta ovozli xabar maksimal uzunligi (10 daqiqa).
   Limitga yetganda yozuv TO'XTAYDI — keyingi ovoz uchun yana bosib yozish kerak
   (avtomatik yangi bo'lak boshlanmaydi). */
const VOICE_MAX_SEC = 600; // 10 daqiqa

/* ── Rolik (dumaloq video xabar) rejimi ────────────────────────────────────
 * Logika SpaceMR camera (camera-capture.js) bilan bir xil:
 *   max 60s, max 30 MB, xuddi shu mime/bitrate, timeslice 250ms.
 * Farqi faqat UI: dumaloq preview + past o'ng (chatVoiceBtn) bosib turish.
 * Qisqa bosish: mikrofon ⇄ rolik. Bosib turish = yozish; qo'yib yuborish = yuborish;
 * chapga surish = bekor. 60s da avto-to'xtaydi. */
const _MODE_KEY = 'mrspace_rec_mode';
/* SpaceMR camera bilan bir xil cheklovlar (faqat UI dumaloq + past o'ng tugma) */
const VID_MAX_SEC = 60;                 // 1 daqiqa — camera MAX_VIDEO_MS
const VID_MAX_BYTES = 30 * 1024 * 1024; // 30 MB — camera MAX_VIDEO_BYTES
const VID_BITRATE = 900_000;  // 480p circle — engil, tez yuklash/o'ynash
const VID_AUDIO_BITRATE = 64000;
let _recMode = 'audio';
try { if (localStorage.getItem(_MODE_KEY) === 'video') _recMode = 'video'; } catch (_) {}
/* Qurilmalar: enumerateDevices + muvaffaqiyatli stream (proven).
 * Boshlang'ich false — skan tugaguncha "yuborish" xavfsiz default.
 * devicechange / focus da qayta skan. NotFoundError → shu tur o'chiriladi. */
let _hasMic = false, _hasCam = false, _camCount = 0, _vidTorchSeen = false;
let _micProven = false, _camProven = false;  // getUserMedia muvaffaqiyatli ochilgan
let _mediaScanDone = false;
let _onDevicesChange = null;
let _scanTimer = null;

function _effMode() {
  if (!_hasMic && !_hasCam) return 'none';
  if (!_hasMic) return 'video';
  if (!_hasCam) return 'audio';
  return _recMode;
}

/** false → na mikrofon, na kamera: tugma doim "yuborish" */
export function canRecordMedia() { return _hasMic || _hasCam; }
export function hasMicDevice() { return _hasMic; }
export function hasCamDevice() { return _hasCam; }
export function isMediaScanDone() { return _mediaScanDone; }

function _markMicProven(ok) {
  if (ok) { _micProven = true; _hasMic = true; }
  else { _micProven = false; }
}
function _markCamProven(ok) {
  if (ok) { _camProven = true; _hasCam = true; }
  else { _camProven = false; }
}

async function _scanDevices() {
  try {
    const p = await probeInputDevices();
    // Proven stream bor, lekin enumerate 0 qaytarsa — qurilma uzilgan
    if (_micProven && p.micCount === 0) _micProven = false;
    if (_camProven && p.camCount === 0) _camProven = false;
    _hasMic = p.mic || _micProven;
    _hasCam = p.cam || _camProven;
    _camCount = p.camCount;
    // Faqat mic yoki faqat cam bo'lsa — rejimni majburan moslashtirish
    if (_hasMic && !_hasCam) _recMode = 'audio';
    else if (!_hasMic && _hasCam) _recMode = 'video';
  } catch (_) {
    // Skan xatosi: proven bo'lmasa o'chiramiz
    if (!_micProven) _hasMic = false;
    if (!_camProven) _hasCam = false;
  }
  _mediaScanDone = true;
  _applyRecMode();
  try { _onDevicesChange?.(); } catch (_) {}
}

function _scheduleScan(delay = 80) {
  clearTimeout(_scanTimer);
  _scanTimer = setTimeout(() => { _scanDevices(); }, delay);
}
let _vidHoldTimer = null;
let _vidActive    = false;
let _vidStream    = null;
let _vidRec       = null;
let _vidChunks    = [];
let _vidStartTs   = 0;
let _vidAutoStop  = null;
let _vidRingTimer = null;
let _finishHoldRef = null;

function _applyRecMode() {
  const b = $('chatVoiceBtn');
  if (!b) return;
  const m = _effMode();
  b.classList.toggle('mode-video', m === 'video');
  b.classList.toggle('no-mic', !_hasMic);
  b.classList.toggle('no-cam', !_hasCam);
  b.classList.toggle('no-media', m === 'none');
  b.dataset.hasMic = _hasMic ? '1' : '0';
  b.dataset.hasCam = _hasCam ? '1' : '0';
  if (m === 'video') b.title = 'Video xabar (bosib turing)';
  else if (m === 'none') b.title = 'Yuborish';
  else b.title = 'Ovozli xabar (bosib turing, yuqoriga — qulflash)';
}
function _toggleRecMode() {
  if (!_hasMic || !_hasCam) return;   // faqat bittasi bo'lsa — almashmaydi
  _recMode = _recMode === 'video' ? 'audio' : 'video';
  try { localStorage.setItem(_MODE_KEY, _recMode); } catch (_) {}
  _applyRecMode();
}

/* ── Rolik: Telegram uslubida LOCK + kamera almashtirish ─────────────────────
 * Bosib turib YUQORIGA surilsa → qulflanadi: qo'l bo'shaydi, yozuv davom etadi,
 *   old/orqa kamera almashadi (yozuv TO'XTAMAYDI — canvas orqali bitta uzluksiz video),
 *   orqa kamerada fonar tugmasi chiqadi. Qulflangan yozuvda yozuv tugmasini yana bossangiz — yuboriladi;
 *   «Bekor qilish» — o'chiriladi; 1 daqiqada o'zi yuboriladi.
 * Qulflanmagan (bosib turish): qo'yib yuborilsa yuboriladi; kamera almashtirib bo'lmaydi. */
const VID_SIZE = 360;
const _VID_LOCK_DIST = 90;   // px yuqoriga (rolik + oddiy ovoz uchun bir xil)
let _vidLocked = false, _vidFacing = 'user', _vidTorchOn = false, _vidSwitching = false;
/* Oddiy ovoz: yuqoriga surilsa qulflanadi (rolik bilan bir xil UX) */
let _voiceLocked = false;
let _vidCanSwitch = false;  // 2+ kamera (listCameras)
let _vidVideoTrack = null, _vidAudioTracks = [];
let _vidCanvas = null, _vidCtx = null, _vidRaf = 0, _vidLastDraw = 0, _vidOutStream = null, _vidUseCanvas = false, _vidPreviewEl = null;

const _VN_ICO_FLIP = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/><path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14"/></svg>';
const _VN_ICO_FLASH = '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M7 2v11h3v9l7-12h-4l4-8z"/></svg>';

function _vidVideoConstraints(face) {
  return { facingMode: { ideal: face }, width: { ideal: VID_SIZE }, height: { ideal: VID_SIZE }, aspectRatio: { ideal: 1 }, frameRate: { ideal: 24, max: 30 } };
}

function _vidWaitFrame(v, ms) {
  return new Promise(res => {
    if (!v) { res(); return; }
    let done = false;
    const fin = () => { if (!done) { done = true; res(); } };
    setTimeout(fin, ms);
    if (v.readyState >= 2 && v.videoWidth) { fin(); return; }
    if (v.requestVideoFrameCallback) v.requestVideoFrameCallback(fin);
    else v.addEventListener('loadeddata', fin, { once: true });
  });
}

/* Canvas pipeline: kamera → kvadrat canvas → MediaRecorder. Kamera almashganda recorder to'xtamaydi,
   canvas oxirgi kadrni ushlab turadi. */
function _vidPaint() {
  const v = _vidPreviewEl;
  if (!_vidCtx || _vidSwitching || !v || v.readyState < 2 || !v.videoWidth) return;
  const S = VID_SIZE, vw = v.videoWidth, vh = v.videoHeight;
  const sc = Math.max(S / vw, S / vh), dw = vw * sc, dh = vh * sc;
  _vidCtx.drawImage(v, (S - dw) / 2, (S - dh) / 2, dw, dh);
}
function _vidLoop(ts) {
  _vidRaf = requestAnimationFrame(_vidLoop);
  if (ts - _vidLastDraw < 30) return;   // ~30 fps
  _vidLastDraw = ts;
  _vidPaint();
}
function _vidBuildOut(pv, audioTracks) {
  _vidPreviewEl = pv;
  _vidCanvas = document.createElement('canvas');
  _vidCanvas.width = _vidCanvas.height = VID_SIZE;
  _vidCtx = _vidCanvas.getContext('2d', { alpha: false });
  _vidCtx.fillStyle = '#000';
  _vidCtx.fillRect(0, 0, VID_SIZE, VID_SIZE);
  _vidPaint();
  _vidLastDraw = 0;
  _vidRaf = requestAnimationFrame(_vidLoop);
  const out = new MediaStream(_vidCanvas.captureStream(30).getVideoTracks());
  audioTracks.forEach(t => out.addTrack(t));
  return out;
}
function _vidTeardownCanvas() {
  cancelAnimationFrame(_vidRaf); _vidRaf = 0;
  if (_vidUseCanvas) { try { _vidOutStream?.getVideoTracks().forEach(t => t.stop()); } catch (_) {} }
  _vidOutStream = null; _vidCanvas = null; _vidCtx = null; _vidPreviewEl = null;
}
function _vidStopAll() {
  _vidTeardownCanvas();
  try { _vidStream?.getTracks().forEach(t => t.stop()); } catch (_) {}
  try { _vidVideoTrack?.stop(); } catch (_) {}
  _vidStream = null; _vidVideoTrack = null; _vidAudioTracks = [];
  _vidSwitching = false;
}

/* ── Lock hint (yozuv tugmasi tepasida) ── */
function _lockHintEl() {
  let el = document.getElementById('vnLockHint');
  if (!el) {
    el = document.createElement('div');
    el.id = 'vnLockHint';
    el.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2.5"/><path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3"/></svg>'
      + '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>';
    document.body.appendChild(el);
  }
  return el;
}
function _showLockHint() {
  const btn = $('chatVoiceBtn');
  const el = _lockHintEl();
  if (btn) {
    const r = btn.getBoundingClientRect();
    el.style.left = Math.round(r.left + r.width / 2 - 18) + 'px';
    el.style.top = Math.max(8, Math.round(r.top - 96)) + 'px';
  }
  el.style.setProperty('--lp', '0');
  el.classList.add('show');
}
function _setLockProgress(p) { document.getElementById('vnLockHint')?.style.setProperty('--lp', String(p)); }
function _hideLockHint() { document.getElementById('vnLockHint')?.classList.remove('show'); }

/* ── Preview (ekran o'rtasidagi doira) ── */

/* Record/send tugmasi: body ga chiqariladi — #vnotePreview (9000) stacking contextidan tashqarida */
function _vnFloatRecordBtn(on) {
  const btn = $('chatVoiceBtn');
  if (!btn) return;
  if (on) {
    const r = btn.getBoundingClientRect();
    if (btn.dataset.vnFloat !== '1') {
      btn.dataset.vnFloat = '1';
      btn.dataset.vnPrevStyle = btn.getAttribute('style') || '';
      // Joy saqlash (layout sakramasin)
      let ph = document.getElementById('chatVoiceBtnPh');
      if (!ph) {
        ph = document.createElement('span');
        ph.id = 'chatVoiceBtnPh';
        ph.setAttribute('aria-hidden', 'true');
        ph.style.cssText = 'display:inline-block;flex-shrink:0;visibility:hidden;pointer-events:none;';
      }
      ph.style.width = Math.round(r.width) + 'px';
      ph.style.height = Math.round(r.height) + 'px';
      if (btn.parentElement && btn.parentElement.id !== 'chatVoiceBtnPh') {
        btn.parentElement.insertBefore(ph, btn);
      }
      document.body.appendChild(btn);
    }
    btn.style.position = 'fixed';
    btn.style.left = Math.round(r.left) + 'px';
    btn.style.top = Math.round(r.top) + 'px';
    btn.style.width = Math.round(Math.max(r.width, 36)) + 'px';
    btn.style.height = Math.round(Math.max(r.height, 36)) + 'px';
    btn.style.zIndex = '10050';
    btn.style.margin = '0';
    btn.style.opacity = '1';
    btn.style.filter = 'none';
    btn.style.pointerEvents = 'auto';
    btn.style.touchAction = 'none';
    try { _pulseFloatContainer(true); _pulsePlaceRingsNearBtn(); } catch (_) {}
  } else if (btn.dataset.vnFloat === '1') {
    const ph = document.getElementById('chatVoiceBtnPh');
    if (ph && ph.parentElement) {
      ph.parentElement.insertBefore(btn, ph);
      ph.remove();
    }
    const prev = btn.dataset.vnPrevStyle || '';
    if (prev) btn.setAttribute('style', prev);
    else btn.removeAttribute('style');
    delete btn.dataset.vnFloat;
    delete btn.dataset.vnPrevStyle;
    try { _pulseFloatContainer(false); } catch (_) {}
  }
}

function _showVidPreview(stream) {
  let el = document.getElementById('vnotePreview');
  if (!el) {
    el = document.createElement('div');
    el.id = 'vnotePreview';
    el.innerHTML = '<div class="vnp-stage"><div class="vnp-circle"><video class="vnp-video" muted playsinline autoplay></video><canvas class="vnp-freeze"></canvas>'
      + '<svg class="vnp-ring" viewBox="0 0 100 100" aria-hidden="true"><circle class="vnp-ring-fg" cx="50" cy="50" r="48"/></svg></div>'
      + '<div class="vnp-ctrls">'
      + '<button type="button" class="vnp-btn vnp-flip" aria-label="Kamerani almashtirish">' + _VN_ICO_FLIP + '</button>'
      + '<button type="button" class="vnp-btn vnp-flash" aria-label="Fonar" hidden>' + _VN_ICO_FLASH + '</button>'
      + '</div></div>';
    document.body.appendChild(el);
    el.querySelector('.vnp-flip').addEventListener('click', () => _vidFlip());
    el.querySelector('.vnp-flash').addEventListener('click', () => _vidToggleTorch());
  }
  const v = el.querySelector('video');
  v.srcObject = stream;
  v.play().catch(() => {});
  const fg = el.querySelector('.vnp-ring-fg');
  const C = 2 * Math.PI * 48;
  if (fg) { fg.style.strokeDasharray = String(C); fg.style.strokeDashoffset = String(C); }
  clearInterval(_vidRingTimer);
  _vidRingTimer = setInterval(() => {
    const p = Math.min(1, (performance.now() - _vidStartTs) / (VID_MAX_SEC * 1000));
    if (fg) fg.style.strokeDashoffset = String(C * (1 - p));
  }, 100);
  el.classList.add('show');
  try { document.body.classList.add('vn-rec'); } catch (_) {}
  _vnFloatRecordBtn(true);
}
function _hideVidPreview() {
  clearInterval(_vidRingTimer); _vidRingTimer = null;
  try { document.body.classList.remove('vn-rec'); } catch (_) {}
  _vnFloatRecordBtn(false);
  const el = document.getElementById('vnotePreview');
  if (!el) return;
  el.classList.remove('show', 'locked');
  const v = el.querySelector('video');
  if (v) v.srcObject = null;
  el.querySelector('.vnp-freeze')?.classList.remove('show');
}

/* Lock holati tugmalari: flip har doim (lock bo'lganda), fonar — faqat ORQA kamerada */
function _vidSyncCtrls() {
  const el = document.getElementById('vnotePreview');
  if (!el) return;
  const back = _vidFacing === 'environment';
  const fl = el.querySelector('.vnp-flash');
  if (fl) {
    const trackOk = trackSupportsTorch(_vidVideoTrack);
    const maybe = trackMaybeTorch(_vidVideoTrack, _vidFacing);
    if (trackOk) _vidTorchSeen = true;
    // Faqat ORQA kamera — old kamerada fonar tugmasi YO'Q
    fl.hidden = !back;
    if (!back) _vidTorchOn = false;
    fl.classList.toggle('off', back && !trackOk && !maybe);
    fl.classList.toggle('on', !!_vidTorchOn && back);
    fl.setAttribute('aria-disabled', (trackOk || maybe) && back ? 'false' : 'true');
  }
  el.querySelector('.vnp-video')?.classList.toggle('back', back);
  const fb = el.querySelector('.vnp-flip');
  if (fb) {
    // Canvas yo'q bo'lsa yozuv paytida switch ishlamaydi; 2+ kamera kerak
    const canFlip = !!_vidUseCanvas && (_vidCanSwitch || _camCount >= 2);
    fb.hidden = !canFlip;
  }
}

/** Ruxsatdan keyin kameralar sonini yangilash (flip tugmasi uchun) */
async function _vidRefreshCamList() {
  try {
    const c = await listCameras();
    _camCount = c.list?.length || 0;
    _vidCanSwitch = _camCount >= 2 || !!(c.front && c.back && c.front.deviceId !== c.back.deviceId);
  } catch (_) {}
  _vidSyncCtrls();
}

async function _vidToggleTorch() {
  let tr = _vidVideoTrack;
  if (!tr || _vidSwitching) return;
  // Haqiqiy facing — settings dan (ideal constraint ba'zan front qoldiradi)
  let face = _vidFacing;
  try {
    const st = tr.getSettings?.() || {};
    if (st.facingMode) face = st.facingMode;
  } catch (_) {}
  if (face !== 'environment' && !trackSupportsTorch(tr)) {
    toast("Fonarni yoqish uchun orqa kameraga o'ting (almashtirish)", "error");
    return;
  }
  // Capabilities kelishini kutish
  if (!trackSupportsTorch(tr)) await waitTrackTorchReady(tr, 600);
  const want = !_vidTorchOn;
  let ok = await setTorch(tr, want);
  if (!ok) {
    await new Promise(r => setTimeout(r, 150));
    tr = _vidVideoTrack; // track yangilangan bo'lishi mumkin
    ok = await setTorch(tr, want);
  }
  if (!ok) {
    _vidTorchOn = false;
    toast("Fonarni yoqib bo'lmadi. Orqa kamera + Chrome (HTTPS) kerak", 'error');
  } else {
    _vidTorchOn = want;
    if (want) _vidTorchSeen = true;
  }
  _vidSyncCtrls();
}

async function _vidFlip() {
  if (!_vidLocked || !_vidActive || _vidSwitching || !_vidRec) return;
  if (!_vidUseCanvas) { toast("Bu brauzerda yozuv paytida kamerani almashtirib bo'lmaydi", 'error'); return; }
  _vidSwitching = true;
  const el = document.getElementById('vnotePreview');
  const pv = el?.querySelector('video');
  const fz = el?.querySelector('.vnp-freeze');
  const prevFace = _vidFacing;
  const next = prevFace === 'user' ? 'environment' : 'user';
  let failed = false;
  // Oxirgi kadr xira holda ushlab turiladi (qora ekran ko'rinmaydi)
  try {
    if (fz && pv?.videoWidth) {
      fz.width = 180; fz.height = 180;
      const sc = Math.max(180 / pv.videoWidth, 180 / pv.videoHeight);
      const dw = pv.videoWidth * sc, dh = pv.videoHeight * sc;
      fz.getContext('2d').drawImage(pv, (180 - dw) / 2, (180 - dh) / 2, dw, dh);
      fz.classList.toggle('back', prevFace === 'environment');
      fz.classList.add('show');
    }
  } catch (_) {}
  try {
    if (_vidTorchOn) { try { await setTorch(_vidVideoTrack, false); } catch (_) {} _vidTorchOn = false; }
    try { _vidVideoTrack?.stop(); } catch (_) {}
    let ns = null;
    try {
      ns = await navigator.mediaDevices.getUserMedia({ audio: false, video: _vidVideoConstraints(next) });
      _vidFacing = next;
    } catch (_) {
      toast("Kamerani almashtirib bo'lmadi", 'error');
      try { ns = await navigator.mediaDevices.getUserMedia({ audio: false, video: _vidVideoConstraints(prevFace) }); }
      catch (_2) { failed = true; }
    }
    if (ns) {
      _vidVideoTrack = ns.getVideoTracks()[0];
      if (pv) { pv.srcObject = new MediaStream([_vidVideoTrack]); pv.play().catch(() => {}); }
      waitTrackTorchReady(_vidVideoTrack, 1000).then(() => _vidSyncCtrls());
      setTimeout(() => _vidSyncCtrls(), 400);
      setTimeout(() => _vidSyncCtrls(), 1000);
    }
  } finally {
    if (!failed) {
      _vidSyncCtrls();
      await new Promise(r => {
        const t = setTimeout(r, 900);
        if (pv?.requestVideoFrameCallback) pv.requestVideoFrameCallback(() => { clearTimeout(t); r(); });
        else setTimeout(r, 150);
      });
      fz?.classList.remove('show');
    }
    _vidSwitching = false;
  }
  if (failed) _vidCancelLocked();
}

function _lockVideo() {
  if (_vidLocked || !_vidActive) return;
  _vidLocked = true;
  _voiceCancelled = false;
  _hideLockHint();
  const btn = $('chatVoiceBtn');
  if (btn) { btn.classList.add('vn-locked'); btn.classList.remove('cancelling'); }
  _clearVoiceCancelVisuals();
  const bar = $('chatRecordBar');
  if (bar) { bar.classList.add('locked'); bar.classList.remove('cancelling'); }
  const ct = $('crbCancelText');
  if (ct) { ct.textContent = 'Bekor qilish'; ct.style.opacity = '1'; }
  $('vnotePreview')?.classList.add('locked');
  _vnFloatRecordBtn(true); // lock: send btn overlay ustida qolsin
  _vidSyncCtrls();
  try { navigator.vibrate?.(15); } catch (_) {}
}

function _vidResetLockUi() {
  _vidLocked = false;
  _hideLockHint();
  $('chatVoiceBtn')?.classList.remove('vn-locked');
  $('chatRecordBar')?.classList.remove('locked');
  $('vnotePreview')?.classList.remove('locked');
  if (_vidTorchOn) { try { setTorch(_vidVideoTrack, false); } catch (_) {} _vidTorchOn = false; }
}

/* Qulflangan yozuvni yuborish (yozuv tugmasi yana bosilganda yoki 1 daqiqada) */
function _vidSendLocked() {
  if (!_vidLocked || !_vidActive) return;
  _vidActive = false;
  $('chatVoiceBtn')?.classList.remove('recording', 'cancelling');
  _hideRecordBar();
  stopVideoRecording();
}
function _vidCancelLocked() {
  _vidActive = false;
  $('chatVoiceBtn')?.classList.remove('recording', 'cancelling');
  _hideRecordBar();
  cancelVideoRecording();
  toast('Video xabar bekor qilindi');
}

/* ── Oddiy ovoz LOCK (rolik bilan bir xil UX: yuqoriga surish) ─────────────── */
function _lockVoice() {
  if (_voiceLocked || _vidActive) return;
  if (!_mediaRec || _mediaRec.state === 'inactive') return;
  _voiceLocked = true;
  _voiceCancelled = false;
  _hideLockHint();
  const btn = $('chatVoiceBtn');
  if (btn) { btn.classList.add('vn-locked'); btn.classList.remove('cancelling'); }
  _clearVoiceCancelVisuals();
  const bar = $('chatRecordBar');
  if (bar) { bar.classList.add('locked'); bar.classList.remove('cancelling'); }
  const ct = $('crbCancelText');
  if (ct) { ct.textContent = 'Bekor qilish'; ct.style.opacity = '1'; }
  try { navigator.vibrate?.(15); } catch (_) {}
}
function _voiceResetLockUi() {
  _voiceLocked = false;
  _hideLockHint();
  $('chatVoiceBtn')?.classList.remove('vn-locked');
  $('chatRecordBar')?.classList.remove('locked');
}
function _voiceSendLocked() {
  if (!_voiceLocked) return;
  _isHoldingVoice = false;
  $('chatVoiceBtn')?.classList.remove('recording', 'cancelling');
  _hideRecordBar();
  stopRecording();
  _voiceResetLockUi();
}
function _voiceCancelLocked() {
  _isHoldingVoice = false;
  $('chatVoiceBtn')?.classList.remove('recording', 'cancelling');
  _hideRecordBar();
  cancelRecording();
  _voiceResetLockUi();
  toast('Ovozli xabar bekor qilindi');
}

async function startVideoRecording() {
  _voiceStopRequested = false;
  _vidChunks = [];
  _vidFacing = 'user'; _vidTorchOn = false; _vidSwitching = false;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: _hasMic,   // mikrofon bo'lmasa ham rolik (ovozsiz) olinaveradi
      video: _vidVideoConstraints('user'),
    });
    _vidStream = stream;
    _vidVideoTrack = stream.getVideoTracks()[0] || null;
    _vidAudioTracks = stream.getAudioTracks();
    if (_vidVideoTrack) _markCamProven(true);
    if (_vidAudioTracks.length) _markMicProven(true);
    // Ruxsat dialogi paytida pointer yo'qolishi mumkin — stream olindi, hold qayta tekshiriladi
    if (_voiceStopRequested) {
      _vidStopAll();
      _stopPulse();
      return;
    }
    if (!_isHoldingVoice && !_vidActive) {
      // Hali yozuv UI boshlanmagan va hold yo'q — to'xtat
      _vidStopAll();
      _stopPulse();
      return;
    }
    // Hold yo'qolgan bo'lsa ham (permission UI) — yozishni davom ettiramiz, user qo'yib yuborganda to'xtaydi
    if (!_vidLocked) _isHoldingVoice = true;
    _vidActive = true;
    // Mobile: vp8 tezroq encode/decode; mp4 (h264) ba'zi Androidlarda yaxshi
    const cands = [
      'video/mp4',
      'video/webm;codecs=vp8,opus',
      'video/webm;codecs=vp9,opus',
      'video/webm',
    ];
    const mime = cands.find(m => MediaRecorder.isTypeSupported?.(m)) || '';
    const opts = { videoBitsPerSecond: VID_BITRATE, audioBitsPerSecond: VID_AUDIO_BITRATE };
    if (mime) opts.mimeType = mime;

    // Preview avval; birinchi kadr kelgach yozuv boshlanadi (boshida qora kadr bo'lmasin)
    _vidStartTs = performance.now();
    _showVidPreview(new MediaStream(_vidVideoTrack ? [_vidVideoTrack] : []));
    const pv = $('vnotePreview')?.querySelector('video');
    await _vidWaitFrame(pv, 900);
    if (_voiceStopRequested || !_vidActive) {
      _vidStopAll();
      _hideVidPreview();
      _stopPulse();
      return;
    }

    _vidUseCanvas = typeof HTMLCanvasElement !== 'undefined' && !!HTMLCanvasElement.prototype.captureStream;
    _vidOutStream = _vidUseCanvas
      ? _vidBuildOut(pv, _vidAudioTracks)
      : new MediaStream([...(_vidVideoTrack ? [_vidVideoTrack] : []), ..._vidAudioTracks]);
    _vidSyncCtrls();
    try {
      _vidRec = mime
        ? new MediaRecorder(_vidOutStream, opts)
        : new MediaRecorder(_vidOutStream, { videoBitsPerSecond: VID_BITRATE, audioBitsPerSecond: VID_AUDIO_BITRATE });
    } catch (_)
    {
      try { _vidRec = new MediaRecorder(_vidOutStream); }
      catch (e2) {
        _vidStopAll();
        _hideVidPreview();
        _abortVoiceUi();
        toast("Video yozib bo'lmadi", "error");
        return;
      }
    }
    _vidRec.ondataavailable = e => { if (e.data && e.data.size > 0) _vidChunks.push(e.data); };
    _vidRec.onstop = () => {
      _vidStopAll();
      const sec = Math.max(1, Math.round((performance.now() - _vidStartTs) / 1000));
      if (!_vidChunks.length) return;
      const type = String(_vidRec?.mimeType || mime || 'video/webm').split(';')[0];
      const ext = type.includes('mp4') ? 'mp4' : 'webm';
      const blob = new Blob(_vidChunks, { type });
      _vidChunks = [];
      if (blob.size > VID_MAX_BYTES) {
        toast('Video 30 MB dan oshdi — qisqaroq yozing', 'error');
        return;
      }
      if (blob.size < 1000) {
        toast('Video juda qisqa', 'error');
        return;
      }
      const file = new File([blob], videoNoteFileName(sec, ext), { type });
      if (typeof _onVideoRecorded === 'function') _onVideoRecorded(file, sec);
    };
    _vidStartTs = performance.now();
    _vidRec.start(500);
    _startPulse(stream);
    _vidRefreshCamList();   // flip tugmasi uchun 2+ kamera
    // Torch capabilities ba'zan kechikadi
    setTimeout(() => _vidSyncCtrls(), 400);
    setTimeout(() => _vidSyncCtrls(), 1200);
    clearTimeout(_vidAutoStop);
    // 1 daqiqa — avto-yuborish (qulflangan bo'lsa ham, bosib turilgan bo'lsa ham)
    _vidAutoStop = setTimeout(() => {
      if (_vidLocked) _vidSendLocked();
      else if (_isHoldingVoice || _vidActive) _finishHoldRef?.();
    }, VID_MAX_SEC * 1000);
  } catch (err) {
    console.error('Kamera xatosi:', err);
    _abortVoiceUi();
    const kind = _micErrorKind(err);
    if (kind === 'notfound') {
      _scheduleScan(0);
      toast('Kamera yoki mikrofon topilmadi', 'error');
    } else if (kind === 'busy') toast('Kamera boshqa dasturda band', 'error');
    else toast('Kamera va mikrofonga ruxsat bering (manzil qatoridagi qulf ikonka)', 'error');
  }
}

function stopVideoRecording() {
  _voiceStopRequested = true;
  clearTimeout(_vidAutoStop); _vidAutoStop = null;
  _vidResetLockUi();
  _hideVidPreview();
  if (_vidRec && _vidRec.state !== 'inactive') {
    try { _vidRec.stop(); } catch (_) {}
  } else {
    _vidStopAll();
  }
  _stopPulse();
}

function cancelVideoRecording() {
  _voiceStopRequested = true;
  clearTimeout(_vidAutoStop); _vidAutoStop = null;
  clearTimeout(_vidHoldTimer); _vidHoldTimer = null;
  _vidActive = false;
  _vidResetLockUi();
  _hideVidPreview();
  if (_vidRec) {
    _vidRec.ondataavailable = null;
    _vidRec.onstop = null;
    if (_vidRec.state !== 'inactive') { try { _vidRec.stop(); } catch (_) {} }
    _vidRec = null;
  }
  _vidStopAll();
  _vidChunks = [];
  _stopPulse();
}

function _showRecordBar() {
  const bar = $('chatRecordBar');
  const timer = $('chatRecordTimer');
  const cancelText = $('crbCancelText');
  const inputRow = $('chatThreadInputRow');
  const attachBtn = $('chatAttachBtn');

  if (inputRow) inputRow.classList.add('recording');
  if (attachBtn) {
    attachBtn.classList.add('recording-hidden');
    attachBtn.setAttribute('tabindex', '-1');
    attachBtn.setAttribute('aria-hidden', 'true');
  }

  if (!bar) return;
  bar.classList.add('active');
  bar.classList.remove('cancelling');
  if (cancelText) { cancelText.textContent = 'Bekor qilish uchun chapga suring'; cancelText.style.transform = ''; }
  if (timer) timer.textContent = '0:00';
  _voiceStartTime = Date.now();
  if (_recTimerInterval) clearInterval(_recTimerInterval);
  _recTimerInterval = setInterval(() => {
    const elapsed = Math.floor((Date.now() - _voiceStartTime) / 1000);
    const m = Math.floor(elapsed / 60);
    const s = elapsed % 60;
    if (timer) timer.textContent = `${m}:${s < 10 ? '0' : ''}${s}`;
  }, 250);
}

function _hideRecordBar() {
  const bar = $('chatRecordBar');
  if (bar) bar.classList.remove('active', 'cancelling', 'locked');
  _hideLockHint();
  if (_recTimerInterval) { clearInterval(_recTimerInterval); _recTimerInterval = null; }
  const wrap = $('chatVoiceWrap');
  if (wrap) wrap.classList.remove('cancelling');
  _clearVoiceCancelVisuals();

  const inputRow = $('chatThreadInputRow');
  if (inputRow) inputRow.classList.remove('recording');
  const attachBtn = $('chatAttachBtn');
  if (attachBtn) {
    attachBtn.classList.remove('recording-hidden');
    attachBtn.removeAttribute('tabindex');
    attachBtn.removeAttribute('aria-hidden');
  }
}

function _setRecordBarCancelState(isCancelling) {
  const bar = $('chatRecordBar');
  const cancelText = $('crbCancelText');
  const wrap = $('chatVoiceWrap');
  if (bar) bar.classList.toggle('cancelling', isCancelling);
  if (wrap) wrap.classList.toggle('cancelling', isCancelling);
  if (cancelText) {
    cancelText.textContent = 'Bekor qilish uchun chapga suring';
  }
}

/* Chapga surish progressi (0..1) — rang/pulse silliq o'zgaradi */
const _VOICE_CANCEL_DIST = 120; // px — to'liq bekor (Samsung jitter uchun katta)
function _lerp(a, b, t) { return a + (b - a) * t; }
function _rgbMix(r1, g1, b1, r2, g2, b2, t) {
  return `rgb(${Math.round(_lerp(r1,r2,t))},${Math.round(_lerp(g1,g2,t))},${Math.round(_lerp(b1,b2,t))})`;
}
function _applyVoiceCancelProgress(p) {
  // p: 0 = normal, 1 = to'liq cancel
  // Chapga surganda tugma/pulse QIZARMAYDI — faqat matn + chapdagi nuqta qizil bo'ladi
  p = Math.max(0, Math.min(1, p));
  const wrap = $('chatVoiceWrap');
  const cancelText = $('crbCancelText');
  const bar = $('chatRecordBar');
  const dot = bar ? bar.querySelector('.crb-dot') : null;

  // Matn o'zgarmaydi — chapga surganda silliq oqadi (Telegram)
  if (cancelText) {
    cancelText.textContent = 'Bekor qilish uchun chapga suring';
    // Siljish faqat ota-konteynerda (chevron + matn birga) — matnni alohida surma, chevron ustiga chiqib ketadi
    const op = 1 - p * 0.25;
    cancelText.style.transform = '';
    cancelText.style.opacity = String(Math.max(0.55, op));
  }
  const cancelWrap = $('chatRecordCancel');
  if (cancelWrap) {
    const dx = -Math.round(p * 28);
    cancelWrap.style.transform = `translateX(${dx}px)`;
    cancelWrap.classList.toggle('is-sliding', p > 0.02);
  }

  // REC nuqta doimo qizil (CSS) — slide da rang o'zgarmaydi
  // (dot style'ga tegilmaydi)

  // Binary class faqat to'liq cancel zonasida (release qarori uchun)
  const full = p >= 0.92;
  if (wrap) wrap.classList.toggle('cancelling', full);
  if (bar) bar.classList.toggle('cancelling', full);
  return full;
}

function _clearVoiceCancelVisuals() {
  const vBtn = $('chatVoiceBtn');
  if (vBtn) {
    vBtn.style.removeProperty('--voice-rec-bg');
    vBtn.style.removeProperty('--voice-rec-shadow');
    vBtn.style.background = '';
    vBtn.style.boxShadow = '';
  }
  ['cvPulse1', 'cvPulse2', 'cvPulse3'].forEach(id => {
    const el = $(id);
    if (el) el.style.background = '';
  });
  const cancelEl = $('chatRecordCancel');
  if (cancelEl) {
    cancelEl.style.color = '';
    cancelEl.style.opacity = '';
    cancelEl.style.fontWeight = '';
  }
  // REC nuqta CSS da doimo qizil — inline tozalash shart emas
  const cancelText = $('crbCancelText');
  if (cancelText) {
    cancelText.style.transform = '';
    cancelText.style.opacity = '';
  }
  const cancelWrap = $('chatRecordCancel');
  if (cancelWrap) {
    cancelWrap.style.transform = '';
    cancelWrap.classList.remove('is-sliding');
  }
}

/* ── Mikrofon ruxsati: har safar so'raymiz, custom card + browser popup ── */
function _ensureMicPermUi() {
  let ov = document.getElementById('micPermOverlay');
  if (ov) return ov;
  ov = document.createElement('div');
  ov.id = 'micPermOverlay';
  ov.className = 'overlay';
  ov.innerHTML = `
    <div class="sheet mic-perm-sheet" role="dialog" aria-labelledby="micPermTitle">
      <div class="sheet-title" id="micPermTitle">Mikrofon ruxsati</div>
      <div class="mic-perm-body">
        <div class="mic-perm-icon" aria-hidden="true">
          <img src="./svg/extra/icon-dae7be10a164.svg" alt="" class="icon" width="40" height="40">
        </div>
        <p id="micPermMsg" class="mic-perm-msg">Ovozli xabar yuborish uchun mikrofonga ruxsat bering.</p>
        <p id="micPermHint" class="mic-perm-hint" hidden></p>
      </div>
      <div class="modal-btn-row">
        <button type="button" class="btn-ghost" id="micPermCancelBtn">Bekor qilish</button>
        <button type="button" class="btn-primary" id="micPermAllowBtn">Ruxsat berish</button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  return ov;
}

function _showMicPermCard({ msg, hint, onAllow } = {}) {
  const ov = _ensureMicPermUi();
  const msgEl = ov.querySelector('#micPermMsg');
  const hintEl = ov.querySelector('#micPermHint');
  const allowBtn = ov.querySelector('#micPermAllowBtn');
  const cancelBtn = ov.querySelector('#micPermCancelBtn');
  if (msgEl) msgEl.textContent = msg || 'Ovozli xabar yuborish uchun mikrofonga ruxsat bering.';
  if (hintEl) {
    if (hint) { hintEl.hidden = false; hintEl.textContent = hint; }
    else { hintEl.hidden = true; hintEl.textContent = ''; }
  }
  const close = () => ov.classList.remove('show');
  // clone to drop old listeners
  const newAllow = allowBtn.cloneNode(true);
  allowBtn.parentNode.replaceChild(newAllow, allowBtn);
  const newCancel = cancelBtn.cloneNode(true);
  cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);
  newAllow.onclick = async () => {
    newAllow.disabled = true;
    newAllow.textContent = "So’ralmoqda...";
    try {
      await onAllow?.();
      close();
    } catch (err) {
      console.error('[mic-perm]', err);
    } finally {
      newAllow.disabled = false;
      newAllow.textContent = 'Ruxsat berish';
    }
  };
  newCancel.onclick = close;
  ov.onclick = (e) => { if (e.target === ov) close(); };
  ov.classList.add('show');
}

async function _queryMicPermission() {
  try {
    if (!navigator.permissions?.query) return 'prompt';
    const st = await navigator.permissions.query({ name: 'microphone' });
    return st?.state || 'prompt'; // 'granted' | 'denied' | 'prompt'
  } catch (_) {
    return 'prompt';
  }
}

async function _requestMicStream() {
  // Har safar yangidan so'raymiz — denied cache qilmaymiz
  return navigator.mediaDevices.getUserMedia({ audio: true });
}

function _micErrorKind(err) { return mediaErrorKind(err); }   // umumiy: camera-access.js

function _abortVoiceUi() {
  cancelVideoRecording();
  $('chatVoiceBtn')?.classList.remove('recording', 'cancelling', 'vn-locked');
  _hideRecordBar();
  _stopPulse();
  _isHoldingVoice = false;
  _voiceCancelled = true;
}

/* ── Uzun yozuv: VOICE_MAX_SEC da to'xtaydi (yangi bo'lak avtomatik boshlanmaydi) ── */
function _deliverVoice(blob, duration) {
  if (typeof _onVoiceRecorded !== 'function') return;
  _voiceTail = _voiceTail
    .then(() => _onVoiceRecorded(blob, duration))
    .catch(() => {});
}

function _newSegmentRecorder(stream, mime) {
  const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
  const chunks = [];
  const t0 = performance.now();
  rec.ondataavailable = e => { if (e.data && e.data.size > 0) chunks.push(e.data); };
  rec.onstop = () => {
    // Mikrofon faqat YAKUNIY bo'lak tugaganda o'chadi (almashtirishda emas)
    if (rec._final) {
      stream.getTracks().forEach(t => t.stop());
      _mediaStream = null;
    }
    if (!chunks.length) return;
    const duration = Math.max(1, Math.round((performance.now() - t0) / 1000));
    _deliverVoice(new Blob(chunks, { type: rec.mimeType || mime || 'audio/webm' }), duration);
  };
  rec.start();
  return rec;
}

/* 10 daqiqa limit: yozuv to'xtaydi, keyingi ovoz uchun yana bosish kerak */
function _scheduleVoiceMaxStop(ms = VOICE_MAX_SEC * 1000) {
  clearTimeout(_segTimer);
  _segTimer = setTimeout(() => {
    _segTimer = null;
    if (_voiceStopRequested || !_mediaRec) return;
    // Qulflangan yoki bosib turilgan — bir xil: yozuvni yakunlab yuboramiz
    toast(`${Math.round(VOICE_MAX_SEC / 60)} daqiqa to'ldi — ovoz yuborildi`);
    if (_voiceLocked) {
      _voiceSendLocked();
    } else {
      _isHoldingVoice = false;
      $('chatVoiceBtn')?.classList.remove('recording', 'cancelling');
      _clearVoiceCancelVisuals();
      _hideRecordBar();
      stopRecording();
      _voiceResetLockUi();
    }
  }, ms);
}

async function startRecording() {
  _voiceStopRequested = false;
  _voiceLocked = false;
  _recChunks = [];
  _recStartTs = performance.now();

  // Ruxsat holatini tekshirish — denied bo'lsa darhol o'z cardimizni ko'rsatamiz
  const perm = await _queryMicPermission();
  if (perm === 'denied') {
    _abortVoiceUi();
    _showMicPermCard({
      msg: 'Brauzer mikrofonga ruxsatni bloklagan.',
      hint: "Brauzer sozlamalaridan (qulf ikonka → Mikrofon) ruxsatni yoqing, keyin «Ruxsat berish»ni bosing. Keyingi safar ham qayta so’raladi.",
      onAllow: async () => {
        try {
          const s = await _requestMicStream();
          s.getTracks().forEach(t => t.stop());
          toast('Mikrofon ruxsati berildi — endi bosib turing', 'success');
        } catch (err) {
          const kind = _micErrorKind(err);
          if (kind === 'notfound') {
            toast('Mikrofon topilmadi — qurilma ulanganligini tekshiring', 'error');
          } else if (kind === 'denied') {
            toast("Hali ham ruxsat yo’q. Brauzer manzil qatori yonidagi qulfdan Mikrofonni yoqing", "error");
          } else {
            toast('Mikrofon ochilmadi: ' + (err.message || 'xato'), 'error');
          }
          throw err;
        }
      }
    });
    return;
  }

  try {
    const stream = await _requestMicStream();
    _mediaStream = stream;
    _markMicProven(true);   // jismoniy mic ishlayapti

    if (_voiceStopRequested || !_isHoldingVoice) {
      stream.getTracks().forEach(t => t.stop());
      _mediaStream = null;
      _stopPulse();
      return;
    }

    const MIME_CANDIDATES = [
      'audio/webm;codecs=opus',
      'audio/ogg;codecs=opus',
      'audio/mp4',
      'audio/webm',
    ];
    const chosenMime = MIME_CANDIDATES.find(m => MediaRecorder.isTypeSupported?.(m));
    _mediaRec = _newSegmentRecorder(stream, chosenMime || '');
    _scheduleVoiceMaxStop();
    _startPulse(stream);

  } catch (err) {
    console.error('Mikrofon xatosi:', err);
    _abortVoiceUi();
    const kind = _micErrorKind(err);

    if (kind === 'notfound') {
      // Jismoniy qurilma yo'q — UI ni darhol yangilaymiz
      _markMicProven(false);
      _hasMic = false;
      _applyRecMode();
      try { _onDevicesChange?.(); } catch (_) {}
      toast('Mikrofon topilmadi. Tashqi adapter yoki mikrofon ulanganligini tekshiring', 'error');
      return;
    }

    if (kind === 'busy') {
      toast('Mikrofon boshqa dasturda band', 'error');
      return;
    }

    // Ruxsat yo'q / boshqa — o'z cardimiz + browser popup
    _showMicPermCard({
      msg: kind === 'denied'
        ? 'Mikrofonga ruxsat berilmadi.'
        : 'Ovozli xabar uchun mikrofon kerak.',
      hint: "«Ruxsat berish»ni bosing — brauzer so’rovi chiqadi. Agar chiqmasa, manzil qatori yonidagi qulf ikonkasidan Mikrofonni yoqing.",
      onAllow: async () => {
        try {
          const s = await _requestMicStream();
          s.getTracks().forEach(t => t.stop());
          toast('Mikrofon ruxsati berildi — endi bosib turing', 'success');
        } catch (e2) {
          const k2 = _micErrorKind(e2);
          if (k2 === 'notfound') {
            toast('Mikrofon topilmadi — qurilma ulanganligini tekshiring', 'error');
          } else if (k2 === 'denied') {
            toast('Ruxsat berilmadi. Brauzer sozlamalaridan Mikrofonni yoqing', 'error');
          } else {
            toast('Mikrofon ochilmadi', 'error');
          }
          throw e2;
        }
      }
    });
  }
}

function stopRecording() {
  _voiceStopRequested = true;
  clearTimeout(_segTimer); _segTimer = null;
  if (_mediaRec && _mediaRec.state !== 'inactive') {
    _mediaRec._final = true;
    _mediaRec.stop();
  } else if (_mediaStream) {
    _mediaStream.getTracks().forEach(t => t.stop());
    _mediaStream = null;
  }
  _stopPulse();
  _voiceResetLockUi();
}

function cancelRecording() {
  _voiceStopRequested = true;
  clearTimeout(_segTimer); _segTimer = null;
  if (_mediaRec) {
    _mediaRec.ondataavailable = null;
    _mediaRec.onstop = null;
    if (_mediaRec.state !== 'inactive') {
      try { _mediaRec.stop(); } catch(_) {}
    }
    _mediaRec = null;
  }
  if (_mediaStream) {
    _mediaStream.getTracks().forEach(t => t.stop());
    _mediaStream = null;
  }
  _recChunks = [];
  _stopPulse();
  _voiceResetLockUi();
}

/* ── Hold-to-talk: Telegram-style real amplitude pulse (voice + rolik) ── */
function _pulseAudioStream(stream) {
  // Faqat audio track — video track analyser ni buzmasin
  try {
    const tracks = stream?.getAudioTracks?.() || [];
    if (!tracks.length) return stream;
    return new MediaStream(tracks);
  } catch (_) { return stream; }
}

function _pulsePlaceRingsNearBtn() {
  // Float tugma body da bo'lsa — ringlar ham tugma markaziga bog'lanadi
  const btn = $('chatVoiceBtn');
  const cont = $('cvPulseContainer');
  if (!btn || !cont) return;
  const r = btn.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  // Container body da fixed bo'lsa — markazni yangilaymiz
  if (cont.dataset.vnPulseFloat === '1') {
    cont.style.left = cx + 'px';
    cont.style.top = cy + 'px';
  }
}

function _pulseFloatContainer(on) {
  const cont = $('cvPulseContainer');
  const wrap = $('chatVoiceWrap');
  if (!cont) return;
  if (on) {
    if (cont.dataset.vnPulseFloat === '1') { _pulsePlaceRingsNearBtn(); return; }
    cont.dataset.vnPulseFloat = '1';
    cont.dataset.vnPulsePrev = cont.getAttribute('style') || '';
    document.body.appendChild(cont);
    cont.style.position = 'fixed';
    cont.style.zIndex = '10040'; // tugma (10050) ostida, overlay (9000) ustida
    cont.style.pointerEvents = 'none';
    cont.style.transform = 'none';
    cont.style.width = '38px';
    cont.style.height = '38px';
    cont.style.margin = '0';
    _pulsePlaceRingsNearBtn();
  } else if (cont.dataset.vnPulseFloat === '1') {
    if (wrap) wrap.insertBefore(cont, wrap.firstChild);
    const prev = cont.dataset.vnPulsePrev || '';
    if (prev) cont.setAttribute('style', prev);
    else cont.removeAttribute('style');
    delete cont.dataset.vnPulseFloat;
    delete cont.dataset.vnPulsePrev;
  }
}

function _startPulse(stream) {
  _stopPulse(false); // ring float holatini saqlash mumkin emas — to'liq tozalash
  const r1 = $('cvPulse1');
  const r2 = $('cvPulse2');
  const r3 = $('cvPulse3');
  const vBtn = $('chatVoiceBtn');
  if (!stream) return;

  // Rolik / float: ringlar tugma yonida ko'rinsin
  try { _pulseFloatContainer(true); } catch (_) {}

  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    _pulseCtx = new AC();
    if (_pulseCtx.state === 'suspended') _pulseCtx.resume().catch(() => {});

    const aStream = _pulseAudioStream(stream);
    const src = _pulseCtx.createMediaStreamSource(aStream);
    const analyser = _pulseCtx.createAnalyser();
    // Telegram: tez reaction, past latency
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.35;
    analyser.minDecibels = -70;
    analyser.maxDecibels = -10;
    src.connect(analyser);
    _pulseAnalyser = analyser;

    const time = new Uint8Array(analyser.fftSize);
    const freq = new Uint8Array(analyser.frequencyBinCount);
    let lastTime = performance.now();
    let phase = 0;
    _pulseLevel = 0;

    const tick = (now) => {
      if (!_pulseAnalyser) return;

      // 1) Peak + RMS (time domain) — gapirish aniq seziladi
      analyser.getByteTimeDomainData(time);
      let sumSq = 0, peak = 0;
      for (let i = 0; i < time.length; i++) {
        const n = (time[i] - 128) / 128;
        const a = Math.abs(n);
        if (a > peak) peak = a;
        sumSq += n * n;
      }
      const rms = Math.sqrt(sumSq / time.length);
      // Soft noise gate + kuchli gain (Telegram sezgirligi)
      let amp = Math.max(0, (peak * 0.55 + rms * 0.45) - 0.012);
      amp = Math.min(1, Math.pow(amp * 5.2, 0.85));

      // 2) Speech band energy (~300–3400 Hz) — shovqin vs gapirish
      analyser.getByteFrequencyData(freq);
      const binHz = (_pulseCtx.sampleRate / 2) / freq.length;
      let fSum = 0, fN = 0;
      for (let i = 0; i < freq.length; i++) {
        const hz = i * binHz;
        if (hz < 250 || hz > 3800) continue;
        fSum += freq[i];
        fN++;
      }
      const fAvg = fN ? (fSum / fN) / 255 : 0;
      const fAmp = Math.min(1, Math.max(0, (fAvg - 0.04) * 2.8));

      // Aralashma: peak/RMS asosiy, spektr qo'shimcha
      const raw = Math.min(1, amp * 0.78 + fAmp * 0.22);

      // Telegram physics: juda tez attack, o'rtacha decay
      const speed = raw > _pulseLevel ? 0.55 : 0.12;
      _pulseLevel += (raw - _pulseLevel) * speed;

      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;
      phase += dt * (2.2 + _pulseLevel * 1.8);
      const breathe = Math.sin(phase) * (0.02 + _pulseLevel * 0.03);

      // Tugma scale — jimlikda ~1.18, baland ovozda ~1.38
      if (vBtn && !_voiceCancelled) {
        const btnScale = 1.0 + (_pulseLevel * 0.12) + breathe * 0.5;
        vBtn.style.transform = 'scale(' + btnScale.toFixed(3) + ')';
        // Soft glow — amplituda bilan
        const g = (0.35 + _pulseLevel * 0.55).toFixed(2);
        const blur = (12 + _pulseLevel * 22).toFixed(0);
        vBtn.style.boxShadow =
          '0 4px ' + blur + 'px rgba(29,155,240,' + g + '), 0 0 0 2px rgba(231,233,234,' + (0.12 + _pulseLevel * 0.2).toFixed(2) + ')';
      }

      _pulsePlaceRingsNearBtn();

      // Telegram soft blobs
      if (r1) {
        const s1 = 1.0 + _pulseLevel * 0.55 + breathe * 0.15;
        r1.style.transform = 'translate(-50%, -50%) scale(' + s1.toFixed(3) + ')';
        r1.style.opacity = Math.min(0.55, 0.12 + _pulseLevel * 0.5).toFixed(3);
      }
      if (r2) {
        const s2 = 1.25 + _pulseLevel * 1.15 + Math.sin(phase - 0.5) * 0.04;
        r2.style.transform = 'translate(-50%, -50%) scale(' + s2.toFixed(3) + ')';
        r2.style.opacity = Math.min(0.4, 0.06 + _pulseLevel * 0.38).toFixed(3);
      }
      if (r3) {
        const s3 = 1.55 + _pulseLevel * 1.85 + Math.sin(phase - 1.1) * 0.05;
        r3.style.transform = 'translate(-50%, -50%) scale(' + s3.toFixed(3) + ')';
        r3.style.opacity = Math.min(0.28, 0.03 + _pulseLevel * 0.28).toFixed(3);
      }

      _pulseRaf = requestAnimationFrame(tick);
    };

    _pulseRaf = requestAnimationFrame(tick);
  } catch (e) {
    console.warn('Pulse ishga tushmadi:', e?.message || e);
  }
}

function _stopPulse() {
  if (_pulseRaf) { cancelAnimationFrame(_pulseRaf); _pulseRaf = null; }
  if (_pulseCtx) { try { _pulseCtx.close(); } catch(_) {} _pulseCtx = null; }
  _pulseAnalyser = null;
  _pulseLevel = 0;
  const vBtn = $('chatVoiceBtn');
  if (vBtn) {
    vBtn.style.transform = '';
    // boxShadow ni recording CSS qayta qo'ysin — inline olib tashlaymiz
    if (!vBtn.classList.contains('recording')) vBtn.style.boxShadow = '';
    else vBtn.style.removeProperty('box-shadow');
  }
  ['cvPulse1', 'cvPulse2', 'cvPulse3'].forEach(id => {
    const el = $(id);
    if (el) {
      el.style.transform = 'translate(-50%, -50%) scale(0.8)';
      el.style.opacity = '0';
    }
  });
  try { _pulseFloatContainer(false); } catch (_) {}
}



function _bindVoiceHoldUi() {
const _vBtn = $('chatVoiceBtn');
if (_vBtn) {
  // Mobile Chrome: img.mic.svg long-press -> Copy/Download image menyu
  _vBtn.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); });
  _vBtn.querySelectorAll('img, svg').forEach(el => {
    el.setAttribute('draggable', 'false');
    el.addEventListener('contextmenu', e => { e.preventDefault(); e.stopPropagation(); });
  });
  _vBtn.addEventListener('pointerdown', e => {
    if (e.button !== undefined && e.button !== 0) return;

    // QULFLANGAN yozuv: yozuv tugmasini yana bosish = yuborish (rolik yoki ovoz)
    if (_vidLocked && _vidActive) {
      e.preventDefault();
      _voiceJustHandled = true;
      setTimeout(() => { _voiceJustHandled = false; }, 350);
      _vidSendLocked();
      return;
    }
    if (_voiceLocked && _mediaRec && _mediaRec.state !== 'inactive') {
      e.preventDefault();
      _voiceJustHandled = true;
      setTimeout(() => { _voiceJustHandled = false; }, 350);
      _voiceSendLocked();
      return;
    }

    // Matn yoki fayl yoki post bo'lsa — bu yuborish tugmasi (click orqali ishlaydi)
    if (typeof _isComposerBusy === 'function' && _isComposerBusy()) return;
    if (!canRecordMedia()) return;   // qurilma yo'q — bu faqat yuborish tugmasi (click)

    e.preventDefault();
    _activePointerId = e.pointerId;
    try { _vBtn.setPointerCapture(e.pointerId); } catch (_) {}

    _isHoldingVoice = true;
    _voiceCancelled = false;
    _voiceStartX = e.clientX;
    _voiceStartY = e.clientY;
    _voiceStartTime = Date.now();

    _clearVoiceCancelVisuals();
    _applyVoiceCancelProgress(0);
    if (_effMode() === 'video') {
      // Qisqa bosish = rejim almashtirish; yozuv faqat bosib turilganda boshlanadi
      clearTimeout(_vidHoldTimer);
      _vidHoldTimer = setTimeout(() => {
        _vidHoldTimer = null;
        if (!_isHoldingVoice) return;
        _vidActive = true;
        _vBtn.classList.add('recording');
        _vBtn.classList.remove('cancelling');
        _showRecordBar();
        _showLockHint();
        startVideoRecording();
      }, 280);
    } else {
      _vBtn.classList.add('recording');
      _vBtn.classList.remove('cancelling');
      _showRecordBar();
      _showLockHint();
      startRecording();
    }
  });

  _vBtn.addEventListener('pointermove', e => {
    if (_vidLocked || _voiceLocked) return;
    if (!_isHoldingVoice) return;
    if (!_voiceCancelled) {
      // Yuqoriga surish (Telegram) → qulflash — rolik va oddiy ovoz
      const lp = Math.max(0, Math.min(1, (_voiceStartY - e.clientY) / _VID_LOCK_DIST));
      _setLockProgress(lp);
      if (lp >= 1) {
        if (_vidActive) { _lockVideo(); return; }
        if (_mediaRec && _mediaRec.state !== 'inactive') { _lockVoice(); return; }
      }
    }
    const dx = e.clientX - _voiceStartX;
    // Chapga surish: 0..1 progress — rang silliq o'zgaradi, to'satdan qizarib ketmaydi
    const progress = dx >= 0 ? 0 : Math.min(1, (-dx) / _VOICE_CANCEL_DIST);
    const full = _applyVoiceCancelProgress(progress);
    _voiceCancelled = full;
    _vBtn.classList.toggle('cancelling', full);
  });

  const _finishVoiceHold = () => {
    if (!_isHoldingVoice) return;
    _isHoldingVoice = false;
    _voiceJustHandled = true;
    setTimeout(() => { _voiceJustHandled = false; }, 350);

    if (_activePointerId !== null) {
      try { _vBtn.releasePointerCapture(_activePointerId); } catch (_) {}
      _activePointerId = null;
    }

    // Qulflangan (rolik yoki ovoz): barmoq ko'tarildi, lekin yozuv DAVOM etadi
    if (_vidActive && _vidLocked) return;
    if (_voiceLocked) return;

    _vBtn.classList.remove('recording', 'cancelling');
    _clearVoiceCancelVisuals();
    _hideRecordBar();
    _voiceResetLockUi();

    const duration = Date.now() - _voiceStartTime;

    if (_vidHoldTimer) {
      // Rolik rejimi: yozuv hali boshlanmagan — bu oddiy bosish → mikrofon ⇄ rolik
      clearTimeout(_vidHoldTimer); _vidHoldTimer = null;
      if (!_voiceCancelled) _toggleRecMode();
      return;
    }
    if (_vidActive) {
      _vidActive = false;
      if (_voiceCancelled) {
        cancelVideoRecording();
        toast('Video xabar bekor qilindi');
      } else if (duration < 700) {
        cancelVideoRecording();
        toast('Video yozish uchun tugmani bosib turing');
      } else {
        stopVideoRecording();
      }
      return;
    }

    if (_voiceCancelled) {
      cancelRecording();
      toast('Ovozli xabar bekor qilindi');
    } else if (duration < 500) {
      // Qisqa bosish (tap) → mikrofon ⇄ rolik ikonka almashadi
      cancelRecording();
      _toggleRecMode();
    } else {
      // Normal qo'yib yuborish: ovoz darhol ketadi!
      stopRecording();
    }
  };

  _finishHoldRef = _finishVoiceHold;
  _vBtn.addEventListener('pointerup', _finishVoiceHold);
  // Samsung/Chrome: permission dialog yoki scroll pointercancel beradi — bekor qilmaymiz, oddiy release
  _vBtn.addEventListener('pointercancel', () => {
    if (!_isHoldingVoice) return;
    _finishVoiceHold();
  });

  _vBtn.addEventListener('click', e => {
    if (_voiceJustHandled) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if ((typeof _isComposerBusy === 'function' && _isComposerBusy()) || !canRecordMedia()) {
      if (typeof _onSendAction === 'function') _onSendAction();
    } else {
      toast('Ovoz yozish uchun mikrofoni bosib turing');
    }
  });

  $('chatRecordCancel')?.addEventListener('click', () => { if (_vidLocked) _vidCancelLocked(); else if (_voiceLocked) _voiceCancelLocked(); });

  window.addEventListener('blur', () => {
    // Ruxsat dialogi blur beradi — yozuv boshlangan bo'lsa bekor qilmaymiz
    if (!_isHoldingVoice) return;
    if (_vidLocked || _voiceLocked) return;
    if (_vidActive || (_mediaRec && _mediaRec.state === 'recording')) return;
    _voiceCancelled = true;
    _finishVoiceHold();
  });
}

}

/**
 * @param {{ onRecorded: (blob: Blob, duration: number) => void,
 *           isComposerBusy?: () => boolean,
 *           onSendAction?: () => void }} opts
 */
let _devWatch = false;
export function initChatVoiceRecording(opts = {}) {
  _onVoiceRecorded = opts.onRecorded || null;
  _isComposerBusy = opts.isComposerBusy || null;
  _onSendAction = opts.onSendAction || null;
  _onVideoRecorded = opts.onVideoRecorded || null;
  _onDevicesChange = opts.onDevicesChange || null;
  _applyRecMode();
  if (!_devWatch) {
    _devWatch = true;
    try { navigator.mediaDevices?.addEventListener?.('devicechange', () => _scheduleScan(120)); } catch (_) {}
    window.addEventListener('focus', () => _scheduleScan(50));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') _scheduleScan(50);
    });
  }
  _scanDevices();
  if (!_voiceUiBound) {
    _voiceUiBound = true;
    _bindVoiceHoldUi();
  }
}

export { cancelRecording };

export function forceStopVoiceRecording() {
  cancelRecording();
  cancelVideoRecording();
  _abortVoiceUi();
}
