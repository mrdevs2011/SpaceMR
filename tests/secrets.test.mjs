import { protectSecrets as P, maskSpoilers as M, hasSecrets } from '../modules/core/secrets.js';
import assert from 'node:assert/strict';
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.log('FAIL:', name, '\n  ', e.message.split('\n').slice(0,4).join('\n   ')); } };

/* Soxta, lekin real formatdagi kalitlar — runtime'da yasaladi, faylda haqiqiy kalit yo'q */
const rnd = (n, a='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789') => { let s=''; let x=12345; for(let i=0;i<n;i++){ x=(x*1103515245+12345)&0x7fffffff; s+=a[(x>>>8)%a.length]; } return s; };
const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' + 'eyJzdWIiOiIxMjM0NTY3ODkwIiwicm9sZSI6ImFub24ifQ.' + rnd(43);

const MUST_HIDE = {
  openai:     'sk-proj-' + rnd(48, 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-'),
  anthropic:  'sk-ant-api03-' + rnd(60, 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-'),
  github:     'ghp_' + rnd(36),
  githubpat:  'github_pat_' + rnd(60),
  slack:      'xoxb-' + '123456789012-' + rnd(24),
  google:     'AIza' + rnd(35),
  aws:        'AKIA' + rnd(16, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'),
  stripe:     'sk_live_' + rnd(32),
  supabase:   'sbp_' + rnd(40, '0123456789abcdef'),
  telegram:   '123456789:' + rnd(35),
  jwt,
  hf:         'hf_' + rnd(34),
  npm:        'npm_' + rnd(36),
  sendgrid:   'SG.' + rnd(22) + '.' + rnd(43),
  randomtok:  rnd(40),
  hex64:      rnd(64, '0123456789abcdef'),
};
for (const [k, v] of Object.entries(MUST_HIDE)) {
  t('hide ' + k + ' (alone)', () => assert.equal(P(v), '||' + v + '||'));
  t('hide ' + k + ' (in sentence)', () => assert.equal(P(`mana ${v} ol`), `mana ||${v}|| ol`));
}

t('PEM private key', () => {
  const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA' + rnd(60) + '\n' + rnd(64) + '\n-----END RSA PRIVATE KEY-----';
  assert.equal(P('mana: ' + pem + ' tamom'), 'mana: ||' + pem + '|| tamom');
});
t('PEM truncated (no END)', () => {
  const pem = '-----BEGIN PRIVATE KEY-----\n' + rnd(64);
  assert.equal(P(pem), '||' + pem + '||');
});
t('db url creds', () => assert.equal(P('postgres://admin:S3cretPass@db.example.com:5432/app qani'), '||postgres://admin:S3cretPass@db.example.com:5432/app|| qani'));
t('url without creds untouched', () => { const s = 'https://example.com/path?x=1 va http://localhost:3000'; assert.equal(P(s), s); });
t('Bearer', () => { const tok = rnd(30); assert.equal(P('Authorization: Bearer ' + tok), 'Authorization: Bearer ||' + tok + '||'); });
t('env line', () => { const v = rnd(40); assert.equal(P('SUPABASE_SERVICE_ROLE_KEY=' + v), 'SUPABASE_SERVICE_ROLE_KEY=||' + v + '||'); });
t('api_key: value', () => assert.equal(P('api_key: abcd1234efgh'), 'api_key: ||abcd1234efgh||'));
t('json style', () => assert.equal(P('{"apiKey": "abcd1234efgh5678"}'), '{"apiKey": "||abcd1234efgh5678||"}'));
t('parol uzbek', () => assert.equal(P('parol: qwerty123'), 'parol: ||qwerty123||'));
t('parol short', () => assert.equal(P('password=1234'), 'password=||1234||'));
t('parol dash', () => assert.equal(P('parol - abc12345'), 'parol - ||abc12345||'));
t('card visa', () => assert.equal(P('karta 4111 1111 1111 1111 mana'), 'karta ||4111 1111 1111 1111|| mana'));
t('card uzcard', () => assert.equal(P('8600 1234 5678 9012'), '||8600 1234 5678 9012||'));
t('card humo', () => assert.equal(P('9860123456789012'), '||9860123456789012||'));
t('multiple secrets', () => { const a='ghp_'+rnd(36), b='AIza'+rnd(35); assert.equal(P(`${a} va ${b}`), `||${a}|| va ||${b}||`); });
t('overlap kv+prefix merges', () => { const k='sk-proj-'+rnd(40,'abcdefghijklmnopqrstuvwxyz0123456789'); assert.equal(P('OPENAI_API_KEY='+k), 'OPENAI_API_KEY=||'+k+'||'); });
t('inside inline code → whole code wrapped', () => { const k='ghp_'+rnd(36); assert.equal(P('shu `'+k+'` ni ol'), 'shu ||`'+k+'`|| ni ol'); });
t('inside code block → whole block wrapped', () => { const k='ghp_'+rnd(36); const b='```\nTOKEN='+k+'\n```'; assert.equal(P(b), '||'+b+'||'); });
t('code block without secret untouched', () => { const b='```js\nconst a = 1;\nconsole.log(a)\n```'; assert.equal(P(b), b); });
t('already spoilered untouched', () => { const s='||ghp_'+rnd(36)+'||'; assert.equal(P(s), s); });
t('stray || cannot unhide', () => {
  const k='ghp_'+rnd(36); const out=P('||abc '+k);
  const unmatched = out.replace(/\|\|[\s\S]*?\|\|/g,'§');
  assert.ok(!unmatched.includes(k), 'secret exposed: '+out);
});

/* Xato ijobiylar: oddiy matnga TEGILMASLIGI kerak */
const SAFE = [
  'Salom, qalaysan? Bugun uchrashamizmi?',
  'git commit 3f786850e387550fdab836ed7e6dc881de23001b ni ko‘r',
  'uuid: 550e8400-e29b-41d4-a716-446655440000',
  'https://spacemr.vercel.app/modules/chat/chat-actions.js',
  'Mening raqamim +998 90 123 45 67',
  'Soat 12:30 da, narxi 150 000 so‘m',
  'token yo‘q hozircha',
  'parol kerak emas',
  'password: required',
  'api_key=YOUR_API_KEY',
  'TOKEN=<your-token-here>',
  'secret: ********',
  'key: value',
  'Bu kalit juda muhim',
  'epoch 1760700000000 va 1760700000001',
  'const veryLongFunctionNameThatDescribesSomething = 1;',
  'thisIsAVeryLongCamelCaseIdentifierWithoutDigitsAtAll',
  'src/modules/chat/message-bubble-component/index.js',
  '```js\nconst x = 1;\n```',
  '@username va #hashtag **qalin** ~~chizilgan~~',
  '😀😀😀',
  '',
  'ok',
];
for (const s of SAFE) t('safe: ' + JSON.stringify(s).slice(0, 50), () => assert.equal(P(s), s));
t('identity string when unchanged', () => { const s = 'oddiy matn bu'; assert.ok(P(s) === s); });

/* Idempotentlik */
for (const [k, v] of Object.entries(MUST_HIDE)) t('idempotent ' + k, () => { const once = P('x ' + v + ' y'); assert.equal(P(once), once); });
t('idempotent kv', () => { const o = P('parol: qwerty123 va api_key=abcd1234efgh'); assert.equal(P(o), o); });

/* maskSpoilers */
t('mask closed', () => assert.equal(M('a ||sir|| b'), 'a •••• b'));
t('mask unclosed (truncated preview)', () => assert.equal(M('a ||sirbusirbu'), 'a ••••'));
t('mask none', () => assert.equal(M('oddiy'), 'oddiy'));
t('hasSecrets', () => { assert.ok(hasSecrets('ghp_' + rnd(36))); assert.ok(!hasSecrets('salom dunyo')); });

/* Tezlik */
t('speed: 1000 typical messages < 100ms', () => {
  const msgs = Array.from({ length: 1000 }, (_, i) => `Salom ${i}, bugun nima qilamiz? https://example.com/page/${i}?x=${i} ok`);
  const t0 = performance.now(); for (const m of msgs) P(m); const dt = performance.now() - t0;
  console.log('   1000 msgs:', dt.toFixed(1), 'ms');
  assert.ok(dt < 100, dt + 'ms');
});
t('speed: 50KB hostile single word < 300ms', () => {
  const s = 'a-'.repeat(25000); const t0 = performance.now(); P(s); const dt = performance.now() - t0;
  console.log('   50KB hostile:', dt.toFixed(1), 'ms'); assert.ok(dt < 300, dt + 'ms');
});
t('speed: 100KB text with many pipes/backticks < 300ms', () => {
  const s = ('`a` || x | `').repeat(8000); const t0 = performance.now(); P(s); const dt = performance.now() - t0;
  console.log('   100KB pipes:', dt.toFixed(1), 'ms'); assert.ok(dt < 300, dt + 'ms');
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
