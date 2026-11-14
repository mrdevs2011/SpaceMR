/**
 * chat-upload-queue.js — 0ms Optimistik yuklash navbati va Telegram progress boshqaruvchisi.
 *
 * Xususiyatlari:
 * 1. 0ms Optimistik UI: Foydalanuvchi fayl tanlashi bilan chatga darhol tushadi.
 * 2. Ketma-ket (sequential) navbat: Bir vaqtda faqat 1 ta fayl yuklanadi (50kbps sekin tarmoqda
 *    ham ulanish tiqilib qolmaydi, socketlar buzilmaydi).
 * 3. Telegram uslubidagi doiraviy SVG progress ring va markazida 'X' (cancel) tugmasi.
 * 4. Bekor qilish (Cancel / Abort): 'X' bosilganda AbortController orqali XHR darhol to'xtatiladi,
 *    xabar bekor qilinadi, navbatdagi keyingi fayllar ZARARLANMAYDI.
 * 5. Avtomatik Retry: Sekin tarmoqda glitch/timeout bo'lsa 2 martagacha shoshilmasdan qayta urinadi.
 */

import { uploadViaControllerProgress } from './chat-shared.js';
import { toast } from '../ui/toast.js';

// SVG Aylana radiusi va perimetri: r = 19 => C = 2 * PI * 19 = 119.38
const RING_CIRCUMFERENCE = 119.38;

/** Har bir faol yuklash uchun AbortController xaritasi */
const _controllers = new Map();

/** Navbatdagi vazifalar ro'yxati */
const _uploadQueue = [];
let _isProcessingQueue = false;

/**
 * Telegram uslubidagi doiraviy progress ring HTML-kodi.
 * @param {string} uploadId - Xabar yoki media elementi ID si
 * @param {number} [initialPct=0] - Boshlang'ich foiz (0..100)
 * @param {boolean} [isFile=false] - Oddiy fayl (doc/pdf) uchun ixcham ko'rinish
 */
export function renderUploadRingHtml(uploadId, initialPct = 0, isFile = false) {
  const pct = Math.max(0, Math.min(100, Math.round(initialPct)));
  const offset = RING_CIRCUMFERENCE - (pct / 100) * RING_CIRCUMFERENCE;
  const fileCls = isFile ? ' chat-upload-ring--file' : '';

  return `<div class="chat-upload-ring${fileCls}" data-upload-id="${uploadId}" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
    <div class="cur-backdrop"></div>
    <svg class="cur-svg" viewBox="0 0 48 48">
      <circle class="cur-track" cx="24" cy="24" r="19" fill="none" stroke-width="3"></circle>
      <circle class="cur-fill" cx="24" cy="24" r="19" fill="none" stroke-width="3" stroke-dasharray="${RING_CIRCUMFERENCE}" stroke-dashoffset="${offset.toFixed(2)}"></circle>
    </svg>
    <button type="button" class="cur-cancel" aria-label="Yuklashni bekor qilish" title="Bekor qilish" data-cancel-upload="${uploadId}">
      <svg viewBox="0 0 14 14" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
        <path d="M3 3l8 8M11 3l-8 8"></path>
      </svg>
    </button>
    <span class="cur-pct">${pct}%</span>
  </div>`;
}

/**
 * Doiraviy progress ringni yangilash (0..100%).
 * DOM da bir nechta joyda (masalan albom ichida va ro'yxatda) bo'lsa ham barchasini yangilaydi.
 */
export function updateUploadProgress(uploadId, pct) {
  const rings = document.querySelectorAll(`.chat-upload-ring[data-upload-id="${uploadId}"]`);
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  const offset = RING_CIRCUMFERENCE - (clamped / 100) * RING_CIRCUMFERENCE;

  rings.forEach(ring => {
    const fill = ring.querySelector('.cur-fill');
    const lbl = ring.querySelector('.cur-pct');
    if (fill) fill.style.strokeDashoffset = offset.toFixed(2);
    if (lbl) lbl.textContent = clamped + '%';
    ring.setAttribute('aria-valuenow', clamped);
  });
}

/**
 * Yuklash muvaffaqiyatli yakunlanganda doirani silliq olib tashlash.
 */
export function markUploadCompleted(uploadId) {
  _controllers.delete(uploadId);
  const rings = document.querySelectorAll(`.chat-upload-ring[data-upload-id="${uploadId}"]`);
  rings.forEach(ring => {
    ring.classList.add('cur-done');
    setTimeout(() => {
      try { ring.remove(); } catch (_) {}
    }, 220);
  });
}

/**
 * Yuklashni bekor qilish (foydalanuvchi 'X' ni bosganda yoki sahifadan chiqqanda).
 * @param {string} uploadId
 * @returns {boolean} Bekor qilinganligi
 */
export function cancelUpload(uploadId) {
  // 1. Agar navbatda kutayotgan bo'lsa — navbatdan chiqaramiz
  const qIdx = _uploadQueue.findIndex(t => t.id === uploadId);
  if (qIdx !== -1) {
    const [task] = _uploadQueue.splice(qIdx, 1);
    if (task && task.reject) {
      task.reject(new DOMException('Upload cancelled by user', 'AbortError'));
    }
    _cleanupRing(uploadId);
    return true;
  }

  // 2. Agar ayni paytda faol yuklanayotgan bo'lsa — controller.abort() qilamiz
  const ctrl = _controllers.get(uploadId);
  if (ctrl) {
    try { ctrl.abort(); } catch (_) {}
    _controllers.delete(uploadId);
    _cleanupRing(uploadId);
    return true;
  }

  _cleanupRing(uploadId);
  return false;
}

function _cleanupRing(uploadId) {
  const rings = document.querySelectorAll(`.chat-upload-ring[data-upload-id="${uploadId}"]`);
  rings.forEach(ring => ring.remove());
}

/**
 * Ketma-ket (sequential) navbatga yuklash vazifasini qo'shish.
 *
 * @param {object} opts
 * @param {string} opts.id - Unikal yuklash ID si (message ID yoki album item ID)
 * @param {File|Blob} opts.file - Yuklanadigan fayl
 * @param {string} opts.folder - Storage papkasi (masalan 'chat-files' yoki 'group-files')
 * @param {(pct: number) => void} [opts.onProgress] - Foiz o'zgarishi callbacki
 * @param {number} [opts.retries=2] - Xatolikda qayta urinishlar soni
 * @returns {Promise<{ path: string, url: string }>}
 */
export function enqueueSequentialUpload({ id, file, folder, onProgress, retries = 2 }) {
  return new Promise((resolve, reject) => {
    const task = {
      id,
      file,
      folder,
      onProgress,
      retriesLeft: retries,
      resolve,
      reject,
    };

    _uploadQueue.push(task);
    _processUploadQueue();
  });
}

/**
 * Navbatdagi vazifalarni ketma-ket (bittalab) bajarish.
 * 50kbps tarmoqda tiqilmaslik uchun bir vaqtning o'zida faqat 1 ta yuklash ishlaydi.
 */
async function _processUploadQueue() {
  if (_isProcessingQueue) return;
  if (!_uploadQueue.length) return;

  _isProcessingQueue = true;

  while (_uploadQueue.length > 0) {
    const task = _uploadQueue[0];
    if (!task) break;

    const controller = new AbortController();
    _controllers.set(task.id, controller);

    let success = false;
    let result = null;
    let lastError = null;

    while (task.retriesLeft >= 0 && !controller.signal.aborted) {
      try {
        result = await uploadViaControllerProgress(
          task.file,
          task.folder,
          pct => {
            updateUploadProgress(task.id, pct);
            if (typeof task.onProgress === 'function') task.onProgress(pct);
          },
          controller.signal
        );

        success = true;
        break;
      } catch (err) {
        lastError = err;
        if (controller.signal.aborted || err?.name === 'AbortError') {
          // Foydalanuvchi atayin bekor qildi — qayta urinmaymiz
          break;
        }

        task.retriesLeft--;
        if (task.retriesLeft >= 0) {
          // 50kbps tarmoq tiklanishi uchun 1.2 soniya kutib qayta urinamiz
          await new Promise(r => setTimeout(r, 1200));
        }
      }
    }

    _controllers.delete(task.id);
    _uploadQueue.shift(); // Joriy vazifani navbatdan olib tashlaymiz

    if (success && result) {
      markUploadCompleted(task.id);
      task.resolve(result);
    } else {
      _cleanupRing(task.id);
      task.reject(lastError || new Error('Upload failed'));
    }
  }

  _isProcessingQueue = false;
}

/**
 * Biron yuklash ayni paytda faol yoki navbatdami tekshirish.
 */
export function hasActiveUpload(id) {
  return _controllers.has(id) || _uploadQueue.some(t => t.id === id);
}
