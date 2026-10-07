/** loadThreadDelta / syncChat — kursor va "xabar tushib qolishi" regressiya testi (Node, brauzersiz).
 *  sync.js importlari stublarga almashtirilgan nusxada ishga tushadi. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'syncdelta-'));
let fail = 0;
const ok = (c, m) => { if (!c) { console.error('FAIL:', m); fail++; } else console.log('ok:', m); };

// ---- stublar
let SERVER = []; // {seq,id,...}
let TOMBS = [];
let HEAD = 0;
globalThis.__rpcCalls = [];
fs.writeFileSync(path.join(tmp, 'config.js'), `
export const state = { me: { uid: 'u1' } };
export const ts = (x) => x;
export const mapMessage = (r) => r && ({ id: r.id, seq: r.seq == null ? null : Number(r.seq), createdAt: r.created_at || 0, senderId: r.sender_id });
export const sb = {
  rpc: async (name, args) => {
    globalThis.__rpcCalls.push(args.p_after_seq);
    const after = args.p_after_seq, lim = args.p_limit;
    const all = globalThis.__SERVER.filter(m => m.seq > after).sort((a, b) => a.seq - b.seq);
    const page = all.slice(0, lim);
    return { data: { messages: page, tombstones: globalThis.__TOMBS.filter(t => t.seq > after), head_seq: globalThis.__HEAD, has_more: all.length > lim }, error: null };
  },
  from: () => ({ select: () => ({ in: async () => ({ data: [] }) }) }),
};
`);
fs.writeFileSync(path.join(tmp, 'store.js'), `export const putThread=()=>{};export const putChatsList=()=>{};export const setUid=()=>{};export const isStoreV2Enabled=()=>false;export const store={};`);
fs.writeFileSync(path.join(tmp, 'cache-policy.js'), `export const canCache=()=>false;`);
fs.writeFileSync(path.join(tmp, 'perf.js'), `export const syncPath=()=>{};export const measure=(n,f)=>f&&f();`);
fs.writeFileSync(path.join(tmp, 'flags.js'), `export const isSyncV2Enabled=()=>true;`);
let src = fs.readFileSync(path.join(root, 'modules/core/store/sync.js'), 'utf8')
  .replace("'../config.js'", "'./config.js'").replace("'./store.js'", "'./store.js'")
  .replace("'../cache-policy.js'", "'./cache-policy.js'").replace("'../perf.js'", "'./perf.js'").replace("'./flags.js'", "'./flags.js'");
fs.writeFileSync(path.join(tmp, 'sync.mjs'), src);
const { loadThreadDelta, syncChat, setCursor, getCursor } = await import(pathToFileURL(path.join(tmp, 'sync.mjs')).href);

const mk = (seq) => ({ id: 'm' + seq, seq, created_at: seq * 1000, sender_id: 'x' });
const mkc = (seq) => ({ id: 'm' + seq, seq, createdAt: seq * 1000 });
const reset = (n) => { globalThis.__SERVER = Array.from({ length: n }, (_, i) => mk(i + 1)); globalThis.__TOMBS = []; globalThis.__HEAD = n; globalThis.__rpcCalls = []; };

// 1) Jonli kursor asosdan oldinda (realtime siljitgan) — orqada qolgan xabarlar baribir keladi
reset(160);
setCursor('dm:c1', 160);
let base = Array.from({ length: 150 }, (_, i) => mkc(i + 1));   // asosda 1..150, kursor 160
let r = await loadThreadDelta('c1', base);
ok(r.msgs.length === 160, '151..160 tushib qolmaydi (kursor asosdan oldinda)');
ok(globalThis.__rpcCalls[0] === 150, "delta asosdagi max seq (150) dan boshlandi");

// 2) has_more: 250 ta orqada — hammasi sahifalab olinadi, kursor oxirida head ga yetadi
reset(400);
base = Array.from({ length: 150 }, (_, i) => mkc(i + 1));
r = await loadThreadDelta('c2', base);
ok(r.msgs.length === 400, "has_more: 400 ta xabar to'liq olindi");
ok(getCursor('dm:c2') === 400, 'kursor oxirida head ga yetdi');

// 3) syncChat bitta sahifada: has_more bo'lsa kursor head ga SURILMAYDI
reset(400);
await syncChat('c3', 0);
ok(getCursor('dm:c3') === 100, 'has_more da kursor 100 da qoldi (head=400 ga sakramadi)');

// 4) tombstone asosdagi xabarni olib tashlaydi
reset(10);
globalThis.__TOMBS = [{ seq: 11, message_id: 'm5' }]; globalThis.__HEAD = 11;
base = Array.from({ length: 10 }, (_, i) => mkc(i + 1));
r = await loadThreadDelta('c4', base);
ok(!r.msgs.some(m => m.id === 'm5') && r.msgs.length === 9, "tombstone m5 ni olib tashladi");

// 5) bo'sh asos: kursordan boshlanadi
reset(5);
r = await loadThreadDelta('c5', []);
ok(r.msgs.length === 5, "bo'sh asos — hamma xabar");

// 6) Takroriy chaqiruv idempotent (dublikat yo'q)
r = await loadThreadDelta('c5', r.msgs);
ok(r.msgs.length === 5, 'takroriy delta dublikat qo\'shmaydi');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fail ? `${fail} FAIL` : 'ALL PASS');
process.exit(fail ? 1 : 0);
