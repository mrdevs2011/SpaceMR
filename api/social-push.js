import webpush from 'web-push';

const recentEvents = new Map();
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function clip(value, max = 100) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function safeText(value) {
  return String(value ?? '').replace(/\|\|[\s\S]*?(?:\|\||$)/g, '••••');
}

function json(res, status, body) {
  return res.status(status).json(body);
}

async function restRequest(base, serviceKey, table, query, method = 'GET', body) {
  const url = new URL(`${base}/rest/v1/${table}`);
  for (const [key, value] of Object.entries(query || {})) url.searchParams.set(key, value);
  const response = await fetch(url, {
    method,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      ...(method === 'DELETE' ? { Prefer: 'return=minimal' } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(9000),
  });
  if (!response.ok) {
    const error = new Error(`Supabase ${method} ${table} returned ${response.status}`);
    error.status = response.status;
    throw error;
  }
  if (response.status === 204) return null;
  return response.json();
}

function publicMediaUrl(base, path) {
  if (!path || typeof path !== 'string') return undefined;
  const safePath = path.split('/').map(encodeURIComponent).join('/');
  return `${base}/storage/v1/object/public/media/${safePath}`;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Vary', 'Authorization');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });

  const auth = String(req.headers.authorization || '');
  const jwt = auth.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!jwt) return json(res, 401, { error: 'unauthorized' });

  const base = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const vapidPublic = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_SECRET_KEY;
  const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';
  const canonicalOrigin = String(process.env.PUSH_CANONICAL_ORIGIN || 'https://spacemr.vercel.app').replace(/\/$/, '');
  if (!base || !serviceKey || !vapidPublic || !vapidPrivate) {
    return json(res, 503, { error: 'push_not_configured' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return json(res, 400, { error: 'invalid_json' }); }
  }
  const event = body?.event;
  const postId = String(body?.postId || '');
  const commentId = String(body?.commentId || '');
  if (body?.kind !== 'social' || !['like', 'comment'].includes(event) || !UUID_RE.test(postId)) {
    return json(res, 400, { error: 'invalid_event' });
  }
  if (event === 'comment' && !UUID_RE.test(commentId)) return json(res, 400, { error: 'invalid_comment' });

  try {
    // JWTni Auth serverda tekshiramiz; client yuborgan user_id ga ishonmaymiz.
    const authResponse = await fetch(`${base}/auth/v1/user`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${jwt}` },
      signal: AbortSignal.timeout(7000),
    });
    if (!authResponse.ok) return json(res, 401, { error: 'unauthorized' });
    const actor = await authResponse.json();
    const actorId = actor?.id;
    if (!UUID_RE.test(String(actorId || ''))) return json(res, 401, { error: 'unauthorized' });

    const posts = await restRequest(base, serviceKey, 'posts', {
      select: 'id,user_id,media_path,media_type', id: `eq.${postId}`, limit: '1',
    });
    const post = posts?.[0];
    if (!post || post.user_id === actorId) return json(res, 200, { ok: true, sent: 0 });

    let eventKey;
    let commentText = '';
    if (event === 'like') {
      const likes = await restRequest(base, serviceKey, 'post_likes', {
        select: 'post_id,created_at', post_id: `eq.${postId}`, user_id: `eq.${actorId}`, limit: '1',
      });
      if (!likes?.length) return json(res, 200, { ok: true, sent: 0 });
      eventKey = `like:${postId}:${actorId}:${likes[0].created_at || ''}`;
    } else {
      const comments = await restRequest(base, serviceKey, 'comments', {
        select: 'id,text', id: `eq.${commentId}`, post_id: `eq.${postId}`, user_id: `eq.${actorId}`, limit: '1',
      });
      if (!comments?.length) return json(res, 200, { ok: true, sent: 0 });
      eventKey = `comment:${commentId}`;
      commentText = clip(safeText(comments[0].text), 90);
    }

    const now = Date.now();
    for (const [key, at] of recentEvents) if (now - at > 10 * 60_000) recentEvents.delete(key);
    if (recentEvents.has(eventKey)) return json(res, 200, { ok: true, sent: 0, duplicate: true });
    recentEvents.set(eventKey, now);

    const profiles = await restRequest(base, serviceKey, 'profiles', {
      select: 'full_name,avatar', id: `eq.${actorId}`, limit: '1',
    });
    const profile = profiles?.[0] || {};
    const actorName = clip(profile.full_name || 'SpaceMR', 70);
    const tokens = await restRequest(base, serviceKey, 'push_tokens', {
      select: 'token,user_id,origin',
      user_id: `eq.${post.user_id}`,
      origin: `eq.${canonicalOrigin}#social-v2`,
    });
    if (!tokens?.length) return json(res, 200, { ok: true, sent: 0 });

    webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);
    const image = String(post.media_type || '').startsWith('image/')
      ? publicMediaUrl(base, post.media_path) : undefined;
    const payload = JSON.stringify({
      type: 'social',
      title: actorName,
      body: event === 'like' ? 'Postingizga yoqdi' : `Izoh: ${commentText || 'Yangi izoh'}`,
      icon: typeof profile.avatar === 'string' && profile.avatar.startsWith('https://') ? profile.avatar : undefined,
      image: image?.startsWith('https://') ? image : undefined,
      fromUid: actorId,
      postId,
      ...(event === 'comment' ? { commentId } : {}),
    });

    const dead = [];
    const outcomes = await Promise.all(tokens.map(async row => {
      try {
        const subscription = JSON.parse(row.token);
        await webpush.sendNotification(subscription, payload, { TTL: 3600, urgency: 'normal' });
        return true;
      } catch (error) {
        if (error?.statusCode === 404 || error?.statusCode === 410) dead.push(row.token);
        else console.error('[social-push] delivery failed:', Number(error?.statusCode) || 'network');
        return false;
      }
    }));

    await Promise.all(dead.map(token => restRequest(base, serviceKey, 'push_tokens', {
      token: `eq.${token}`,
    }, 'DELETE')));
    return json(res, 200, { ok: true, sent: outcomes.filter(Boolean).length });
  } catch (error) {
    console.error('[social-push] request failed:', Number(error?.status) || 'internal');
    return json(res, 502, { error: 'push_delivery_failed' });
  }
}
