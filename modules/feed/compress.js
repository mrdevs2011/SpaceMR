/* Cross-browser image preparation. Original file is always retained as a safe fallback. */
const IMG_MAX_DIM = 2048;
const IMG_QUALITY = 0.9;
const STORY_MAX_DIM = 1440;
const STORY_QUALITY = 0.82;
const MIME_BY_EXT = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', heic: 'image/heic', heif: 'image/heif', bmp: 'image/bmp' };

function imageMime(file) {
  const type = String(file?.type || '').toLowerCase().split(';')[0];
  if (type.startsWith('image/')) return type;
  const ext = String(file?.name || '').toLowerCase().split('.').pop();
  return MIME_BY_EXT[ext] || '';
}

async function decodeImage(file) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file); } catch (_) { /* Safari/HEIC fallback */ }
  }
  return decodeWithImageElement(file);
}

function decodeWithImageElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Rasm brauzerda ochilmadi')); };
    img.src = url;
  });
}

function hasTransparency(source) {
  try {
    const sample = document.createElement('canvas');
    sample.width = 48; sample.height = 48;
    const ctx = sample.getContext('2d', { willReadFrequently: true });
    if (!ctx) return false;
    ctx.drawImage(source, 0, 0, 48, 48);
    const data = ctx.getImageData(0, 0, 48, 48).data;
    sample.width = 0; sample.height = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] < 250) return true;
  } catch (_) {}
  return false;
}

function canvasBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Rasmni kodlab bo‘lmadi')), type, quality);
    } catch (e) { reject(e); }
  });
}

/**
 * JPG/PNG/WebP/AVIF/HEIC/BMP rasmlarini brauzer qo‘llasa JPEG/PNG ga aylantiradi.
 * GIF animatsiyasini saqlash uchun o‘zgartirmaydi. Har qanday decode/canvas xatosida original qaytadi.
 */
export async function compressImage(file, opts = {}) {
  if (!file) return file;
  const sourceMime = imageMime(file);
  if (!sourceMime || sourceMime === 'image/gif' || sourceMime === 'image/svg+xml') return file;

  let source = null;
  let bitmap = false;
  try {
    source = await decodeImage(file);
    bitmap = typeof source.close === 'function';
    const sw = source.width || source.naturalWidth;
    const sh = source.height || source.naturalHeight;
    if (!(sw > 0 && sh > 0)) return file;

    const maxDim = opts.preset === 'story' ? STORY_MAX_DIM : (opts.maxDim || IMG_MAX_DIM);
    const quality = opts.preset === 'story' ? STORY_QUALITY : (opts.quality || IMG_QUALITY);
    const scale = Math.min(1, maxDim / Math.max(sw, sh));
    const w = Math.max(1, Math.round(sw * scale));
    const h = Math.max(1, Math.round(sh * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return file;
    ctx.drawImage(source, 0, 0, w, h);

    const transparent = hasTransparency(source);
    const mime = transparent ? 'image/png' : 'image/jpeg';
    const blob = await canvasBlob(canvas, mime, transparent ? undefined : quality);
    canvas.width = 0; canvas.height = 0;
    if (!blob || !blob.size) return file;

    // Faylni ozgina kichraytirish uchun sifatni yo‘qotmaymiz; faqat katta tejash bo‘lsa almashtiramiz.
    const threshold = opts.preset === 'story' ? 0.9 : 0.94;
    if (blob.size >= file.size * threshold && sourceMime !== 'image/heic' && sourceMime !== 'image/heif' && sourceMime !== 'image/avif') return file;

    const base = String(file.name || 'photo').replace(/\.[^.]*$/, '').replace(/[^\w.-]/g, '_') || 'photo';
    const ext = transparent ? '.png' : '.jpg';
    return new File([blob], base + ext, { type: mime, lastModified: Date.now() });
  } catch (e) {
    console.warn('[compress] image conversion unavailable; original retained:', e?.message || e);
    return file;
  } finally {
    if (bitmap && source) { try { source.close(); } catch (_) {} }
  }
}
