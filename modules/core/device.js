/**
 * QURILMA SINFI — ekran o'lchamiga HECH QACHON qaramaydi.
 * Faqat qurilmaning o'ziga qaraydi: userAgentData / UA / iPadOS belgisi / asosiy kiritish turi (sensorli yoki sichqoncha).
 * Natija: <html data-device="phone|tablet|desktop"> — CSS ham, JS ham faqat shunga tayanadi.
 * (index.html <head> ichida ham xuddi shu mantiq CSS'dan oldin ishlaydi — bu fayl bilan bir xil bo'lishi shart.)
 */
function detect() {
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  const ua = nav.userAgent || '';
  const uad = nav.userAgentData;
  const touchPts = nav.maxTouchPoints || 0;
  const ipadOs = /Macintosh/i.test(ua) && touchPts > 1;       // iPadOS Safari "desktop" UA yuboradi
  if (/iPad/i.test(ua) || ipadOs) return 'tablet';
  if (/iPhone|iPod/i.test(ua)) return 'phone';
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? 'phone' : 'tablet';
  if (uad && uad.mobile === true) return 'phone';
  if (/webOS|BlackBerry|IEMobile|Opera Mini|Windows Phone|Mobile/i.test(ua)) return 'phone';
  if (/Tablet|Silk|Kindle/i.test(ua)) return 'tablet';
  // UA hech narsa demasa — asosiy kiritish qurilmasi: faqat barmoq (sichqonchasiz) bo'lsa mobil
  try {
    const m = window.matchMedia;
    if (m && m('(pointer: coarse)').matches && m('(hover: none)').matches && touchPts > 0) return 'phone';
  } catch (_) {}
  return 'desktop';
}

export const DEVICE = detect();
export const isDesktopDevice = () => DEVICE === 'desktop';
export const isPhoneDevice = () => DEVICE === 'phone';
export const isTabletDevice = () => DEVICE === 'tablet';
export const isMobileDevice = () => DEVICE !== 'desktop';
/** Asosiy kiritish — barmoq (sensorli ekran) */
export const isTouchDevice = () => DEVICE !== 'desktop';

try { document.documentElement.setAttribute('data-device', DEVICE); } catch (_) {}
