// Admin parol tiklash — Edge Function (fallback emas, rezerv).
// Asosiy mantiq: modules/admin-reset-password.js → RPC admin_reset_user_password.
// Bu funksiya hozir ishlatilmaydi; RPC to'g'ridan-to'g'ri chaqiriladi.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const CORS = {
  'Access-Control-Allow-Origin': 'https://spacemr.vercel.app',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return json({ error: 'Missing Authorization header' }, 401);

  const url        = Deno.env.get('SUPABASE_URL')!;
  const anonKey    = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  /* Tokenni tekshirish */
  const userClient = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: { user }, error: authErr } = await userClient.auth.getUser(token);
  if (authErr || !user) return json({ error: 'Invalid session' }, 401);

  /* Admin tekshiruvi */
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: profile } = await admin.from('profiles').select('is_admin').eq('id', user.id).single();
  if (!profile?.is_admin) return json({ error: 'Not an admin' }, 403);

  /* Body */
  let body: { uid?: string; code?: string } = {};
  try { body = await req.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const { uid, code } = body;
  if (!uid || !code || String(code).length < 6) {
    return json({ error: 'uid and code (min 6 chars) required' }, 400);
  }

  /* OTP ni profiles ga yozish (parol O'ZGARMAYDI) */
  const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  const { error } = await admin.from('profiles').update({
    recovery_code: String(code).trim(),
    recovery_code_expires_at: expiresAt,
    recovery_attempts: 0,
  }).eq('id', uid);

  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
});
