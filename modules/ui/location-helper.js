/* location-helper.js — Geolocation orqali joylashuvni olish va jo‘natish yordamchisi */
import { toast } from './toast.js';

/**
 * Reverse geocoding (OpenStreetMap Nominatim orqali shahar / tuman nomini aniqlash)
 */
async function reverseGeocode(lat, lon) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=16&addressdetails=1`;
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'Accept-Language': 'uz,ru,en' },
    });
    clearTimeout(timer);
    if (res.ok) {
      const data = await res.json();
      const a = data.address || {};
      const place = a.road || a.pedestrian || a.suburb || a.city || a.town || a.village || a.county || 'Joylashuv';
      const city = a.city || a.town || a.state || '';
      const title = city && place !== city ? `${place}, ${city}` : place;
      const full = data.display_name || `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
      return { title, address: full };
    }
  } catch (_) {}
  return {
    title: 'Mening joylashuvim',
    address: `${lat.toFixed(5)}, ${lon.toFixed(5)}`,
  };
}

/**
 * Foydalanuvchi joriy koordinatalarini olib, callback orqali uzatadi
 * @param {(loc: { lat: number, lon: number, title: string, address: string }) => void} onLocation
 */
export function requestAndSendLocation(onLocation) {
  if (!navigator.geolocation) {
    toast('Qurilmangizda lokatsiya (GPS) qo‘llab-quvvatlanmaydi', 'error');
    return;
  }

  toast('Joylashuv aniqlanmoqda...', 'info');

  const options = {
    enableHighAccuracy: true,
    timeout: 12000,
    maximumAge: 10000,
  };

  navigator.geolocation.getCurrentPosition(
    async pos => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      toast('Joylashuv aniqlandi, yuborilmoqda...', 'info');

      const info = await reverseGeocode(lat, lon);
      if (typeof onLocation === 'function') {
        onLocation({
          lat,
          lon,
          title: info.title,
          address: info.address,
        });
      }
    },
    err => {
      console.warn('[Location] error:', err);
      if (err.code === 1) { // PERMISSION_DENIED
        toast('Lokatsiyaga ruxsat berilmadi. Manzil qatoridagi qulf orqali yoqing.', 'warning');
      } else if (err.code === 2) { // POSITION_UNAVAILABLE
        toast('Joylashuvni aniqlab bo‘lmadi (GPS o‘chiq bo‘lishi mumkin)', 'error');
      } else if (err.code === 3) { // TIMEOUT
        toast('Joylashuvni aniqlash vaqti tugadi', 'warning');
      } else {
        toast('Joylashuvni aniqlab bo‘lmadi', 'error');
      }
    },
    options
  );
}

/**
 * PWA yoki brauzerdan tashqi ilova / brauzerni 100% ishonchli ochish
 */
export function openExternalUrl(url) {
  if (!url) return;
  // PWA (standalone) yoki mobil brauzerda tizim brauzeri / ilovasini ochish
  try {
    const w = window.open(url, '_system') || window.open(url, '_blank', 'noopener,noreferrer');
    if (w) return;
  } catch (_) {}
  try {
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer external';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      try { document.body.removeChild(a); } catch (_) {}
    }, 150);
    return;
  } catch (_) {}
  try {
    window.location.href = url;
  } catch (_) {}
}

/**
 * Foydalanuvchi qurilmasiga mos xaritalar ilovasini ochish yoki navigatsiyani boshlash:
 * - Apple (iPhone/iPad/Mac): Apple Maps (maps:// yoki maps.apple.com)
 * - Android / Desktop:
 *     Top 1: Yandex Maps (yandexmaps:// ilovasi yoki browser)
 *     Top 2: Google Maps (google.navigation: yoki google.com/maps)
 *     Top 3 / Web: Yandex Maps yoki OpenStreetMap
 * - `navigate: true` bo'lsa, to'g'ridan-to'g'ri o'sha manzilga yo'l (marshrut / directions) boshlaydi!
 */
export function openSmartMapLocation(lat, lon, { navigate = false, title = '' } = {}) {
  const nLat = Number(lat);
  const nLon = Number(lon);
  if (isNaN(nLat) || isNaN(nLon)) return;

  const ua = navigator.userAgent || '';
  const isApple = /iPhone|iPad|iPod|Macintosh|Mac OS X/i.test(ua);
  const isAndroid = /Android/i.test(ua);
  const isMobile = isApple || isAndroid;

  if (isApple) {
    if (navigate) {
      const appUrl = `maps://?daddr=${nLat},${nLon}&dirflg=d`;
      const webUrl = `https://maps.apple.com/?daddr=${nLat},${nLon}&dirflg=d`;
      if (isMobile) {
        window.location.href = appUrl;
        setTimeout(() => { openExternalUrl(webUrl); }, 700);
      } else {
        openExternalUrl(webUrl);
      }
    } else {
      const q = encodeURIComponent(title || 'Joylashuv');
      const appUrl = `maps://?ll=${nLat},${nLon}&q=${q}`;
      const webUrl = `https://maps.apple.com/?ll=${nLat},${nLon}&q=${q}`;
      if (isMobile) {
        window.location.href = appUrl;
        setTimeout(() => { openExternalUrl(webUrl); }, 700);
      } else {
        openExternalUrl(webUrl);
      }
    }
    return;
  }

  // Android yoki Desktop / Web: Top 1 = Yandex Maps, Top 2 = Google Maps
  if (navigate) {
    const yandexApp = `yandexmaps://build_route_on_map?lat_to=${nLat}&lon_to=${nLon}`;
    const yandexWeb = `https://yandex.ru/maps/?rtext=~${nLat},${nLon}&rtt=auto`;
    const googleApp = `google.navigation:q=${nLat},${nLon}&mode=d`;
    const googleWeb = `https://www.google.com/maps/dir/?api=1&destination=${nLat},${nLon}`;

    if (isMobile) {
      const t0 = Date.now();
      window.location.href = yandexApp;
      setTimeout(() => {
        if (Date.now() - t0 < 1200) {
          window.location.href = googleApp;
          setTimeout(() => {
            openExternalUrl(yandexWeb);
          }, 600);
        }
      }, 600);
    } else {
      openExternalUrl(yandexWeb);
    }
  } else {
    // Xaritada ko'rish
    const yandexApp = `yandexmaps://maps.yandex.ru/?pt=${nLon},${nLat}&z=16&l=map`;
    const yandexWeb = `https://yandex.ru/maps/?pt=${nLon},${nLat}&z=16&l=map`;

    if (isMobile) {
      const t0 = Date.now();
      window.location.href = yandexApp;
      setTimeout(() => {
        if (Date.now() - t0 < 1200) {
          openExternalUrl(yandexWeb);
        }
      }, 600);
    } else {
      openExternalUrl(yandexWeb);
    }
  }
}

if (typeof window !== 'undefined') {
  window.__openSmartMap = openSmartMapLocation;
}
