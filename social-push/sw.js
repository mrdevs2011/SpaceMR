/* SpaceMR social-only Web Push worker. Kept separate so existing chat/call
   subscriptions and their VAPID key remain untouched. */
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch { data = { body: event.data ? event.data.text() : '' }; }

  event.waitUntil((async () => {
    const postId = typeof data.postId === 'string' ? data.postId : '';
    const commentId = typeof data.commentId === 'string' ? data.commentId : '';
    const title = String(data.title || 'SpaceMR').slice(0, 80);
    const body = String(data.body || 'Yangi faollik').replace(/\|\|[\s\S]*?(?:\|\||$)/g, '••••').slice(0, 150);
    const icon = typeof data.icon === 'string' && data.icon.startsWith('https://') ? data.icon : '/icons/icon-192.png';
    const image = typeof data.image === 'string' && data.image.startsWith('https://') ? data.image : undefined;
    await self.registration.showNotification(title, {
      body,
      icon,
      badge: '/icons/icon-192.png',
      image,
      lang: 'uz',
      timestamp: Date.now(),
      tag: commentId ? `spacemr-social-comment-${commentId}` : `spacemr-social-like-${postId}`,
      renotify: true,
      data: { postId, commentId },
      vibrate: [180, 90, 180],
    });
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const data = event.notification.data || {};
  const postId = typeof data.postId === 'string' ? data.postId : '';
  if (!/^[0-9a-f-]{36}$/i.test(postId)) return;
  const path = `/p/${encodeURIComponent(postId)}${data.commentId ? '/comments' : ''}`;
  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (client.url.startsWith(self.location.origin) && typeof client.navigate === 'function') {
        const next = await client.navigate(new URL(path, self.location.origin).href);
        return (next || client).focus?.();
      }
    }
    return clients.openWindow?.(path);
  })());
});
