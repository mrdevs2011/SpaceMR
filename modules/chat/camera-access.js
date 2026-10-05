/* camera-access.js — kamera/mikrofon yordamchilari (attach + rolik).
   Ruxsat rad etilishi eslab qolinmaydi — har bosishda getUserMedia yangidan. */

/**
 * Qurilmadagi audio/video inputlarni aniqlash (jismoniy qurilma taxmini).
 * - secure context bo'lmasa → yo'q
 * - enumerateDevices: audioinput / videoinput bor-yo'qligi
 * Ruxsat berilmaguncha label bo'sh bo'lishi mumkin, lekin kind odatda bor.
 * @returns {Promise<{ mic: boolean, cam: boolean, micCount: number, camCount: number }>}
 */
export async function probeInputDevices() {
  const out = { mic: false, cam: false, micCount: 0, camCount: 0 };
  try {
    if (!window.isSecureContext) return out;
    if (!navigator.mediaDevices?.enumerateDevices) return out;
    const list = await navigator.mediaDevices.enumerateDevices();
    const mics = list.filter(d => d.kind === 'audioinput');
    const cams = list.filter(d => d.kind === 'videoinput');
    out.micCount = mics.length;
    out.camCount = cams.length;
    // deviceId bo'sh bo'lsa ham (ruxsat oldin) kind mavjudligi — qurilma borligiga ishora
    out.mic = mics.length > 0;
    out.cam = cams.length > 0;
  } catch (_) {}
  return out;
}

/** Qurilmada kamera (videoinput) bormi. */
export async function hasCameraDevice() {
  const p = await probeInputDevices();
  return p.cam;
}

export function mediaErrorKind(err) {
  const name = err?.name || '';
  const msg = (err?.message || '').toLowerCase();
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || msg.includes('not found') || msg.includes('no device')) return 'notfound';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotReadableError' || name === 'TrackStartError' || msg.includes('in use') || msg.includes('busy')) return 'busy';
  return 'other';
}

export function cameraErrorMsg(err) {
  const k = mediaErrorKind(err);
  if (k === 'notfound') return 'Kamera topilmadi';
  if (k === 'busy') return 'Kamera boshqa dasturda band';
  if (k === 'denied') return 'Kameraga ruxsat berilmadi. Qayta bossangiz yana so\'raladi (bloklangan bo\'lsa — manzil qatoridagi qulf orqali yoqing)';
  return 'Kamerani ochib bo\'lmadi';
}

/** facing: 'user' | 'environment' | null (aniqlanmagan) */
function _guessFacing(device) {
  const label = (device.label || '').toLowerCase();
  if (/front|user|face|selfie|ön|old/.test(label)) return 'user';
  if (/back|rear|environment|world|orqa|arka|arkadaki/.test(label)) return 'environment';
  return null;
}

/**
 * Kameralarni aniqlash. Avval getUserMedia ruxsati kerak (label bo'sh bo'lmasligi uchun).
 * @returns {{ front: MediaDeviceInfo|null, back: MediaDeviceInfo|null, list: MediaDeviceInfo[] }}
 */
export async function listCameras() {
  const empty = { front: null, back: null, list: [] };
  try {
    if (!navigator.mediaDevices?.enumerateDevices) return empty;
    const all = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput');
    let front = null, back = null;
    for (const d of all) {
      const f = _guessFacing(d);
      if (f === 'user' && !front) front = d;
      if (f === 'environment' && !back) back = d;
    }
    // Label aniq bo'lmasa: 2+ kamera → birinchi front, ikkinchi back deb taxmin
    if (all.length >= 2 && !front && !back) {
      front = all[0];
      back = all[1];
    } else if (all.length === 1) {
      // Bitta kamera — front deb olamiz (switch yo'q)
      front = front || all[0];
    } else {
      // Ba'zilarida faqat biri label bilan
      if (!front && !back && all.length) front = all[0];
      if (front && !back) {
        back = all.find(d => d.deviceId !== front.deviceId) || null;
      }
      if (back && !front) {
        front = all.find(d => d.deviceId !== back.deviceId) || null;
      }
    }
    return { front, back, list: all };
  } catch (_) {
    return empty;
  }
}

/** Track torch (fonar) qo'llab-quvvatlaydimi */
export function trackSupportsTorch(track) {
  try {
    if (!track || track.readyState !== 'live') return false;
    const caps = track.getCapabilities?.() || {};
    if ('torch' in caps) return !!caps.torch;
    const fl = caps.fillLightMode;
    if (Array.isArray(fl) && (fl.includes('torch') || fl.includes('flash'))) return true;
  } catch (_) {}
  return false;
}

/** Orqa kamera + live — capabilities kechiksa ham urinishga ruxsat */
export function trackMaybeTorch(track, facingHint) {
  if (trackSupportsTorch(track)) return true;
  try {
    const face = facingHint || track?.getSettings?.()?.facingMode;
    if (face === 'environment' && track?.readyState === 'live') return true;
  } catch (_) {}
  return false;
}

/* applyConstraints oldingi advanced ni ALMASHTIRADI — zoom+torch birga saqlanadi */
const _adv = new WeakMap();
export async function applyTrackAdvanced(track, patch) {
  if (!track || track.readyState !== 'live') return false;
  const cur = { ...(_adv.get(track) || {}), ...patch };
  // null/undefined ni olib tashlash
  for (const k of Object.keys(cur)) if (cur[k] == null) delete cur[k];
  const advanced = Object.keys(cur).map(k => ({ [k]: cur[k] }));
  if (!advanced.length) return true;
  for (let i = 0; i < 2; i++) {
    try {
      await track.applyConstraints({ advanced });
      _adv.set(track, cur);
      return true;
    } catch (err) {
      console.warn('[camera] applyConstraints:', err?.name, err?.message);
      if (i === 0) await new Promise(r => setTimeout(r, 120));
    }
  }
  return false;
}

function _torchSettings(track) {
  try { return track.getSettings?.() || {}; } catch (_) { return {}; }
}

function _torchVerified(track, want) {
  const st = _torchSettings(track);
  if ('torch' in st) return st.torch === want;
  // settings da torch yo'q — ba'zi Android applyConstraints throw qilmasa ham ishlaydi
  return null; // noma'lum
}

/**
 * Fonarni yoqish/o'chirish — bir necha usul (Chrome Android, WebView).
 * @returns {Promise<boolean>}
 */
export async function setTorch(track, on) {
  if (!track || track.readyState !== 'live') return false;
  const want = !!on;
  const prev = _adv.get(track) || {};
  const zoom = prev.zoom;

  const attempts = [];

  // 1) Faqat torch (advanced) — eng ishonchli Chrome Android
  attempts.push(async () => {
    await track.applyConstraints({ advanced: [{ torch: want }] });
  });
  // 2) To'g'ridan-to'g'ri
  attempts.push(async () => {
    await track.applyConstraints({ torch: want });
  });
  // 3) Zoom bilan birga (oldingi zoom yo'qolmasin)
  if (zoom != null) {
    attempts.push(async () => {
      await track.applyConstraints({ advanced: [{ torch: want }, { zoom }] });
    });
  }
  // 4) ImageCapture fillLightMode (ba'zi qurilmalar)
  attempts.push(async () => {
    if (typeof ImageCapture === 'undefined') throw new Error('no ImageCapture');
    const ic = new ImageCapture(track);
    if (typeof ic.setOptions !== 'function') throw new Error('no setOptions');
    await ic.setOptions({ fillLightMode: want ? 'torch' : 'off' });
  });

  for (let i = 0; i < attempts.length; i++) {
    try {
      await attempts[i]();
      await new Promise(r => setTimeout(r, 40));
      const v = _torchVerified(track, want);
      if (v === false) continue; // aniq ishlamadi — keyingi usul
      _adv.set(track, { ...prev, torch: want, ...(zoom != null ? { zoom } : {}) });
      return true;
    } catch (err) {
      console.warn('[setTorch] usul', i + 1, err?.name || err?.message || err);
    }
  }
  return false;
}

/** Track tayyor bo'lgach capabilities qayta o'qish (kechikish) */
export function waitTrackTorchReady(track, ms = 800) {
  return new Promise(resolve => {
    if (!track) { resolve(false); return; }
    const t0 = Date.now();
    const tick = () => {
      if (trackSupportsTorch(track)) { resolve(true); return; }
      if (Date.now() - t0 >= ms) { resolve(trackSupportsTorch(track)); return; }
      setTimeout(tick, 100);
    };
    tick();
  });
}

