/**
 * overlay-stack.js — SpaceMR Mobil & Desktop Yagona Orqaga (Back-Button / Edge Swipe) Qatlamlar Tizimi.
 *
 * Qat'iy LIFO (Last-In-First-Out) qoidasi:
 * 1. Eng ustki ko'rinib turgan modal / card / drawer / camera orqaga tugmasi / swipe orqali yopiladi.
 * 2. Eng oxirgi ochilgan narsa birinchi yopiladi.
 * 3. Hamma overlaylar yopilgandagina oxirgi ochilgan sahifa (page) orqaga qaytadi.
 */

import { closeTopmost } from './shortcuts.js';

const _stack = [];
let _suppressNextPop = false;
let _suppressTimer = null;

export function isOverlayOpen(id) {
  return _stack.some(item => item.id === id);
}

/**
 * Yangi overlay/modal/drawer/kamera ochilganda ro'yxatga oladi va brauzer tarixiga yozadi.
 * @param {string} id - overlay identifikatori (masalan: 'camCapture', 'attachDrawer')
 * @param {Function} closeFn - yopish funksiyasi
 */
export function pushOverlay(id, closeFn) {
  if (!id) return;
  // Agar bu overlay allaqachon stackda bo'lsa, qayta qo'shmaymiz
  const existingIdx = _stack.findIndex(item => item.id === id);
  if (existingIdx !== -1) {
    _stack.splice(existingIdx, 1);
  }

  const currentHref = window.location.href;
  _stack.push({ id, closeFn, href: currentHref });

  try {
    const st = history.state || {};
    history.pushState({ ...st, _overlayId: id, _overlayTime: Date.now() }, '', currentHref);
  } catch (err) {
    console.warn('[OverlayStack] pushState xatosi:', err);
  }
}

/**
 * Overlay dasturiy yo'l bilan (X tugmasi, fon bosilishi, jo'natish) yopilganda chaqiriladi.
 * Brauzer tarixidagi ortiqcha qatlamni tozalaydi.
 * @param {string} id
 */
export function dismissOverlay(id) {
  if (!id) return;
  const idx = _stack.findIndex(item => item.id === id);
  if (idx === -1) return;

  _stack.splice(idx, 1);

  // Agar brauzer tarixining tepasida aynan shu overlay turgan bo'lsa, history.back() qilamiz
  if (history.state && history.state._overlayId === id) {
    _suppressNextPop = true;
    if (_suppressTimer) clearTimeout(_suppressTimer);
    _suppressTimer = setTimeout(() => { _suppressNextPop = false; }, 400);
    try {
      history.back();
    } catch (_) {}
  }
}

/**
 * Telefondagi "Orqaga" tugmasi yoki chetdan surish (popstate) hodisasini ushlash.
 * Agar biror modal/drawer/kamera ochiq bo'lsa, uni yopadi va true qaytaradi (sahifa o'zgarmaydi).
 */
export function handleOverlayPopState() {
  if (_suppressNextPop) {
    _suppressNextPop = false;
    if (_suppressTimer) clearTimeout(_suppressTimer);
    return true;
  }

  // 1. Stackdagi eng oxirgi ochilgan overlayni yopish
  while (_stack.length > 0) {
    const top = _stack.pop();
    if (top && typeof top.closeFn === 'function') {
      try {
        const closed = top.closeFn();
        if (closed !== false) {
          return true;
        }
      } catch (err) {
        console.warn('[OverlayStack] closeFn xatosi:', err);
      }
    }
  }

  // 2. Stackda bo'lmagan, lekin ekranda ochiq turgan har qanday topmost overlayni yopish
  try {
    if (typeof closeTopmost === 'function') {
      const closed = closeTopmost();
      if (closed) {
        // Brauzer URL'ini tiklash
        return true;
      }
    }
  } catch (err) {
    console.warn('[OverlayStack] closeTopmost xatosi:', err);
  }

  return false;
}
