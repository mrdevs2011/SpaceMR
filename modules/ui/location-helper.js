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
