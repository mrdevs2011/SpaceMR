// Vercel Serverless Function: Cloudflare Realtime TURN uchun qisqa muddatli kredensial beradi.
// Sirlar (TURN_KEY_ID, TURN_KEY_API_TOKEN) faqat serverda; brauzerga faqat muddatli iceServers chiqadi.
// Faqat tizimga kirgan foydalanuvchiga (Supabase access_token) beriladi.
const TTL = 86400;              // Cloudflare kredensiali 24 soat amal qiladi
const CACHE_MS = 6 * 3600e3;    // serverda 6 soat keshlanadi (mijozga kamida ~18 soat qoladi)
let cache = null;
const rateByIp = new Map(); // ip -> { n, t0 }
function rateOk(ip) {
  const now = Date.now();
  let e = rateByIp.get(ip);
  if (!e || now - e.t0 > 60000) { e = { n: 0, t0: now }; rateByIp.set(ip, e); }
  e.n++;
  if (rateByIp.size > 2000) rateByIp.clear();
  return e.n <= 30; // 30 req / min / IP
}


export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'method' });
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '?').split(',')[0].trim();
  if (!rateOk(ip)) return res.status(429).json({ error: 'rate' });

  const keyId = process.env.TURN_KEY_ID;
  const token = process.env.TURN_KEY_API_TOKEN;
  if (!keyId || !token) return res.status(503).json({ error: 'turn-not-configured' });

  // Faqat kirgan foydalanuvchi (TURN trafigini begonalar ishlatmasligi uchun)
  const auth = String(req.headers.authorization || '');
  const jwt = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const sbUrl = process.env.SUPABASE_URL;
  const sbKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!jwt || !sbUrl || !sbKey) return res.status(401).json({ error: 'unauthorized' });
  try {
    const u = await fetch(`${sbUrl}/auth/v1/user`, { headers: { apikey: sbKey, Authorization: `Bearer ${jwt}` } });
    if (!u.ok) return res.status(401).json({ error: 'unauthorized' });
  } catch { return res.status(502).json({ error: 'auth-check-failed' }); }

  if (cache && cache.exp > Date.now()) return res.status(200).json(cache.body);

  try {
    const r = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
      { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ttl: TTL }) }
    );
    if (!r.ok) return res.status(502).json({ error: 'cloudflare-' + r.status });
    const data = await r.json();
    // 53-port ba'zi brauzerlarda bloklanadi — chiqarib tashlaymiz
    const iceServers = (data.iceServers || []).map(s => ({
      ...s,
      urls: [].concat(s.urls || []).filter(x => !/:53(\?|$)/.test(x)),
    })).filter(s => s.urls.length);
    if (!iceServers.length) return res.status(502).json({ error: 'empty' });
    cache = { exp: Date.now() + CACHE_MS, body: { iceServers } };
    return res.status(200).json(cache.body);
  } catch { return res.status(502).json({ error: 'cloudflare-failed' }); }
}
