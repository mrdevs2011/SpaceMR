/* camera-access.js — kamera/mikrofon yordamchilari (attach + rolik).
   Ruxsat rad etilishi eslab qolinmaydi — har bosishda getUserMedia yangidan. */

/** Qurilmada kamera (videoinput) bormi. */
export async function hasCameraDevice() {
  try {
    if (!navigator.mediaDevices?.enumerateDevices) return false;
    const d = await navigator.mediaDevices.enumerateDevices();
    return d.some(x => x.kind === 'videoinput');
  } catch (_) { return false; }
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
    const caps = track?.getCapabilities?.();
    return !!(caps && 'torch' in caps && caps.torch);
  } catch (_) { return false; }
}

export async function setTorch(track, on) {
  if (!track || !trackSupportsTorch(track)) return false;
  try {
    await track.applyConstraints({ advanced: [{ torch: !!on }] });
    return true;
  } catch (_) { return false; }
}
