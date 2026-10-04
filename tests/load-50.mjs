/* tests/load-50.mjs — MRspace yuk sinovi (~50 virtual foydalanuvchi).

   ⚠️ HAQIQIY (production) bazaga EMAS — alohida Supabase loyiha/branch'ga yurgiz.
      Production'ga yurgizsang: lt_001..lt_050 akkauntlari va ularning postlari oilaviy
      foydalanuvchilarga ko'rinadi (kechasi, qisqa yurgiz, darhol `cleanup` qil).

   Bosqichlar:
     node tests/load-50.mjs setup     # 50 ta test akkaunt (lt_001...) yaratadi + tasdiqlaydi
     node tests/load-50.mjs run       # login → realtime → chat/guruh/post → hisobot
     node tests/load-50.mjs cleanup   # barcha lt_* akkaunt va ma'lumotlarni o'chiradi
     node tests/load-50.mjs full      # setup + run + cleanup

   Kerakli env (kalitlarni repo'ga yozma, terminalda export qil):
     LOAD_SUPABASE_URL   LOAD_ANON_KEY   LOAD_SERVICE_KEY   LOAD_CONFIRM=yes
   Ixtiyoriy:
     USERS=50 (max 80)  DURATION_SEC=180  WAVES=2 (DM juftliklari)  LOAD_PUBLIC_POSTS=0 (postlar ochiq bo'lmasin)

   Bir marta o'rnatish:  npm i --no-save @supabase/supabase-js
   Sinov foydalanuvchi xatti-harakatini taqlid qiladi va DB rate-limit triggerlaridan (047) oshmaydi:
   xabar ~8/daq, 3 chat/daq, 3 post/daq. Rate-limit javobi "xato" emas, alohida sanaladi. */
import { createClient } from '@supabase/supabase-js';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import readline from 'node:readline/promises';

const HERE = join(fileURLToPath(import.meta.url), '..');
const STATE = join(HERE, '.load-state.json');
const env = process.env;
const real = v => (v && !/\.\.\.|XXXX/.test(v) ? v : undefined);   // "..." / XXXX namuna qiymatlarni tashlab yuboradi
let URL_ = real(env.LOAD_SUPABASE_URL), ANON = real(env.LOAD_ANON_KEY), SERVICE = real(env.LOAD_SERVICE_KEY);
let N = Math.min(+env.USERS || 50, 80);
let DURATION = (+env.DURATION_SEC || 180) * 1000;
let CONFIRMED = env.LOAD_CONFIRM === 'yes';
let CMD = process.argv[2];
const WAVES = Math.max(1, Math.min(+env.WAVES || 2, 3));
const PUBLIC_POSTS = env.LOAD_PUBLIC_POSTS !== '0';
const PFX = 'lt_', DOMAIN = 'loadtest.example';
const RL = /kuting|too many|rate limit/i;
const NET = /fetch failed|ECONN|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket|network/i;   // tarmoq uzilishi (server emas)

const sleep = ms => new Promise(r => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];
const die = m => { console.error('❌ ' + m); process.exit(1); };
const pct = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return Math.round(s[Math.min(s.length - 1, Math.floor(p / 100 * s.length))]); };
async function pool(items, n, fn) {
  const q = [...items];
  await Promise.all(Array.from({ length: Math.min(n, q.length) }, async () => { while (q.length) await fn(q.shift()); }));
}
const mk = key => createClient(URL_, key, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  realtime: { params: { eventsPerSecond: 60 } },
});

function guard(needService) {
  if (!URL_ || !ANON || (needService && !SERVICE)) die('LOAD_SUPABASE_URL / LOAD_ANON_KEY / LOAD_SERVICE_KEY env kerak.');
  let host;
  try { host = new URL(URL_).host; } catch (_) { die(`LOAD_SUPABASE_URL noto'g'ri: "${URL_}". Haqiqiy manzil kerak, masalan https://abcdxyz.supabase.co ("..." faqat namuna edi).`); }
  if (/\.\.\./.test(ANON + (SERVICE || ''))) die('Kalitlar o\'rnida "..." qolib ketgan — haqiqiy kalitlarni qo\'y.');
  console.log(`🎯 Nishon: ${host}  |  foydalanuvchi: ${N}  |  davomiylik: ${DURATION / 1000}s`);
  try {
    const linked = readFileSync(join(HERE, '..', 'supabase', '.temp', 'project-ref'), 'utf8').trim();
    if (linked && host.startsWith(linked + '.') && env.LOAD_ALLOW_LINKED !== 'yes')
      die(`Bu loyiha (${linked}) repo'ga ulangan — ehtimol PRODUCTION. Yuk sinovi faqat alohida sinov loyihasida yurgiziladi.`);
  } catch (_) {}
  if (!CONFIRMED) die(`Nishon ${host} to'g'rimi? Tasdiqlash uchun LOAD_CONFIRM=yes qo'sh (production bo'lsa — to'xta va alohida loyiha ishlat).`);
}

/* ── Statistika ─────────────────────────────────────────────── */
const stats = {};
function rec(op, ms, kind, msg) {
  const s = (stats[op] ||= { n: 0, ok: 0, fail: 0, rl: 0, net: 0, lat: [], errs: {} });
  s.n++; s[kind === 'ok' ? 'ok' : kind]++;
  if (kind === 'ok') s.lat.push(ms);
  else if (msg) s.errs[msg.slice(0, 80)] = (s.errs[msg.slice(0, 80)] || 0) + 1;
}
async function timed(op, fn) {
  const t = performance.now();
  try {
    const res = await fn();
    if (res?.error) throw res.error;
    if (res?.data && typeof res.data === 'object' && res.data.success === false) throw new Error(res.data.error || 'success=false');
    rec(op, performance.now() - t, 'ok');
    return { ok: true, data: res?.data };
  } catch (e) {
    const msg = e?.message || String(e);
    if (e?.code === '23505') { rec(op, performance.now() - t, 'ok'); return { ok: true, dup: true }; }
    const rl = RL.test(msg);
    rec(op, performance.now() - t, rl ? 'rl' : NET.test(msg) ? 'net' : 'fail', msg);
    return { ok: false, rl, err: msg };
  }
}
/* tayyorlash bosqichida rate-limitga tushsa kutib qayta uradi */
async function must(op, fn, tries = 3) {
  let r;
  for (let i = 0; i < tries; i++) {
    r = await timed(op, fn);
    if (r.ok) return r;
    if (r.rl) await sleep(62000);
    else if (NET.test(r.err || '')) await sleep(1500 * (i + 1));
    else return r;
  }
  return r;
}

/* ── SETUP ──────────────────────────────────────────────────── */
async function setup() {
  guard(true);
  const admin = mk(SERVICE);
  const password = 'Lt!' + randomBytes(9).toString('base64url');
  const users = [];
  await pool([...Array(N).keys()], 4, async i => {
    const uname = PFX + String(i + 1).padStart(3, '0'), email = `${uname}@${DOMAIN}`;
    let id;
    const { data, error } = await admin.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { username: uname, full_name: 'Load ' + uname },
    });
    if (error) {
      const { data: p } = await admin.from('profiles').select('id').eq('username', uname).maybeSingle();
      if (!p) return console.error('createUser xato:', uname, error.message);
      id = p.id;
      await admin.auth.admin.updateUserById(id, { password });
    } else id = data.user.id;
    users[i] = { i, uname, email, id };
  });
  const ok = users.filter(Boolean);
  if (!ok.length) die('Hech qanday akkaunt yaratilmadi.');
  const ids = ok.map(u => u.id);
  const { error: aErr } = await admin.from('profiles').update({ approval: 'approved' }).in('id', ids);
  if (aErr) die('Tasdiqlash xatosi: ' + aErr.message + (/Cannot modify approval/.test(aErr.message)
    ? '\n   → Bu loyihada 031 trigger service key bilan tasdiqlashni to\'sadi. Production himoyasini susaytirma: alohida SINOV loyihasida ishlat.' : ''));
  const { count } = await admin.from('profiles').select('id', { count: 'exact', head: true }).in('id', ids).eq('approval', 'approved');
  await writeFile(STATE, JSON.stringify({ password, users: ok, createdAt: new Date().toISOString() }, null, 1));
  console.log(`✅ ${ok.length} akkaunt tayyor, tasdiqlangan: ${count}. Holat: tests/.load-state.json`);
}

/* ── RUN ────────────────────────────────────────────────────── */
async function run() {
  guard(false);
  if (!existsSync(STATE)) die('Avval: node tests/load-50.mjs setup');
  const st = JSON.parse(await readFile(STATE, 'utf8'));
  const U = st.users.slice(0, N).map(u => ({ ...u, chats: [], groups: [], rt: false, ok: false }));
  const runId = randomBytes(2).toString('hex');
  const expected = new Map(), got = new Map(), rtLat = [];
  const postPool = [];

  console.log('🔐 Login...');
  /* Supabase bitta IP'dan login'ni cheklaydi (~30/5 daq) — rate-limit/tarmoq xatosida kutib qayta uradi */
  await pool(U, 4, async u => {
    u.c = mk(ANON);
    for (let i = 0; i < 25 && !u.ok; i++) {
      const r = await timed('login', () => u.c.auth.signInWithPassword({ email: u.email, password: st.password }));
      if (r.ok) u.ok = true;
      else if (r.rl) await sleep(20000 + rnd(0, 5000));
      else if (NET.test(r.err || '')) await sleep(2000);
      else break;
    }
  });
  const A = U.filter(u => u.ok);
  console.log(`   ${A.length}/${U.length} login muvaffaqiyatli`);
  if (A.length < 2) die('Login deyarli ishlamadi — setup/kalitlarni tekshir.');

  console.log('📡 Realtime ulanish...');
  const onRow = (me, row) => {
    if (!row || row.sender_id === me.id || !row.text?.startsWith('LT|')) return;
    rtLat.push(Date.now() - (+row.text.split('|')[2]));
    if (!got.has(row.id)) got.set(row.id, new Set());
    got.get(row.id).add(me.id);
  };
  await pool(A, 10, u => new Promise(res => {
    const to = setTimeout(() => res(), 15000);
    u.ch = u.c.channel('lt-' + u.i)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, p => onRow(u, p.new))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'group_messages' }, p => onRow(u, p.new))
      .subscribe(s => {
        if (s === 'SUBSCRIBED') { u.rt = true; clearTimeout(to); res(); }
        else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') { clearTimeout(to); res(); }
      });
  }));

  console.log('💬 Chatlar ochilmoqda (to\'lqinlar rate-limit oynasiga mos)...');
  for (let w = 0; w < WAVES; w++) {
    const off = w === 0 ? 1 : 7 * w;
    await pool(A.map((u, k) => ({ u, peer: A[(k + off) % A.length] })), 10, async ({ u, peer }) => {
      if (u === peer) return;
      const r = await must('chat_open', () => u.c.rpc('get_or_create_chat', { p_other: peer.id }));
      if (!r.ok || !r.data) return;
      if (!u.chats.some(c => c.chatId === r.data)) u.chats.push({ chatId: r.data, peer });
      if (!peer.chats.some(c => c.chatId === r.data)) peer.chats.push({ chatId: r.data, peer: u });
    });
    if (w < WAVES - 1) { console.log('   ⏳ keyingi to\'lqin uchun 65s kutilmoqda...'); await sleep(65000); }
  }

  console.log('👥 Guruhlar...');
  const G = Math.max(2, Math.round(A.length / 9));
  const groups = [];
  for (let k = 0; k < G; k++) {
    const owner = A[Math.floor(k * A.length / G)];
    const gid = randomUUID(), code = randomBytes(32).toString('hex');
    const r = await must('group_create', () => owner.c.from('groups').insert({
      id: gid, type: 'group', name: `LT ${runId} #${k + 1}`, owner_id: owner.id, is_private: true, username: null, invite_code: code,
    }));
    if (r.ok) { const g = { gid, code, owner, members: [owner] }; groups.push(g); owner.groups.push(g); }
  }
  if (!groups.length) console.warn('⚠️ Guruh yaratib bo\'lmadi — guruh testlari o\'tkazib yuboriladi.');
  else await pool(A.filter(u => !groups.some(g => g.owner === u)).map((u, k) => ({ u, g: groups[k % groups.length] })), 6, async ({ u, g }) => {
    const r = await must('group_join', () => u.c.rpc('join_group_by_token', { p_token: g.code }));
    if (r.ok) { g.members.push(u); u.groups.push(g); }
  });

  console.log('📝 Boshlang\'ich postlar...');
  for (const u of A.slice(0, 3)) {
    const r = await timed('post_create', () => u.c.from('posts').insert({ user_id: u.id, user_full_name: 'Load ' + u.uname, text: 'LT seed post', is_public: PUBLIC_POSTS }).select('id').single());
    if (r.ok && r.data?.id) postPool.push(r.data.id);
  }

  /* ── Asosiy sikl ── */
  const W = [['dm', 50], ['grp', 25], ['readChat', 9], ['feed', 8], ['like', 4], ['comment', 3], ['post', 1]];
  const pickAct = () => { let x = Math.random() * 100; for (const [n, w] of W) { if ((x -= w) < 0) return n; } return 'dm'; };
  const msgText = (id, u) => `LT|${id.slice(0, 8)}|${Date.now()}|salom ${u.uname}`;

  async function act(u) {
    const a = pickAct();
    if (a === 'dm' && u.chats.length) {
      const ch = pick(u.chats), id = randomUUID();
      if (ch.peer.rt) expected.set(id, new Set([ch.peer.id]));
      const r = await timed('dm_send', () => u.c.from('messages').insert({ id, chat_id: ch.chatId, sender_id: u.id, type: 'text', text: msgText(id, u) }));
      if (!r.ok) expected.delete(id);
    } else if (a === 'grp' && u.groups.length) {
      const g = pick(u.groups), id = randomUUID();
      expected.set(id, new Set(g.members.filter(m => m !== u && m.rt).map(m => m.id)));
      const r = await timed('group_send', () => u.c.from('group_messages').insert({ id, group_id: g.gid, sender_id: u.id, type: 'text', text: msgText(id, u) }));
      if (!r.ok) expected.delete(id);
    } else if (a === 'readChat' && u.chats.length) {
      await timed('chat_history', () => u.c.from('messages').select('*').eq('chat_id', pick(u.chats).chatId).order('created_at', { ascending: false }).limit(50));
    } else if (a === 'feed') {
      const r = await timed('feed_load', () => u.c.from('posts').select('*').order('created_at', { ascending: false }).limit(20));
      for (const p of r.data || []) if (postPool.length < 60 && !postPool.includes(p.id)) postPool.push(p.id);
    } else if (a === 'like' && postPool.length) {
      await timed('like', () => u.c.from('post_likes').insert({ post_id: pick(postPool), user_id: u.id }));
    } else if (a === 'comment' && postPool.length) {
      await timed('comment', () => u.c.from('comments').insert({ post_id: pick(postPool), user_id: u.id, user_name: 'Load ' + u.uname, text: 'LT izoh ' + Date.now() }));
    } else if (a === 'post') {
      if (u.lastPost && Date.now() - u.lastPost < 30000) return;
      u.lastPost = Date.now();
      const r = await timed('post_create', () => u.c.from('posts').insert({ user_id: u.id, user_full_name: 'Load ' + u.uname, text: 'LT post ' + Date.now(), is_public: PUBLIC_POSTS }).select('id').single());
      if (r.ok && r.data?.id && postPool.length < 60) postPool.push(r.data.id);
    }
  }

  console.log(`🚀 Asosiy sinov boshlandi: ${A.length} foydalanuvchi, ${DURATION / 1000}s...`);
  const end = Date.now() + DURATION;
  await Promise.all(A.map(async u => {
    await sleep(rnd(0, 8000));
    while (Date.now() < end) { await act(u); await sleep(rnd(5000, 12000)); }
  }));
  console.log('⏳ Realtime qoldiqlarini kutish (8s)...');
  await sleep(8000);

  /* ── Hisobot ── */
  let totExp = 0, totGot = 0;
  for (const [id, set] of expected) { totExp += set.size; const g = got.get(id); if (g) for (const x of set) if (g.has(x)) totGot++; }
  const loss = totExp ? +(100 * (1 - totGot / totExp)).toFixed(2) : 0;
  const rows = {};
  for (const [op, s] of Object.entries(stats)) rows[op] = { n: s.n, ok: s.ok, xato: s.fail, rateLimit: s.rl, tarmoq: s.net, p50: pct(s.lat, 50), p95: pct(s.lat, 95), p99: pct(s.lat, 99), max: pct(s.lat, 100) };
  console.log('\n══════ NATIJA (ms) ══════'); console.table(rows);
  const rtOk = A.filter(u => u.rt).length;
  const rt = { ulandi: `${rtOk}/${A.length}`, yetkazish_p50: pct(rtLat, 50), p95: pct(rtLat, 95), p99: pct(rtLat, 99), kutilgan: totExp, yetdi: totGot, yoqotish_foiz: loss };
  console.log('Realtime:', rt);
  for (const [op, s] of Object.entries(stats)) for (const [m, c] of Object.entries(s.errs)) console.log(`  ⚠ ${op} ×${c}: ${m}`);

  const write = ['dm_send', 'group_send', 'comment', 'like', 'post_create'];
  const bad = [];
  for (const op of write) { const s = stats[op]; if (s && pct(s.lat, 95) > 800) bad.push(`${op} p95 ${pct(s.lat, 95)}ms > 800ms`); }
  const real = Object.entries(stats).filter(([k]) => !['login'].includes(k)).reduce((a, [, s]) => [a[0] + s.fail, a[1] + s.n], [0, 0]);
  if (real[1] && real[0] / real[1] > 0.01) bad.push(`xato ulushi ${(100 * real[0] / real[1]).toFixed(1)}% > 1%`);
  const netTot = Object.values(stats).reduce((a, s) => a + s.net, 0);
  if (netTot) bad.push(`tarmoq uzilishi ${netTot} ta (bu kompyuter/internet, server emas)`);
  if (A.length < U.length) bad.push(`${U.length - A.length} ta foydalanuvchi login qila olmadi`);
  if (rtOk < A.length) bad.push(`realtime ulanmadi: ${A.length - rtOk} ta`);
  if (pct(rtLat, 95) > 1500) bad.push(`realtime p95 ${pct(rtLat, 95)}ms > 1500ms`);
  if (loss > 1) bad.push(`xabar yo'qotilishi ${loss}% > 1%`);
  console.log(bad.length ? '\n🟠 DIQQAT:\n - ' + bad.join('\n - ') : '\n🟢 Hammasi me\'yorda (p95 < 800ms, realtime < 1.5s, yo\'qotish < 1%, xato < 1%).');

  const file = join(HERE, `load-report-${Date.now()}.json`);
  await writeFile(file, JSON.stringify({ users: A.length, durationSec: DURATION / 1000, ops: rows, realtime: rt, warnings: bad }, null, 1));
  console.log('📄 Hisobot:', file);
  await Promise.all(A.map(async u => { try { await u.c.removeAllChannels(); await u.c.auth.signOut(); } catch (_) {} }));
}

/* ── CLEANUP ────────────────────────────────────────────────── */
async function cleanup() {
  guard(true);
  const admin = mk(SERVICE);
  const { data: profs, error } = await admin.from('profiles').select('id,username,email').like('email', `%@${DOMAIN}`);
  if (error) die(error.message);
  const ids = (profs || []).filter(p => p.username?.startsWith(PFX) && p.email?.endsWith('@' + DOMAIN)).map(p => p.id);
  if (!ids.length) return console.log('✅ Tozalanadigan lt_* akkaunt yo\'q.');
  console.log(`🧹 ${ids.length} ta test akkaunt tozalanmoqda...`);
  const del = async (label, q) => { const { error: e } = await q; console.log(e ? `  ⚠ ${label}: ${e.message}` : `  ✓ ${label}`); };
  const sel = async q => (await q).data?.map(r => r.id) || [];

  const postIds = await sel(admin.from('posts').select('id').in('user_id', ids));
  if (postIds.length) { await del('comments(post)', admin.from('comments').delete().in('post_id', postIds)); await del('likes(post)', admin.from('post_likes').delete().in('post_id', postIds)); }
  await del('comments', admin.from('comments').delete().in('user_id', ids));
  await del('likes', admin.from('post_likes').delete().in('user_id', ids));
  await del('posts', admin.from('posts').delete().in('user_id', ids));

  const gids = await sel(admin.from('groups').select('id').in('owner_id', ids));
  if (gids.length) { await del('group_messages(g)', admin.from('group_messages').delete().in('group_id', gids)); await del('group_members(g)', admin.from('group_members').delete().in('group_id', gids)); }
  await del('group_messages', admin.from('group_messages').delete().in('sender_id', ids));
  await del('group_members', admin.from('group_members').delete().in('user_id', ids));
  if (gids.length) await del('groups', admin.from('groups').delete().in('id', gids));

  const cids = [...new Set([...await sel(admin.from('chats').select('id').in('user_a', ids)), ...await sel(admin.from('chats').select('id').in('user_b', ids))])];
  for (let i = 0; i < cids.length; i += 40) {
    const part = cids.slice(i, i + 40);
    await del('messages(chat)', admin.from('messages').delete().in('chat_id', part));
    await del('chat_members', admin.from('chat_members').delete().in('chat_id', part));
    await del('chats', admin.from('chats').delete().in('id', part));
  }
  await del('messages', admin.from('messages').delete().in('sender_id', ids));
  await del('contacts(owner)', admin.from('contacts').delete().in('owner_id', ids));
  await del('contacts(contact)', admin.from('contacts').delete().in('contact_id', ids));
  await del('push_tokens', admin.from('push_tokens').delete().in('user_id', ids));

  let gone = 0;
  await pool(ids, 4, async id => { const { error: e } = await admin.auth.admin.deleteUser(id); if (e) console.log('  ⚠ deleteUser:', e.message); else gone++; });
  const { count } = await admin.from('profiles').select('id', { count: 'exact', head: true }).like('email', `%@${DOMAIN}`);
  console.log(`✅ ${gone}/${ids.length} akkaunt o'chirildi. Qolgan lt_* profillar: ${count ?? '?'}`);
}

/* ── Interaktiv so'rov: yetishmagan narsani birma-bir so'raydi (paste + Enter) ── */
async function interactive() {
  if (!process.stdin.isTTY) return;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = async (text, def) => {
    const a = (await rl.question(text)).trim().replace(/^['"]|['"]$/g, '');
    return a || def || '';
  };
  const field = async (title, hint, validate) => {
    for (;;) {
      const v = await ask(`\n${title}\n  ${hint}\n  > `);
      const bad = validate(v);
      if (!bad) { console.log(`  ✓ qabul qilindi (…${v.slice(-4)}, ${v.length} belgi)`); return v; }
      console.log('  ✗ ' + bad);
    }
  };
  const vUrl = v => /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(v) ? '' : 'https://XXXX.supabase.co ko\'rinishida bo\'lishi kerak';
  const vKey = v => (v.length < 30 || /\s|\.\.\./.test(v)) ? 'kalit juda qisqa yoki noto\'g\'ri — to\'liq nusxalab qo\'y' : '';
  try {
    if (!CMD) {
      console.log('\nNima qilamiz?\n  1) Kichik sinov   (5 foydalanuvchi, 60s)  ← avval shu\n  2) To\'liq sinov   (50 foydalanuvchi, 3 daqiqa)\n  3) Faqat tozalash (lt_* akkauntlarni o\'chirish)');
      const c = await ask('Tanlov (1/2/3) [1]: ', '1');
      if (c === '3') CMD = 'cleanup';
      else { CMD = 'full'; if (c !== '2') { N = 5; DURATION = 60000; } }
    }
    const needAnon = CMD === 'run' || CMD === 'full';
    const needService = CMD !== 'run';
    if (!URL_) URL_ = (await field('1) Supabase Project URL', '(Project Settings → API → Project URL)', vUrl)).replace(/\/$/, '');
    if (needAnon && !ANON) ANON = await field('2) anon / publishable key', '(Project Settings → API → anon public)', vKey);
    if (needService && !SERVICE) SERVICE = await field('3) service_role key', '(Project Settings → API → service_role → Reveal)  ⚠ maxfiy', vKey);
    if (!CONFIRMED) {
      const a = (await ask(`\n🎯 Nishon: ${new URL(URL_).host}\nBu SINOV loyihasi (production EMAS)? Davom etamizmi? (h/y): `)).toLowerCase();
      if (a !== 'h' && a !== 'ha') { console.log('To\'xtatildi.'); process.exit(0); }
      CONFIRMED = true;
    }
  } finally { rl.close(); }
}

await interactive();
if (CMD === 'setup') await setup();
else if (CMD === 'run') await run();
else if (CMD === 'cleanup') await cleanup();
else if (CMD === 'full') { await setup(); try { await run(); } finally { await cleanup(); } }
else die('Ishlatish: node tests/load-50.mjs [setup | run | cleanup | full]  (argumentsiz — menyu)');
process.exit(0);
