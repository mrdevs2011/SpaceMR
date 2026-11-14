/**
 * modules/ui/gallery-fs.js
 * SpaceMR FileSystem Access API & Device Gallery Specialist
 *
 * Android DCIM / Pictures papkalarini boshqarish, ruxsatlarni tekshirish,
 * noto'g'ri papka modal dialogi va ichki ost-papkalarni (Camera, Screenshots va h.k.)
 * rekursiv skanerlash mexanizmi.
 */

import { toast } from './toast.js';

const GALLERY_DB_NAME = 'spacemr_gallery_db';
const GALLERY_DB_VER = 1;
const GALLERY_STORE = 'handles';
const HANDLE_KEY = 'smr_gallery_dir_handle';

// Ruxsat berilgan papka nomlari kalit so'zlari
export const ALLOWED_FOLDER_KEYWORDS = [
  'dcim',
  'camera',
  'pictures',
  'photos',
  'gallery',
  'internal shared storage'
];

// Qo'llab-quvvatlanadigan media kengaytmalari
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'heic', 'heif', 'avif']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'm4v', 'webm', '3gp', 'mkv']);

/**
 * IndexedDB dan saqlangan FileSystemDirectoryHandle ni olish
 */
export async function getSavedGalleryDirHandle() {
  if (typeof indexedDB === 'undefined') return null;
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(GALLERY_DB_NAME, GALLERY_DB_VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(GALLERY_STORE)) {
          db.createObjectStore(GALLERY_STORE);
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        try {
          const tx = db.transaction(GALLERY_STORE, 'readonly');
          const getReq = tx.objectStore(GALLERY_STORE).get(HANDLE_KEY);
          getReq.onsuccess = () => {
            db.close();
            resolve(getReq.result || null);
          };
          getReq.onerror = () => {
            db.close();
            resolve(null);
          };
        } catch (_) {
          db.close();
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    } catch (_) {
      resolve(null);
    }
  });
}

/**
 * FileSystemDirectoryHandle ni IndexedDB da saqlash
 */
export async function saveGalleryDirHandle(dirHandle) {
  if (typeof indexedDB === 'undefined' || !dirHandle) return false;
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open(GALLERY_DB_NAME, GALLERY_DB_VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(GALLERY_STORE)) {
          db.createObjectStore(GALLERY_STORE);
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        try {
          const tx = db.transaction(GALLERY_STORE, 'readwrite');
          tx.objectStore(GALLERY_STORE).put(dirHandle, HANDLE_KEY);
          tx.oncomplete = () => {
            db.close();
            resolve(true);
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
        } catch (err) {
          db.close();
          reject(err);
        }
      };
      req.onerror = () => reject(req.error);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Saqlangan DirectoryHandle ni tozalash
 */
export async function clearGalleryDirHandle() {
  if (typeof indexedDB === 'undefined') return false;
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(GALLERY_DB_NAME, GALLERY_DB_VER);
      req.onsuccess = () => {
        const db = req.result;
        try {
          const tx = db.transaction(GALLERY_STORE, 'readwrite');
          tx.objectStore(GALLERY_STORE).delete(HANDLE_KEY);
          tx.oncomplete = () => {
            db.close();
            resolve(true);
          };
          tx.onerror = () => {
            db.close();
            resolve(false);
          };
        } catch (_) {
          db.close();
          resolve(false);
        }
      };
      req.onerror = () => resolve(false);
    } catch (_) {
      resolve(false);
    }
  });
}

/**
 * Tanlangan papka nomi to'g'ri ekanligini qat'iy tekshirish
 */
export function isAllowedGalleryFolder(dirHandle) {
  if (!dirHandle || !dirHandle.name) return false;
  const name = String(dirHandle.name).toLowerCase().trim();
  return ALLOWED_FOLDER_KEYWORDS.some(k => name.includes(k));
}

/**
 * Android qurilma ekanligini aniqlash
 */
export function isAndroidMobile() {
  if (typeof navigator === 'undefined') return false;
  return /android/i.test(navigator.userAgent || '');
}

/**
 * Noto'g'ri papka tanlanganda ochiladigan chiroyli Modal Popup
 */
export function showInvalidFolderModal({ onRetry, onCancel } = {}) {
  // Eski modal mavjud bo'lsa olib tashlaymiz
  const existing = document.getElementById('smrInvalidFolderModal');
  if (existing) {
    try { existing.remove(); } catch (_) {}
  }

  const overlay = document.createElement('div');
  overlay.id = 'smrInvalidFolderModal';
  overlay.className = 'smr-folder-modal-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'smrFolderModalTitle');

  overlay.innerHTML = `
    <div class="smr-folder-modal-box">
      <div class="smr-folder-modal-icon-wrap">
        <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
          <line x1="12" y1="11" x2="12" y2="15"></line>
          <line x1="12" y1="17" x2="12.01" y2="17"></line>
        </svg>
      </div>

      <h3 class="smr-folder-modal-title" id="smrFolderModalTitle">Noto'g'ri papka tanlandi</h3>
      <p class="smr-folder-modal-text">
        Galereyadagi barcha rasm va videolaringiz ko'rinishi uchun iltimos qurilmaning ichki xotirasidagi <strong>DCIM</strong> yoki <strong>Pictures</strong> papkasini tanlang.
      </p>

      <div class="smr-folder-modal-actions">
        <button type="button" class="smr-folder-btn smr-folder-btn-cancel" id="smrFolderCancelBtn">Bekor qilish</button>
        <button type="button" class="smr-folder-btn smr-folder-btn-retry" id="smrFolderRetryBtn">Qayta tanlash</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Animatsiyani faollashtirish
  requestAnimationFrame(() => {
    overlay.classList.add('open');
  });

  const close = () => {
    overlay.classList.remove('open');
    setTimeout(() => {
      try { overlay.remove(); } catch (_) {}
    }, 200);
  };

  overlay.querySelector('#smrFolderCancelBtn')?.addEventListener('click', () => {
    close();
    if (typeof onCancel === 'function') onCancel();
  });

  overlay.querySelector('#smrFolderRetryBtn')?.addEventListener('click', () => {
    close();
    if (typeof onRetry === 'function') onRetry();
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      close();
      if (typeof onCancel === 'function') onCancel();
    }
  });
}

/**
 * Papka tanlash va qat'iy tekshirish oqimi
 */
export async function pickAndValidateGalleryDirectory({ onInvalidFolder = null } = {}) {
  if (!('showDirectoryPicker' in window)) {
    throw new Error("Brauzeringiz File System Access API ni qo'llab-quvvatlamaydi");
  }

  let dirHandle;
  try {
    dirHandle = await window.showDirectoryPicker({
      mode: 'read',
      startIn: 'pictures',
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      return null; // Foydalanuvchi oynani bekor qildi
    }
    throw err;
  }

  if (!isAllowedGalleryFolder(dirHandle)) {
    // Noto'g'ri papka tanlandi
    if (typeof onInvalidFolder === 'function') {
      onInvalidFolder();
    } else {
      showInvalidFolderModal({
        onRetry: () => pickAndValidateGalleryDirectory({ onInvalidFolder }),
      });
    }
    return { invalid: true, dirHandle };
  }

  // To'g'ri papka tanlandi, saqlaymiz
  await saveGalleryDirHandle(dirHandle);
  return { valid: true, dirHandle };
}

/**
 * Tanlangan papka va uning barcha ichki ost-papkalarini (Camera, Screenshots va h.k.)
 * chaqmoq tezligida parallel va progressiv oqim bilan skanerlash.
 * Dastlabki topilgan fayllar darhol onBatch() orqali UI ga uzatiladi.
 * onProgress() esa skanerlash jarayonini real-vaqtda son va papka nomi bilan ko'rsatib boradi.
 */
export async function scanDirectory(dirHandle, maxDepthOrOptions = 3, maxCountParam = 150) {
  if (!dirHandle) return [];

  let maxDepth = 3;
  let maxCount = 150;
  let onProgress = null;
  let onBatch = null;

  if (typeof maxDepthOrOptions === 'object' && maxDepthOrOptions !== null) {
    maxDepth = maxDepthOrOptions.maxDepth ?? 3;
    maxCount = maxDepthOrOptions.maxCount ?? 150;
    onProgress = maxDepthOrOptions.onProgress ?? null;
    onBatch = maxDepthOrOptions.onBatch ?? null;
  } else {
    maxDepth = Number(maxDepthOrOptions) || 3;
    maxCount = Number(maxCountParam) || 150;
  }

  const rawEntries = [];
  const seenFileKeys = new Set();
  let totalScannedDirs = 0;
  let totalFoundFiles = 0;

  // 1) Papkalarni ustuvorlik bo'yicha saralash
  // DCIM ichida "Camera" eng muhim! Keyin "Screenshots", keyin boshqalar.
  function prioritizeDirs(dirs) {
    return dirs.sort((a, b) => {
      const aN = (a.name || '').toLowerCase();
      const bN = (b.name || '').toLowerCase();
      if (aN === 'camera') return -1;
      if (bN === 'camera') return 1;
      if (aN.includes('camera')) return -1;
      if (bN.includes('camera')) return 1;
      if (aN.includes('screenshot')) return -1;
      if (bN.includes('screenshot')) return 1;
      return 0;
    });
  }

  // Bitta papka ichidagi fayllarni parallel (chunks bilan) o'qish
  async function readDirectoryEntries(handle) {
    const files = [];
    const subDirs = [];
    try {
      for await (const entry of handle.values()) {
        if (entry.kind === 'file') {
          const name = entry.name || '';
          const dotIdx = name.lastIndexOf('.');
          const ext = dotIdx >= 0 ? name.slice(dotIdx + 1).toLowerCase() : '';
          if (IMAGE_EXTENSIONS.has(ext) || VIDEO_EXTENSIONS.has(ext)) {
            files.push(entry);
          }
        } else if (entry.kind === 'directory') {
          const dName = (entry.name || '').toLowerCase();
          const isIgnored = dName.startsWith('.') ||
                            dName.includes('thumb') ||
                            dName.includes('cache') ||
                            dName.includes('trashed') ||
                            dName === 'lost.dir';
          if (!isIgnored) {
            subDirs.push(entry);
          }
        }
      }
    } catch (err) {
      console.warn('[GalleryFS] dir read error:', handle.name, err);
    }
    return { files, subDirs };
  }

  // Parallel file.getFile() olish (Concurrency: 12)
  async function resolveFilesParallel(fileEntries, folderName) {
    const CHUNK_SIZE = 12;

    for (let i = 0; i < fileEntries.length; i += CHUNK_SIZE) {
      if (rawEntries.length >= maxCount * 2) break; // yetarli media yig'ildi

      const chunk = fileEntries.slice(i, i + CHUNK_SIZE);
      const batchFiles = await Promise.all(
        chunk.map(async (entry) => {
          try {
            const f = await entry.getFile();
            if (f && f.size > 0) {
              const key = `${f.name}_${f.size}_${f.lastModified}`;
              if (!seenFileKeys.has(key)) {
                seenFileKeys.add(key);
                const ext = (f.name.split('.').pop() || '').toLowerCase();
                const isImg = IMAGE_EXTENSIONS.has(ext);
                return {
                  file: f,
                  name: f.name || entry.name,
                  type: f.type || (isImg ? 'image/jpeg' : 'video/mp4'),
                  size: f.size,
                  lastModified: f.lastModified || Date.now(),
                };
              }
            }
          } catch (_) {}
          return null;
        })
      );

      const validItems = batchFiles.filter(Boolean);
      if (validItems.length > 0) {
        rawEntries.push(...validItems);
        totalFoundFiles = rawEntries.length;

        // Progress haqida xabar berish
        if (typeof onProgress === 'function') {
          onProgress({
            scannedCount: totalScannedDirs,
            foundCount: totalFoundFiles,
            currentFolder: folderName || 'DCIM',
            isComplete: false,
          });
        }

        // Yangi batch kelishi bilan UI ni darhol progressiv yangilash
        if (typeof onBatch === 'function') {
          const currentSorted = [...rawEntries].sort((a, b) => (b.lastModified || 0) - (a.lastModified || 0)).slice(0, maxCount);
          onBatch(currentSorted);
        }
      }
    }
  }

  async function processDirectory(handle, depth = 0) {
    if (!handle || depth > maxDepth || rawEntries.length >= maxCount * 2) return;
    totalScannedDirs++;

    if (typeof onProgress === 'function') {
      onProgress({
        scannedCount: totalScannedDirs,
        foundCount: totalFoundFiles,
        currentFolder: handle.name || 'DCIM',
        isComplete: false,
      });
    }

    const { files, subDirs } = await readDirectoryEntries(handle);

    // Agar fayllar bo'lsa, ularni parallel olamiz
    if (files.length > 0) {
      await resolveFilesParallel(files, handle.name);
    }

    if (depth < maxDepth && subDirs.length > 0 && rawEntries.length < maxCount * 2) {
      const prioritized = prioritizeDirs(subDirs);
      for (const sub of prioritized) {
        if (rawEntries.length >= maxCount * 2) break;
        await processDirectory(sub, depth + 1);
      }
    }
  }

  await processDirectory(dirHandle, 0);

  // Eng so'nggi (yangi) fotosuratlar va videolar birinchi bo'lib chiqishi uchun saralaymiz
  rawEntries.sort((a, b) => (b.lastModified || 0) - (a.lastModified || 0));
  const finalResult = rawEntries.slice(0, maxCount);

  if (typeof onProgress === 'function') {
    onProgress({
      scannedCount: totalScannedDirs,
      foundCount: finalResult.length,
      currentFolder: dirHandle.name || 'DCIM',
      isComplete: true,
    });
  }

  if (typeof onBatch === 'function') {
    onBatch(finalResult);
  }

  return finalResult;
}

// Qulaylik uchun alias
export const scanDirectoryForMedia = scanDirectory;
