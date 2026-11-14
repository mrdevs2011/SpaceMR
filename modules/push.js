/**
 * push.js — Web Push (VAPID) bildirishnomalari
 *
 * Firebase/FCM yo'q: brauzerning o'z Push API'si ishlatiladi. Obuna (subscription)
 * `push_tokens` jadvaliga register_push_token RPC orqali yoziladi, yuborishni
 * Chat/call push eski Edge Function'da qoladi; like/comment alohida Vercel API orqali yuboriladi.
 *
 * Android: sayt yopiq bo'lsa ham xabar keladi.
 * Desktop: brauzer ochiq bo'lsa keladi.
 *
 * VAPID_PUBLIC_KEY — ochiq kalit (maxfiy emas). Maxfiy kalit FAQAT Supabase
 * Chat/call uchun eski VAPID kalit saqlanadi. Social push o'z alohida worker/keypair'iga ega.
 */

import { sb, state } from './core/config.js';

export const VAPID_PUBLIC_KEY = 'BC7D7mT0RhLjM8kes8iFCvavCiTY5crwYaXzGeuEIRclNoRmIDAg0QTpgfbGvefGmprso8bqiArQ3a1kz33FOt0';

// Alohida VAPID juftligi: eski chat/call subscription va Edge secret'iga tegmaydi.
const SOCIAL_VAPID_PUBLIC_KEY = 'BA_VRFyejzm1adqnb7yF_4c9Z8lBUa1LRVyy4ykErOOAQzYdWQe-Gfd0_QCAKQ5sNHnEQKjxGaHC9BhTTJbDviY';
const SOCIAL_PUSH_ORIGIN = 'https://spacemr.vercel.app#social-v2';

// Foydalanuvchi "Sozlamalar" ekranidan bildirishnomalarni o'chirib qo'ysa,
// keyingi kirishlarda initPush() avtomatik chaqirilmasligi uchun localStorage
// bayrog'i. Standart holat: yoqilgan (faqat aniq '0' yozilgan bo'lsa o'chirilgan).
const NOTIF_LS_KEY = 'spacemrNotifsEnabled';

/** Foydalanuvchi bildirishnomalarni o'chirib qo'yganmi (Settings orqali)? */
export function notificationsUserDisabled() {
  try {
    const v = localStorage.getItem(NOTIF_LS_KEY) ?? localStorage.getItem('mrspaceNotifsEnabled');
    return v === '0';
  } catch { return false; }
}

/** Settings toggle uchun: hozirgi holat yoqilganmi?
 * Brauzer ruxsati 'denied' bo'lsa — har doim o'chirilgan hisoblanadi
 * (JS orqali qayta yoqib bo'lmaydi, foydalanuvchi brauzer sozlamalaridan yoqadi). */
export function areNotificationsEnabled() {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'denied') return false;
  return !notificationsUserDisabled();
}

let _swReg    = null;
let _initDone = false;

function _b64urlToBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

function _sameKey(sub, keyBytes) {
  const cur = sub.options?.applicationServerKey;
  if (!cur) return false;
  const a = new Uint8Array(cur);
  return a.length === keyBytes.length && a.every((v, i) => v === keyBytes[i]);
}

function _platform() {
  const ua = navigator.userAgent || '';
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  return 'web';
}

/** Like/comment uchun alohida worker va VAPID obunasi. Eski root workerga tegmaydi. */
async function _initSocialPush(uid) {
  try {
    const reg = await navigator.serviceWorker.register('/social-push/sw.js', { scope: '/social-push/' });
    await reg.update().catch(() => {});
    const key = _b64urlToBytes(SOCIAL_VAPID_PUBLIC_KEY);
    let sub = await reg.pushManager.getSubscription();
    if (sub && !_sameKey(sub, key)) {
      await sub.unsubscribe().catch(() => {});
      sub = null;
    }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    if (!sub) return;
    const { error } = await sb.rpc('register_push_token', {
      p_token: JSON.stringify(sub.toJSON()),
      p_platform: _platform(),
      p_origin: SOCIAL_PUSH_ORIGIN,
    });
    if (error) throw error;
  } catch (error) {
    // Ikkilamchi kanal xatosi asosiy chat/call push'ni buzmasin.
    console.warn('[Push] social channel unavailable:', error?.message || 'registration failed');
  }
}

/** Social eventni JWT bilan Vercel serverless endpointiga yuboradi. */
export async function sendSocialPush(event, postId, commentId) {
  const { data } = await sb.auth.getSession();
  const token = data?.session?.access_token;
  if (!token) return;
  const response = await fetch('/api/social-push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ kind: 'social', event, postId, ...(commentId ? { commentId } : {}) }),
    cache: 'no-store',
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error || `HTTP ${response.status}`);
  }
  return response.json().catch(() => ({}));
}

/** Service Worker'ni ro'yxatdan o'tkazish */
async function _registerSW() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const existing = await navigator.serviceWorker.getRegistration();
    if (existing) return existing;
    return await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  } catch {
    return null;
  }
}

/**
 * Push ruxsatini so'rash, obuna bo'lish va obunani DB ga saqlash.
 * auth.js → _enterApp() da chaqiriladi (foydalanuvchi kirganda).
 */
export async function initPush() {
  if (_initDone) return;
  if (!('Notification' in window) || !('PushManager' in window)) return;

  _swReg = await _registerSW();
  if (!_swReg) return;

  try {
    let permission = Notification.permission;
    if (permission === 'default') {
      // Foydalanuvchi imo-ishorasisiz (user gesture) brauzer ruxsat oynasini bloklaydi
      if (typeof navigator !== 'undefined' && navigator.userActivation?.hasBeenActive) {
        try { permission = await Notification.requestPermission(); } catch (_) { return; }
      } else {
        return;
      }
    }
    if (permission !== 'granted') return;

    const uid = state.me?.uid;
    if (!uid) return;

    const reg = await navigator.serviceWorker.ready;
    const key = _b64urlToBytes(VAPID_PUBLIC_KEY);

    let sub = await reg.pushManager.getSubscription();
    // Eski (FCM yoki boshqa VAPID kalit bilan) obuna bo'lsa — yangisiga almashtiramiz
    if (sub && !_sameKey(sub, key)) { await sub.unsubscribe().catch(() => {}); sub = null; }

    if (!sub) {
      try {
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      } catch (subErr) {
        // "Registration failed - push service error" — brauzer push serveri (FCM/Mozilla) bilan
        // tarmoq muammosi. Ilovaga ta'sir qilmaydi, jimgina chiqamiz.
        return;
      }
    }

    if (!sub) return;

    const { error } = await sb.rpc('register_push_token', {
      p_token: JSON.stringify(sub.toJSON()),
      p_platform: _platform(),
      p_origin: location.origin,
    });
    if (error) throw error;

    // Ikkinchi worker eski subscriptionni almashtirmaydi.
    await _initSocialPush(uid);
    _initDone = true;
  } catch (e) {
    const msg = e?.message || String(e);
    // Brauzer push xizmati muammolari — faqat DB/RPC xatolarini ko'rsatamiz
    if (!msg.includes('push service') && !msg.includes('Registration failed') && !msg.includes('network')) {
      console.warn('[Push] obuna bo\'lmadi:', msg);
    }
  }
}

/**
 * Chiqish paytida obunani DB dan va brauzerdan o'chirish.
 * auth.js → logOut() da (sessiya tugashidan OLDIN) chaqiriladi.
 */
export async function removePushToken() {
  try {
    const reg = _swReg || (await navigator.serviceWorker?.getRegistration());
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (sub) {
      if (state.me?.uid) {
        await sb.from('push_tokens').delete().eq('token', JSON.stringify(sub.toJSON()));
      }
      await sub.unsubscribe().catch(() => {});
    }
    // Social worker alohida registration: logoutda uning tokeni ham o'chadi.
    const socialReg = await navigator.serviceWorker?.getRegistration('/social-push/');
    const socialSub = socialReg ? await socialReg.pushManager.getSubscription() : null;
    if (socialSub) {
      if (state.me?.uid) {
        await sb.from('push_tokens').delete().eq('token', JSON.stringify(socialSub.toJSON()));
      }
      await socialSub.unsubscribe().catch(() => {});
    }
  } catch {
    // Jimgina
  }
  _initDone = false;
}

/**
 * Settings ekranidagi "Bildirishnomalar" toggle shu funksiyani chaqiradi.
 * Yoqilsa — ruxsat so'rab qayta obuna bo'ladi; o'chirilsa — obunani o'chiradi va
 * localStorage bayrog'ini yozadi (auth.js shu bayroqni tekshiradi).
 *
 * Qaytaradi: yakuniy holat (true = yoqilgan). Ruxsat rad etilgan bo'lsa false.
 */
export async function setNotificationsEnabled(enabled) {
  if (!enabled) {
    await removePushToken();
    try { localStorage.setItem(NOTIF_LS_KEY, '0'); } catch {}
    return false;
  }

  try { localStorage.setItem(NOTIF_LS_KEY, '1'); } catch {}
  await initPush();
  return areNotificationsEnabled();
}


/** Har refresh / appga qaytishda: ruxsat yo'q bo'lsa so'rayveradi (granted bo'lguncha).
 * "Ruxsat berilmagan" yozuvi yo'q — faqat so'rov. */
let _notifNagWired = false;
export function ensureNotifOnEveryVisit() {
  if (_notifNagWired) return;
  _notifNagWired = true;

  const syncState = async () => {
    if (!('Notification' in window)) return;
    if (notificationsUserDisabled()) return;
    if (Notification.permission === 'granted') {
      if (!_initDone) {
        try { await initPush(); } catch (_) {}
      }
    }
  };

  // Faqat granted bo'lsa push obunasini tekshiradi (user gesture talab qilmaydi)
  syncState();
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) syncState();
  });
  window.addEventListener('focus', syncState);
}
