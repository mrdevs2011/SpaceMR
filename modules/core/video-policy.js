/**
 * SpaceMR VIDEO SIYOSATI — kamera mantig'i bilan bir xil (yagona manba).
 *
 * Har qanday video (kamera orqali olinganmi, galereyadan yuklanganmi, 4K/240fps bo'lsa ham)
 * story va postga FAQAT shu standartga keltirilgandan keyin chiqadi:
 *   - davomiyligi 1 daqiqadan oshmaydi (uzunroq bo'lsa dastlabki 60 soniya olinadi)
 *   - eng ko'pi 1920x1080 chegarasida (portret bo'lsa 1080x1920), 30 fps
 *   - video 4.5 Mbps, audio 128 kbps
 *   - fayl 30 MB dan oshmaydi
 * Kamera yozgan fayllar allaqachon shu standartda — markVideoReady() bilan belgilanadi
 * va qayta kodlanmaydi. Boshqa har qanday video prepareVideo() orqali qayta kodlanadi.
 */

export const MAX_VIDEO_MS = 60_000;
export const MAX_VIDEO_BYTES = 30 * 1024 * 1024;
export const VIDEO_BITRATE = 3_000_000;
export const AUDIO_BITRATE = 128_000;
export const VIDEO_W = 1920;
export const VIDEO_H = 1080;
export const VIDEO_FPS = 30;

const _ready = new WeakSet();

/** Fayl siyosatga mos (kamera yozgan yoki prepareVideo chiqargan) deb belgilanadi. */
export function markVideoReady(file) {
  if (file) _ready.add(file);
  return file;
}
export function isVideoReady(file) { return !!file && _ready.has(file); }

export function pickVideoMime() {
  // VP8 eng barqaror progressive o'ynash uchun; VP9 og'irroq (yarimdan keyin qotishi mumkin)
  const cands = [
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp8',
    'video/webm;codecs=vp9,opus',
    'video/webm',
    'video/mp4',
  ];
  for (const m of cands) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(m)) return m;
  }
  return '';
}

function _el(file) {
  const url = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.preload = 'auto';
  v.playsInline = true;
  v.setAttribute('playsinline', '');
  v.style.cssText = 'position:fixed;left:-9999px;top:0;width:2px;height:2px;opacity:0;pointer-events:none';
  v.src = url;
  document.body.appendChild(v);
  const dispose = () => { try { v.pause(); } catch (_) {} v.remove(); try { URL.revokeObjectURL(url); } catch (_) {} };
  return { v, dispose };
}

function _waitMeta(v, ms = 20000) {
  return new Promise((res, rej) => {
    if (v.readyState >= 1 && v.videoWidth) return res();
    const t = setTimeout(() => rej(new Error("Videoni o'qib bo'lmadi")), ms);
    v.addEventListener('loadedmetadata', () => { clearTimeout(t); res(); }, { once: true });
    v.addEventListener('error', () => { clearTimeout(t); rej(new Error("Bu video formatini o'qib bo'lmadi")); }, { once: true });
  });
}

/** Video metadatasi: davomiylik (s), kenglik, balandlik. */
export async function probeVideo(file) {
  const { v, dispose } = _el(file);
  try {
    await _waitMeta(v);
    let d = v.duration;
    // MediaRecorder webm fayllarida duration = Infinity bo'lishi mumkin
    if (!isFinite(d)) {
      d = await new Promise(res => {
        const t = setTimeout(() => res(Infinity), 4000);
        v.addEventListener('durationchange', () => { if (isFinite(v.duration)) { clearTimeout(t); res(v.duration); } });
        v.currentTime = 1e7;
      });
    }
    return { duration: d, width: v.videoWidth, height: v.videoHeight };
  } finally { dispose(); }
}

function _fit(sw, sh) {
  const s = Math.min(1, VIDEO_W / Math.max(sw, sh), VIDEO_H / Math.min(sw, sh));
  const even = n => Math.max(2, Math.round(n * s) & ~1);
  return { w: even(sw), h: even(sh) };
}

async function _transcode(file, meta, onProgress) {
  if (typeof MediaRecorder === 'undefined') throw new Error('MediaRecorder yo\'q');
  const mime = pickVideoMime();
  const { v, dispose } = _el(file);
  let ac = null, timer = null, rec = null;
  try {
    await _waitMeta(v);
    const { w, h } = _fit(v.videoWidth, v.videoHeight);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { alpha: false });
    const vstream = canvas.captureStream(VIDEO_FPS);

    // Audio: MediaElementSource → MediaStreamDestination (dinamikka chiqmaydi, jim yoziladi)
    let atrack = null;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      ac = new AC();
      const src = ac.createMediaElementSource(v);
      const dest = ac.createMediaStreamDestination();
      src.connect(dest);
      atrack = dest.stream.getAudioTracks()[0] || null;
      if (ac.state === 'suspended') await ac.resume().catch(() => {});
    } catch (_) { atrack = null; }

    const out = new MediaStream([...vstream.getVideoTracks(), ...(atrack ? [atrack] : [])]);
    const opts = { videoBitsPerSecond: VIDEO_BITRATE, audioBitsPerSecond: AUDIO_BITRATE };
    if (mime) opts.mimeType = mime;
    rec = new MediaRecorder(out, opts);
    const chunks = [];
    rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };

    const total = Math.min(isFinite(meta?.duration) ? meta.duration : MAX_VIDEO_MS / 1000, MAX_VIDEO_MS / 1000);
    let truncated = isFinite(meta?.duration) ? meta.duration > MAX_VIDEO_MS / 1000 + 0.25 : false;

    const done = new Promise((res, rej) => {
      rec.onstop = () => res();
      rec.onerror = e => rej(e?.error || new Error('Yozish xatosi'));
    });

    v.currentTime = 0;
    v.muted = false;
    try { await v.play(); }
    catch (_) { v.muted = true; await v.play(); }
    // 500ms timeslice — WebM cluster/keyframe tez-tez; seek va yarimdan keyin qotish kamayadi
    rec.start(500);

    let stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true;
      try { if (rec.state !== 'inactive') rec.stop(); } catch (_) {}
    };
    const t0 = performance.now();
    // rAF — silliq kadr; setInterval FPS tashlab yuborishi mumkin edi
    const tick = () => {
      if (stopped) return;
      try { ctx.drawImage(v, 0, 0, w, h); } catch (_) {}
      const cur = v.currentTime;
      if (onProgress) onProgress(Math.min(1, cur / (total || 1)));
      if (cur * 1000 >= MAX_VIDEO_MS) { truncated = true; stop(); return; }
      if (v.ended) { stop(); return; }
      if (performance.now() - t0 > MAX_VIDEO_MS + 15000) { truncated = true; stop(); return; }
      timer = requestAnimationFrame(tick);
    };
    timer = requestAnimationFrame(tick);
    v.addEventListener('ended', stop, { once: true });

    await done;
    try { cancelAnimationFrame(timer); } catch (_) {}
    timer = null;
    const blob = new Blob(chunks, { type: (rec.mimeType || mime || 'video/webm').split(';')[0] });
    if (!blob.size) throw new Error('Bo\'sh natija');
    if (blob.size > MAX_VIDEO_BYTES) throw new Error('Video 30 MB dan oshdi — qisqaroq video tanlang');
    const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
    const outFile = new File([blob], `video_${Date.now()}.${ext}`, { type: blob.type });
    return { file: markVideoReady(outFile), truncated, width: w, height: h };
  } finally {
    if (timer) { try { cancelAnimationFrame(timer); } catch (_) { try { clearInterval(timer); } catch (_) {} } }
    try { if (rec && rec.state !== 'inactive') rec.stop(); } catch (_) {}
    try { ac && ac.close(); } catch (_) {}
    dispose();
  }
}

/**
 * Har qanday videoni kamera standartiga keltiradi.
 * @returns {Promise<{file: File, truncated: boolean, width: number, height: number}>}
 * @throws Error (foydalanuvchiga ko'rsatiladigan matn bilan)
 */

/**
 * MediaRecorder WebM da duration ko\'pincha Infinity.
 * Chrome texnikasi: currentTime ni juda katta qiymatga qo\'yib durationchange kutamiz,
 * keyin boshiga qaytaramiz. Natija: progress/seek to\'g\'ri ishlaydi.
 * @param {HTMLVideoElement} v
 * @returns {Promise<number>} finite sekund yoki 0
 */
export function fixVideoDuration(v) {
  if (!v) return Promise.resolve(0);
  if (isFinite(v.duration) && v.duration > 0) return Promise.resolve(v.duration);
  return new Promise((resolve) => {
    let done = false;
    const wasPaused = v.paused;
    const savedTime = isFinite(v.currentTime) ? v.currentTime : 0;
    try { if (!wasPaused) v.pause(); } catch (_) {}

    const finish = (d) => {
      if (done) return;
      done = true;
      v.removeEventListener('durationchange', onChange);
      clearTimeout(timer);
      const sec = isFinite(d) && d > 0 ? d : 0;
      const target = (savedTime > 0.05 && sec > 0 && savedTime < sec) ? savedTime : 0;

      const restorePlay = () => {
        try { if (!wasPaused && sec > 0) v.play().catch(() => {}); } catch (_) {}
        resolve(sec);
      };

      // 1e101 seek dan keyin currentTime oxirida qoladi — progress 100% da qotadi.
      // seeked ni kutib boshiga (yoki oldingi vaqtga) qaytaramiz.
      const resetTime = () => {
        try {
          if (Math.abs((v.currentTime || 0) - target) <= 0.08) {
            restorePlay();
            return;
          }
          let settled = false;
          const onSeeked = () => {
            if (settled) return;
            settled = true;
            v.removeEventListener('seeked', onSeeked);
            restorePlay();
          };
          v.addEventListener('seeked', onSeeked);
          v.currentTime = target;
          setTimeout(() => {
            if (settled) return;
            settled = true;
            v.removeEventListener('seeked', onSeeked);
            try { v.currentTime = target; } catch (_) {}
            restorePlay();
          }, 450);
        } catch (_) {
          restorePlay();
        }
      };
      resetTime();
    };

    const onChange = () => {
      if (isFinite(v.duration) && v.duration > 0) finish(v.duration);
    };
    v.addEventListener('durationchange', onChange);
    const timer = setTimeout(() => finish(v.duration), 2500);
    try {
      v.currentTime = 1e101;
    } catch (_) {
      finish(v.duration);
    }
  });
}

/** Video elementga bir marta duration fix — progress oxirida qotib qolmasin. */
export function ensureVideoDuration(v) {
  if (!v || v.dataset.durFixed === '1') return;
  const run = () => {
    if (v.dataset.durFixed === '1') return;
    if (isFinite(v.duration) && v.duration > 0) { v.dataset.durFixed = '1'; return; }
    // Ijro paytida 1e101 seek — decoder qotadi; faqat pauzada tuzatamiz
    if (!v.paused && !v.ended) {
      const onPause = () => { v.removeEventListener('pause', onPause); run(); };
      v.addEventListener('pause', onPause);
      return;
    }
    fixVideoDuration(v).then((d) => {
      if (d > 0) v.dataset.durFixed = '1';
      try { v.dispatchEvent(new Event('durationchange')); } catch (_) {}
    });
  };
  if (v.readyState >= 1) run();
  else v.addEventListener('loadedmetadata', run, { once: true });
}

/** stalled/waiting — buffer to'lguncha kutib davom ettirish */
export function hardenVideoPlayback(v) {
  if (!v || v.dataset.playHardened === '1') return;
  v.dataset.playHardened = '1';
  let resumeT = 0;
  const softResume = () => {
    clearTimeout(resumeT);
    resumeT = setTimeout(() => {
      if (v.paused || v.ended) return;
      try {
        if (v.readyState < 2) {
          const t = v.currentTime;
          // kichik seek decoder ni uyg'otadi (WebM keyframe)
          if (t > 0.15) {
            v.currentTime = Math.max(0, t - 0.05);
          }
        }
        v.play().catch(() => {});
      } catch (_) {}
    }, 280);
  };
  v.addEventListener('waiting', softResume);
  v.addEventListener('stalled', softResume);
  // Prefetch: metadata emas — avvalgi buffer
  try {
    if (v.preload === 'metadata' || !v.preload) v.preload = 'auto';
  } catch (_) {}
}

export async function prepareVideo(file, { onProgress } = {}) {
  if (isVideoReady(file)) {
    return { file, truncated: false, width: null, height: null };
  }
  let meta = null;
  try { meta = await probeVideo(file); } catch (e) { throw new Error(e?.message || "Videoni o'qib bo'lmadi"); }
  try {
    return await _transcode(file, meta, onProgress);
  } catch (e) {
    // Qayta kodlash ishlamasa — faqat asl fayl allaqachon standartga mos bo'lsa (metadata bo'yicha) o'tkazamiz
    const ok = isFinite(meta.duration) && meta.duration <= MAX_VIDEO_MS / 1000 + 0.25
      && file.size <= MAX_VIDEO_BYTES
      && Math.max(meta.width, meta.height) <= VIDEO_W && Math.min(meta.width, meta.height) <= VIDEO_H;
    if (ok) return { file: markVideoReady(file), truncated: false, width: meta.width, height: meta.height };
    console.warn('[video] qayta kodlanmadi:', e?.message || e);
    throw new Error(e?.message && /MB|oshdi/.test(e.message) ? e.message : "Videoni 1 daqiqa / 1080p standartiga keltirib bo'lmadi");
  }
}
