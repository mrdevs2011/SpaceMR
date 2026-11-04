import test from 'node:test';
import assert from 'node:assert/strict';
import webpush from 'web-push';
import handler from '../../api/social-push.js';

const actorId = '11111111-1111-4111-8111-111111111111';
const postId = '22222222-2222-4222-8222-222222222222';
const ownerId = '33333333-3333-4333-8333-333333333333';

function mockResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(name, value) { this.headers[name] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; return this; },
    end() { return this; },
  };
}

test('social push authenticates actor, verifies like and sends only to social-v2 subscription', async () => {
  const keys = webpush.generateVAPIDKeys();
  const oldEnv = { ...process.env };
  const oldFetch = globalThis.fetch;
  const oldSend = webpush.sendNotification;
  const sent = [];
  try {
    Object.assign(process.env, {
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'test-service-role',
      VAPID_PUBLIC_KEY: keys.publicKey,
      VAPID_SECRET_KEY: keys.privateKey,
      VAPID_SUBJECT: 'mailto:test@example.com',
      PUSH_CANONICAL_ORIGIN: 'https://spacemr.vercel.app',
    });
    webpush.sendNotification = async (subscription, payload) => { sent.push({ subscription, payload: JSON.parse(payload) }); };
    globalThis.fetch = async input => {
      const url = new URL(String(input));
      if (url.pathname === '/auth/v1/user') return Response.json({ id: actorId });
      if (url.pathname === '/rest/v1/posts') return Response.json([{ id: postId, user_id: ownerId, media_path: null, media_type: 'text' }]);
      if (url.pathname === '/rest/v1/post_likes') return Response.json([{ post_id: postId, created_at: '2026-11-04T10:00:00Z' }]);
      if (url.pathname === '/rest/v1/profiles') return Response.json([{ full_name: 'Tester', avatar: null }]);
      if (url.pathname === '/rest/v1/push_tokens') {
        assert.equal(url.searchParams.get('origin'), 'eq.https://spacemr.vercel.app#social-v2');
        return Response.json([{ token: JSON.stringify({ endpoint: 'https://push.example/sub', keys: { p256dh: 'abc', auth: 'xyz' } }), user_id: ownerId, origin: 'https://spacemr.vercel.app#social-v2' }]);
      }
      throw new Error(`Unexpected request: ${url.pathname}`);
    };

    const res = mockResponse();
    await handler({ method: 'POST', headers: { authorization: 'Bearer valid-user-jwt' }, body: { kind: 'social', event: 'like', postId } }, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ok: true, sent: 1 });
    assert.equal(sent.length, 1);
    assert.equal(sent[0].payload.type, 'social');
    assert.equal(sent[0].payload.body, 'Postingizga yoqdi');
    assert.equal(sent[0].payload.postId, postId);
  } finally {
    globalThis.fetch = oldFetch;
    webpush.sendNotification = oldSend;
    for (const key of Object.keys(process.env)) if (!(key in oldEnv)) delete process.env[key];
    Object.assign(process.env, oldEnv);
  }
});

test('social push rejects unauthenticated requests before database access', async () => {
  const res = mockResponse();
  await handler({ method: 'POST', headers: {}, body: { kind: 'social', event: 'like', postId } }, res);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: 'unauthorized' });
});
