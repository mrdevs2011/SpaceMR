/* camera-capture.js — SpaceMR kamera UI: photo + video, switch, flash, sifat normalizatsiya.
   Video: max 60s, maqsad ≤30MB. Rasm: max 1920px, JPEG ~0.85. */
import { toast } from '../ui/toast.js';
import {
  hasCameraDevice, cameraErrorMsg, listCameras,
  trackSupportsTorch, setTorch,
} from './camera-access.js';

let _open = false;

const MAX_VIDEO_MS = 60_000;
const MAX_VIDEO_BYTES = 30 * 1024 * 1024; // 30 MB
const VIDEO_BITRATE = 2_500_000;         // ~2.5 Mbps → 60s ≈ 18–20 MB
const VIDEO_W = 1280;
const VIDEO_H = 720;
const PHOTO_MAX_SIDE = 1920;
const PHOTO_QUALITY = 0.85;

const SVG = {
  close: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  flip: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5M8 21H3v-5"/><path d="M21 3l-7 7M3 21l7-7"/></svg>',
  flashOn: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M7 2v11h3v9l7-12h-4l4-8z"/></svg>',
  flashOff: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M7 2v11h3v9l7-12h-4l4-8z"/><path d="M4 4l16 16"/></svg>',
  photo: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7h-3l-1.5-2h-7L7 7H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  video: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="14" height="12" rx="2"/><path d="M16 10l6-3v10l-6-3z"/></svg>',
};

function _constraints(deviceId, facing, withAudio) {
  const video = deviceId
    ? { deviceId: { exact: deviceId }, width: { ideal: VIDEO_W }, height: { ideal: VIDEO_H }, frameRate: { ideal: 30, max: 30 } }
    : { facingMode: { ideal: facing || 'user' }, width: { ideal: VIDEO_W }, height: { ideal: VIDEO_H }, frameRate: { ideal: 30, max: 30 } };
  return { audio: !!withAudio, video };
}

async function _startStream(deviceId, facing, withAudio) {
  return navigator.mediaDevices.getUserMedia(_constraints(deviceId, facing, withAudio));
}

function _pickMime() {
  const cands = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4',
  ];
  for (const m of cands) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(m)) return m;
  }
  return '';
}

/** Canvas orqali rasmni bir xil sifatga keltirish */
function _capturePhoto(video) {
  return new Promise(resolve => {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) { resolve(null); return; }
    let w = vw, h = vh;
    const max = PHOTO_MAX_SIDE;
    if (w > max || h > max) {
      if (w >= h) { h = Math.round(h * (max / w)); w = max; }
      else { w = Math.round(w * (max / h)); h = max; }
    }
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    // front camera mirror ko'rinishini saqlash ixtiyoriy — real faylda to'g'ri
    ctx.drawImage(video, 0, 0, w, h);
    c.toBlob(
      b => resolve(b ? new File([b], `photo_${Date.now()}.jpg`, { type: 'image/jpeg' }) : null),
      'image/jpeg',
      PHOTO_QUALITY
    );
  });
}

/** MediaRecorder blob → File; 30MB dan oshsa qayta encode qilinmaydi, ogohlantirish */
function _blobToVideoFile(blob) {
  if (!blob || !blob.size) return null;
  const ext = (blob.type || '').includes('mp4') ? 'mp4' : 'webm';
  return new File([blob], `video_${Date.now()}.${ext}`, { type: blob.type || 'video/webm' });
}

/**
 * Kamerani ochadi. Rasm/video File yoki null.
 * options: { mode?: 'photo'|'video' } — boshlang'ich rejim
 */
export async function openCameraCapture(options = {}) {
  if (_open) return null;
  _open = true;

  let stream = null;
  let facing = 'user'; // 'user' | 'environment'
  let deviceId = null;
  let mode = options.mode === 'video' ? 'video' : 'photo';
  let torchOn = false;
  let recording = false;
  let mediaRec = null;
  let recChunks = [];
  let recTimer = null;
  let recStarted = 0;
  let cams = { front: null, back: null, list: [] };
  let finishRef = null;

  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      toast('Kamera bu brauzerda mavjud emas', 'error');
      return null;
    }

    // Dastlabki stream (ruxsat + label uchun)
    try {
      stream = await _startStream(null, facing, mode === 'video');
    } catch (err) {
      // environment urinib ko'rish
      try {
        facing = 'environment';
        stream = await _startStream(null, facing, mode === 'video');
      } catch (err2) {
        console.error('Kamera xatosi:', err2);
        toast(cameraErrorMsg(err2), 'error');
        return null;
      }
    }

    cams = await listCameras();
    // Faqat mavjud kamerani tanlash
    if (cams.front && !cams.back) {
      facing = 'user';
      deviceId = cams.front.deviceId;
    } else if (cams.back && !cams.front) {
      facing = 'environment';
      deviceId = cams.back.deviceId;
    } else if (cams.front && cams.back) {
      // default: orqa (agar bor)
      facing = 'environment';
      deviceId = cams.back.deviceId;
    }
    // Aniq device bilan qayta ulash (audio video rejim uchun)
    if (deviceId) {
      try {
        stream.getTracks().forEach(t => t.stop());
        stream = await _startStream(deviceId, facing, mode === 'video');
      } catch (_) { /* eski stream bilan davom */ }
    }

    const canSwitch = !!(cams.front && cams.back
      && cams.front.deviceId !== cams.back.deviceId);

    const ov = document.createElement('div');
    ov.id = 'camCapture';
    ov.innerHTML = `
      <video class="cc-video" autoplay muted playsinline></video>
      <div class="cc-top">
        <button type="button" class="cc-btn cc-close" aria-label="Yopish">${SVG.close}</button>
        <button type="button" class="cc-btn cc-flash" aria-label="Fonar" hidden>${SVG.flashOff}</button>
        ${canSwitch ? `<button type="button" class="cc-btn cc-flip" aria-label="Kamerani almashtirish">${SVG.flip}</button>` : ''}
      </div>
      <div class="cc-modes">
        <button type="button" class="cc-mode" data-mode="photo" aria-label="Foto">${SVG.photo}</button>
        <button type="button" class="cc-mode" data-mode="video" aria-label="Video">${SVG.video}</button>
      </div>
      <div class="cc-rec-timer" hidden><span class="cc-rec-dot"></span><span class="cc-rec-time">0:00</span></div>
      <div class="cc-bottom">
        <button type="button" class="cc-shutter" aria-label="Surat / yozish"><span class="cc-shutter-inner"></span></button>
      </div>
    `;
    document.body.appendChild(ov);

    const video = ov.querySelector('.cc-video');
    const flashBtn = ov.querySelector('.cc-flash');
    const modesEl = ov.querySelector('.cc-modes');
    const timerEl = ov.querySelector('.cc-rec-timer');
    const timeTxt = ov.querySelector('.cc-rec-time');
    const shutter = ov.querySelector('.cc-shutter');

    const vTrack = () => stream?.getVideoTracks?.()[0] || null;

    const refreshFlash = () => {
      const t = vTrack();
      const ok = trackSupportsTorch(t);
      flashBtn.hidden = !ok;
      if (!ok) torchOn = false;
      flashBtn.innerHTML = torchOn ? SVG.flashOn : SVG.flashOff;
      flashBtn.classList.toggle('on', torchOn);
    };

    const setStream = async (s, face) => {
      stream = s;
      facing = face;
      video.srcObject = s;
      video.classList.toggle('mirror', face === 'user');
      await video.play().catch(() => {});
      refreshFlash();
    };
    await setStream(stream, facing);

    const syncModeUi = () => {
      modesEl.querySelectorAll('.cc-mode').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === mode);
      });
      shutter.classList.toggle('video-mode', mode === 'video');
      shutter.classList.toggle('recording', recording);
    };
    syncModeUi();

    const switchFacing = async () => {
      if (!canSwitch || recording) return;
      const nextFace = facing === 'user' ? 'environment' : 'user';
      const nextDev = nextFace === 'user' ? cams.front : cams.back;
      try {
        await setTorch(vTrack(), false);
        torchOn = false;
        const s = await _startStream(nextDev?.deviceId, nextFace, mode === 'video');
        stream?.getTracks().forEach(t => t.stop());
        deviceId = nextDev?.deviceId || null;
        await setStream(s, nextFace);
      } catch (err) {
        toast(cameraErrorMsg(err), 'error');
      }
    };

    const switchMode = async (next) => {
      if (recording || next === mode) return;
      mode = next;
      // Video rejimida audio kerak — stream ni yangilash
      try {
        await setTorch(vTrack(), false);
        torchOn = false;
        const s = await _startStream(deviceId, facing, mode === 'video');
        stream?.getTracks().forEach(t => t.stop());
        await setStream(s, facing);
      } catch (err) {
        toast(cameraErrorMsg(err), 'error');
      }
      syncModeUi();
    };

    const stopRecTimer = () => {
      if (recTimer) { clearInterval(recTimer); recTimer = null; }
      timerEl.hidden = true;
    };

    const startRecording = () => {
      if (recording || !stream) return;
      const mime = _pickMime();
      recChunks = [];
      try {
        mediaRec = mime
          ? new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: VIDEO_BITRATE, audioBitsPerSecond: 128000 })
          : new MediaRecorder(stream, { videoBitsPerSecond: VIDEO_BITRATE, audioBitsPerSecond: 128000 });
      } catch (err) {
        try { mediaRec = new MediaRecorder(stream); }
        catch (e2) {
          toast('Video yozib bo\'lmadi', 'error');
          return;
        }
      }
      mediaRec.ondataavailable = e => { if (e.data?.size) recChunks.push(e.data); };
      mediaRec.start(250);
      recording = true;
      recStarted = Date.now();
      timerEl.hidden = false;
      timeTxt.textContent = '0:00';
      recTimer = setInterval(() => {
        const ms = Date.now() - recStarted;
        const s = Math.floor(ms / 1000);
        timeTxt.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
        if (ms >= MAX_VIDEO_MS) {
          stopRecording(false).then(f => { finishRef?.(f); });
        }
      }, 200);
      syncModeUi();
    };

    const stopRecording = (auto = false) => new Promise(resolve => {
      if (!recording || !mediaRec) { resolve(null); return; }
      const rec = mediaRec;
      recording = false;
      stopRecTimer();
      syncModeUi();
      rec.onstop = () => {
        const type = rec.mimeType || 'video/webm';
        const blob = new Blob(recChunks, { type });
        recChunks = [];
        mediaRec = null;
        if (blob.size > MAX_VIDEO_BYTES) {
          toast('Video 30 MB dan oshdi — qisqaroq yozing', 'error');
          resolve(null);
          return;
        }
        if (blob.size < 1000) {
          toast('Video juda qisqa', 'error');
          resolve(null);
          return;
        }
        resolve(_blobToVideoFile(blob));
      };
      try { rec.stop(); } catch (_) { resolve(null); }
    });

    return await new Promise(resolve => {
      const cleanup = () => {
        document.removeEventListener('keydown', onKey, true);
        stopRecTimer();
        try { if (mediaRec && mediaRec.state !== 'inactive') mediaRec.stop(); } catch (_) {}
        try { setTorch(vTrack(), false); } catch (_) {}
        try { stream?.getTracks().forEach(t => t.stop()); } catch (_) {}
        stream = null;
        video.srcObject = null;
        ov.remove();
      };
      const done = file => { finishRef = null; cleanup(); resolve(file || null); };
      finishRef = done;

      const onKey = e => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          if (recording) stopRecording(false).then(f => done(f));
          else done(null);
        }
      };
      document.addEventListener('keydown', onKey, true);

      ov.querySelector('.cc-close').onclick = () => {
        if (recording) stopRecording(false).then(f => done(f));
        else done(null);
      };
      ov.querySelector('.cc-flip')?.addEventListener('click', () => switchFacing());
      flashBtn.addEventListener('click', async () => {
        const t = vTrack();
        if (!trackSupportsTorch(t)) return;
        torchOn = !torchOn;
        const ok = await setTorch(t, torchOn);
        if (!ok) torchOn = false;
        refreshFlash();
      });
      modesEl.addEventListener('click', e => {
        const b = e.target.closest('.cc-mode');
        if (b) switchMode(b.dataset.mode);
      });

      shutter.addEventListener('click', async () => {
        if (mode === 'photo') {
          if (recording) return;
          shutter.classList.add('snap');
          setTimeout(() => shutter.classList.remove('snap'), 180);
          const file = await _capturePhoto(video);
          if (file) done(file);
          else toast('Rasm olinmadi', 'error');
          return;
        }
        // video
        if (!recording) startRecording();
        else {
          const file = await stopRecording(false);
          if (file) done(file);
        }
      });
    });
  } finally {
    _open = false;
  }
}

export { hasCameraDevice };
