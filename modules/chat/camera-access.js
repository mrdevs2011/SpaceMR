/* camera-access.js — kamera/mikrofon uchun umumiy yordamchilar (attach-menyu kamerasi VA rolik bir xil ishlatadi).
   Qoida: ruxsat rad etilishi HECH QACHON eslab qolinmaydi — har bosishda getUserMedia yangidan chaqiriladi (brauzer qayta so'raydi). */

/** Qurilmada kamera (videoinput) bormi. Ruxsatsiz ham qurilma turlari ko'rinadi. */
export async function hasCameraDevice() {
  try {
    if (!navigator.mediaDevices?.enumerateDevices) return false;
    const d = await navigator.mediaDevices.enumerateDevices();
    return d.some(x => x.kind === 'videoinput');
  } catch (_) { return false; }
}

/** getUserMedia xatosi turi: 'notfound' | 'denied' | 'busy' | 'other' */
export function mediaErrorKind(err) {
  const name = err?.name || '';
  const msg = (err?.message || '').toLowerCase();
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || msg.includes('not found') || msg.includes('no device')) return 'notfound';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotReadableError' || name === 'TrackStartError' || msg.includes('in use') || msg.includes('busy')) return 'busy';
  return 'other';
}

/** Kamera xatosi uchun foydalanuvchi matni */
export function cameraErrorMsg(err) {
  const k = mediaErrorKind(err);
  if (k === 'notfound') return 'Kamera topilmadi';
  if (k === 'busy') return 'Kamera boshqa dasturda band';
  if (k === 'denied') return 'Kameraga ruxsat berilmadi. Qayta bossangiz yana so\'raladi (bloklangan bo\'lsa — manzil qatoridagi qulf orqali yoqing)';
  return 'Kamerani ochib bo\'lmadi';
}
