/* ═══════════════════════════════════════════════════════════════════════
   MEDIA SIQISH (DIET F7.2) — Supabase Free 1 GB storage kvotasi uchun
   Rasm: canvas orqali ~1600px gacha kichraytirish + JPEG/PNG qayta siqish.
   Shaffof (transparent) rasmlar — PNG sifatida saqlanadi, fon qo'shilmaydi.
   Xato bo'lsa originalni qaytaradi (hech qachon yuklashni buzmaydi).
   ═══════════════════════════════════════════════════════════════════════ */

const IMG_MAX_DIM = 2560;   // eng uzun tomoni (sifat uchun)
const IMG_QUALITY = 0.92;   // JPEG sifati (xiralik kamayadi)
const IMG_MIN_SAVE = 0.92;  // siqish 8% dan kam tejasa — original qoladi

/** Canvasda alpha kanali bor-yo'qligini tekshiradi (shaffof piksel bormi). */
function _hasTransparency(ctx, w, h) {
  try {
    // Katta rasmlarda hammasini o'qimaslik uchun sampling
    const step = Math.max(1, Math.floor(Math.min(w, h) / 64));
    const data = ctx.getImageData(0, 0, w, h).data;
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        if (data[(y * w + x) * 4 + 3] < 255) return true;
      }
    }
    return false;
  } catch (_) {
    return false; // getImageData ishlamasa — shaffof deb hisoblamaymiz
  }
}

/** Rasm faylni siqib qaytaradi. Siqish kerakmas/mumkin bo'lmasa — original. */
export async function compressImage(file) {
  try {
    if (!file || !file.type.startsWith('image/')) return file;
    // GIF (animatsiya) va SVG ni tegma
    if (file.type === 'image/gif' || file.type === 'image/svg+xml') return file;

    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, IMG_MAX_DIM / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);

    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d', { alpha: true });

    // Avval hech qanday fon to'ldirmasdan chizamiz — shaffoflikni saqlash uchun
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close && bitmap.close();

    const transparent = _hasTransparency(ctx, w, h);

    let blob, mime, ext;
    if (transparent) {
      // Shaffof rasm — PNG (fon qo'shilmaydi)
      blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
      mime = 'image/png';
      ext = '.png';
    } else {
      // Oddiy rasm — JPEG (kichikroq)
      blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', IMG_QUALITY));
      mime = 'image/jpeg';
      ext = '.jpg';
    }

    if (!blob) return file;
    // Siqish foydasiz bo'lsa (kichik/kam presslangan rasm) — originalni qaytar
    if (blob.size >= file.size * IMG_MIN_SAVE) return file;

    const name = (file.name || 'photo').replace(/\.[^.]*$/, '') + ext;
    return new File([blob], name, { type: mime, lastModified: Date.now() });
  } catch (e) {
    console.warn('[compress] rasm siqilmadi, original ishlatiladi:', e?.message || e);
    return file;
  }
}
