/* camera-capture.js — SpaceMR kamera: foto/video, review (retake / paperplane send). */
import { toast } from '../ui/toast.js';
import {
  hasCameraDevice, cameraErrorMsg, listCameras,
  trackSupportsTorch, setTorch,
} from './camera-access.js';

let _open = false;

const MAX_VIDEO_MS = 60_000;
const MAX_VIDEO_BYTES = 30 * 1024 * 1024;
const VIDEO_BITRATE = 2_500_000;
const VIDEO_W = 1280;
const VIDEO_H = 720;
const PHOTO_MAX_SIDE = 1920;
const PHOTO_QUALITY = 0.85;

const SVG = {
  close: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  flip: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10"/><path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14"/></svg>',  flashOn: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M7 2v11h3v9l7-12h-4l4-8z"/></svg>',
  flashOff: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M7 2v11h3v9l7-12h-4l4-8z"/><path d="M4 4l16 16"/></svg>',
  photo: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7h-3l-1.5-2h-7L7 7H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  video: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="14" height="12" rx="2"/><path d="M16 10l6-3v10l-6-3z"/></svg>',
  retake: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  send: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M3.4 20.6L21 12 3.4 3.4l.1 6.8L15 12 3.5 13.8z"/></svg>',
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

function _capturePhoto(videoEl) {
  return new Promise(resolve => {
    const vw = videoEl.videoWidth, vh = videoEl.videoHeight;
    if (!vw || !vh) { resolve(null); return; }
    let w = vw, h = vh;
    const max = PHOTO_MAX_SIDE;
    if (w > max || h > max) {
      if (w >= h) { h = Math.round(h * (max / w)); w = max; }
      else { w = Math.round(w * (max / h)); h = max; }
    }
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(videoEl, 0, 0, w, h);
    c.toBlob(
      b => resolve(b ? new File([b], `photo_${Date.now()}.jpg`, { type: 'image/jpeg' }) : null),
      'image/jpeg',
      PHOTO_QUALITY
    );
  });
}

function _blobToVideoFile(blob) {
  if (!blob || !blob.size) return null;
  const ext = (blob.type || '').includes('mp4') ? 'mp4' : 'webm';
  return new File([blob], `video_${Date.now()}.${ext}`, { type: blob.type || 'video/webm' });
}

export async function openCameraCapture(options = {}) {
  if (_open) return null;
  _open = true;

  let stream = null;
  let facing = 'user';
  let deviceId = null;
  let mode = options.mode === 'video' ? 'video' : 'photo';
  let torchOn = false;
  let recording = false;
  let reviewing = false;
  let pendingFile = null;
  let pendingUrl = null;
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

    try {
      stream = await _startStream(null, facing, mode === 'video');
    } catch (err) {
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
    if (cams.front && !cams.back) {
      facing = 'user'; deviceId = cams.front.deviceId;
    } else if (cams.back && !cams.front) {
      facing = 'environment'; deviceId = cams.back.deviceId;
    } else if (cams.front && cams.back) {
      facing = 'environment'; deviceId = cams.back.deviceId;
    }
    if (deviceId) {
      try {
        stream.getTracks().forEach(t => t.stop());
        stream = await _startStream(deviceId, facing, mode === 'video');
      } catch (_) {}
    }

    const canSwitch = !!(cams.front && cams.back && cams.front.deviceId !== cams.back.deviceId)
      || (cams.list && cams.list.length >= 2);

    const ov = document.createElement('div');
    ov.id = 'camCapture';
    ov.innerHTML = `
      <video class="cc-video" autoplay muted playsinline></video>
      <img class="cc-preview-img" alt="" hidden>
      <video class="cc-preview-vid" playsinline controls hidden></video>
      <div class="cc-top">
        <button type="button" class="cc-btn cc-close" aria-label="Yopish">${SVG.close}</button>
        <div class="cc-top-center">
          <div class="cc-modes">
            <button type="button" class="cc-mode" data-mode="photo" aria-label="Foto">${SVG.photo}</button>
            <button type="button" class="cc-mode" data-mode="video" aria-label="Video">${SVG.video}</button>
          </div>
          <div class="cc-rec-timer" hidden><span class="cc-rec-dot"></span><span class="cc-rec-time">0:00</span></div>
        </div>
        <div class="cc-top-right">
          <button type="button" class="cc-btn cc-flip" aria-label="Kamerani almashtirish">${SVG.flip}</button>
          <button type="button" class="cc-btn cc-flash" aria-label="Fonar" hidden>${SVG.flashOff}</button>
        </div>
      </div>
      <div class="cc-bottom">
        <button type="button" class="cc-shutter" aria-label="Surat / yozish"><span class="cc-shutter-inner"></span></button>
        <div class="cc-review" hidden>
          <button type="button" class="cc-btn cc-retake" aria-label="Qayta olish">${SVG.retake}</button>
          <button type="button" class="cc-btn cc-send" aria-label="Yuborish">${SVG.send}</button>
        </div>
      </div>
    `;
    document.body.appendChild(ov);

    const liveVid = ov.querySelector('.cc-video');
    const prevImg = ov.querySelector('.cc-preview-img');
    const prevVid = ov.querySelector('.cc-preview-vid');
    const flashBtn = ov.querySelector('.cc-flash');
    const closeBtn = ov.querySelector('.cc-close');
    const modesEl = ov.querySelector('.cc-modes');
    const timerEl = ov.querySelector('.cc-rec-timer');
    const timeTxt = ov.querySelector('.cc-rec-time');
    const shutter = ov.querySelector('.cc-shutter');
    const reviewEl = ov.querySelector('.cc-review');
    const flipBtn = ov.querySelector('.cc-flip');

    const vTrack = () => stream?.getVideoTracks?.()[0] || null;

    const refreshFlash = () => {
      const t = vTrack();
      const ok = trackSupportsTorch(t) && !reviewing;
      flashBtn.hidden = !ok;
      if (!ok) torchOn = false;
      flashBtn.innerHTML = torchOn ? SVG.flashOn : SVG.flashOff;
      flashBtn.classList.toggle('on', torchOn);
    };

    const setStream = async (s, face) => {
      stream = s;
      facing = face;
      liveVid.srcObject = s;
      liveVid.classList.toggle('mirror', face === 'user');
      await liveVid.play().catch(() => {});
      refreshFlash();
    };
    await setStream(stream, facing);

    const clearPending = () => {
      if (pendingUrl) { try { URL.revokeObjectURL(pendingUrl); } catch (_) {} }
      pendingUrl = null;
      pendingFile = null;
      prevImg.hidden = true;
      prevImg.removeAttribute('src');
      prevVid.hidden = true;
      prevVid.removeAttribute('src');
      prevVid.pause();
    };

    const syncUi = () => {
      modesEl.querySelectorAll('.cc-mode').forEach(b => {
        b.classList.toggle('active', b.dataset.mode === mode);
      });
      shutter.classList.toggle('video-mode', mode === 'video');
      shutter.classList.toggle('recording', recording);
      ov.classList.toggle('is-recording', recording);
      ov.classList.toggle('is-review', reviewing);

      // top X: yozishda yashirin; live + review da ko'rinadi
      closeBtn.hidden = recording || reviewing;

      if (recording) {
        modesEl.setAttribute('hidden', '');
        timerEl.removeAttribute('hidden');
      } else if (reviewing) {
        modesEl.setAttribute('hidden', '');
        timerEl.setAttribute('hidden', '');
      } else {
        timerEl.setAttribute('hidden', '');
        modesEl.removeAttribute('hidden');
      }

      if (reviewing) {
        shutter.setAttribute('hidden', '');
        reviewEl.removeAttribute('hidden');
        liveVid.hidden = true;
        if (flipBtn) flipBtn.hidden = true;
        flashBtn.hidden = true;
      } else {
        reviewEl.setAttribute('hidden', '');
        shutter.removeAttribute('hidden');
        liveVid.hidden = false;
        if (flipBtn) flipBtn.hidden = false;
        refreshFlash();
      }
    };
    syncUi();

    const enterReview = (file) => {
      if (!file) return;
      clearPending();
      pendingFile = file;
      pendingUrl = URL.createObjectURL(file);
      reviewing = true;
      recording = false;
      if (file.type.startsWith('video/')) {
        prevVid.src = pendingUrl;
        prevVid.hidden = false;
        prevVid.play().catch(() => {});
      } else {
        prevImg.src = pendingUrl;
        prevImg.hidden = false;
      }
      try { setTorch(vTrack(), false); } catch (_) {}
      torchOn = false;
      // live stream pause tracks optional — keep for retake speed
      syncUi();
    };

    const exitReview = () => {
      clearPending();
      reviewing = false;
      syncUi();
      liveVid.play().catch(() => {});
    };

    const switchFacing = async () => {
      if (recording || reviewing) return;
      const nextFace = facing === 'user' ? 'environment' : 'user';
      const nextDev = nextFace === 'user' ? cams.front : cams.back;
      try {
        await setTorch(vTrack(), false);
        torchOn = false;
        const s = await _startStream(nextDev?.deviceId || null, nextFace, mode === 'video');
        stream?.getTracks().forEach(t => t.stop());
        deviceId = nextDev?.deviceId || null;
        await setStream(s, nextFace);
      } catch (err) {
        toast(cameraErrorMsg(err), 'error');
      }
    };

    const switchMode = async (next) => {
      if (recording || reviewing || next === mode) return;
      mode = next;
      try {
        await setTorch(vTrack(), false);
        torchOn = false;
        const s = await _startStream(deviceId, facing, mode === 'video');
        stream?.getTracks().forEach(t => t.stop());
        await setStream(s, facing);
      } catch (err) {
        toast(cameraErrorMsg(err), 'error');
      }
      syncUi();
    };

    const stopRecTimer = () => {
      if (recTimer) { clearInterval(recTimer); recTimer = null; }
    };

    const startRecording = () => {
      if (recording || reviewing || !stream) return;
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
      timeTxt.textContent = '0:00';
      recTimer = setInterval(() => {
        const ms = Date.now() - recStarted;
        const s = Math.floor(ms / 1000);
        timeTxt.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
        if (ms >= MAX_VIDEO_MS) {
          stopRecording().then(f => { if (f) enterReview(f); });
        }
      }, 200);
      syncUi();
    };

    const stopRecording = () => new Promise(resolve => {
      if (!recording || !mediaRec) { resolve(null); return; }
      const rec = mediaRec;
      recording = false;
      stopRecTimer();
      syncUi();
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
        clearPending();
        try { if (mediaRec && mediaRec.state !== 'inactive') mediaRec.stop(); } catch (_) {}
        try { setTorch(vTrack(), false); } catch (_) {}
        try { stream?.getTracks().forEach(t => t.stop()); } catch (_) {}
        stream = null;
        liveVid.srcObject = null;
        ov.remove();
      };
      const done = file => { finishRef = null; cleanup(); resolve(file || null); };
      finishRef = done;

      const onKey = e => {
        if (e.key !== 'Escape') return;
        e.stopPropagation();
        if (recording) {
          stopRecording().then(f => { if (f) enterReview(f); });
        } else if (reviewing) {
          exitReview();
        } else {
          done(null);
        }
      };
      document.addEventListener('keydown', onKey, true);

      closeBtn.onclick = () => {
        if (recording) return; // yozishda X yo'q
        if (reviewing) { exitReview(); return; }
        done(null);
      };

      flipBtn?.addEventListener('click', () => switchFacing());
      flashBtn.addEventListener('click', async () => {
        if (reviewing || recording) return;
        const t = vTrack();
        if (!trackSupportsTorch(t)) return;
        torchOn = !torchOn;
        const ok = await setTorch(t, torchOn);
        if (!ok) torchOn = false;
        refreshFlash();
      });
      modesEl.addEventListener('click', e => {
        const b = e.target.closest('.cc-mode');
        if (b && !recording && !reviewing) switchMode(b.dataset.mode);
      });

      ov.querySelector('.cc-retake').onclick = () => exitReview();
      ov.querySelector('.cc-send').onclick = () => {
        if (pendingFile) done(pendingFile);
      };

      // Shutter: tap = foto / video toggle; 2s hold (photo) = video mode + start, release does not stop
      let holdTimer = null;
      let holdFired = false;
      let ignoreNextClick = false;

      const clearHold = () => {
        if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
      };

      const onShutterDown = (e) => {
        if (reviewing || recording) return;
        if (e.button != null && e.button !== 0) return;
        holdFired = false;
        clearHold();
        if (mode !== 'photo') return;
        holdTimer = setTimeout(async () => {
          holdTimer = null;
          holdFired = true;
          ignoreNextClick = true;
          // long-press: switch to video + start recording (release will not stop)
          try {
            if (mode !== 'video') await switchMode('video');
            startRecording();
          } catch (_) {}
        }, 2000);
      };

      const onShutterUp = () => {
        clearHold();
      };

      shutter.addEventListener('pointerdown', onShutterDown);
      shutter.addEventListener('pointerup', onShutterUp);
      shutter.addEventListener('pointerleave', onShutterUp);
      shutter.addEventListener('pointercancel', onShutterUp);

      shutter.addEventListener('click', async () => {
        if (ignoreNextClick) { ignoreNextClick = false; return; }
        if (reviewing) return;
        if (holdFired) { holdFired = false; return; }
        if (mode === 'photo') {
          if (recording) return;
          shutter.classList.add('snap');
          setTimeout(() => shutter.classList.remove('snap'), 180);
          const file = await _capturePhoto(liveVid);
          if (file) enterReview(file);
          else toast('Rasm olinmadi', 'error');
          return;
        }
        if (!recording) startRecording();
        else {
          const file = await stopRecording();
          if (file) enterReview(file);
        }
      });
    });
  } finally {
    _open = false;
  }
}

export { hasCameraDevice };
