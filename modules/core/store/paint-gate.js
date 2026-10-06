/**
 * paint-gate.js — UI chizish darvozasi (I-2, P2).
 * Kesh + network birinchi javobi tayyor bo'lguncha spinner; keyin faqat bir marta “ochiladi”.
 * Flash detektori: ochilgandan keyin full clear taqiqlanadi (dev log).
 */

const gates = new Map(); // key -> { open, hasCache, hasNetwork, openedAt }

export function paintGateKey(kind, id) {
  return String(kind || 'x') + ':' + String(id || '');
}

/** Gate ochiqmi? */
export function isPaintOpen(key) {
  return !!gates.get(key)?.open;
}

/** Kesh borligini belgilash */
export function markCacheReady(key) {
  const g = gates.get(key) || { open: false, hasCache: false, hasNetwork: false, openedAt: 0 };
  g.hasCache = true;
  gates.set(key, g);
  return g;
}

/** Network birinchi javob */
export function markNetworkReady(key) {
  const g = gates.get(key) || { open: false, hasCache: false, hasNetwork: false, openedAt: 0 };
  g.hasNetwork = true;
  gates.set(key, g);
  return g;
}

/**
 * Chizish mumkinmi?
 * - Kesh bo'lsa: darhol open (network fon)
 * - Kesh yo'q: network kelguncha yopiq
 */
export function tryOpenPaint(key) {
  const g = gates.get(key) || { open: false, hasCache: false, hasNetwork: false, openedAt: 0 };
  if (g.open) return true;
  if (g.hasCache || g.hasNetwork) {
    g.open = true;
    g.openedAt = Date.now();
    gates.set(key, g);
    return true;
  }
  return false;
}

/** Thread/sahifa yopilganda tozalash */
export function resetPaintGate(key) {
  gates.delete(key);
}

/** Full clear chaqiruvi — ochiq gateda ogohlantirish (dev) */
export function assertNoFullClear(key, reason) {
  const g = gates.get(key);
  if (g?.open) {
    console.warn('[paint-gate] full clear after open:', key, reason || '');
  }
}

export function getPaintGate(key) {
  return gates.get(key) || null;
}
