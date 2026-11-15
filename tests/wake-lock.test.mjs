/**
 * tests/wake-lock.test.mjs
 * SpaceMR Screen Wake Lock Engine Unit & Regression Tests.
 */

import assert from 'assert';
import { readFileSync } from 'fs';
import { resolve } from 'path';

console.log('=== TEST: Screen Wake Lock Engine ===');

// 1. Fayllar mavjudligi va ulanishi
const indexHtml = readFileSync(resolve('index.html'), 'utf8');
assert.ok(indexHtml.includes('modules/core/wake-lock.js'), 'wake-lock.js must be loaded in index.html');
console.log('✓ PASS: wake-lock.js correctly referenced in index.html');

const scriptJs = readFileSync(resolve('modules/script.js'), 'utf8');
assert.ok(scriptJs.includes('./core/wake-lock.js'), 'wake-lock.js must be imported in modules/script.js');
console.log('✓ PASS: wake-lock.js imported in modules/script.js');

// 2. Mock environment va funksionallik testi
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.document = {
  visibilityState: 'visible',
  addEventListener: () => {},
  removeEventListener: () => {},
  createElement: (tag) => {
    return {
      tagName: tag,
      setAttribute: () => {},
      style: {},
      play: async () => {},
      pause: () => {},
      remove: () => {},
      isConnected: false
    };
  },
  body: {
    appendChild: () => {}
  }
};

let nativeRequestCalled = false;
let mockReleased = false;

Object.defineProperty(globalThis.navigator, 'wakeLock', {
  value: {
    request: async (type) => {
      assert.strictEqual(type, 'screen', 'Wake lock must request screen');
      nativeRequestCalled = true;
      return {
        type: 'screen',
        released: false,
        release: async () => { mockReleased = true; },
        addEventListener: (event, cb) => {}
      };
    }
  },
  configurable: true,
  writable: true
});

const { acquireWakeLock, releaseWakeLock, initWakeLock } = await import('../modules/core/wake-lock.js');

assert.strictEqual(typeof acquireWakeLock, 'function', 'acquireWakeLock must be exported');
assert.strictEqual(typeof releaseWakeLock, 'function', 'releaseWakeLock must be exported');
assert.strictEqual(typeof initWakeLock, 'function', 'initWakeLock must be exported');

const res = await acquireWakeLock();
assert.strictEqual(res, true, 'acquireWakeLock should return true on success');
assert.strictEqual(nativeRequestCalled, true, 'navigator.wakeLock.request should have been called');
console.log('✓ PASS: acquireWakeLock successfully requested native screen wake lock');

await releaseWakeLock();
assert.strictEqual(mockReleased, true, 'releaseWakeLock must release lock');
console.log('✓ PASS: releaseWakeLock released the lock cleanly');

console.log('====================================================');
console.log('ALL SCREEN WAKE LOCK TESTS PASSED (100%)');
console.log('====================================================');
