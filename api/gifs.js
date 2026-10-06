// Vercel Serverless Function: Klipy GIF qidiruvi/trendlari uchun proksi.
// KLIPY_KEY faqat serverda (Vercel env) — brauzerga tushmaydi. Faqat tizimga kirgan foydalanuvchiga.
// GET /api/gifs?q=<so'z>&page=1  (q bo'sh bo'lsa — trendlar)
const PER_PAGE = 24;
const CACHE_MS = 5 * 60e3;       // test rejimida soatiga 100 so'rov — bir xil so'rovlar 5 daqiqa keshlanadi
const cache = new Map();

const pick = (f) => f && f.url ? { u: f.url, w: f.width | 0, h: f.height | 0 } : null;

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') return res.status(405).json({ error: 'method' });

  const key = process.env.KLIPY_KEY;
  if (!key) return res.status(503).json({ error: 'gif-not-configured' });

  const auth = String(req.headers.authorization || '');
  const jwt = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const sbUrl = process.env.SUPABASE_URL;
  const sbKey = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!jwt || !sbUrl || !sbKey) return res.status(401).json({ error: 'unauthorized' });
  try {
    const u = await fetch(`${sbUrl}/auth/v1/user`, { headers: { apikey: sbKey, Authorization: `Bearer ${jwt}` } });
    if (!u.ok) return res.status(401).json({ error: 'unauthorized' });
  } catch { return res.status(502).json({ error: 'auth-check-failed' }); }

  const q = String(req.query.q || '').trim().slice(0, 60);
  const page = Math.max(1, Math.min(50, parseInt(req.query.page, 10) || 1));
  const ck = q.toLowerCase() + '|' + page;
  const hit = cache.get(ck);
  if (hit && hit.exp > Date.now()) return res.status(200).json(hit.body);

  const base = `https://api.klipy.com/api/v1/${encodeURIComponent(key)}/gifs/${q ? 'search' : 'trending'}`;
  const url = `${base}?${q ? 'q=' + encodeURIComponent(q) + '&' : ''}page=${page}&per_page=${PER_PAGE}`;
  try {
    const r = await fetch(url);
    if (!r.ok) return res.status(502).json({ error: 'klipy-' + r.status });
    const j = await r.json();
    const list = j?.data?.data || [];
    const items = list.map(g => {
      const sm = pick(g.file?.sm?.gif) || pick(g.file?.xs?.gif);
      const md = pick(g.file?.md?.gif) || sm;
      return sm && md ? { id: String(g.id), t: String(g.title || '').slice(0, 80), sm, md } : null;
    }).filter(Boolean);
    const body = { items, next: j?.data?.has_next === false || !items.length ? 0 : page + 1 };
    if (cache.size > 200) cache.clear();
    cache.set(ck, { exp: Date.now() + CACHE_MS, body });
    return res.status(200).json(body);
  } catch { return res.status(502).json({ error: 'klipy-failed' }); }
}
