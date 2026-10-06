/**
 * flags.js — Phase 8: feature flag, rollout, kill-switch, ephemeral device.
 *
 * localStorage kalitlari:
 *   ff_sync_v2=1|0          — delta sync (default 0)
 *   ff_store_v2=1|0         — dual-write store (default 1)
 *   ff_rollout_pct=0..100   — sync v2 foizi (uid hash); 100 = hammaga
 *   spacemr_ephemeral=1     — "bu qurilmada ma'lumotni saqlama" (faqat xotira)
 *   spacemr_kill=1          — lokal kill: sync/store o'chiriladi + SW kill urinish
 */

function _ls(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function _set(key, v) {
  try {
    if (v == null) localStorage.removeItem(key);
    else localStorage.setItem(key, String(v));
  } catch (_) {}
}

/** Oddiy string hash → 0..99 */
export function uidBucket(uid) {
  if (!uid) return 0;
  let h = 0;
  const s = String(uid);
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 100;
}

export function isKillSwitch() {
  return _ls('spacemr_kill') === '1';
}

export function setKillSwitch(on) {
  _set('spacemr_kill', on ? '1' : null);
  if (on) {
    try {
      navigator.serviceWorker?.controller?.postMessage({ type: 'KILL_SWITCH' });
    } catch (_) {}
  }
}

export function isEphemeralDevice() {
  return _ls('spacemr_ephemeral') === '1';
}

export function setEphemeralDevice(on) {
  _set('spacemr_ephemeral', on ? '1' : null);
}

export function getRolloutPct() {
  const n = parseInt(_ls('ff_rollout_pct') || '0', 10);
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

export function setRolloutPct(pct) {
  _set('ff_rollout_pct', String(Math.max(0, Math.min(100, pct | 0))));
}

/** Sync v2: default ON (migratsiya 074–076). O'chirish: localStorage ff_sync_v2=0 */
export function isSyncV2Enabled(uid) {
  if (isKillSwitch()) return false;
  const v = _ls('ff_sync_v2');
  if (v === '0') return false;
  if (v === '1') return true;
  // Aniq o'chirilmagan bo'lsa — yoqilgan (RPC xato bo'lsa chat eski yo'lga tushadi)
  const pct = getRolloutPct();
  if (pct <= 0) return true; // default ON
  if (pct >= 100) return true;
  return uidBucket(uid) < pct;
}

export function isStoreV2Enabled() {
  if (isKillSwitch() || isEphemeralDevice()) return false;
  const v = _ls('ff_store_v2');
  if (v === '0') return false;
  return true; // default on for dual-write unless ephemeral/kill
}

/** Diagnostika */
export function flagsSnapshot(uid) {
  return {
    kill: isKillSwitch(),
    ephemeral: isEphemeralDevice(),
    syncV2: isSyncV2Enabled(uid),
    storeV2: isStoreV2Enabled(),
    rolloutPct: getRolloutPct(),
    bucket: uidBucket(uid),
  };
}

try {
  if (typeof window !== 'undefined') {
    window.__spacemrFlags = {
      isSyncV2Enabled, isStoreV2Enabled, isKillSwitch, setKillSwitch,
      isEphemeralDevice, setEphemeralDevice, getRolloutPct, setRolloutPct,
      flagsSnapshot, uidBucket,
    };
  }
} catch (_) {}
