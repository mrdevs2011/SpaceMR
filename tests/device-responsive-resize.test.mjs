import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const listeners = new Map();
let layoutChangeEvents = 0;
const rootAttrs = {};
let width = 1440;
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/156.0.0.0 Safari/537.36', maxTouchPoints: 0 } });
globalThis.document = { documentElement: { setAttribute: (k, v) => { rootAttrs[k] = v; } } };
globalThis.window = {
  get innerWidth() { return width; },
  addEventListener: (name, fn) => { const a = listeners.get(name) || []; a.push(fn); listeners.set(name, a); },
  dispatchEvent: event => { if (event.type === 'spacemr:devicechange') layoutChangeEvents++; for (const fn of listeners.get(event.type) || []) fn(event); },
  requestAnimationFrame: fn => { fn(); return 1; },
};
const desktop = await import('../modules/core/device.js?desktop-resize-test');
assert.equal(desktop.DEVICE, 'desktop');
assert.equal(rootAttrs['data-device'], 'desktop');

function resizeTo(nextWidth, expected) {
  width = nextWidth;
  for (const fn of listeners.get('resize') || []) fn();
  assert.equal(desktop.DEVICE, expected, `DEVICE at ${nextWidth}px`);
  assert.equal(rootAttrs['data-device'], expected, `html[data-device] at ${nextWidth}px`);
}

resizeTo(1024, 'tablet');
assert.equal(layoutChangeEvents, 1, 'breakpoint change emits a layout event');
assert.equal(desktop.isDesktopDevice(), false);
assert.equal(desktop.isTabletDevice(), true);
assert.equal(desktop.isMobileDevice(), true);
assert.equal(desktop.isTouchDevice(), false, 'desktop hardware stays non-touch after window resize');
resizeTo(768, 'tablet');
assert.equal(layoutChangeEvents, 1, 'same breakpoint does not emit duplicate layout event');
resizeTo(390, 'phone');
assert.equal(layoutChangeEvents, 2, 'phone breakpoint emits a layout event');
assert.equal(desktop.isPhoneDevice(), true);
resizeTo(320, 'phone');
resizeTo(1280, 'desktop');
assert.equal(desktop.isDesktopDevice(), true);

Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', maxTouchPoints: 5 } });
const phoneHardware = await import('../modules/core/device.js?phone-hardware-test');
assert.equal(phoneHardware.PHYSICAL_DEVICE, 'phone');
assert.equal(phoneHardware.DEVICE, 'phone', 'phone UA stays phone in a wide viewport');
assert.equal(phoneHardware.isTouchDevice(), true);

Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)', maxTouchPoints: 5 } });
const tabletHardware = await import('../modules/core/device.js?tablet-hardware-test');
assert.equal(tabletHardware.PHYSICAL_DEVICE, 'tablet');
assert.equal(tabletHardware.DEVICE, 'tablet', 'tablet UA uses tablet layout in landscape');
width = 500;
for (const fn of listeners.get('resize') || []) fn();
assert.equal(tabletHardware.DEVICE, 'phone', 'narrow tablet viewport uses phone layout');
width = 768;
for (const fn of listeners.get('resize') || []) fn();
assert.equal(tabletHardware.DEVICE, 'tablet');

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const boot = html.slice(html.indexOf('/* Responsive layout:'), html.indexOf('</script>', html.indexOf('/* Responsive layout:')));
assert.match(boot, /addEventListener\('resize'/);
assert.match(boot, /w < 600 \? 'phone' : w < 1100 \? 'tablet' : 'desktop'/);
assert.match(boot, /window\.innerWidth/);
assert.doesNotMatch(boot, /visualViewport/);

const apps = readFileSync(new URL('../modules/apps/apps.js', import.meta.url), 'utf8');
assert.match(apps, /spacemr:devicechange/);
console.log('PASS desktop resize: desktop -> tablet -> phone -> desktop');
console.log('PASS JS layout helpers follow viewport while physical touch detection stays stable');
console.log('PASS physical phone/tablet classifications and narrow tablet layout');
console.log('PASS early HTML boot and apps re-render on responsive layout changes');
console.log('ALL RESPONSIVE RESIZE TESTS PASSED');
