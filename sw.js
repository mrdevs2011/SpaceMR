/**
 * sw.js — SpaceMR Service Worker (cache + Web Push)
 * Standart Web Push ('push' hodisasi). Firebase yo'q.
 * Payload Edge Function'dan keladi: { title, body, type, fromUid, chatId, groupId }
 * Android: sayt yopiq bo'lsa ham ishlaydi. Desktop: brauzer ochiq bo'lsa.
 */

/** Bildirishnoma matnini chiroyli qiladi: xom JSON ({"__postShare":...}) hech qachon ko'rinmasin.
 *  Edge Function eski bo'lsa ham ishlaydi (ikki qavatli himoya). */
function friendlyBody(data) {
  let b = String(data.body || '').replace(/\s+/g, ' ').trim();
  b = b.replace(/\{\s*"__postShare"[\s\S]*$/, '📌 Post ulashdi');
  b = b.replace(/\{\s*"__callLog"[\s\S]*$/, "📞 Qo'ng'iroq");
  b = b.replace(/\{\s*"__gif"[\s\S]*$/, '🎞 GIF');
  if (b.startsWith('{"__')) b = '💬 Yangi xabar';
  if (data.type === 'call' && b && !b.startsWith('📞')) b = '📞 ' + b;
  return b;
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
    await self.registration.showNotification(data.title || 'SpaceMR', {
      body:  friendlyBody(data),
      icon,
      badge: '/icons/icon-192.png',
      image: data.image || undefined,   // ulashilgan postning rasmi (bo'lsa)
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
const CACHE_VERSION  = 't-1791297600'; /* BUILD_VERSION_LINE */
const STATIC_CACHE   = `spacemr-static-${CACHE_VERSION}`;
const RUNTIME_CACHE  = `spacemr-runtime-${CACHE_VERSION}`;
const EMOJI_CACHE    = 'spacemr-emoji-v1';
let _emojiCache = null;

// PRECACHE_URLS — scripts/build-sw.mjs avtomatik to'ldiradi (barcha modules/**/*.js).
// BEGIN_PRECACHE
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
  '/modules/admin/admin-badge.js',
  '/modules/admin/admin-gate.js',
  '/modules/admin/admin-keys.js',
  '/modules/admin/admin-reset-password.js',
  '/modules/admin/admin-storage.js',
  '/modules/admin/admin-wipe.js',
  '/modules/apps/apps.js',
  '/modules/apps/code-hl.js',
  '/modules/apps/logo-extract.js',
  '/modules/apps/panels.js',
  '/modules/apps/runner.js',
  '/modules/auth/auth-pending.js',
  '/modules/auth/auth-recovery.js',
  '/modules/auth/auth-reg-recovery.js',
  '/modules/auth/auth-settings.js',
  '/modules/auth/auth.js',
  '/modules/auth/pwd-ui.js',
  '/modules/call/call.js',
  '/modules/chat/attach-menu.js',
  '/modules/chat/camera-access.js',
  '/modules/chat/camera-capture.js',
  '/modules/chat/chat-actions.js',
  '/modules/chat/chat-media.js',
  '/modules/chat/chat-pin.js',
  '/modules/chat/chat-shared.js',
  '/modules/chat/chat-state.js',
  '/modules/chat/chat-storage.js',
  '/modules/chat/chat-voice-player.js',
  '/modules/chat/chat-voice-record.js',
  '/modules/chat/chat.js',
  '/modules/chat/chats-x.js',
  '/modules/chat/components/chat-image-zoom.js',
  '/modules/chat/components/message-bubble.js',
  '/modules/chat/components/video-note.js',
  '/modules/chat/groups.js',
  '/modules/chat/msg-menu.js',
  '/modules/chat/msg-reactions.js',
  '/modules/chat/rt-chat.js',
  '/modules/core/config.js',
  '/modules/core/env.js',
  '/modules/core/error-log.js',
  '/modules/core/file-icons.js',
  '/modules/core/icons.js',
  '/modules/core/live.js',
  '/modules/core/local-cache.js',
  '/modules/core/no-autocomplete.js',
  '/modules/core/perf.js',
  '/modules/core/quota.js',
  '/modules/core/rate-limit.js',
  '/modules/core/rt-bus.js',
  '/modules/core/scroll-jump-debug.js',
  '/modules/core/upload-policy.js',
  '/modules/core/utils.js',
  '/modules/core/video-policy.js',
  '/modules/explore.js',
  '/modules/feed/comments.js',
  '/modules/feed/compress.js',
  '/modules/feed/feed.js',
  '/modules/feed/like-sync.js',
  '/modules/feed/stories.js',
  '/modules/feed/story-cache.js',
  '/modules/feed/upload.js',
  '/modules/profile/profile.js',
  '/modules/profile/view-actions.js',
  '/modules/profile/view-apps.js',
  '/modules/profile/view-chats.js',
  '/modules/profile/view-home.js',
  '/modules/profile/view-login.js',
  '/modules/profile/view-notifs.js',
  '/modules/profile/view-profile.js',
  '/modules/profile/view-saved.js',
  '/modules/profile/view-users.js',
  '/modules/push.js',
  '/modules/router.js',
  '/modules/script.js',
  '/modules/ui/attach-menu.js',
  '/modules/ui/avi-crop.js',
  '/modules/ui/bar.js',
  '/modules/ui/dissolve.js',
  '/modules/ui/emoji-data.js',
  '/modules/ui/emoji-img.js',
  '/modules/ui/emoji-only.js',
  '/modules/ui/emoji-picker.js',
  '/modules/ui/emoji-uz.js',
  '/modules/ui/esc-stack.js',
  '/modules/ui/gif-panel.js',
  '/modules/ui/install-guide.js',
  '/modules/ui/notifs.js',
  '/modules/ui/password-confirm.js',
  '/modules/ui/right-rail.js',
  '/modules/ui/shortcuts.js',
  '/modules/ui/sidebar.js',
  '/modules/ui/toast.js',
  '/modules/ui/ui.js',
  '/modules/url-router.js',
  '/modules/vendor/vendor-supabase.js'
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
  // addAll bitta xatoda hammasi yiqiladi — alohida add
  await Promise.all(PRECACHE_URLS.map(u => cache.add(u).catch(() => {})));
}

self.addEventListener('install', (event) => {
  // Toast yo'q: yangi versiya o'zi qo'llanadi
  event.waitUntil(_precacheAll().then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => k !== STATIC_CACHE && k !== RUNTIME_CACHE && k !== EMOJI_CACHE).map(k => caches.delete(k))
    );
    await self.clients.claim();
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

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = req.url;

  if (_isBypassed(url) || req.method !== 'GET') return;

  // Range (video seek) — keshga yozilmasin, tarmoqqa o'tkazilsin (Safari 206)
  if (req.headers.has('range')) {
    event.respondWith(fetch(req).catch(() => caches.match(req)));
    return;
  }

  // Emoji — cache-first, alohida kesh
  if (url.indexOf('/emoji/') > 0 && new URL(url).pathname.startsWith('/emoji/')) {
    event.respondWith(
      (_emojiCache || (_emojiCache = caches.open(EMOJI_CACHE))).then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok && (res.headers.get('content-type') || '').startsWith('image/')) c.put(req, res.clone());
        return res;
      })
    );
    return;
  }

  // HTML navigatsiya — stale-while-revalidate + offline fallback
  if (req.destination === 'document' || req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(RUNTIME_CACHE);
      const cached = await cache.match(req) || await caches.match('/index.html') || await caches.match('/');
      const networkPromise = fetch(req).then(res => {
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      }).catch(() => null);
      if (cached) {
        networkPromise.catch(() => {}); // fon yangilanish
        return cached;
      }
      const res = await networkPromise;
      return res || new Response('Offline', { status: 503, statusText: 'Offline' });
    })());
    return;
  }

  // JS / CSS — cache-first (CACHE_VERSION o'zgaganda activate eski keshni tozalaydi)
  // Ikkinchi ochilishda 0 KB shell uchun.
  if (req.destination === 'script' || req.destination === 'style') {
    event.respondWith(
      caches.match(req).then(cached => {
        if (cached) {
          // fon revalidate (SWR)
          fetch(req).then(res => {
            if (res && res.ok) caches.open(STATIC_CACHE).then(c => c.put(req, res));
          }).catch(() => {});
          return cached;
        }
        return fetch(req).then(res => {
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(STATIC_CACHE).then(c => c.put(req, clone));
          }
          return res;
        });
      })
    );
    return;
  }

  // Rasm / font — cache-first
  if (_isStaticAsset(req)) {
    event.respondWith(
      caches.match(req).then(cached => {
        if (cached) return cached;
        return fetch(req).then(res => {
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(STATIC_CACHE).then(c => c.put(req, clone));
          }
          return res;
        });
      })
    );
  }
});
