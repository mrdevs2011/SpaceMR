/**
 * chat-voice-record.js — hold-to-talk yozish, mikrofon ruxsati, pulse UI
 * chat.js dan ehtiyotkor ajratilgan. Playback/waveform chat.js da qoladi.
 */
import { $ } from '../core/utils.js';
import { videoNoteFileName } from './components/video-note.js';
import { mediaErrorKind } from './camera-access.js';
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

/* ── Rolik (dumaloq video xabar) rejimi ────────────────────────────────────
 * Tugmaga qisqa bosish: mikrofon ⇄ rolik ikonka almashadi (tanlov eslab qolinadi).
 * Rolik rejimida BOSIB TURISH = ovozli xabar bilan bir xil (pastdagi yozuv paneli, chapga surish = bekor),
 * ekran o'rtasida esa dumaloq kamera ko'rinadi. Qo'yib yuborilganda fayl sifatida (vnote_<ts>_<sek>.webm) ketadi. */
const _MODE_KEY = 'mrspace_rec_mode';
const VID_MAX_SEC = 60;
let _recMode = 'audio';
try { if (localStorage.getItem(_MODE_KEY) === 'video') _recMode = 'video'; } catch (_) {}
/* Qurilmalar: sayt mikrofon/kamera borligini o'zi biladi (ulanganda/uzilganda ham — 'devicechange') */
let _hasMic = true, _hasCam = true;
let _onDevicesChange = null;
function _effMode() {
  if (!_hasMic && !_hasCam) return 'none';
  if (!_hasMic) return 'video';
  if (!_hasCam) return 'audio';
  return _recMode;
}
/** false → na mikrofon, na kamera: tugma doim "yuborish" (qog'oz samolyot) */
export function canRecordMedia() { return _hasMic || _hasCam; }
async function _scanDevices() {
  try {
    if (navigator.mediaDevices?.enumerateDevices) {
      const d = await navigator.mediaDevices.enumerateDevices();
      _hasMic = d.some(x => x.kind === 'audioinput');
      _hasCam = d.some(x => x.kind === 'videoinput');
    } else { _hasMic = _hasCam = false; }
  } catch (_) {}
  _applyRecMode();
  try { _onDevicesChange?.(); } catch (_) {}
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
  b.title = m === 'video' ? 'Video xabar (bosib turing)' : m === 'none' ? 'Yuborish' : 'Ovozli xabar';
}
function _toggleRecMode() {
  if (!_hasMic || !_hasCam) return;   // faqat bittasi bo'lsa — almashmaydi
  _recMode = _recMode === 'video' ? 'audio' : 'video';
  try { localStorage.setItem(_MODE_KEY, _recMode); } catch (_) {}
  _applyRecMode();
}

function _showVidPreview(stream) {
  let el = document.getElementById('vnotePreview');
  if (!el) {
    el = document.createElement('div');
    el.id = 'vnotePreview';
    el.innerHTML = '<div class="vnp-circle"><video class="vnp-video" muted playsinline autoplay></video>'
      + '<svg class="vnp-ring" viewBox="0 0 100 100" aria-hidden="true"><circle class="vnp-ring-fg" cx="50" cy="50" r="48"/></svg></div>';
    document.body.appendChild(el);
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
}
function _hideVidPreview() {
  clearInterval(_vidRingTimer); _vidRingTimer = null;
  const el = document.getElementById('vnotePreview');
  if (!el) return;
  el.classList.remove('show');
  const v = el.querySelector('video');
  if (v) v.srcObject = null;
}

async function startVideoRecording() {
  _voiceStopRequested = false;
  _vidChunks = [];
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: _hasMic,   // mikrofon bo'lmasa ham rolik (ovozsiz) olinaveradi
      video: { facingMode: 'user', width: { ideal: 480 }, height: { ideal: 480 }, aspectRatio: { ideal: 1 }, frameRate: { ideal: 30 } },
    });
    _vidStream = stream;
    if (_voiceStopRequested || !_isHoldingVoice) {
      stream.getTracks().forEach(t => t.stop());
      _vidStream = null;
      _stopPulse();
      if (!_voiceCancelled && !_voiceStopRequested) toast('Video yozilmadi — tugmani bosib turing');
      return;
    }
    const cands = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
    const mime = cands.find(m => MediaRecorder.isTypeSupported?.(m)) || '';
    const opts = { videoBitsPerSecond: 900000, audioBitsPerSecond: 64000 };
    if (mime) opts.mimeType = mime;
    _vidRec = new MediaRecorder(stream, opts);
    _vidRec.ondataavailable = e => { if (e.data && e.data.size > 0) _vidChunks.push(e.data); };
    _vidRec.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      _vidStream = null;
      const sec = Math.max(1, Math.round((performance.now() - _vidStartTs) / 1000));
      if (!_vidChunks.length) return;
      const type = String(_vidRec?.mimeType || mime || 'video/webm').split(';')[0];
      const ext = type.includes('mp4') ? 'mp4' : 'webm';
      const file = new File(_vidChunks, videoNoteFileName(sec, ext), { type });
      _vidChunks = [];
      if (typeof _onVideoRecorded === 'function') _onVideoRecorded(file, sec);
    };
    _vidStartTs = performance.now();
    _vidRec.start(1000);
    _showVidPreview(stream);
    _startPulse(stream);
    clearTimeout(_vidAutoStop);
    _vidAutoStop = setTimeout(() => { if (_isHoldingVoice) _finishHoldRef?.(); }, VID_MAX_SEC * 1000);
  } catch (err) {
    console.error('Kamera xatosi:', err);
    _abortVoiceUi();
    const kind = _micErrorKind(err);
    if (kind === 'notfound') toast('Kamera yoki mikrofon topilmadi', 'error');
    else if (kind === 'busy') toast('Kamera boshqa dasturda band', 'error');
    else toast('Kamera va mikrofonga ruxsat bering (manzil qatoridagi qulf ikonka)', 'error');
  }
}

function stopVideoRecording() {
  _voiceStopRequested = true;
  clearTimeout(_vidAutoStop); _vidAutoStop = null;
  _hideVidPreview();
  if (_vidRec && _vidRec.state !== 'inactive') {
    try { _vidRec.stop(); } catch (_) {}
  } else if (_vidStream) {
    _vidStream.getTracks().forEach(t => t.stop());
    _vidStream = null;
  }
  _stopPulse();
}

function cancelVideoRecording() {
  _voiceStopRequested = true;
  clearTimeout(_vidAutoStop); _vidAutoStop = null;
  clearTimeout(_vidHoldTimer); _vidHoldTimer = null;
  _vidActive = false;
  _hideVidPreview();
  if (_vidRec) {
    _vidRec.ondataavailable = null;
    _vidRec.onstop = null;
    if (_vidRec.state !== 'inactive') { try { _vidRec.stop(); } catch (_) {} }
    _vidRec = null;
  }
  if (_vidStream) { _vidStream.getTracks().forEach(t => t.stop()); _vidStream = null; }
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
  if (bar) bar.classList.remove('active', 'cancelling');
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
const _VOICE_CANCEL_DIST = 72; // px — to'liq bekor qilish masofasi
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
      <button type="button" class="btn-primary" id="micPermAllowBtn">Ruxsat berish</button>
      <button type="button" class="btn-ghost" id="micPermCancelBtn">Bekor qilish</button>
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
  $('chatVoiceBtn')?.classList.remove('recording', 'cancelling');
  _hideRecordBar();
  _stopPulse();
  _isHoldingVoice = false;
  _voiceCancelled = true;
}

async function startRecording() {
  _voiceStopRequested = false;
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
    const opts = chosenMime ? { mimeType: chosenMime } : {};

    _mediaRec = new MediaRecorder(stream, opts);
    _mediaRec.ondataavailable = e => {
      if (e.data && e.data.size > 0) _recChunks.push(e.data);
    };
    _mediaRec.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      _mediaStream = null;
      const duration = Math.round((performance.now() - _recStartTs) / 1000);
      if (!_recChunks.length) return;
      const mimeType = _mediaRec.mimeType || chosenMime || 'audio/webm';
      const blob = new Blob(_recChunks, { type: mimeType });
      if (typeof _onVoiceRecorded === 'function') _onVoiceRecorded(blob, duration);
    };

    _mediaRec.start();
    _startPulse(stream);

  } catch (err) {
    console.error('Mikrofon xatosi:', err);
    _abortVoiceUi();
    const kind = _micErrorKind(err);

    if (kind === 'notfound') {
      // Faqat jismoniy qurilma yo'qligida — ruxsat emas
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
  if (_mediaRec && _mediaRec.state !== 'inactive') {
    _mediaRec.stop();
  } else if (_mediaStream) {
    _mediaStream.getTracks().forEach(t => t.stop());
    _mediaStream = null;
  }
  _stopPulse();
}

function cancelRecording() {
  _voiceStopRequested = true;
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
}

/* ── Hold-to-talk: faqat mic pulse (chiziqli waveform olib tashlandi) ── */

function _startPulse(stream) {
  const r1 = $('cvPulse1');
  const r2 = $('cvPulse2');
  const r3 = $('cvPulse3');
  const vBtn = $('chatVoiceBtn');

  try {
    _pulseCtx = new (window.AudioContext || window.webkitAudioContext)();
    const src = _pulseCtx.createMediaStreamSource(stream);
    const analyser = _pulseCtx.createAnalyser();
    // Telegramga yaqin: tez reaction + silliq decay
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.55;
    src.connect(analyser);
    _pulseAnalyser = analyser;

    const freq = new Uint8Array(analyser.frequencyBinCount);
    const time = new Uint8Array(analyser.fftSize);
    let lastTime = performance.now();
    let phase = 0;
    _pulseLevel = 0.08;

    const tick = (now) => {
      if (!_pulseAnalyser) return;

      // 1) Time-domain RMS — gapirish amplitudasi (realistik)
      analyser.getByteTimeDomainData(time);
      let sumSq = 0;
      for (let i = 0; i < time.length; i++) {
        const n = (time[i] - 128) / 128;
        sumSq += n * n;
      }
      const rms = Math.sqrt(sumSq / time.length);
      // threshold + gain (jimlikda deyarli 0, gapirganda 0.2..1)
      let amp = Math.min(1, Math.max(0, (rms - 0.015) * 4.5));

      // 2) Frequency energy (o'rta diapazon) — boyroq waveform
      analyser.getByteFrequencyData(freq);
      let fSum = 0;
      const fMax = Math.min(48, freq.length);
      for (let i = 2; i < fMax; i++) fSum += freq[i];
      const fAvg = fSum / (fMax - 2) / 255;
      const fAmp = Math.min(1, Math.max(0, (fAvg - 0.02) * 2.4));

      // aralashma: asosan RMS, biroz spektr
      const raw = Math.min(1, amp * 0.72 + fAmp * 0.28);

      // Telegram physics: tez attack, sekin decay
      const speed = raw > _pulseLevel ? 0.42 : 0.14;
      _pulseLevel += (raw - _pulseLevel) * speed;

      const dt = (now - lastTime) / 1000;
      lastTime = now;
      phase += dt * 2.8;
      const breathe = Math.sin(phase) * 0.04;

      // ── Mic button + 3 pulse rings (Telegram) ──
      if (vBtn && !_voiceCancelled) {
        const btnScale = 1.18 + (_pulseLevel * 0.14) + breathe * 0.25;
        vBtn.style.transform = `scale(${btnScale.toFixed(3)})`;
      }
      if (r1) {
        const s1 = 1.0 + (_pulseLevel * 0.85) + breathe * 0.4;
        r1.style.transform = `translate(-50%, -50%) scale(${s1.toFixed(3)})`;
        r1.style.opacity = (0.4 + _pulseLevel * 0.55).toFixed(3);
      }
      if (r2) {
        const s2 = 1.25 + (_pulseLevel * 1.55) + Math.sin(phase - 0.6) * 0.08;
        r2.style.transform = `translate(-50%, -50%) scale(${s2.toFixed(3)})`;
        r2.style.opacity = (0.28 + _pulseLevel * 0.45).toFixed(3);
      }
      if (r3) {
        const s3 = 1.55 + (_pulseLevel * 2.35) + Math.sin(phase - 1.2) * 0.1;
        r3.style.transform = `translate(-50%, -50%) scale(${s3.toFixed(3)})`;
        r3.style.opacity = (0.15 + _pulseLevel * 0.4).toFixed(3);
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
  if (vBtn) vBtn.style.transform = '';
  ['cvPulse1', 'cvPulse2', 'cvPulse3'].forEach(id => {
    const el = $(id);
    if (el) {
      el.style.transform = 'translate(-50%, -50%) scale(0.8)';
      el.style.opacity = '0';
    }
  });
}


function _bindVoiceHoldUi() {
const _vBtn = $('chatVoiceBtn');
if (_vBtn) {
  _vBtn.addEventListener('pointerdown', e => {
    if (e.button !== undefined && e.button !== 0) return;

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
        startVideoRecording();
      }, 280);
    } else {
      _vBtn.classList.add('recording');
      _vBtn.classList.remove('cancelling');
      _showRecordBar();
      startRecording();
    }
  });

  _vBtn.addEventListener('pointermove', e => {
    if (!_isHoldingVoice) return;
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

    _vBtn.classList.remove('recording', 'cancelling');
    _clearVoiceCancelVisuals();
    _hideRecordBar();

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
  _vBtn.addEventListener('pointercancel', () => {
    if (!_isHoldingVoice) return;
    _voiceCancelled = true;
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

  window.addEventListener('blur', () => {
    if (_isHoldingVoice) {
      _voiceCancelled = true;
      _finishVoiceHold();
    }
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
    try { navigator.mediaDevices?.addEventListener?.('devicechange', _scanDevices); } catch (_) {}
    window.addEventListener('focus', _scanDevices);
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
