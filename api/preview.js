// Vercel Serverless Function: Butun dunyo bo'ylab har qanday veb-havola uchun OpenGraph preview ma'lumotlarini olish.
// GET /api/preview?url=https://...
const cache = new Map();
const CACHE_MS = 24 * 60 * 60 * 1000; // 24 soat kesh

function decodeHtml(html) {
  if (!html) return '';
  return html
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/gi, '/')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .trim();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'public, s-maxage=86400, max-age=3600');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });

  const rawUrl = String(req.query.url || '').trim();
  if (!rawUrl) return res.status(400).json({ error: 'url_required' });

  let targetUrl;
  try {
    targetUrl = new URL(rawUrl.startsWith('http') ? rawUrl : ('https://' + rawUrl));
    if (!['http:', 'https:'].includes(targetUrl.protocol)) {
      return res.status(400).json({ error: 'invalid_protocol' });
    }
  } catch {
    return res.status(400).json({ error: 'invalid_url' });
  }

  const cacheKey = targetUrl.href;
  const cached = cache.get(cacheKey);
  if (cached && cached.exp > Date.now()) {
    return res.status(200).json(cached.data);
  }

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);

    const resp = await fetch(targetUrl.href, {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 SpaceMR/1.0',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'uz,ru,en;q=0.9',
      }
    });
    clearTimeout(timer);

    if (!resp.ok) {
      const fallback = { ok: false, url: targetUrl.href, domain: targetUrl.hostname.replace(/^www\./, '') };
      return res.status(200).json(fallback);
    }

    const cType = (resp.headers.get('content-type') || '').toLowerCase();
    if (cType.startsWith('image/')) {
      const imgData = { ok: true, url: targetUrl.href, domain: targetUrl.hostname.replace(/^www\./, ''), image: targetUrl.href, type: 'image' };
      cache.set(cacheKey, { exp: Date.now() + CACHE_MS, data: imgData });
      return res.status(200).json(imgData);
    }

    // HTML ning dastlabki 70KB qismini o'qiymiz (head qismi yetarli)
    const html = (await resp.text()).slice(0, 75000);

    const pickMeta = (propName) => {
      const re = new RegExp('<meta\\s+(?:property|name)=["\']' + propName + '["\']\\s+content=["\']([^"\']+)["\']', 'i');
      const reRev = new RegExp('<meta\\s+content=["\']([^"\']+)["\']\\s+(?:property|name)=["\']' + propName + '["\']', 'i');
      const m = html.match(re) || html.match(reRev);
      return m ? decodeHtml(m[1]) : '';
    };

    let title = pickMeta('og:title') || pickMeta('twitter:title');
    if (!title) {
      const tm = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      if (tm) title = decodeHtml(tm[1]);
    }

    let description = pickMeta('og:description') || pickMeta('twitter:description') || pickMeta('description');

    let image = pickMeta('og:image:secure_url') || pickMeta('og:image') || pickMeta('twitter:image');
    if (image && !image.startsWith('http') && !image.startsWith('data:')) {
      try {
        image = new URL(image, targetUrl.href).href;
      } catch (_) {
        image = '';
      }
    }

    const siteName = pickMeta('og:site_name') || targetUrl.hostname.replace(/^www\./, '');

    // Favicon & Icon extraction from HTML (apple-touch-icon 180x180, SVG icon, PNG favicon, shortcut icon)
    let favicon = '';
    const appleM = html.match(/<link[^>]+rel=["'](?:apple-touch-icon|apple-touch-icon-precomposed)["'][^>]+href=["']([^"']+)["']/i) ||
                   html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["'](?:apple-touch-icon|apple-touch-icon-precomposed)["']/i);
    if (appleM && appleM[1]) {
      favicon = decodeHtml(appleM[1]);
    } else {
      const iconM = html.match(/<link[^>]+rel=["'](?:shortcut\s+)?icon["'][^>]+href=["']([^"']+)["']/i) ||
                    html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["'](?:shortcut\s+)?icon["']/i);
      if (iconM && iconM[1]) favicon = decodeHtml(iconM[1]);
    }

    if (favicon) {
      try {
        favicon = new URL(favicon, targetUrl.href).href;
      } catch (_) {
        favicon = '';
      }
    }
    if (!favicon) {
      favicon = `https://icons.duckduckgo.com/ip3/${targetUrl.hostname.replace(/^www\./, '')}.ico`;
    }

    const result = {
      ok: true,
      url: targetUrl.href,
      domain: targetUrl.hostname.replace(/^www\./, ''),
      title: title ? title.slice(0, 160) : '',
      description: description ? description.slice(0, 240) : '',
      image: image || '',
      siteName: siteName ? siteName.slice(0, 60) : '',
      favicon: favicon || '',
    };

    cache.set(cacheKey, { exp: Date.now() + CACHE_MS, data: result });
    if (cache.size > 2000) cache.clear();

    return res.status(200).json(result);
  } catch (err) {
    const fallback = { ok: false, url: targetUrl.href, domain: targetUrl.hostname.replace(/^www\./, ''), error: err.message };
    return res.status(200).json(fallback);
  }
}
