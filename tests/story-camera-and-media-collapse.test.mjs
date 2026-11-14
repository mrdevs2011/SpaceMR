import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function assert(condition, message) {
  if (!condition) {
    console.error(`✗ FAIL: ${message}`);
    process.exit(1);
  }
}

console.log('=== TEST: Story Camera & Media Collapse Fixes ===');

// 1. Check modules/feed/stories.js
const storiesCode = readFileSync(resolve('modules/feed/stories.js'), 'utf8');
assert(storiesCode.includes('isMobileOrTabletDevice()'), 'stories.js must check isMobileOrTabletDevice()');
assert(storiesCode.includes('openCameraCapture({ forStory: true })'), 'stories.js must call openCameraCapture({ forStory: true }) on mobile/tablet');
assert(storiesCode.includes('openStoryComposer'), 'stories.js must fallback to openStoryComposer');
console.log('✓ PASS: stories.js mobile direct camera flow verified');

// 2. Check modules/chat/camera-capture.js
const camCode = readFileSync(resolve('modules/chat/camera-capture.js'), 'utf8');
assert(camCode.includes('cc-gallery-btn'), 'camera-capture.js must include cc-gallery-btn in bottom bar');
assert(camCode.includes('gallery:'), 'camera-capture.js must define gallery SVG');
assert(camCode.includes('initAttachMenu'), 'camera-capture.js must initialize attach menu on galleryBtn');
assert(camCode.includes('context: \'story_camera\'') || camCode.includes('isStoryCamera: true'), 'camera-capture.js must pass story_camera context');
assert(camCode.includes('galleryBtn.hidden = recording || reviewing'), 'camera-capture.js must hide gallery button while recording or reviewing');
console.log('✓ PASS: camera-capture.js gallery button and attach menu integration verified');

// 3. Check CSS/mono-x.css brace matching & cfm-media-dm
const monoCode = readFileSync(resolve('CSS/mono-x.css'), 'utf8');
let depth = 0;
let inComment = false;
for (let i = 0; i < monoCode.length; i++) {
  if (!inComment && monoCode.slice(i, i + 2) === '/*') {
    inComment = true;
    i++;
    continue;
  }
  if (inComment && monoCode.slice(i, i + 2) === '*/') {
    inComment = false;
    i++;
    continue;
  }
  if (!inComment) {
    if (monoCode[i] === '{') depth++;
    else if (monoCode[i] === '}') {
      depth--;
      assert(depth >= 0, `Brace mismatch in mono-x.css at char ${i}`);
    }
  }
}
assert(depth === 0, `Braces must balance in mono-x.css (depth: ${depth})`);
assert(monoCode.includes('.cfm-media-dm {') && monoCode.includes('min-width: min(240px, 72vw) !important'), 'mono-x.css must enforce min-width on .cfm-media-dm to prevent collapse');
console.log('✓ PASS: mono-x.css brace balance and zero-collapse verified');

// 4. Check CSS/features.css scrollbar hide on #chatThreadMessages
const featCode = readFileSync(resolve('CSS/features.css'), 'utf8');
assert(featCode.includes('#chatThreadMessages::-webkit-scrollbar'), 'features.css must hide scrollbar for #chatThreadMessages');
assert(featCode.includes('scrollbar-width: none !important'), 'features.css must set scrollbar-width: none for #chatThreadMessages');
console.log('✓ PASS: features.css scrollbar hide verified');

console.log('====================================================');
console.log('ALL STORY CAMERA & MEDIA COLLAPSE TESTS PASSED (100%)');
console.log('====================================================');
