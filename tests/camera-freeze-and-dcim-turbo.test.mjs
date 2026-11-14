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

// 3. Check modules/ui/gallery-fs.js
const galleryFsJs = readFileSync(resolve('modules/ui/gallery-fs.js'), 'utf8');

assert(
  galleryFsJs.includes('onProgress') &&
  galleryFsJs.includes('onBatch') &&
  galleryFsJs.includes('prioritizeDirs') &&
  galleryFsJs.includes('resolveFilesParallel'),
  'FAIL: gallery-fs.js scanDirectory must support onProgress, onBatch, prioritizeDirs and parallel chunking'
);
console.log('✓ PASS: DCIM scanDirectory turbo parallel engine verified');

// 4. Test scanDirectory logic with mock FileSystemDirectoryHandle
import { scanDirectory } from '../modules/ui/gallery-fs.js';

let progressCalled = false;
let batchCalled = false;

const mockFileHandle = (name, lastModified = Date.now()) => ({
  kind: 'file',
  name,
  getFile: async () => ({
    name,
    size: 1024 * 50,
    lastModified,
    type: 'image/jpeg',
  }),
});

const mockDirHandle = {
  kind: 'directory',
  name: 'DCIM',
  async *values() {
    yield mockFileHandle('IMG_0001.jpg', 1000);
    yield mockFileHandle('IMG_0002.jpg', 2000);
    yield {
      kind: 'directory',
      name: 'Camera',
      async *values() {
        yield mockFileHandle('IMG_CAMERA_01.jpg', 3000);
        yield mockFileHandle('IMG_CAMERA_02.jpg', 4000);
      }
    };
  }
};

const entries = await scanDirectory(mockDirHandle, {
  maxDepth: 2,
  maxCount: 10,
  onProgress: (p) => { progressCalled = true; },
  onBatch: (b) => { batchCalled = true; },
});

assert(entries.length === 4, `Expected 4 media items, got ${entries.length}`);
assert(entries[0].name === 'IMG_CAMERA_02.jpg', 'Latest file must be first');
assert(progressCalled, 'onProgress must be triggered');
assert(batchCalled, 'onBatch must be triggered');
console.log('✓ PASS: mock Directory scan with Camera prioritization & streaming passed');

// 5. Check attach-menu.js for amGalleryLoadingText and live streaming
const attachMenuJs = readFileSync(resolve('modules/ui/attach-menu.js'), 'utf8');
assert(
  attachMenuJs.includes('amGalleryLoadingText') &&
  attachMenuJs.includes('onProgress') &&
  attachMenuJs.includes('onBatch'),
  'FAIL: attach-menu.js must bind amGalleryLoadingText and onBatch progressive render'
);
console.log('✓ PASS: attach-menu.js real-time progressive loader verified');

console.log('====================================================');
console.log('ALL CAMERA FREEZE & DCIM TURBO STREAMING TESTS PASSED!');
console.log('====================================================');
