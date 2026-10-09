/**
 * sw.js — SpaceMR Service Worker (cache + Web Push)
 * Standart Web Push ('push' hodisasi). Firebase yo'q.
 * Payload Edge Function'dan keladi: { title, body, type, fromUid, chatId, groupId }
 * Android: sayt yopiq bo'lsa ham ishlaydi. Desktop: brauzer ochiq bo'lsa.
 */

/** Push matnidan emoji olib tashlanadi (belgi ham, "[[emoji/2d/<kalit>.png]]" token ham): bildirishnomani tizim chizadi,
 *  PNG ko'rsata olmaydi. key — birinchi emoji kaliti (faqat emoji bo'lsa u bildirishnoma RASMI bo'ladi).
 *  Mantiq supabase/functions/send-push/emoji-text.ts bilan bir xil (ikki qavatli himoya: eski Edge Function bilan ham toza). */
const PUSH_EMO_RE = new RegExp(
  '\\[\\[emoji/2d/([0-9a-f]{2,6}(?:-[0-9a-f]{2,6})*)\\.png\\]\\]|(' +
  '(?![\\u00A9\\u00AE\\u2122](?!\\uFE0F))(?:\\p{Extended_Pictographic}|\\p{Regional_Indicator}{2}|[#*0-9]\\uFE0F?\\u20E3)' +
  '(?:\\uFE0F|\\u200D\\p{Extended_Pictographic}|[\\u{1F3FB}-\\u{1F3FF}])*)', 'gu');
function stripPushEmoji(raw) {
  let key = '';
  const s = String(raw == null ? '' : raw).replace(PUSH_EMO_RE, (_m, tok, glyph) => {
    if (!key) {
      key = tok || Array.from(glyph || '').map(ch => ch.codePointAt(0).toString(16)).filter(h => h !== 'fe0f').join('-');
    }
    return ' ';
  });
  return { text: s.replace(/[\uFE0F\u200D\u20E3\u{1F3FB}-\u{1F3FF}]/gu, '').replace(/\s+/g, ' ').trim(), key };
}

/** Bildirishnoma matnini chiroyli qiladi: xom JSON ({"__postShare":...}) hech qachon ko'rinmasin.
 *  Edge Function eski bo'lsa ham ishlaydi (ikki qavatli himoya). */
function friendlyBody(data) {
  let b = String(data.body || '').replace(/\s+/g, ' ').trim();
  b = b.replace(/\{\s*"__postShare"[\s\S]*$/, 'Post ulashdi');
  b = b.replace(/\{\s*"__callLog"[\s\S]*$/, "Qo'ng'iroq");
  b = b.replace(/\{\s*"__gif"[\s\S]*$/, 'GIF');
  if (b.startsWith('{"__')) b = 'Yangi xabar';
  if (data.type === 'call' && b && !/^Qo'ng'iroq/.test(b)) b = "Qo'ng'iroq: " + b;
  const c = stripPushEmoji(b);
  return c.text || (c.key ? 'Emoji' : b);
}

/** Xabar faqat emoji bo'lsa — birinchi emoji PNG'i bildirishnoma rasmi (server rasm bermagan bo'lsa) */
function emojiImageOf(data) {
  const c = stripPushEmoji(data.body);
  return (!c.text && c.key && /^[0-9a-f]{2,6}(?:-[0-9a-f]{2,6})*$/.test(c.key)) ? (self.location.origin + '/emoji/2d/' + c.key + '.png') : undefined;
}

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch (_) { data = { body: event.data ? event.data.text() : '' }; }

  const isCall = data.type === 'call';

  event.waitUntil((async () => {
    // Ilova ochiq va ko'rinib turgan bo'lsa (qo'ng'iroqdan tashqari) bildirishnoma ko'rsatmaymiz —
    // xabarni foydalanuvchi allaqachon ilovada ko'rib turibdi.
    if (!isCall) {
      const wins = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (wins.some((c) => c.visibilityState === 'visible')) return;
    }

    // Xom JSON xizmat xabarlari (qo'ng'iroq yozuvi va h.k.) uchun bildirishnoma umuman ko'rsatilmaydi
    if (!isCall && /^\s*\{\s*"__callLog"/.test(String(data.body || ''))) return;

    const icon = (typeof data.icon === 'string' && data.icon.startsWith('https://')) ? data.icon : '/icons/icon-192.png';
    const image = (typeof data.image === 'string' && data.image.startsWith('https://')) ? data.image : emojiImageOf(data);
    await self.registration.showNotification(stripPushEmoji(data.title).text || 'SpaceMR', {
      body:  friendlyBody(data),
      icon,
      badge: '/icons/icon-192.png',
      image,   // ulashilgan post rasmi yoki (faqat emoji xabarda) emoji PNG'i
      lang:  'uz',
      timestamp: Date.now(),
      tag:   isCall ? 'spacemr-call' : (data.chatId || data.groupId || data.fromUid || 'spacemr'),
      renotify: !isCall,
      data:  { url: '/', ...data },
      // Qo'ng'iroqda kuchli tebranish pattern
      vibrate: isCall
        ? [500, 200, 500, 200, 500, 200, 500, 200, 500]
        : [200, 100, 200],
      requireInteraction: isCall, // Qo'ng'iroq bildirishnomasi o'z-o'zidan yopilmaydi
      silent: false,
      actions: isCall ? [
        { action: 'accept', title: "Qabul qilish" },
        { action: 'reject', title: "Rad etish" },
      ] : [],
    });
  })());
});

// Notification bosilganda saytni ochish
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data   = event.notification.data || {};
  const action = event.action; // 'accept' | 'reject' | ''
  const url    = '/';

  // URL ga action ni parametr sifatida qo'shamiz — sayt ochilganda qayta ishlaydi
  let openUrl = url;
  if (data.type === 'call' && data.fromUid) {
    openUrl = action === 'reject'
      ? `/?call_action=reject&from=${data.fromUid}`
      : `/?call_action=accept&from=${data.fromUid}`;
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.postMessage({ type: 'CALL_ACTION', action, data });
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(openUrl);
    })
  );
});


/* ── Cache versiyasi ── */
// Deploy da scripts/bump-sw.mjs yoki build-sw.mjs oshiradi.
const CACHE_VERSION  = 't-1791560000001'; /* BUILD_VERSION_LINE */
const STATIC_CACHE   = `spacemr-static-${CACHE_VERSION}`;
const RUNTIME_CACHE  = `spacemr-runtime-${CACHE_VERSION}`;
const EMOJI_CACHE    = 'spacemr-emoji-v1';
let _emojiCache = null;

// PRECACHE_URLS — scripts/build-sw.mjs avtomatik to'ldiradi (barcha modules/**/*.js).
// BEGIN_PRECACHE
/* Faqat shell — modules runtime cache. */
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/app.css',
  '/app.js',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/svg/logo.png',
  '/svg/favicon.png',
  '/modules/script.js',
  '/modules/core/config.js',
  '/modules/core/utils.js',
  '/modules/core/env.js',
  '/modules/router.js',
  '/modules/url-router.js'
];
// END_PRECACHE

function _isBypassed(url) {
  return (
    url.includes('supabase.co') ||
    url.includes('/rest/v1/') ||
    url.includes('/auth/v1/') ||
    url.includes('/realtime/') ||
    url.includes('/storage/v1/') ||
    url.includes('/api/') ||
    !url.startsWith(self.location.origin)
  );
}

function _isStaticAsset(request) {
  const dest = request.destination;
  return dest === 'style' || dest === 'script' || dest === 'image' || dest === 'font' || dest === 'worker';
}

async function _precacheAll() {
  const cache = await caches.open(STATIC_CACHE);
  // Parallel cheklov + umumiy timeout — install uzoq osilib qolmasin (tab spinner)
  const urls = PRECACHE_URLS.slice();
  const CONC = 6;
  const hardMs = 8000;
  let i = 0;
  const worker = async () => {
    while (i < urls.length) {
      const u = urls[i++];
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 4000);
        const res = await fetch(u, { signal: ctrl.signal, cache: 'no-cache' });
        clearTimeout(t);
        if (res && res.ok) await cache.put(u, res.clone());
      } catch (_) {}
    }
  };
  const run = Promise.all(Array.from({ length: Math.min(CONC, urls.length) }, () => worker()));
  await Promise.race([
    run,
    new Promise(r => setTimeout(r, hardMs)),
  ]);
}

self.addEventListener('install', (event) => {
  // skipWaiting YO'Q — aks holda controllerchange → location.reload loop
  // Yangi SW faqat client SKIP_WAITING yuborganda (F5 yoki force-reload) faollashadi
  event.waitUntil(_precacheAll());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => k !== STATIC_CACHE && k !== RUNTIME_CACHE && k !== EMOJI_CACHE).map(k => caches.delete(k))
    );
    await self.clients.claim();
    // Mijozlarga yangi versiya — bir marta reload (controllerchange bilan birga)
    try {
      const clientsList = await self.clients.matchAll({ type: 'window' });
      clientsList.forEach(c => c.postMessage({ type: 'SW_ACTIVATED', version: CACHE_VERSION }));
    } catch (_) {}
  })());
});

self.addEventListener('message', (event) => {
  const data = event.data;
  const type = typeof data === 'string' ? data : data && data.type;
  if (type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (type === 'KILL_SWITCH') {
    event.waitUntil((async () => {
      try { await self.registration.unregister(); } catch (_) {}
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
      const clientsList = await self.clients.matchAll({ type: 'window' });
      clientsList.forEach(c => c.postMessage({ type: 'SW_KILLED' }));
    })());
  }
});

async function _matchCache(req) {
  return (await caches.match(req, { ignoreSearch: true })) || (await caches.match(req));
}

async function _putIn(cacheName, req, res) {
  if (!res || !res.ok) return;
  try {
    const c = await caches.open(cacheName);
    // Path kalit — query params match ni buzmasin
    let key = req;
    if (typeof req !== 'string') {
      try { key = new URL(req.url).pathname || req; } catch (_) { key = req; }
    }
    await c.put(key, res.clone());
  } catch (_) {}
}

async function _networkFirst(req, cacheName, fallbackUrls) {
  try {
    const res = await fetch(req);
    if (res && res.ok) {
      await _putIn(cacheName, req, res);
      return res;
    }
    // Server yo'naltirdi (masalan chiqishdan keyin 302 -> /login): keshdagi eski qobiqni EMAS, yo'naltirishni qaytaramiz
    if (res && (res.type === 'opaqueredirect' || (res.status >= 300 && res.status < 400))) return res;
  } catch (_) {}
  const hit = await _matchCache(req);
  if (hit) return hit;
  for (const u of (fallbackUrls || [])) {
    const h = await caches.match(u);
    if (h) return h;
  }
  return new Response('Offline', { status: 503, statusText: 'Offline' });
}

async function _cacheFirstSWR(req, cacheName) {
  const cached = await _matchCache(req);
  if (cached) {
    // Fon yangilash — SW CACHE_VERSION o'zgaganda eski cache o'chadi
    fetch(req).then(res => { if (res && res.ok) _putIn(cacheName, req, res); }).catch(() => {});
    return cached;
  }
  try {
    const res = await fetch(req);
    if (res && res.ok) await _putIn(cacheName, req, res);
    return res;
  } catch (e) {
    return new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = req.url;

  if (_isBypassed(url) || req.method !== 'GET') return;

  if (req.headers.has('range')) {
    event.respondWith(fetch(req).catch(() => _matchCache(req)));
    return;
  }

  let path = '';
  try { path = new URL(url).pathname; } catch (_) { return; }

  // Emoji — alohida kesh
  if (path.startsWith('/emoji/')) {
    event.respondWith(
      (_emojiCache || (_emojiCache = caches.open(EMOJI_CACHE))).then(async (c) => {
        const hit = await c.match(req) || await c.match(req, { ignoreSearch: true });
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok && (res.headers.get('content-type') || '').startsWith('image/')) {
          try { c.put(req, res.clone()); } catch (_) {}
        }
        return res;
      })
    );
    return;
  }

  // HTML navigatsiya — network-first (index no-cache), offline fallback
  const isNav = req.destination === 'document' || req.mode === 'navigate';
  if (isNav || path === '/' || path === '/index.html') {
    event.respondWith(_networkFirst(req, RUNTIME_CACHE, ['/index.html', '/']));
    return;
  }

  // sw.js — har doim tarmoq (update tekshiruvi)
  if (path === '/sw.js') {
    event.respondWith(fetch(req).catch(() => _matchCache(req)));
    return;
  }

  // CSS — cache-first + SWR
  const isCss = req.destination === 'style' || path.endsWith('.css');
  if (isCss) {
    event.respondWith(_cacheFirstSWR(req, STATIC_CACHE));
    return;
  }

  // JS/modullar — network-first (deploydan keyin eski kesh ushlab qolmasin)
  const isJs = req.destination === 'script'
    || path.endsWith('.js') || path.endsWith('.mjs');
  if (isJs) {
    event.respondWith(_networkFirst(req, STATIC_CACHE));
    return;
  }

  // Rasm / font
  if (_isStaticAsset(req) || /\.(png|jpg|jpeg|gif|webp|svg|ico|woff2?|ttf|otf)$/i.test(path)) {
    event.respondWith(_cacheFirstSWR(req, STATIC_CACHE));
  }
});
