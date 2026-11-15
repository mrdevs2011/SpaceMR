/**
 * wake-lock.js — SpaceMR Screen Wake Lock Engine.
 * 
 * Foydalanuvchi SpaceMR ilovasida turganda telefon ekrani o'chib qolmasligini (sleep/lockscreen)
 * 100% ta'minlaydi.
 * 
 * 1. Screen Wake Lock API (navigator.wakeLock.request('screen'))
 * 2. Avtomatik qayta tiklash: tab/ilova fonidan qaytganda (visibilitychange: visible)
 * 3. Foydalanuvchi teginishi (touchstart/click) orqali darhol faollashtirish
 * 4. Qadimgi brauzerlar uchun ko'rinmas mikro-video playback fallback
 */

let _wakeLock = null;
let _isAcquiring = false;
let _fallbackVideo = null;
let _fallbackActive = false;

// 1 ta qora pikselli ovozsiz mikro-video data-url (Screen Wake Lock bo'lmagan brauzerlar uchun)
const SILENT_MICRO_VIDEO_URI = 'data:video/mp4;base64,AAAAHGZ0eXBtcDQyAAAAAG1wNDJpc29tYXZjMQAAAAhmcmVlAAAABG1kYXQAAAAIZmRzYwAAAAFtb292AAAAbG12aGQAAAAAAAAAAAAAAAAAAAPoAAAAKAABAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAAAGHRya2hkAAAAAQAAAAAAAAAAAAAAAQAAAAAAACgAAAAAAAAAAAAAAAABAAAAAA==';

/**
 * Screen Wake Lock ni faollashtirish
 */
export async function acquireWakeLock() {
  if (typeof document === 'undefined') return false;
  if (document.visibilityState !== 'visible') return false;
  if (_wakeLock && !_wakeLock.released) return true;
  if (_isAcquiring) return false;

  _isAcquiring = true;

  // 1. Zamonaviy Screen Wake Lock API (Chrome, Edge, Safari 16.4+, Android WebView)
  if (typeof navigator !== 'undefined' && 'wakeLock' in navigator && typeof navigator.wakeLock?.request === 'function') {
    try {
      const lock = await navigator.wakeLock.request('screen');
      _wakeLock = lock;
      lock.addEventListener('release', () => {
        if (_wakeLock === lock) _wakeLock = null;
      });
      _isAcquiring = false;
      stopFallbackVideo();
      return true;
    } catch (err) {
      // Ba'zi tizimlarda batareya tejash yoki user-gesture yetishmasligi mumkin
      console.warn('[WakeLock] native request rad etildi, fallback ga o‘tilmoqda:', err?.message || err);
    }
  }

  _isAcquiring = false;

  // 2. Native API bo'lmasa yoki rad etilsa — mikro-video fallback
  return startFallbackVideo();
}

/**
 * Wake Lock ni qo'yib yuborish
 */
export async function releaseWakeLock() {
  if (_wakeLock) {
    try {
      await _wakeLock.release();
    } catch (_) {}
    _wakeLock = null;
  }
  stopFallbackVideo();
}

function startFallbackVideo() {
  if (typeof document === 'undefined') return false;
  if (_fallbackActive) return true;

  try {
    if (!_fallbackVideo) {
      const v = document.createElement('video');
      v.setAttribute('playsinline', '');
      v.setAttribute('webkit-playsinline', '');
      v.setAttribute('muted', '');
      v.muted = true;
      v.loop = true;
      v.src = SILENT_MICRO_VIDEO_URI;
      v.style.position = 'fixed';
      v.style.width = '1px';
      v.style.height = '1px';
      v.style.top = '-100px';
      v.style.left = '-100px';
      v.style.opacity = '0';
      v.style.pointerEvents = 'none';
      v.style.zIndex = '-9999';
      _fallbackVideo = v;
    }

    if (!_fallbackVideo.isConnected && document.body) {
      document.body.appendChild(_fallbackVideo);
    }

    const p = _fallbackVideo.play();
    if (p && typeof p.then === 'function') {
      p.then(() => {
        _fallbackActive = true;
      }).catch(() => {
        _fallbackActive = false;
      });
    } else {
      _fallbackActive = true;
    }
    return true;
  } catch (_) {
    return false;
  }
}

function stopFallbackVideo() {
  if (_fallbackVideo) {
    try {
      _fallbackVideo.pause();
    } catch (_) {}
    try {
      _fallbackVideo.remove();
    } catch (_) {}
    _fallbackVideo = null;
  }
  _fallbackActive = false;
}

/**
 * SpaceMR ochilishi bilanoq Wake Lock tizimini ishga tushirish
 */
export function initWakeLock() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__spacemrWakeLockInit) return;
  window.__spacemrWakeLockInit = true;

  // Darhol faollashtirishga harakat qilamiz
  acquireWakeLock().catch(() => {});

  // Brauzer tabiga yoki ilovaga qaytgan zahoti qayta uyg'otish
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      acquireWakeLock().catch(() => {});
    } else {
      // Fon rejimiga o'tganda batareyani behuda sarflamaslik uchun qo'yib yuboramiz
      releaseWakeLock().catch(() => {});
    }
  });

  // Agar brauzer foydalanuvchi birinchi marta ekranga tegishini kutsa (user gesture requirement)
  const onFirstInteraction = () => {
    acquireWakeLock().catch(() => {});
  };

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    ['pointerdown', 'touchstart', 'click', 'keydown'].forEach(ev => {
      window.addEventListener(ev, onFirstInteraction, { passive: true, once: false });
    });
  }

  // Davriy qo'riqchi (har 30 soniyada tekshirib, agar uzilib qolgan bo'lsa qayta tiklaydi)
  const watchdog = setInterval(() => {
    if (document.visibilityState === 'visible' && (!_wakeLock || _wakeLock.released)) {
      acquireWakeLock().catch(() => {});
    }
  }, 30000);
  if (watchdog && typeof watchdog.unref === 'function') {
    watchdog.unref();
  }
}

// Skript import qilinganda avtomatik ishga tushadi
if (typeof window !== 'undefined') {
  initWakeLock();
}
