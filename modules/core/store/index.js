/** store/index.js — Phase 2–4 public API */
export { POLICY, policyOf, canCache, isExpired, SCHEMA_VERSION } from '../cache-policy.js';
export {
  openDb, ensureSchema, clearAllStores, isDbFailed, DB_NAME, STORES, msgScope, scopedKey,
} from './db.js';
export {
  store, get, subscribe, dispatch, setUid, getUid, whenStoreReady,
  isStoreV2Enabled, clearStore, putProfile, putPosts, putThread, putChatsList,
} from './store.js';
export {
  isSyncV2Enabled, fetchHeads, syncChat, syncGroup, loadThreadDelta, loadGroupDelta,
  bindTombstoneChannel, bindGroupTombstoneChannel, getCursor, setCursor, invalidateHeads,
} from './sync.js';
export {
  paintGateKey, isPaintOpen, markCacheReady, markNetworkReady, tryOpenPaint,
  resetPaintGate, assertNoFullClear, getPaintGate,
} from './paint-gate.js';
export { enqueueSend, flushOutbox, scheduleFlush, pendingCount, listPending } from './outbox.js';
export {
  resolveMedia, putMedia, touch, removeMedia, evictIfNeeded, clearMediaCache,
  cachedMediaUrlSync, resolvePublicMedia, prefetchMany, mediaCache,
} from './media-cache.js';
export {
  isKillSwitch, setKillSwitch,
  isEphemeralDevice, setEphemeralDevice, getRolloutPct, setRolloutPct,
  flagsSnapshot, uidBucket,
} from './flags.js';
