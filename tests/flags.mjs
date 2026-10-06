/** Phase 8 — flags unit */
import {
  uidBucket, isKillSwitch, setKillSwitch, isEphemeralDevice, setEphemeralDevice,
  getRolloutPct, setRolloutPct, isSyncV2Enabled, isStoreV2Enabled, flagsSnapshot,
} from '../modules/core/store/flags.js';

// Minimal localStorage mock for Node
if (typeof globalThis.localStorage === 'undefined') {
  const m = new Map();
  globalThis.localStorage = {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
  };
}

let fail = 0;
function assert(c, msg) {
  if (!c) { console.error('FAIL', msg); fail++; }
  else console.log('ok', msg);
}

const b1 = uidBucket('user-aaa');
const b2 = uidBucket('user-aaa');
assert(b1 === b2, 'bucket stable');
assert(b1 >= 0 && b1 < 100, 'bucket range');

setKillSwitch(false);
setEphemeralDevice(false);
setRolloutPct(0);
localStorage.removeItem('ff_sync_v2');
assert(isSyncV2Enabled('x') === false, 'sync off by default');

localStorage.setItem('ff_sync_v2', '1');
assert(isSyncV2Enabled('x') === true, 'sync force on');
localStorage.setItem('ff_sync_v2', '0');
assert(isSyncV2Enabled('x') === false, 'sync force off');

localStorage.removeItem('ff_sync_v2');
setRolloutPct(100);
assert(isSyncV2Enabled('any') === true, 'rollout 100');
setRolloutPct(0);
assert(isSyncV2Enabled('any') === false, 'rollout 0');

setKillSwitch(true);
localStorage.setItem('ff_sync_v2', '1');
assert(isSyncV2Enabled('x') === false, 'kill blocks sync');
assert(isStoreV2Enabled() === false, 'kill blocks store');
setKillSwitch(false);

setEphemeralDevice(true);
assert(isStoreV2Enabled() === false, 'ephemeral blocks store');
setEphemeralDevice(false);

const snap = flagsSnapshot('user-aaa');
assert(typeof snap.bucket === 'number', 'snapshot');

if (fail) process.exit(1);
console.log('ALL PASS');
