/** Phase 2 — cache-policy unit (Node, dependency-free) */
import { canCache, isExpired, policyOf, POLICY, SCHEMA_VERSION } from '../modules/core/cache-policy.js';

let fail = 0;
function assert(cond, msg) {
  if (!cond) { console.error('FAIL:', msg); fail++; }
  else console.log('ok:', msg);
}

assert(SCHEMA_VERSION === 2, 'schema v2');
assert(canCache('message') === true, 'message cacheable');
assert(canCache('presence') === false, 'presence not cacheable');
assert(canCache('nope') === false, 'unknown not cacheable');
assert(policyOf('profile')?.class === 'DOC', 'profile DOC');
assert(policyOf('typing')?.class === 'EPHEMERAL', 'typing ephemeral');
assert(isExpired('profile', Date.now()) === false, 'fresh profile');
assert(isExpired('profile', Date.now() - 8 * 24 * 3600 * 1000) === true, 'old profile expired');
assert(isExpired('message', 0) === false, 'LOG no maxAge');
assert(Object.keys(POLICY).length >= 10, 'policy table size');

if (fail) { console.error(fail, 'failed'); process.exit(1); }
console.log('ALL PASS');
