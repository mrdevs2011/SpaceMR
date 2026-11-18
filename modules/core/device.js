/**
 * Qurilmaning fizik turini bir marta aniqlaymiz, layout turini esa viewport bilan
 * birga yangilaymiz. Desktop brauzeri toraytirilsa ham phone/tablet layoutga o'tadi.
 * CSS va JS uchun yagona manba: <html data-device="phone|tablet|desktop">.
 */
function detectPhysicalDevice() {
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  const ua = nav.userAgent || '';
  const touchPts = nav.maxTouchPoints || 0;
  const ipadOs = /Macintosh/i.test(ua) && touchPts > 1;
  if (/iPad/i.test(ua) || ipadOs) return 'tablet';
  if (/iPhone|iPod/i.test(ua)) return 'phone';
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? 'phone' : 'tablet';
  if (nav.userAgentData?.mobile === true) return 'phone';
  if (/webOS|BlackBerry|IEMobile|Opera Mini|Windows Phone|Mobile/i.test(ua)) return 'phone';
  if (/Tablet|Silk|Kindle/i.test(ua)) return 'tablet';
  try {
    if (window.matchMedia?.('(pointer: coarse)').matches && window.matchMedia?.('(hover: none)').matches && touchPts > 0) return 'phone';
  } catch (_) {}
  return 'desktop';
}

export const PHYSICAL_DEVICE = detectPhysicalDevice();

function layoutForViewport() {
  const width = typeof window !== 'undefined' ? (window.innerWidth || 1280) : 1280;
  if (PHYSICAL_DEVICE === 'phone') return 'phone';
  if (PHYSICAL_DEVICE === 'tablet') return width < 600 ? 'phone' : 'tablet';
  if (width < 600) return 'phone';
  if (width < 1100) return 'tablet';
  return 'desktop';
}

export let DEVICE = layoutForViewport();

function applyLayout() {
  const next = layoutForViewport();
  const changed = next !== DEVICE;
  DEVICE = next;
  try { document.documentElement.setAttribute('data-device', next); } catch (_) {}
  if (changed) {
    try { window.dispatchEvent(new Event('spacemr:devicechange')); } catch (_) {}
  }
}

let resizeQueued = false;
function scheduleLayoutUpdate() {
  if (resizeQueued) return;
  resizeQueued = true;
  const raf = typeof window !== 'undefined' && window.requestAnimationFrame ? window.requestAnimationFrame.bind(window) : callback => setTimeout(callback, 0);
  raf(() => { resizeQueued = false; applyLayout(); });
}

try {
  document.documentElement.setAttribute('data-device', DEVICE);
  window.addEventListener('resize', scheduleLayoutUpdate, { passive: true });
  window.addEventListener('orientationchange', scheduleLayoutUpdate, { passive: true });
} catch (_) {}

export const isDesktopDevice = () => DEVICE === 'desktop';
export const isPhoneDevice = () => DEVICE === 'phone';
export const isTabletDevice = () => DEVICE === 'tablet';
export const isMobileDevice = () => DEVICE !== 'desktop';
/** Fizik sensorli qurilma; viewport torayishi buni o'zgartirmaydi. */
export const isTouchDevice = () => PHYSICAL_DEVICE !== 'desktop';
