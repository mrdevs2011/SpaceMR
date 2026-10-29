import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><body><div class="view on"><div class="post-media" id="a"><video id="v1"></video></div><div class="post-media" id="b"><video id="v2"></video></div><div class="post-media" id="c"><video id="v3"></video></div></div></body>', { pretendToBeVisual: true });
globalThis.window = dom.window; globalThis.document = dom.window.document;
const log = [];
for (const id of ['v1','v2','v3']) {
  const v = document.getElementById(id);
  let paused = true;
  Object.defineProperty(v, 'paused', { get: () => paused });
  Object.defineProperty(v, 'ended', { get: () => false });
  v.pause = () => { if (!paused) { paused = true; log.push(id + ' paused'); v.dispatchEvent(new dom.window.Event('pause')); } };
  v.play = () => { paused = false; v.dispatchEvent(new dom.window.Event('play')); return Promise.resolve(); };
}
await import('../modules/feed/post-media-guard.js');
const st = () => ['v1','v2','v3'].map(i => document.getElementById(i).paused ? 'P' : 'PLAY').join(',');
document.getElementById('v1').play(); console.log('after v1.play  :', st());
document.getElementById('v2').play(); console.log('after v2.play  :', st());
document.getElementById('v3').play(); console.log('after v3.play  :', st());
document.getElementById('v1').play(); console.log('after v1.play  :', st());
// brauzer tabi yashirilganda
Object.defineProperty(document, 'hidden', { get: () => true, configurable: true });
document.dispatchEvent(new dom.window.Event('visibilitychange'));
console.log('after tab hide :', st());
const ok = st() === 'P,P,P';
console.log(ok ? 'PASS' : 'FAIL'); process.exit(ok ? 0 : 1);
