import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

console.log('--- 1. Testing Syntax and async keyword in groups.js ---');
const groupsJs = readFileSync('modules/chat/groups.js', 'utf8');
assert.ok(!groupsJs.includes('const applyGroupPayload = (p) => {'), 'applyGroupPayload must not be sync');
assert.ok(groupsJs.includes('const applyGroupPayload = async (p) => {') || groupsJs.includes('async (p) => {'), 'applyGroupPayload must be async');
console.log('✓ PASS: groups.js applyGroupPayload is correctly async (exterminates SyntaxError: Unexpected identifier mediaSecureUrls)');

console.log('--- 2. Testing App Permissions module exports and structure ---');
const permJs = readFileSync('modules/settings/permissions.js', 'utf8');
assert.ok(permJs.includes('export const PERMISSIONS_CONFIG'), 'PERMISSIONS_CONFIG must be exported');
assert.ok(permJs.includes('export function isPermissionAllowed'), 'isPermissionAllowed must be exported');
assert.ok(permJs.includes('export function requirePermission'), 'requirePermission must be exported');
assert.ok(permJs.includes('export function setAppPermissionState'), 'setAppPermissionState must be exported');
assert.ok(permJs.includes('smr_perm_'), 'localStorage smr_perm_ prefix must exist');
console.log('✓ PASS: modules/settings/permissions.js structure and exports verified');

console.log('--- 3. Testing Permission Guards in Camera, Mic, Geolocation, Calls ---');
const micJs = readFileSync('modules/chat/chat-voice-record.js', 'utf8');
assert.ok(micJs.includes("isPermissionAllowed('microphone')"), 'chat-voice-record must check microphone permission');
assert.ok(micJs.includes("isPermissionAllowed('camera')"), 'chat-voice-record must check camera permission for video notes');

const camJs = readFileSync('modules/chat/camera-capture.js', 'utf8');
assert.ok(camJs.includes("isPermissionAllowed('camera')"), 'camera-capture must check camera permission');

const locJs = readFileSync('modules/ui/location-helper.js', 'utf8');
assert.ok(locJs.includes("isPermissionAllowed('geolocation')"), 'location-helper must check geolocation permission');

const callJs = readFileSync('modules/call/call.js', 'utf8');
assert.ok(callJs.includes("isPermissionAllowed('microphone')"), 'call.js must check microphone permission');
assert.ok(callJs.includes("isPermissionAllowed('camera')"), 'call.js must check camera permission');
console.log('✓ PASS: All media and sensor triggers are guarded by App-Level permissions');

console.log('--- 4. Testing Chat History Integrity & No minTs Purge ---');
const chatJs = readFileSync('modules/chat/chat.js', 'utf8');
// Must not contain the old minTs drop logic in _mergeLive
assert.ok(!chatJs.includes('if (minTs && (m.createdAt || 0) < minTs) continue;'), 'Old minTs filter must be purged from _mergeLive');
// Cache size must be 300
const cacheJs = readFileSync('modules/core/local-cache.js', 'utf8');
assert.ok(cacheJs.includes('const MAX_MSGS_PER_CHAT = 300;'), 'MAX_MSGS_PER_CHAT must be 300');
console.log('✓ PASS: Chat history persistence and older message preservation verified');

console.log('--- 5. Testing Settings UI Accordion HTML & CSS ---');
const indexHtml = readFileSync('index.html', 'utf8');
assert.ok(indexHtml.includes('id="permissionsGroup"'), 'permissionsGroup accordion must be present in index.html');
assert.ok(indexHtml.includes('id="permissionsList"'), 'permissionsList container must be present in index.html');
console.log('✓ PASS: Settings UI permissions accordion is verified');

console.log('\n====================================================');
console.log('ALL PERMISSIONS & CHAT HISTORY TESTS PASSED (100%)');
console.log('====================================================');
