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
  b = b.replace(/\|\|[\s\S]*?\|\|/g, '••••').replace(/\|\|[\s\S]*$/, '••••'); // ||spoiler|| bildirishnomada ochilmasin
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
      tag:   isCall ? 'spacemr-call' : (data.type === 'social' ? `spacemr-social-${data.postId || data.fromUid || 'activity'}` : (data.chatId || data.groupId || data.fromUid || 'spacemr')),
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
  if (data.type === 'social' && data.postId) {
    openUrl = `/p/${encodeURIComponent(data.postId)}${data.commentId ? '/comments' : ''}`;
  } else if (data.type === 'call' && data.fromUid) {
    openUrl = action === 'reject'
      ? `/?call_action=reject&from=${data.fromUid}`
      : `/?call_action=accept&from=${data.fromUid}`;
  }

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          if (data.type === 'call') {
            client.postMessage({ type: 'CALL_ACTION', action, data });
            return client.focus();
          }
          if (data.type === 'social' && typeof client.navigate === 'function') {
            return client.navigate(new URL(openUrl, self.location.origin).href).then(next => next?.focus?.() || client.focus());
          }
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(openUrl);
    })
  );
});


/* ── Cache versiyasi ── */
// Deploy da scripts/bump-sw.mjs yoki build-sw.mjs oshiradi.
const CACHE_VERSION  = 't-1794725872297'; /* BUILD_VERSION_LINE */
const STATIC_CACHE   = `spacemr-static-${CACHE_VERSION}`;
const RUNTIME_CACHE  = `spacemr-runtime-${CACHE_VERSION}`;
const EMOJI_CACHE    = 'spacemr-emoji-v1';
let _emojiCache = null;

// PRECACHE_URLS — scripts/build-sw.mjs avtomatik to'ldiradi (barcha modules/**/*.js).
// BEGIN_PRECACHE
/* CRITICAL: o'rnatish shu fayllarsiz tugamaydi. REST: butun ilova (oflayn uchun), alohida fayl xatosi o'rnatishni to'xtatmaydi. */
const PRECACHE_CRITICAL = [
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
const PRECACHE_URLS = [
  '/modules/admin/admin-badge.js',
  '/modules/admin/admin-force-reload.js',
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
  '/modules/auth/device-sessions.js',
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
  '/modules/chat/chat-upload-queue.js',
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
  '/modules/core/auto-update.js',
  '/modules/core/cache-policy.js',
  '/modules/core/device.js',
  '/modules/core/drafts.js',
  '/modules/core/error-log.js',
  '/modules/core/file-icons.js',
  '/modules/core/force-reload.js',
  '/modules/core/friendly-error.js',
  '/modules/core/fwd.js',
  '/modules/core/icons.js',
  '/modules/core/live.js',
  '/modules/core/local-cache.js',
  '/modules/core/no-autocomplete.js',
  '/modules/core/offline.js',
  '/modules/core/perf.js',
  '/modules/core/quota.js',
  '/modules/core/rate-limit.js',
  '/modules/core/rt-bus.js',
  '/modules/core/secrets.js',
  '/modules/core/smart-cache.js',
  '/modules/core/store/db.js',
  '/modules/core/store/flags.js',
  '/modules/core/store/index.js',
  '/modules/core/store/media-cache.js',
  '/modules/core/store/outbox.js',
  '/modules/core/store/paint-gate.js',
  '/modules/core/store/store.js',
  '/modules/core/store/sync.js',
  '/modules/core/sw-register.js',
  '/modules/core/upload-policy.js',
  '/modules/core/video-hold-speed.js',
  '/modules/core/video-policy.js',
  '/modules/core/wake-lock.js',
  '/modules/explore.js',
  '/modules/feed/comments.js',
  '/modules/feed/feed.js',
  '/modules/feed/like-sync.js',
  '/modules/feed/post-image-zoom.js',
  '/modules/feed/post-media-guard.js',
  '/modules/feed/stories.js',
  '/modules/feed/story-cache.js',
  '/modules/feed/upload.js',
  '/modules/profile/profile.js',
  '/modules/profile/view-actions.js',
  '/modules/profile/view-apps.js',
  '/modules/profile/view-chats.js',
  '/modules/profile/view-explore.js',
  '/modules/profile/view-home.js',
  '/modules/profile/view-login.js',
  '/modules/profile/view-notifs.js',
  '/modules/profile/view-profile.js',
  '/modules/profile/view-saved.js',
  '/modules/profile/view-users.js',
  '/modules/push.js',
  '/modules/settings/permissions.js',
  '/modules/settings/settings.js',
  '/modules/ui/attach-menu.js',
  '/modules/ui/avi-crop.js',
  '/modules/ui/bar.js',
  '/modules/ui/dissolve.js',
  '/modules/ui/emoji-data.js',
  '/modules/ui/emoji-dom.js',
  '/modules/ui/emoji-img.js',
  '/modules/ui/emoji-only.js',
  '/modules/ui/emoji-picker.js',
  '/modules/ui/emoji-uz.js',
  '/modules/ui/esc-stack.js',
  '/modules/ui/file-viewer.js',
  '/modules/ui/float-progress.js',
  '/modules/ui/gallery-fs.js',
  '/modules/ui/gif-panel.js',
  '/modules/ui/install-guide.js',
  '/modules/ui/location-helper.js',
  '/modules/ui/notifs.js',
  '/modules/ui/onboarding.js',
  '/modules/ui/overlay-stack.js',
  '/modules/ui/password-confirm.js',
  '/modules/ui/poll-dialog.js',
  '/modules/ui/right-rail.js',
  '/modules/ui/shortcuts.js',
  '/modules/ui/sidebar.js',
  '/modules/ui/spacemr-group-chip.js',
  '/modules/ui/swipe-navigation.js',
  '/modules/ui/toast.js',
  '/modules/ui/ui.js',
  '/modules/vendor/vendor-supabase.js',
  '/svg/SpaceMR.png',
  '/svg/action/close.svg',
  '/svg/action/copy.svg',
  '/svg/action/download.svg',
  '/svg/action/edit-square.svg',
  '/svg/action/edit.svg',
  '/svg/action/logout.svg',
  '/svg/action/pin-filled.svg',
  '/svg/action/pin.svg',
  '/svg/action/plus.svg',
  '/svg/action/refresh.svg',
  '/svg/action/reply.svg',
  '/svg/action/revoke.svg',
  '/svg/action/save.svg',
  '/svg/action/search.svg',
  '/svg/action/send-filled.svg',
  '/svg/action/send.svg',
  '/svg/action/settings.svg',
  '/svg/action/switch-camera.svg',
  '/svg/action/trash.svg',
  '/svg/admin/fail.svg',
  '/svg/admin/key.svg',
  '/svg/admin/ok.svg',
  '/svg/admin/shield.svg',
  '/svg/admin/warn.svg',
  '/svg/auth/lock.svg',
  '/svg/auth/mail.svg',
  '/svg/auth/shield.svg',
  '/svg/call/phone.svg',
  '/svg/chat/chat-bg-pattern.svg',
  '/svg/emoji/activities.svg',
  '/svg/emoji/animals.svg',
  '/svg/emoji/flags.svg',
  '/svg/emoji/food.svg',
  '/svg/emoji/objects.svg',
  '/svg/emoji/people.svg',
  '/svg/emoji/recent.svg',
  '/svg/emoji/search.svg',
  '/svg/emoji/smileys.svg',
  '/svg/emoji/symbols.svg',
  '/svg/emoji/travel.svg',
  '/svg/extra/icon-041fdea3033a.svg',
  '/svg/extra/icon-0c873cf7ce23.svg',
  '/svg/extra/icon-22a55ac71fee.svg',
  '/svg/extra/icon-34d2886eafb1.svg',
  '/svg/extra/icon-34ff153eec4e.svg',
  '/svg/extra/icon-36ae445873ad.svg',
  '/svg/extra/icon-43bf503445c5.svg',
  '/svg/extra/icon-4ed8972aa2b8.svg',
  '/svg/extra/icon-527cb9523916.svg',
  '/svg/extra/icon-615b4dff4d09.svg',
  '/svg/extra/icon-61f15d5fa242.svg',
  '/svg/extra/icon-649766ef725f.svg',
  '/svg/extra/icon-651dd2923a10.svg',
  '/svg/extra/icon-6b67b8783b6a.svg',
  '/svg/extra/icon-6c25873293c0.svg',
  '/svg/extra/icon-6e134fdbda1e.svg',
  '/svg/extra/icon-838eb192325a.svg',
  '/svg/extra/icon-886b6ae85bc6.svg',
  '/svg/extra/icon-9157214ed9c4.svg',
  '/svg/extra/icon-938c12a9f405.svg',
  '/svg/extra/icon-938ddddb771c.svg',
  '/svg/extra/icon-96495123cb1b.svg',
  '/svg/extra/icon-9a45b4993686.svg',
  '/svg/extra/icon-9d6229c40a8d.svg',
  '/svg/extra/icon-a4ea72a360cc.svg',
  '/svg/extra/icon-af51112fbda1.svg',
  '/svg/extra/icon-c0aeb9caa2ca.svg',
  '/svg/extra/icon-c10e4d45ebfa.svg',
  '/svg/extra/icon-c9b87fab5705.svg',
  '/svg/extra/icon-d269b370c5cf.svg',
  '/svg/extra/icon-dae7be10a164.svg',
  '/svg/extra/icon-dc035561d9ad.svg',
  '/svg/extra/icon-de6761387092.svg',
  '/svg/extra/icon-dfb40720ae6a.svg',
  '/svg/extra/icon-e20961b31619.svg',
  '/svg/extra/icon-e3ece82ff84d.svg',
  '/svg/extra/icon-e42dbb86abcd.svg',
  '/svg/extra/icon-e5c4dc67a486.svg',
  '/svg/extra/icon-ea9c18b62f47.svg',
  '/svg/extra/icon-f57c0d2780e7.svg',
  '/svg/extra/icon-fa9cc44ef90e.svg',
  '/svg/extra/icon-fb3793816331.svg',
  '/svg/extra/saved-messages.svg',
  '/svg/media/camera.svg',
  '/svg/media/gallery.svg',
  '/svg/media/mic.svg',
  '/svg/media/paperclip.svg',
  '/svg/media/play.svg',
  '/svg/media/speaker.svg',
  '/svg/media/upload.svg',
  '/svg/media/video.svg',
  '/svg/menu/copy.svg',
  '/svg/menu/del.svg',
  '/svg/menu/edit.svg',
  '/svg/menu/fwd.svg',
  '/svg/menu/resend.svg',
  '/svg/menu/sel.svg',
  '/svg/menu/x.svg',
  '/svg/nav/apps.svg',
  '/svg/nav/arrow-left.svg',
  '/svg/nav/chevron-down.svg',
  '/svg/nav/chevron-left.svg',
  '/svg/nav/home.svg',
  '/svg/social/bookmark-filled.svg',
  '/svg/social/bookmark.svg',
  '/svg/social/chat.svg',
  '/svg/social/heart-filled.svg',
  '/svg/social/heart.svg',
  '/svg/social/user-badge.svg',
  '/svg/social/user.svg',
  '/svg/ui/badge-7z.svg',
  '/svg/ui/badge-aab.svg',
  '/svg/ui/badge-aac.svg',
  '/svg/ui/badge-ai.svg',
  '/svg/ui/badge-angular.svg',
  '/svg/ui/badge-apk.svg',
  '/svg/ui/badge-appimage.svg',
  '/svg/ui/badge-asm.svg',
  '/svg/ui/badge-avi.svg',
  '/svg/ui/badge-avif.svg',
  '/svg/ui/badge-bash.svg',
  '/svg/ui/badge-bz2.svg',
  '/svg/ui/badge-c.svg',
  '/svg/ui/badge-cert.svg',
  '/svg/ui/badge-clojure.svg',
  '/svg/ui/badge-cpp.svg',
  '/svg/ui/badge-csharp.svg',
  '/svg/ui/badge-css.svg',
  '/svg/ui/badge-csv.svg',
  '/svg/ui/badge-dart.svg',
  '/svg/ui/badge-deb.svg',
  '/svg/ui/badge-dmg.svg',
  '/svg/ui/badge-docker.svg',
  '/svg/ui/badge-elixir.svg',
  '/svg/ui/badge-env.svg',
  '/svg/ui/badge-epub.svg',
  '/svg/ui/badge-excel.svg',
  '/svg/ui/badge-exe.svg',
  '/svg/ui/badge-figma.svg',
  '/svg/ui/badge-flac.svg',
  '/svg/ui/badge-flutter.svg',
  '/svg/ui/badge-flv.svg',
  '/svg/ui/badge-gif.svg',
  '/svg/ui/badge-git.svg',
  '/svg/ui/badge-go.svg',
  '/svg/ui/badge-graphql.svg',
  '/svg/ui/badge-gz.svg',
  '/svg/ui/badge-haskell.svg',
  '/svg/ui/badge-html.svg',
  '/svg/ui/badge-ico.svg',
  '/svg/ui/badge-ini.svg',
  '/svg/ui/badge-ipa.svg',
  '/svg/ui/badge-iso.svg',
  '/svg/ui/badge-java.svg',
  '/svg/ui/badge-jpg.svg',
  '/svg/ui/badge-js.svg',
  '/svg/ui/badge-json.svg',
  '/svg/ui/badge-jsx.svg',
  '/svg/ui/badge-julia.svg',
  '/svg/ui/badge-kotlin.svg',
  '/svg/ui/badge-latex.svg',
  '/svg/ui/badge-log.svg',
  '/svg/ui/badge-lua.svg',
  '/svg/ui/badge-m4a.svg',
  '/svg/ui/badge-markdown.svg',
  '/svg/ui/badge-midi.svg',
  '/svg/ui/badge-mkv.svg',
  '/svg/ui/badge-mov.svg',
  '/svg/ui/badge-mp3.svg',
  '/svg/ui/badge-mp4.svg',
  '/svg/ui/badge-msi.svg',
  '/svg/ui/badge-nim.svg',
  '/svg/ui/badge-npm.svg',
  '/svg/ui/badge-ogg.svg',
  '/svg/ui/badge-pdf.svg',
  '/svg/ui/badge-perl.svg',
  '/svg/ui/badge-php.svg',
  '/svg/ui/badge-png.svg',
  '/svg/ui/badge-powerpoint.svg',
  '/svg/ui/badge-powershell.svg',
  '/svg/ui/badge-prisma.svg',
  '/svg/ui/badge-proto.svg',
  '/svg/ui/badge-psd.svg',
  '/svg/ui/badge-python.svg',
  '/svg/ui/badge-r.svg',
  '/svg/ui/badge-rar.svg',
  '/svg/ui/badge-raw.svg',
  '/svg/ui/badge-rpm.svg',
  '/svg/ui/badge-rtf.svg',
  '/svg/ui/badge-ruby.svg',
  '/svg/ui/badge-rust.svg',
  '/svg/ui/badge-scala.svg',
  '/svg/ui/badge-scss.svg',
  '/svg/ui/badge-sql.svg',
  '/svg/ui/badge-svelte.svg',
  '/svg/ui/badge-svg.svg',
  '/svg/ui/badge-swift.svg',
  '/svg/ui/badge-tar.svg',
  '/svg/ui/badge-tiff.svg',
  '/svg/ui/badge-toml.svg',
  '/svg/ui/badge-ts.svg',
  '/svg/ui/badge-tsv.svg',
  '/svg/ui/badge-tsx.svg',
  '/svg/ui/badge-ttf.svg',
  '/svg/ui/badge-txt.svg',
  '/svg/ui/badge-vue.svg',
  '/svg/ui/badge-wasm.svg',
  '/svg/ui/badge-wav.svg',
  '/svg/ui/badge-webm.svg',
  '/svg/ui/badge-webp.svg',
  '/svg/ui/badge-woff.svg',
  '/svg/ui/badge-word.svg',
  '/svg/ui/badge-xml.svg',
  '/svg/ui/badge-yaml.svg',
  '/svg/ui/badge-zig.svg',
  '/svg/ui/badge-zip.svg',
  '/svg/ui/bell.svg',
  '/svg/ui/check.svg',
  '/svg/ui/clock.svg',
  '/svg/ui/dots-vertical.svg',
  '/svg/ui/emoji.svg',
  '/svg/ui/eye-closed.svg',
  '/svg/ui/eye-open.svg',
  '/svg/ui/info.svg',
  '/svg/ui/ticks-read.svg',
  '/svg/ui/ticks-sending.svg',
  '/svg/ui/ticks-sent.svg'
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

/* Lokal ishlab chiqishda (localhost/LAN) versiya o'zgarmaydi — kesh-birinchi eskirgan fayl berardi: tarmoq-birinchi */
const _DEV = /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(self.location.hostname);

/** Butun ilovani (Telegram kabi) ATOMAR o'rnatadi: critical xato bersa o'rnatish bekor (eski versiya ishlayveradi),
 *  qolgan fayllar xatosi o'rnatishni to'xtatmaydi (runtime keshga tushadi). */
async function _precacheAll() {
  const cache = await caches.open(STATIC_CACHE);
  const prev = await _prevStaticCaches();
  const fetchOne = async (u, mustHave) => {
    try {
      const res = await fetch(new Request(u, { cache: 'reload' }));
      if (res && res.ok) { await cache.put(u, res.clone()); return true; }
    } catch (_) {}
    if (mustHave) {
      // Tarmoq vaqtincha yo'q — oldingi versiyadagi nusxa bo'lsa ham (faqat rest uchun) o'tkazamiz
      throw new Error('precache failed: ' + u);
    }
    return false;
  };
  for (const u of PRECACHE_CRITICAL) await fetchOne(u, true);
  const rest = PRECACHE_URLS.slice();
  const CONC = 8;
  let i = 0;
  const worker = async () => {
    while (i < rest.length) {
      const u = rest[i++];
      // O'zgarmagan fayl: oldingi keshdan emas — har doim yangisi (hash yo'q), ammo xato bo'lsa eskisini saqlab qolamiz
      const ok = await fetchOne(u, false);
      if (!ok) {
        for (const pc of prev) { const hit = await pc.match(u); if (hit) { try { await cache.put(u, hit); } catch (_) {} break; } }
      }
    }
  };
  await Promise.all(Array.from({ length: CONC }, () => worker()));
}

async function _prevStaticCaches() {
  try {
    const keys = (await caches.keys()).filter(k => k.startsWith('spacemr-static-') && k !== STATIC_CACHE);
    return Promise.all(keys.map(k => caches.open(k)));
  } catch (_) { return []; }
}

self.addEventListener('install', (event) => {
  // skipWaiting YO'Q: yangi versiya to'liq o'rnatilib kutadi; sahifa SKIP_WAITING yuborganda (xavfsiz payt) almashadi.
  event.waitUntil(_precacheAll());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => k !== STATIC_CACHE && k !== RUNTIME_CACHE && k !== EMOJI_CACHE && k !== 'pwa-share-target').map(k => caches.delete(k))
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
    fetch(req).then(res => { if (res && (res.ok || res.type === 'opaque')) _putIn(cacheName, req, res); }).catch(() => {});
    return cached;
  }
  try {
    const res = await fetch(req);
    if (res && (res.ok || res.type === 'opaque')) await _putIn(cacheName, req, res);
    return res;
  } catch (e) {
    return new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}

/** Versiyalangan fayl: shu versiya keshida bor bo'lsa — darhol (tarmoqsiz). Yo'q bo'lsa tarmoq + keshga. */
async function _versionedFirst(req) {
  let key = req;
  try { key = new URL(req.url).pathname; } catch (_) {}
  const sc = await caches.open(STATIC_CACHE);
  const hit = (await sc.match(key)) || (await _matchCache(req));
  if (hit) return hit;
  try {
    const res = await fetch(req);
    if (res && res.ok) await _putIn(STATIC_CACHE, req, res);
    return res;
  } catch (_) {
    return new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}

/** Sahifa (HTML): shu versiyaning qobig'i darhol keshdan (oflayn ham tez). Aralash versiya bo'lmasligi uchun
 *  tarmoqdan olingan HTML keshga YOZILMAYDI — yangilanish faqat SW versiya almashinuvi orqali. */
async function _shellFirst(req) {
  const sc = await caches.open(STATIC_CACHE);
  const cached = (await sc.match('/index.html')) || (await sc.match('/'));
  if (cached) return cached;
  try { return await fetch(req); }
  catch (_) {
    const any = (await caches.match('/index.html')) || (await caches.match('/'));
    return any || new Response('Offline', { status: 503, statusText: 'Offline' });
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = req.url;

  // PWA Share Target — gallery/files app dan fayllar ulashilganda ushlaymiz
  let path = '';
  try { path = new URL(url).pathname; } catch (_) {}
  if (req.method === 'POST' && path === '/share-target') {
    event.respondWith((async () => {
      try {
        const formData = await req.formData();
        const files = formData.getAll('files');
        const title = formData.get('title') || '';
        const text = formData.get('text') || '';
        const sharedUrl = formData.get('url') || '';

        if (files && files.length > 0) {
          // 1) Fayllarni ochilayotgan sahifa olishi uchun Cache storage'da saqlaymiz
          try {
            const shareCache = await caches.open('pwa-share-target');
            const items = [];
            for (let i = 0; i < files.length; i++) {
              const f = files[i];
              const key = '/_shared_file_' + i;
              items.push({ key, name: f.name, type: f.type, size: f.size });
              await shareCache.put(key, new Response(f, {
                headers: { 'content-type': f.type || 'application/octet-stream' }
              }));
            }
            await shareCache.put('/_shared_manifest', new Response(JSON.stringify({ items, title, text, url: sharedUrl }), {
              headers: { 'content-type': 'application/json' }
            }));
          } catch (_) {}

          // 2) Ochiq oynalar bo'lsa darhol xabar yuboramiz
          const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
          if (clients.length) {
            const fileDataPromises = files.map(async (file) => {
              const ab = await file.arrayBuffer();
              return { name: file.name, type: file.type, size: file.size, data: Array.from(new Uint8Array(ab)) };
            });
            const fileDataArr = await Promise.all(fileDataPromises);
            clients.forEach(client => {
              client.postMessage({ type: 'SHARE_TARGET_FILES', files: fileDataArr, title, text, url: sharedUrl });
            });
          }
        }
        // App ga redirect — fayllar ochiladi
        return Response.redirect('/?share=1', 303);
      } catch (err) {
        return Response.redirect('/', 303);
      }
    })());
    return;
  }

  // Global Media Single-Source Deduplication (1 ta keladi, hamma joy keshdan oladi)
  if (req.method === 'GET' && !req.headers.has('range')) {
    const isStaticMap = url.includes('static-maps.yandex.ru');
    const isExternalIcon = url.includes('icons.duckduckgo.com') || url.includes('google.com/s2/favicons');
    const isYtThumb = url.includes('i.ytimg.com');
    const isPublicMedia = url.includes('/storage/v1/object/public/media/');

    if (isStaticMap || isExternalIcon || isYtThumb || isPublicMedia) {
      event.respondWith(_cacheFirstSWR(req, RUNTIME_CACHE));
      return;
    }
  }

  if (_isBypassed(url) || req.method !== 'GET') return;

  if (req.headers.has('range')) {
    event.respondWith(fetch(req).catch(() => _matchCache(req)));
    return;
  }

  if (!path) {
    try { path = new URL(url).pathname; } catch (_) { return; }
  }

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
    // Telegram kabi: qobiq darhol keshdan (oflayn ham, sekin tarmoq ham tez); yangi versiya SW almashinuvi bilan keladi
    if (_DEV) { event.respondWith(_networkFirst(req, RUNTIME_CACHE, ['/index.html', '/'])); return; }
    event.respondWith(_shellFirst(req));
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
    event.respondWith(_DEV ? _networkFirst(req, STATIC_CACHE) : _versionedFirst(req));
    return;
  }

  // JS/modullar — network-first (deploydan keyin eski kesh ushlab qolmasin)
  const isJs = req.destination === 'script'
    || path.endsWith('.js') || path.endsWith('.mjs');
  if (isJs) {
    event.respondWith(_DEV ? _networkFirst(req, STATIC_CACHE) : _versionedFirst(req));
    return;
  }

  // Rasm / font
  if (_isStaticAsset(req) || /\.(png|jpg|jpeg|gif|webp|svg|ico|woff2?|ttf|otf)$/i.test(path)) {
    event.respondWith(_versionedFirst(req));
  }
});
