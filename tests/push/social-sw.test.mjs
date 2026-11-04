import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import assert from 'node:assert/strict';

const src = readFileSync(new URL('../../social-push/sw.js', import.meta.url), 'utf8');
const handlers = {};
const shown = [];
const opened = [];
const selfObj = {
  addEventListener: (type, fn) => { handlers[type] = fn; },
  location: { origin: 'https://spacemr.vercel.app' },
  registration: { showNotification: async (title, options) => shown.push({ title, ...options }) },
};
const clientsObj = {
  matchAll: async () => [],
  openWindow: async path => { opened.push(path); return {}; },
};
vm.runInContext(src, vm.createContext({ self: selfObj, clients: clientsObj, URL, Promise, Date, JSON, String, RegExp }));

test('social worker displays activity notification and opens post comments on click', async () => {
  const postId = '22222222-2222-4222-8222-222222222222';
  let pending;
  handlers.push({
    data: { json: () => ({ type: 'social', title: 'Tester', body: 'Izoh: salom', postId, commentId: '44444444-4444-4444-8444-444444444444' }) },
    waitUntil: promise => { pending = promise; },
  });
  await pending;
  assert.equal(shown.length, 1);
  assert.equal(shown[0].title, 'Tester');
  assert.equal(shown[0].body, 'Izoh: salom');
  assert.equal(shown[0].data.postId, postId);

  let clickPending;
  handlers.notificationclick({
    notification: { data: shown[0].data, close() {} },
    waitUntil: promise => { clickPending = promise; },
  });
  await clickPending;
  assert.deepEqual(opened, [`/p/${postId}/comments`]);
});
