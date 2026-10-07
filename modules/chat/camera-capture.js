/* camera-capture.js — SpaceMR kamera: foto/video, review (retake / paperplane send). */
import { toast } from '../ui/toast.js';
import {
  hasCameraDevice, cameraErrorMsg, listCameras,
  trackSupportsTorch, trackMaybeTorch, setTorch, applyTrackAdvanced, waitTrackTorchReady,
} from './camera-access.js';
import {
  MAX_VIDEO_MS, MAX_VIDEO_BYTES, VIDEO_BITRATE, VIDEO_W, VIDEO_H, markVideoReady,
} from '../core/video-policy.js';

let _open = false;

const PHOTO_MAX_SIDE = 1920;
const PHOTO_QUALITY = 0.92;

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

// Video oqimi HAR DOIM ovozsiz — mikrofon alohida (kamera almashganda ovoz uzilmasin)
async function _startStream(deviceId, facing) {
  return navigator.mediaDevices.getUserMedia(_constraints(deviceId, facing, false));
}
async function _startAudio() {
  return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
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

function _capturePhoto(videoEl, digitalZoom = 1) {
  return new Promise(resolve => {
    const vw = videoEl.videoWidth, vh = videoEl.videoHeight;
    if (!vw || !vh) { resolve(null); return; }
    const z = Math.max(1, digitalZoom || 1);
    const sw = vw / z, sh = vh / z, sx = (vw - sw) / 2, sy = (vh - sh) / 2;
    let w = Math.round(sw), h = Math.round(sh);
    const max = PHOTO_MAX_SIDE;
    if (w > max || h > max) {
      if (w >= h) { h = Math.round(h * (max / w)); w = max; }
      else { w = Math.round(w * (max / h)); h = max; }
    }
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(videoEl, sx, sy, sw, sh, 0, 0, w, h);
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
  return markVideoReady(new File([blob], `video_${Date.now()}.${ext}`, { type: blob.type || 'video/webm' }));
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

    facing = 'environment';

    const ov = document.createElement('div');
    ov.id = 'camCapture';
    ov.innerHTML = `
      <video class="cc-video" autoplay muted playsinline disablepictureinpicture></video>
      <canvas class="cc-freeze"></canvas>
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
    const freezeEl = ov.querySelector('.cc-freeze');

    const vTrack = () => stream?.getVideoTracks?.()[0] || null;

    let hasTorchDevice = false;   // qurilmada (biror kamerada) fonar bor — bo'lmasa tugma umuman yo'q
    let canSwitch = false;        // 2+ kamera — bo'lmasa almashtirish tugmasi ham, surish ham yo'q
    const refreshFlash = () => {
      const tr = vTrack();
      const trackOk = trackSupportsTorch(tr);
      const maybe = trackMaybeTorch(tr, facing);
      if (trackOk) hasTorchDevice = true;
      // Faqat ORQA kamera — old kamerada fonar tugmasi YO'Q
      const back = facing === 'environment';
      const show = !reviewing && back;
      flashBtn.hidden = !show;
      if (!back && torchOn) torchOn = false;
      flashBtn.classList.toggle('faded', back && !trackOk && !maybe);
      flashBtn.innerHTML = torchOn ? SVG.flashOn : SVG.flashOff;
      flashBtn.classList.toggle('on', !!torchOn && back);
    };

    /* ── Pinch-to-zoom (2 barmoq) ──
       Qurilma zoom'ni qo'llasa (Android Chrome) — haqiqiy kamera zoom'i (foto ham, video ham).
       Aks holda raqamli zoom: faqat FOTO rejimida (video MediaRecorder orqali stream'dan yoziladi). */
    let zoomLevel = 1, zoomMin = 1, zoomHwMax = 1, zoomHw = false;
    let zoomBusy = false, zoomPending = null, zoomBadgeT = null;
    const zoomMaxNow = () => (zoomHw ? zoomHwMax : (mode === 'photo' ? 4 : 1));
    const zoomBadge = document.createElement('div');
    zoomBadge.className = 'cc-zoom-badge';
    ov.appendChild(zoomBadge);
    const showZoomBadge = () => {
      zoomBadge.textContent = zoomLevel.toFixed(1) + '×';
      zoomBadge.classList.add('show');
      clearTimeout(zoomBadgeT);
      zoomBadgeT = setTimeout(() => zoomBadge.classList.remove('show'), 900);
    };
    const applyZoom = (z) => {
      z = Math.min(zoomMaxNow(), Math.max(zoomMin, z));
      if (z === zoomLevel && !zoomHw) return;
      zoomLevel = z;
      if (zoomHw) {
        zoomPending = z;
        if (!zoomBusy) {
          zoomBusy = true;
          (async () => {
            while (zoomPending != null) {
              const v = zoomPending; zoomPending = null;
              try { await applyTrackAdvanced(vTrack(), { zoom: v }); } catch (_) {}
            }
            zoomBusy = false;
          })();
        }
      } else {
        liveVid.style.setProperty('--cc-zoom', String(z));
      }
      showZoomBadge();
    };
    const initZoom = () => {
      zoomHw = false; zoomMin = 1; zoomHwMax = 1; zoomLevel = 1; zoomPending = null;
      liveVid.style.setProperty('--cc-zoom', '1');
      try {
        const t = vTrack();
        const zc = t?.getCapabilities?.().zoom;
        if (zc && typeof zc.max === 'number' && zc.max > (zc.min || 1)) {
          zoomHw = true; zoomMin = zc.min || 1; zoomHwMax = Math.min(zc.max, 10); zoomLevel = zoomMin;
          applyTrackAdvanced(t, { zoom: zoomMin });
        }
      } catch (_) {}
    };
    const ptrs = new Map();
    let pinch = null;
    const ptrDist = () => { const [a, b] = [...ptrs.values()]; return Math.hypot(a.x - b.x, a.y - b.y) || 1; };
    ov.addEventListener('pointerdown', e => {
      if (reviewing) return;
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size === 2) pinch = { d: ptrDist(), z: zoomLevel };
    });
    ov.addEventListener('pointermove', e => {
      if (!ptrs.has(e.pointerId)) return;
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && ptrs.size >= 2 && !reviewing) applyZoom(pinch.z * ptrDist() / pinch.d);
    });
    const endPtr = e => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null; };
    ov.addEventListener('pointerup', endPtr);
    ov.addEventListener('pointercancel', endPtr);
    ov.addEventListener('gesturestart', e => e.preventDefault());   // iOS Safari sahifa zoom'ini o'chiradi

    const setStream = async (s, face) => {
      stream = s;
      facing = face;
      liveVid.srcObject = s;
      liveVid.classList.toggle('mirror', face === 'user');
      await liveVid.play().catch(() => {});
      initZoom();
      refreshFlash();
      setTimeout(() => { if (stream === s) refreshFlash(); }, 400);
      waitTrackTorchReady(vTrack(), 1000).then(() => { if (stream === s) refreshFlash(); });
    };
    /* ── Mikrofon (alohida oqim) ── */
    let audioStream = null, audioAsk = null;
    const ensureAudio = () => {
      if (audioStream) return Promise.resolve(audioStream);
      if (!audioAsk) {
        audioAsk = _startAudio()
          .then(a => {
            if (mode !== 'video' && !recording) { a.getTracks().forEach(t => t.stop()); return null; }
            audioStream = a; return a;
          })
          .catch(() => { toast("Mikrofonga ruxsat yo'q — video ovozsiz yoziladi", 'error'); return null; })
          .finally(() => { audioAsk = null; });
      }
      return audioAsk;
    };
    const releaseAudio = () => {
      try { audioStream?.getTracks().forEach(t => t.stop()); } catch (_) {}
      audioStream = null;
    };

    /* ── Yozuv pipeline: kamera → canvas → MediaRecorder.
       Kamera almashganda recorder TO'XTAMAYDI: canvas oxirgi kadrni ushlab turadi,
       yangi kamera tayyor bo'lgach kadrlar davom etadi — natija BITTA uzluksiz video. ── */
    const canCanvasRec = typeof HTMLCanvasElement !== 'undefined' && !!HTMLCanvasElement.prototype.captureStream;
    let switchingFace = false;
    let recStarting = false, recRaf = 0, recCanvas = null, recCtx = null, recLastDraw = 0, recOutStream = null;
    const paintRec = () => {
      const v = liveVid;
      if (!recCtx) return;
      // Switching paytida live video tayyor emas — oxirgi kadr (freezeEl) ni chizamiz,
      // shunda MediaRecorder bitta uzluksiz video saqlaydi, qotib qolmaydi.
      if (switchingFace) {
        try {
          if (freezeEl.width && freezeEl.height && freezeEl.classList.contains('show')) {
            const cw = recCanvas.width, ch = recCanvas.height;
            const fw = freezeEl.width, fh = freezeEl.height;
            const sc = Math.max(cw / fw, ch / fh), dw = fw * sc, dh = fh * sc;
            recCtx.drawImage(freezeEl, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
          }
        } catch (_) {}
        return;
      }
      if (v.readyState < 2 || !v.videoWidth) return;
      const cw = recCanvas.width, ch = recCanvas.height, vw = v.videoWidth, vh = v.videoHeight;
      const sc = Math.max(cw / vw, ch / vh), dw = vw * sc, dh = vh * sc;
      recCtx.drawImage(v, (cw - dw) / 2, (ch - dh) / 2, dw, dh);
    };
    const recLoop = ts => {
      recRaf = requestAnimationFrame(recLoop);
      if (ts - recLastDraw < 30) return;   // ~30 fps
      recLastDraw = ts;
      paintRec();
    };
    const buildRecStream = () => {
      const vw = liveVid.videoWidth || VIDEO_W, vh = liveVid.videoHeight || VIDEO_H;
      const k = Math.min(1, Math.max(VIDEO_W, VIDEO_H) / Math.max(vw, vh), Math.min(VIDEO_W, VIDEO_H) / Math.min(vw, vh));
      recCanvas = document.createElement('canvas');
      recCanvas.width = Math.max(2, Math.round(vw * k / 2) * 2);
      recCanvas.height = Math.max(2, Math.round(vh * k / 2) * 2);
      recCtx = recCanvas.getContext('2d', { alpha: false });
      recCtx.fillStyle = '#000';
      recCtx.fillRect(0, 0, recCanvas.width, recCanvas.height);
      paintRec();
      recLastDraw = 0;
      recRaf = requestAnimationFrame(recLoop);
      const out = new MediaStream(recCanvas.captureStream(30).getVideoTracks());
      audioStream?.getAudioTracks().forEach(t => out.addTrack(t));
      return out;
    };
    const teardownRec = () => {
      cancelAnimationFrame(recRaf); recRaf = 0;
      if (canCanvasRec) { try { recOutStream?.getVideoTracks().forEach(t => t.stop()); } catch (_) {} }
      recOutStream = null; recCanvas = null; recCtx = null;
    };

    /* ── Kamerani OCHISH: overlay darhol ko'rinadi, bitta getUserMedia (qayta ochish yo'q) ── */
    try {
      let s0;
      try { s0 = await _startStream(null, 'environment'); }
      catch (e1) {
        if (e1?.name === 'NotAllowedError' || e1?.name === 'SecurityError') throw e1;
        s0 = await _startStream(null, 'user');
      }
      const st0 = s0.getVideoTracks()[0]?.getSettings?.() || {};
      facing = st0.facingMode === 'environment' ? 'environment' : 'user';
      deviceId = st0.deviceId || null;
      await setStream(s0, facing);
    } catch (err) {
      console.error('Kamera xatosi:', err);
      toast(cameraErrorMsg(err), 'error');
      ov.remove();
      return null;
    }
    // Kameralar ro'yxati — fonda (ochilishni kutdirmaydi)
    listCameras().then(c => {
      cams = c;
      canSwitch = !!(c.front && c.back && c.front.deviceId !== c.back.deviceId) || !!(c.list && c.list.length >= 2);
      if (flipBtn) flipBtn.hidden = !canSwitch || reviewing;
      const id = vTrack()?.getSettings?.().deviceId;
      if (id) {
        deviceId = id;
        if (cams.back && id === cams.back.deviceId && facing !== 'environment') { facing = 'environment'; liveVid.classList.remove('mirror'); }
        else if (cams.front && id === cams.front.deviceId && facing !== 'user') { facing = 'user'; liveVid.classList.add('mirror'); }
      }
    }).catch(() => {});
    if (mode === 'video') ensureAudio();

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
        if (flipBtn) flipBtn.hidden = !canSwitch;
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

    /* Kamera almashtirish: oxirgi kadr xira holda ushlab turiladi (qora ekran/uzilish ko'rinmaydi) */
    const freezeFrame = () => {
      try {
        const vw = liveVid.videoWidth, vh = liveVid.videoHeight;
        if (!vw || !vh) return;
        const k = 320 / Math.max(vw, vh);
        freezeEl.width = Math.max(1, Math.round(vw * k));
        freezeEl.height = Math.max(1, Math.round(vh * k));
        freezeEl.getContext('2d').drawImage(liveVid, 0, 0, freezeEl.width, freezeEl.height);
        freezeEl.classList.toggle('mirror', liveVid.classList.contains('mirror'));
        freezeEl.style.setProperty('--cc-zoom', liveVid.style.getPropertyValue('--cc-zoom') || '1');
        freezeEl.classList.add('show');
      } catch (_) {}
    };
    const unfreezeFrame = async () => {
      await new Promise(r => {
        let done = false;
        const fin = () => { if (!done) { done = true; r(); } };
        setTimeout(fin, 900);
        if (liveVid.requestVideoFrameCallback) liveVid.requestVideoFrameCallback(fin);
        else setTimeout(fin, 150);
      });
      freezeEl.classList.remove('show');
    };

    const switchFacing = async (want) => {
      if (reviewing || switchingFace || !stream || !canSwitch) return;
      if (recording && !canCanvasRec) { toast("Yozuv paytida kamerani almashtirib bo'lmaydi", 'error'); return; }
      const nextFace = want || (facing === 'user' ? 'environment' : 'user');
      if (nextFace === facing) return;
      switchingFace = true;
      const nextDev = nextFace === 'user' ? cams.front : cams.back;
      const prevFace = facing, prevDev = deviceId;
      const oldStream = stream;
      freezeFrame();
      if (flipBtn) { flipBtn.classList.remove('spin'); void flipBtn.offsetWidth; flipBtn.classList.add('spin'); }
      try {
        try { await setTorch(vTrack(), false); } catch (_) {}
        torchOn = false;
        // 1) Yangi oqimni AVVAL ochamiz (ba'zi qurilmalar 2 kamera birga ochadi).
        //    Agar xato (busy) — eski oqimni to'xtatib qayta urinadi.
        let s1 = null;
        try {
          s1 = await _startStream(nextDev?.deviceId || null, nextFace);
        } catch (e1) {
          // Ko'pchilik mobil: 2 kamera birga ochilmaydi — eskisini to'xtatib qayta
          try { oldStream?.getTracks().forEach(t => t.stop()); } catch (_) {}
          s1 = await _startStream(nextDev?.deviceId || null, nextFace);
        }
        // 2) Yangi video birinchi kadr chiqsin
        const vt = s1.getVideoTracks()[0];
        deviceId = nextDev?.deviceId || vt?.getSettings?.().deviceId || null;
        liveVid.srcObject = s1;
        liveVid.classList.toggle('mirror', nextFace === 'user');
        await liveVid.play().catch(() => {});
        // Birinchi kadr tayyor bo'lguncha kutamiz (max 1.2s)
        await new Promise(r => {
          let done = false;
          const fin = () => { if (!done) { done = true; r(); } };
          const t = setTimeout(fin, 1200);
          if (liveVid.requestVideoFrameCallback) {
            liveVid.requestVideoFrameCallback(() => { clearTimeout(t); fin(); });
          } else if (vt) {
            const onMute = () => { if (!vt.muted && liveVid.videoWidth) { clearTimeout(t); fin(); } };
            vt.addEventListener('unmute', onMute, { once: true });
            setTimeout(onMute, 80);
          }
        });
        stream = s1;
        facing = nextFace;
        initZoom();
        refreshFlash();
        setTimeout(() => { if (stream === s1) refreshFlash(); }, 400);
        waitTrackTorchReady(vTrack(), 1000).then(() => { if (stream === s1) refreshFlash(); });
        // 3) Eski oqimni endi to'xtatamiz (agar hali ochiq bo'lsa)
        if (oldStream && oldStream !== s1) {
          try { oldStream.getTracks().forEach(t => { if (t.readyState === 'live') t.stop(); }); } catch (_) {}
        }
      } catch (err) {
        toast(cameraErrorMsg(err), 'error');
        try {
          const s2 = await _startStream(prevDev, prevFace);
          deviceId = prevDev;
          await setStream(s2, prevFace);
        } catch (_) {}
      } finally {
        await unfreezeFrame();
        switchingFace = false;
      }
    };

    // Rejim almashtirish: oqim QAYTA OCHILMAYDI (tez va silliq); faqat mikrofon ulanadi/uziladi
    const switchMode = async (next) => {
      if (recording || reviewing || next === mode) return;
      mode = next;
      if (mode === 'video') {
        if (!zoomHw && zoomLevel > 1) applyZoom(1);   // raqamli zoom faqat foto rejimida
        ensureAudio();
      } else {
        releaseAudio();
      }
      syncUi();
    };

    const stopRecTimer = () => {
      if (recTimer) { clearInterval(recTimer); recTimer = null; }
    };

    const startRecording = async () => {
      if (recording || reviewing || !stream || recStarting) return;
      recStarting = true;
      try {
        await ensureAudio();   // allaqachon ochiq bo'lsa — darhol
        if (!stream || reviewing || recording) return;
        recOutStream = canCanvasRec
          ? buildRecStream()
          : new MediaStream([...stream.getVideoTracks(), ...(audioStream ? audioStream.getAudioTracks() : [])]);
        const mime = _pickMime();
        const opts = { videoBitsPerSecond: VIDEO_BITRATE, audioBitsPerSecond: 128000 };
        recChunks = [];
        try {
          mediaRec = mime ? new MediaRecorder(recOutStream, { mimeType: mime, ...opts }) : new MediaRecorder(recOutStream, opts);
        } catch (_) {
          try { mediaRec = new MediaRecorder(recOutStream); }
          catch (e2) { teardownRec(); toast("Video yozib bo'lmadi", 'error'); return; }
        }
        mediaRec.ondataavailable = e => { if (e.data?.size) recChunks.push(e.data); };
        mediaRec.start(250);
        recording = true;
        recStarted = Date.now();
        timeTxt.textContent = '0:00';
        recTimer = setInterval(() => {
          const ms = Date.now() - recStarted;
          const sec = Math.floor(ms / 1000);
          timeTxt.textContent = Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
          if (ms >= MAX_VIDEO_MS) {
            stopRecording().then(f => { if (f) enterReview(f); });
          }
        }, 200);
        syncUi();
      } finally {
        recStarting = false;
      }
    };

    const stopRecording = () => new Promise(resolve => {
      if (!recording || !mediaRec) { resolve(null); return; }
      const rec = mediaRec;
      recording = false;
      stopRecTimer();
      syncUi();
      rec.onstop = () => {
        teardownRec();
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
      try { rec.stop(); } catch (_) { teardownRec(); resolve(null); }
    });

    return await new Promise(resolve => {
      const cleanup = () => {
        document.removeEventListener('keydown', onKey, true);
        stopRecTimer();
        clearPending();
        try { if (mediaRec && mediaRec.state !== 'inactive') mediaRec.stop(); } catch (_) {}
        try { setTorch(vTrack(), false); } catch (_) {}
        teardownRec();
        releaseAudio();
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

      // Chapga surish → orqa kamera, o'ngga surish → old kamera (faqat 2+ kamerali qurilmada)
      let sw = null;
      ov.addEventListener('pointerdown', e => {
        if (sw && e.pointerId !== sw.id) { sw.multi = true; return; }   // 2 barmoq = pinch-zoom
        if (e.target.closest('button, .cc-shutter')) { sw = null; return; }
        sw = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), multi: false };
      });
      ov.addEventListener('pointerup', e => {
        const g = sw;
        if (!g || e.pointerId !== g.id) return;
        sw = null;
        if (g.multi || !canSwitch || reviewing || switchingFace) return;
        const dx = e.clientX - g.x, dy = e.clientY - g.y;
        if (Math.abs(dx) < 70 || Math.abs(dx) < Math.abs(dy) * 1.6 || performance.now() - g.t > 700) return;
        switchFacing(dx < 0 ? 'environment' : 'user');
      });
      ov.addEventListener('pointercancel', () => { sw = null; });

      flashBtn.addEventListener('click', async () => {
        if (reviewing || switchingFace) return;
        let tr = vTrack();
        if (!tr) return;
        let face = facing;
        try {
          const st = tr.getSettings?.() || {};
          if (st.facingMode) face = st.facingMode;
        } catch (_) {}
        if (face !== 'environment' && !trackSupportsTorch(tr)) {
          toast("Fonarni yoqish uchun orqa kameraga o'ting", 'error');
          return;
        }
        if (!trackSupportsTorch(tr)) await waitTrackTorchReady(tr, 600);
        const want = !torchOn;
        let ok = await setTorch(tr, want);
        if (!ok) {
          await new Promise(r => setTimeout(r, 150));
          tr = vTrack();
          ok = await setTorch(tr, want);
        }
        if (!ok) {
          torchOn = false;
          toast("Fonarni yoqib bo'lmadi. Orqa kamera + Chrome (HTTPS) kerak", 'error');
        } else {
          torchOn = want;
          if (want) hasTorchDevice = true;
        }
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
          const file = await _capturePhoto(liveVid, zoomHw ? 1 : zoomLevel);
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
