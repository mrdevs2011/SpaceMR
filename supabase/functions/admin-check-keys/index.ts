// Admin uchun kalitlar tekshiruvi (Supabase Edge secrets): service_role, VAPID, webhook secret.
// Sirlar QAYTARILMAYDI — faqat { id, name, status: ok|warn|fail, detail }.
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': 'https://spacemr.vercel.app',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
type Row = { id: string; name: string; status: 'ok' | 'warn' | 'fail'; detail: string };
const row = (id: string, name: string, status: Row['status'], detail: string): Row => ({ id, name, status, detail });
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...CORS } });

const dec = (s: string): Uint8Array | null => {
  try {
    const t = s.replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from(atob(t + '='.repeat((4 - (t.length % 4)) % 4)), (c) => c.charCodeAt(0));
  } catch { return null; }
};
const enc = (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!jwt) return json({ error: 'Missing Authorization header' }, 401);

  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  // Admin tekshiruvi foydalanuvchi JWT'si bilan (service_role buzuq bo'lsa ham ishlaydi)
  const userClient = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: isAdmin, error: adminErr } = await userClient.rpc('is_admin');
  if (adminErr) return json({ error: 'Invalid session', detail: adminErr.message }, 401);
  if (isAdmin !== true) return json({ error: 'Not an admin' }, 403);

  let body: { vapidPublic?: string } = {};
  try { body = await req.json(); } catch { /* bo'sh tana ham mumkin */ }

  const rows: Row[] = [];

  // SUPABASE_SERVICE_ROLE_KEY
  if (!serviceKey) {
    rows.push(row('SERVICE_ROLE', 'SUPABASE_SERVICE_ROLE_KEY (Edge)', 'fail', 'Edge secrets\'da yo\'q'));
  } else {
    try {
      const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
      const { error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
      rows.push(error
        ? row('SERVICE_ROLE', 'SUPABASE_SERVICE_ROLE_KEY (Edge)', 'fail', 'Supabase rad etdi: ' + error.message)
        : row('SERVICE_ROLE', 'SUPABASE_SERVICE_ROLE_KEY (Edge)', 'ok', 'auth.admin ishlaydi'));
    } catch (e) {
      rows.push(row('SERVICE_ROLE', 'SUPABASE_SERVICE_ROLE_KEY (Edge)', 'fail', String((e as Error).message || e)));
    }
  }

  // VAPID
  const vPub = (Deno.env.get('VAPID_PUBLIC_KEY') ?? '').trim();
  const vSec = (Deno.env.get('VAPID_SECRET_KEY') ?? '').trim();
  const pub = vPub ? dec(vPub) : null;
  const sec = vSec ? dec(vSec) : null;
  const pubOk = !!pub && pub.length === 65 && pub[0] === 4;
  const secOk = !!sec && sec.length === 32;
  rows.push(!vPub ? row('VAPID_PUBLIC_KEY', 'VAPID_PUBLIC_KEY (Edge)', 'fail', 'Edge secrets\'da yo\'q')
    : pubOk ? row('VAPID_PUBLIC_KEY', 'VAPID_PUBLIC_KEY (Edge)', 'ok', 'format to\'g\'ri (P-256, 65 bayt)')
    : row('VAPID_PUBLIC_KEY', 'VAPID_PUBLIC_KEY (Edge)', 'fail', 'format noto\'g\'ri (base64url, 65 bayt bo\'lishi kerak)'));
  rows.push(!vSec ? row('VAPID_SECRET_KEY', 'VAPID_SECRET_KEY (Edge)', 'fail', 'Edge secrets\'da yo\'q')
    : secOk ? row('VAPID_SECRET_KEY', 'VAPID_SECRET_KEY (Edge)', 'ok', 'format to\'g\'ri (32 bayt)')
    : row('VAPID_SECRET_KEY', 'VAPID_SECRET_KEY (Edge)', 'fail', 'format noto\'g\'ri (base64url, 32 bayt bo\'lishi kerak)'));

  if (pubOk && secOk) {
    try {
      const alg = { name: 'ECDSA', namedCurve: 'P-256' };
      const priv = await crypto.subtle.importKey('jwk',
        { kty: 'EC', crv: 'P-256', x: enc(pub!.slice(1, 33)), y: enc(pub!.slice(33, 65)), d: enc(sec!), ext: true }, alg, false, ['sign']);
      const pubKey = await crypto.subtle.importKey('raw', pub!, alg, false, ['verify']);
      const data = new TextEncoder().encode('keycheck');
      const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, priv, data);
      const same = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pubKey, sig, data);
      rows.push(same
        ? row('VAPID_PAIR', 'VAPID ochiq+maxfiy kalit juftligi', 'ok', 'bir-biriga mos')
        : row('VAPID_PAIR', 'VAPID ochiq+maxfiy kalit juftligi', 'fail', 'ochiq va maxfiy kalit JUFT EMAS'));
    } catch {
      rows.push(row('VAPID_PAIR', 'VAPID ochiq+maxfiy kalit juftligi', 'fail', 'ochiq va maxfiy kalit JUFT EMAS (import xato)'));
    }
  }

  if (body.vapidPublic !== undefined && vPub) {
    rows.push(String(body.vapidPublic).trim() === vPub
      ? row('VAPID_MATCH', 'VAPID: brauzer (push.js) ↔ Edge', 'ok', 'bir xil')
      : row('VAPID_MATCH', 'VAPID: brauzer (push.js) ↔ Edge', 'fail', 'push.js dagi ochiq kalit Edge\'dagidan FARQ qiladi — push kelmaydi'));
  }

  const subj = (Deno.env.get('VAPID_SUBJECT') ?? '').trim();
  rows.push(!subj ? row('VAPID_SUBJECT', 'VAPID_SUBJECT', 'warn', 'yo\'q — standart mailto:admin@example.com ishlatiladi')
    : !/^(mailto:|https:\/\/)/.test(subj) ? row('VAPID_SUBJECT', 'VAPID_SUBJECT', 'fail', 'mailto: yoki https:// bilan boshlanishi kerak')
    : /example\.com/.test(subj) ? row('VAPID_SUBJECT', 'VAPID_SUBJECT', 'warn', 'example.com — haqiqiy email qo\'ying')
    : row('VAPID_SUBJECT', 'VAPID_SUBJECT', 'ok', 'format to\'g\'ri'));

  const wh = Deno.env.get('PUSH_WEBHOOK_SECRET') ?? '';
  rows.push(!wh ? row('PUSH_WEBHOOK_SECRET', 'PUSH_WEBHOOK_SECRET', 'fail', 'Edge secrets\'da yo\'q — send-push 401 beradi')
    : wh.length < 16 ? row('PUSH_WEBHOOK_SECRET', 'PUSH_WEBHOOK_SECRET', 'warn', 'juda qisqa (<16 belgi)')
    : row('PUSH_WEBHOOK_SECRET', 'PUSH_WEBHOOK_SECRET', 'ok', 'bor (DB webhook\'dagi bilan mosligi tekshirilmaydi)'));

  return json({ rows });
});
