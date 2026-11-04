import assert from 'node:assert/strict';
import { compressImage } from '../modules/feed/compress.js';

const originalBitmap = globalThis.createImageBitmap;
const originalDocument = globalThis.document;
const originalImage = globalThis.Image;

function setupCanvas({ transparent = false, outputSize = 1024 } = {}) {
  globalThis.document = {
    createElement() {
      return {
        width: 0, height: 0,
        getContext() {
          return {
            drawImage() {},
            getImageData() { const data = new Uint8ClampedArray(48 * 48 * 4); for (let i = 3; i < data.length; i += 4) data[i] = transparent ? 0 : 255; return { data }; },
          };
        },
        toBlob(cb, type) { cb(new Blob([new Uint8Array(outputSize)], { type })); },
      };
    },
  };
}

try {
  setupCanvas();
  globalThis.createImageBitmap = async () => ({ width: 4000, height: 3000, close() {} });
  const heic = new File([new Uint8Array(500_000)], 'mobile-photo.HEIC', { type: '' });
  const converted = await compressImage(heic);
  assert.notEqual(converted, heic, 'MIME bo‘sh HEIC ham dekodlanib o‘zgartirilishi kerak');
  assert.equal(converted.type, 'image/jpeg');
  assert.equal(converted.name, 'mobile-photo.jpg');

  setupCanvas({ transparent: true });
  globalThis.createImageBitmap = async () => ({ width: 800, height: 600, close() {} });
  const png = new File([new Uint8Array(200_000)], 'transparent.png', { type: 'image/png' });
  const pngOut = await compressImage(png);
  assert.equal(pngOut.type, 'image/png', 'Shaffoflik saqlanishi kerak');

  const gif = new File([new Uint8Array(100)], 'animated.gif', { type: 'image/gif' });
  assert.equal(await compressImage(gif), gif, 'GIF animatsiyasi o‘zgartirilmasligi kerak');

  setupCanvas();
  globalThis.createImageBitmap = async () => { throw new Error('bitmap unsupported'); };
  globalThis.Image = class {
    set src(_value) { this.naturalWidth = 1200; this.naturalHeight = 800; queueMicrotask(() => this.onload?.()); }
  };
  const fallback = new File([new Uint8Array(300_000)], 'fallback.jpg', { type: 'image/jpeg' });
  const fallbackOut = await compressImage(fallback);
  assert.notEqual(fallbackOut, fallback, 'createImageBitmap ishlamasa Image fallback ishlashi kerak');
  assert.equal(fallbackOut.type, 'image/jpeg');
  console.log('4/4 image compression OK');
} finally {
  if (originalBitmap === undefined) delete globalThis.createImageBitmap; else globalThis.createImageBitmap = originalBitmap;
  if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument;
  if (originalImage === undefined) delete globalThis.Image; else globalThis.Image = originalImage;
}
