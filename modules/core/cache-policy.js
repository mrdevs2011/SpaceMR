/**
 * cache-policy.js — yagona kesh siyosati jadvali (§3.1).
 * Yangi entity turi shu yerga qo'shiladi; tur yo'q → kesh yozilmaydi.
 */

/** @typedef {'IMMUTABLE'|'LOG'|'DOC'|'SNAPSHOT'|'EPHEMERAL'|'LOCAL_ONLY'} CacheClass */

/**
 * @type {Record<string, {
 *   class: CacheClass,
 *   store?: string,
 *   maxAgeMs?: number|null,
 *   note?: string
 * }>}
 */
export const POLICY = Object.freeze({
  /* IMMUTABLE — content-addressed / path */
  media_file:   { class: 'IMMUTABLE', store: 'media_index', maxAgeMs: null, note: 'story/post/chat media blob' },
  emoji:        { class: 'IMMUTABLE', store: null, maxAgeMs: null, note: 'SW emoji cache' },
  shell_asset:  { class: 'IMMUTABLE', store: null, maxAgeMs: null, note: 'JS/CSS/SVG via SW' },

  /* LOG — seq + delta + tombstone */
  message:      { class: 'LOG', store: 'messages', maxAgeMs: null, note: 'dm messages' },
  group_message:{ class: 'LOG', store: 'messages', maxAgeMs: null, note: 'group messages' },

  /* DOC — rev / updated_at */
  profile:      { class: 'DOC', store: 'profiles', maxAgeMs: 7 * 24 * 3600 * 1000 },
  group_meta:   { class: 'DOC', store: 'groups', maxAgeMs: null },
  post:         { class: 'DOC', store: 'posts', maxAgeMs: null },
  comment:      { class: 'DOC', store: null, maxAgeMs: null },

  /* SNAPSHOT — head bilan tasdiqlanadi */
  chats_list:   { class: 'SNAPSHOT', store: 'chats', maxAgeMs: 24 * 3600 * 1000 },
  feed_page:    { class: 'SNAPSHOT', store: 'posts', maxAgeMs: 6 * 3600 * 1000 },
  stories_list: { class: 'SNAPSHOT', store: null, maxAgeMs: 24 * 3600 * 1000, note: 'story-cache.js Phase 6' },

  /* EPHEMERAL — keshlanmaydi */
  presence:     { class: 'EPHEMERAL', store: null },
  typing:       { class: 'EPHEMERAL', store: null },
  unread_count: { class: 'EPHEMERAL', store: null },
  call_state:   { class: 'EPHEMERAL', store: null },

  /* LOCAL_ONLY */
  outbox:       { class: 'LOCAL_ONLY', store: 'outbox', maxAgeMs: null },
  draft:        { class: 'LOCAL_ONLY', store: 'meta', maxAgeMs: null },
  ui_flags:     { class: 'LOCAL_ONLY', store: 'meta', maxAgeMs: null },
});

export function policyOf(entityType) {
  return POLICY[entityType] || null;
}

/** Keshga yozish ruxsati: EPHEMERAL va noma'lum tur — yo'q. */
export function canCache(entityType) {
  const p = POLICY[entityType];
  if (!p) return false;
  return p.class !== 'EPHEMERAL';
}

export function isExpired(entityType, savedAtMs, now = Date.now()) {
  const p = POLICY[entityType];
  if (!p || p.maxAgeMs == null) return false;
  if (!savedAtMs) return true;
  return (now - savedAtMs) > p.maxAgeMs;
}

export const SCHEMA_VERSION = 2;
