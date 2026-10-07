/** force-reload.js — Admin "Update All users":
 *  - Online: realtime + broadcast → darhol hard refresh (0 ms kechikish)
 *  - Offline: localStorage ack solishtiradi, keyingi kirishda hard refresh
 *  Settings dagi fullAppReloadBtn bilan bir xil mexanika.
 */
import { sb } from './config.js';

const ACK_KEY = 'spacemr_force_reload_ack';
const BUSY_KEY = 'spacemr_force_reload_busy';

let _started = false;
let _ch = null;

/** Settings / admin bilan bir xil: SW + cache tozalash + hard navigate.
 *  URL ga ?_full= QO'SHILMAYDI — sessionStorage flag + toza `/`. */
export async function executeHardFullReload() {
  // Loop oldini olish (bir marta)
  try {
    if (sessionStorage.getItem(BUSY_KEY) === '1') return;
    sessionStorage.setItem(BUSY_KEY, '1');
    // SW controllerchange → location.reload ni bloklash (shu sessiya)
    sessionStorage.setItem('spacemr_skip_sw_reload', '1');
  } catch (_) {}

  try {
    try {
      const { clearAllCache } = await import('./local-cache.js');
      clearAllCache();
    } catch (_) {}
    try {
      const { clearRuntimeCache } = await import('./local-cache.js');
      await clearRuntimeCache?.();
    } catch (_) {}
    if (typeof caches !== 'undefined') {
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
    }
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }
  } catch (e) {
    console.warn('[force-reload]', e);
  }

  // Joriy path ni saqlab hard navigate (query paramsiz) — URL yo'qolmasin
  try {
    var path = '/';
    try {
      path = (location.pathname || '/').replace(/\/+$/, '') || '/';
      if (path === '/index.html') path = '/';
    } catch (_) {}
    location.replace(path);
  } catch (_) {
    location.href = path || '/';
  }
}

function _ack() {
  try { return Number(localStorage.getItem(ACK_KEY) || 0) || 0; } catch (_) { return 0; }
}
function _setAck(v) {
  try { localStorage.setItem(ACK_KEY, String(v)); } catch (_) {}
}

/** Server version > local ack → hard reload (darhol) */
export function applyForceVersion(version) {
  const v = Number(version) || 0;
  if (!v) return false;
  if (v <= _ack()) return false;
  _setAck(v); // reload oldidan — loop bo'lmasin
  // 0.0ms: microtask emas, sinxron boshlash
  executeHardFullReload();
  return true;
}

/** Boot: offline userlar uchun */
export async function checkForceReloadOnBoot() {
  // URL dagi eski ?_full= ni jim tozalash (reload qilmasdan)
  try {
    if (location.search && /(?:^|[?&])_full=/.test(location.search)) {
      const u = new URL(location.href);
      u.searchParams.delete('_full');
      const q = u.searchParams.toString();
      history.replaceState(null, '', u.pathname + (q ? '?' + q : '') + u.hash);
    }
  } catch (_) {}
  // BUSY ni darhol olib tashlamaymiz — SW controllerchange qo'shimcha reload qilmasin
  try {
    setTimeout(() => {
      try { sessionStorage.removeItem(BUSY_KEY); } catch (_) {}
    }, 2500);
  } catch (_) {}
  try {
    const { data, error } = await sb
      .from('app_force_reload')
      .select('version')
      .eq('id', 'global')
      .maybeSingle();
    if (error || !data) return;
    applyForceVersion(data.version);
  } catch (e) {
    console.warn('[force-reload] boot', e?.message || e);
  }
}

/** Online: postgres_changes + broadcast */
export function startForceReloadWatcher() {
  if (_started) return;
  _started = true;

  // Boot check (async)
  checkForceReloadOnBoot();

  try {
    _ch = sb.channel('app-force-reload-bus', {
      config: { broadcast: { self: false } },
    });
    _ch
      .on('broadcast', { event: 'force_reload' }, ({ payload }) => {
        applyForceVersion(payload?.version);
      })
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'app_force_reload' },
        (payload) => {
          const v = payload?.new?.version;
          applyForceVersion(v);
        }
      )
      .subscribe();
  } catch (e) {
    console.warn('[force-reload] watch', e?.message || e);
  }
}

/** Admin: barcha userlarga signal */
export async function adminTriggerForceReload() {
  const { data, error } = await sb.rpc('admin_trigger_force_reload');
  if (error) throw error;
  const version = Number(data) || Date.now();

  // Broadcast — realtime publication kechiksa ham online userlar olsin
  try {
    const ch = sb.channel('app-force-reload-bus');
    await new Promise((res) => {
      ch.subscribe((status) => {
        if (status === 'SUBSCRIBED') res();
      });
      setTimeout(res, 800);
    });
    await ch.send({
      type: 'broadcast',
      event: 'force_reload',
      payload: { version },
    });
    try { await sb.removeChannel(ch); } catch (_) {}
  } catch (e) {
    console.warn('[force-reload] broadcast', e?.message || e);
  }

  // Admin o'zi ham yangilanishi mumkin — xohlasa
  return version;
}
