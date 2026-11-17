/**
 * tests/camera-freeze-and-dcim-turbo.test.mjs
 * Regression test for:
 * 1. Camera freeze extermination (z-index 2147483640, pointer-events, touch-action, button isolation)
 * 2. DCIM Turbo Parallel Streaming Engine (chunking, Camera prioritization, onProgress, onBatch)
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';
import assert from 'assert';

console.log('=== TEST: Camera Freeze & DCIM Turbo Streaming Engine ===');

// 1. Check CSS/chat-attach.css
const chatAttachCss = readFileSync(resolve('CSS/chat-attach.css'), 'utf8');

assert(
  chatAttachCss.includes('#camCapture {') &&
  chatAttachCss.includes('z-index: 2147483640 !important;'),
  'FAIL: #camCapture must have maximum z-index 2147483640 !important'
);
console.log('✓ PASS: #camCapture z-index is set to 2147483640');

assert(
  chatAttachCss.includes('.cc-video {') &&
  chatAttachCss.includes('pointer-events: none !important;'),
  'FAIL: .cc-video must have pointer-events: none !important'
);
console.log('✓ PASS: .cc-video has pointer-events: none !important');

assert(
  chatAttachCss.includes('.cc-shutter {') &&
  chatAttachCss.includes('pointer-events: auto !important;') &&
  chatAttachCss.includes('touch-action: manipulation !important;'),
  'FAIL: .cc-shutter must have pointer-events: auto and touch-action: manipulation'
);
console.log('✓ PASS: .cc-shutter clickability and manipulation verified');

// 2. Check modules/chat/camera-capture.js
const camCaptureJs = readFileSync(resolve('modules/chat/camera-capture.js'), 'utf8');

assert(
  camCaptureJs.includes("if (e.target.closest('button, .cc-btn, .cc-shutter, .cc-mode, .cc-gallery-btn, .cc-top, .cc-bottom')) return;"),
  'FAIL: pointerdown in camera-capture.js must ignore button and control elements'
);
console.log('✓ PASS: Camera gesture listener isolates controls from gestures');

// 3. DCIM skaneri olib tashlangan: galereya tizim tanlagichi orqali ochiladi
import { existsSync } from 'node:fs';
assert(!existsSync(resolve('modules/ui/gallery-fs.js')), 'FAIL: gallery-fs.js (DCIM scanner) must be removed');
const attachMenuJs = readFileSync(resolve('modules/ui/attach-menu.js'), 'utf8');
assert(!/dcim|gallery-fs|showDirectoryPicker/i.test(attachMenuJs), 'FAIL: attach-menu.js must not contain DCIM scanning code');
assert(attachMenuJs.includes('galleryPicker.click()'), 'FAIL: gallery button must open the native picker');
console.log('✓ PASS: DCIM scanner removed; gallery uses native picker');

console.log('====================================================');
console.log('ALL CAMERA FREEZE TESTS PASSED!');
console.log('====================================================');
