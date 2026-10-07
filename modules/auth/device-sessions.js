/**
 * device-sessions.js — ulangan qurilmalar ro'yxati, upsert, revoke
 */
import { sb, state } from '../core/config.js';
import { $, esc, showConfirm } from '../core/utils.js';
import { toast } from '../ui/toast.js';

const DEVICE_ID_KEY = 'spacemr_device_id';

export function getDeviceId() {
  let id = null;
  try {
    id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
  } catch (_) {
    id = 'dev-' + Date.now();
  }
  return id;
}

function isPwa() {
  try {
    if (window.matchMedia('(display-mode: standalone)').matches) return true;
    if (window.matchMedia('(display-mode: minimal-ui)').matches) return true;
    if (typeof navigator !== 'undefined' && navigator.standalone === true) return true;
  } catch (_) {}
  return false;
}

function parseBrowser(ua) {
  const s = ua || '';
  if (/Edg\//i.test(s)) return 'Microsoft Edge';
  if (/OPR\//i.test(s) || /Opera/i.test(s)) return 'Opera';
  if (/SamsungBrowser/i.test(s)) return 'Samsung Internet';
  if (/Firefox\//i.test(s)) return 'Firefox';
  if (/CriOS\//i.test(s)) return 'Chrome (iOS)';
  if (/FxiOS\//i.test(s)) return 'Firefox (iOS)';
  if (/Chrome\//i.test(s) && !/Edg\//i.test(s)) return 'Chrome';
  if (/Safari\//i.test(s) && !/Chrome\//i.test(s)) return 'Safari';
  if (/YaBrowser/i.test(s)) return 'Yandex';
  if (/UCBrowser/i.test(s)) return 'UC Browser';
  return 'Brauzer';
}

function parsePlatform(ua, platformHint) {
  const s = ua || '';
  if (/Android/i.test(s)) return 'Android';
  if (/iPhone|iPad|iPod/i.test(s)) return /iPad/i.test(s) ? 'iPadOS' : 'iOS';
  if (/Windows/i.test(s)) return 'Windows';
  if (/Mac OS X|Macintosh/i.test(s)) return 'macOS';
  if (/Linux/i.test(s)) return 'Linux';
  if (/CrOS/i.test(s)) return 'Chrome OS';
  return platformHint || 'Noma\'lum';
}

function parseOsVersion(ua) {
  const s = ua || '';
  let m;
  m = s.match(/Android ([\d.]+)/i);
  if (m) return m[1];
  m = s.match(/OS ([\d_]+) like Mac/i);
  if (m) return m[1].replace(/_/g, '.');
  m = s.match(/Windows NT ([\d.]+)/i);
  if (m) {
    const map = { '10.0': '10/11', '6.3': '8.1', '6.2': '8', '6.1': '7' };
    return map[m[1]] || m[1];
  }
  m = s.match(/Mac OS X ([\d_]+)/i);
  if (m) return m[1].replace(/_/g, '.');
  return '';
}

/** Model / marketing name — Client Hints + UA fallback */
async function detectDeviceInfo() {
  const ua = navigator.userAgent || '';
  let deviceName = '';
  let deviceModel = '';
  let platform = parsePlatform(ua, navigator.platform || '');
  let osVersion = parseOsVersion(ua);
  let browser = parseBrowser(ua);

  try {
    const uad = navigator.userAgentData;
    if (uad) {
      if (uad.platform) platform = uad.platform;
      const brands = uad.brands || uad.uaList || [];
      const brand = brands.find(b => b.brand && !/Not.?A.?Brand/i.test(b.brand));
      if (brand) browser = brand.brand + (brand.version ? ' ' + brand.version.split('.')[0] : '');
      try {
        const high = await uad.getHighEntropyValues([
          'model', 'platformVersion', 'architecture', 'bitness', 'fullVersionList', 'uaFullVersion'
        ]);
        if (high.model) deviceModel = high.model;
        if (high.platformVersion) osVersion = high.platformVersion;
        if (high.platform) platform = high.platform;
        if (Array.isArray(high.fullVersionList)) {
          const b = high.fullVersionList.find(x => x.brand && !/Not.?A.?Brand/i.test(x.brand));
          if (b) browser = b.brand + (b.version ? ' ' + b.version.split('.')[0] : '');
        }
      } catch (_) {}
    }
  } catch (_) {}

  // UA model fallbacks
  if (!deviceModel) {
    let m;
    m = ua.match(/\(Linux; Android [^;]+; ([^)]+)\)/i);
    if (m) deviceModel = m[1].replace(/\s+Build.*$/i, '').trim();
    if (/iPhone/i.test(ua)) deviceModel = deviceModel || 'iPhone';
    if (/iPad/i.test(ua)) deviceModel = deviceModel || 'iPad';
  }

  // Human-readable device name
  if (deviceModel && platform) {
    deviceName = deviceModel;
  } else if (/iPhone/i.test(ua)) {
    deviceName = 'iPhone';
  } else if (/iPad/i.test(ua)) {
    deviceName = 'iPad';
  } else if (/Android/i.test(ua)) {
    deviceName = deviceModel || 'Android qurilma';
  } else if (/Windows/i.test(ua)) {
    deviceName = 'Windows kompyuter';
  } else if (/Mac/i.test(ua)) {
    deviceName = 'Mac';
  } else if (/Linux/i.test(ua)) {
    deviceName = 'Linux';
  } else {
    deviceName = platform || 'Qurilma';
  }

  const clientType = isPwa() ? 'pwa' : 'browser';

  return {
    deviceName: String(deviceName).slice(0, 120),
    deviceModel: String(deviceModel || deviceName).slice(0, 120),
    browser: String(browser).slice(0, 80),
    clientType,
    platform: String(platform).slice(0, 80),
    osVersion: String(osVersion).slice(0, 40),
    userAgent: String(ua).slice(0, 512),
  };
}

/** Login / app kirishda sessiya yozish */
export async function registerDeviceSession() {
  if (!state.me?.uid) return null;
  const deviceId = getDeviceId();
  const info = await detectDeviceInfo();
  try {
    const { data, error } = await sb.rpc('upsert_my_device_session', {
      p_device_id: deviceId,
      p_device_name: info.deviceName,
      p_device_model: info.deviceModel,
      p_browser: info.browser,
      p_client_type: info.clientType,
      p_platform: info.platform,
      p_os_version: info.osVersion,
      p_user_agent: info.userAgent,
    });
    if (error) {
      console.warn('[devices] upsert:', error.message);
      return null;
    }
    return data;
  } catch (e) {
    console.warn('[devices] upsert err:', e?.message || e);
    return null;
  }
}

/** Boot: bu device revoke qilinganmi? */
export async function checkDeviceRevoked() {
  const deviceId = getDeviceId();
  try {
    const { data, error } = await sb.rpc('is_my_device_revoked', { p_device_id: deviceId });
    if (error) return false;
    return data === true;
  } catch (_) {
    return false;
  }
}

export async function listDeviceSessions() {
  const { data, error } = await sb
    .from('device_sessions')
    .select('id, device_id, device_name, device_model, browser, client_type, platform, os_version, user_agent, last_seen, created_at, revoked_at')
    .is('revoked_at', null)
    .order('last_seen', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function revokeDevice(deviceId) {
  const { data, error } = await sb.rpc('revoke_my_device_sessions', {
    p_device_id: deviceId,
    p_all_others: false,
  });
  if (error) throw error;
  return data;
}

export async function revokeAllOtherDevices() {
  const mine = getDeviceId();
  const { data, error } = await sb.rpc('revoke_my_device_sessions', {
    p_device_id: mine,
    p_all_others: true,
  });
  if (error) throw error;
  return data;
}

/** Broadcast orqali boshqa qurilmalarga darhol chiqish signal */
export async function broadcastSessionRevoked(deviceIds) {
  if (!state.me?.uid || !deviceIds?.length) return;
  try {
    const ch = sb.channel('user-session-' + state.me.uid);
    await new Promise((resolve) => {
      const t = setTimeout(resolve, 1500);
      ch.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          clearTimeout(t);
          resolve();
        }
      });
    });
    await ch.send({
      type: 'broadcast',
      event: 'session_revoked',
      payload: {
        deviceIds: Array.isArray(deviceIds) ? deviceIds : [deviceIds],
        from: getDeviceId(),
        at: Date.now(),
      },
    });
    // kanalni uzoq ushlab turmaslik — auth watch allaqachon tinglaydi
    try { sb.removeChannel(ch); } catch (_) {}
  } catch (e) {
    console.warn('[devices] broadcast:', e?.message || e);
  }
}

function relTime(iso) {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!t) return '';
  const sec = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (sec < 60) return 'hozir';
  if (sec < 3600) return Math.floor(sec / 60) + ' daqiqa oldin';
  if (sec < 86400) return Math.floor(sec / 3600) + ' soat oldin';
  if (sec < 86400 * 7) return Math.floor(sec / 86400) + ' kun oldin';
  try {
    return new Date(iso).toLocaleString('uz-UZ', { dateStyle: 'medium', timeStyle: 'short' });
  } catch (_) {
    return iso;
  }
}

function clientLabel(row) {
  const ct = row.client_type === 'pwa' ? 'PWA' : 'Brauzer';
  const br = row.browser || 'Brauzer';
  return ct + ' · ' + br;
}

function deviceTitle(row) {
  const name = row.device_name || row.device_model || 'Qurilma';
  const model = row.device_model && row.device_model !== name ? row.device_model : '';
  return model ? name + ' · ' + model : name;
}

let _menuOpenId = null;

function closeDeviceMenus() {
  document.querySelectorAll('.dev-menu.show').forEach(el => el.classList.remove('show'));
  _menuOpenId = null;
}

function renderAdvanced(row) {
  const lines = [
    ['Qurilma nomi', row.device_name || '—'],
    ['Model', row.device_model || '—'],
    ['Platforma', [row.platform, row.os_version].filter(Boolean).join(' ') || '—'],
    ['Kirish turi', row.client_type === 'pwa' ? 'PWA (o\'rnatilgan ilova)' : 'Brauzer'],
    ['Brauzer', row.browser || '—'],
    ['Oxirgi faollik', relTime(row.last_seen) || '—'],
    ['Birinchi kirish', relTime(row.created_at) || '—'],
    ['User-Agent', row.user_agent || '—'],
    ['Device ID', row.device_id || '—'],
  ];
  return lines.map(([k, v]) =>
    `<div class="dev-adv-row"><span class="dev-adv-k">${esc(k)}</span><span class="dev-adv-v">${esc(String(v))}</span></div>`
  ).join('');
}

export async function paintDevicesList() {
  const list = $('devicesList');
  const empty = $('devicesEmpty');
  const countEl = $('devicesCount');
  if (!list) return;

  list.innerHTML = '<div class="dev-loading">Yuklanmoqda…</div>';
  if (empty) empty.hidden = true;

  try {
    const rows = await listDeviceSessions();
    const mine = getDeviceId();
    if (countEl) {
      if (rows.length) {
        countEl.textContent = String(rows.length);
        countEl.hidden = false;
      } else {
        countEl.textContent = '';
        countEl.hidden = true;
      }
    }

    if (!rows.length) {
      list.innerHTML = '';
      if (empty) empty.hidden = false;
      return;
    }

    list.innerHTML = rows.map(row => {
      const isMe = row.device_id === mine;
      const title = deviceTitle(row);
      const sub = clientLabel(row) + ' · ' + relTime(row.last_seen);
      return `
        <div class="dev-row${isMe ? ' is-current' : ''}" data-dev-id="${esc(row.device_id)}">
          <div class="dev-row-main">
            <div class="dev-row-title">${esc(title)}${isMe ? ' <span class="dev-badge">shu qurilma</span>' : ''}</div>
            <div class="dev-row-sub">${esc(sub)}</div>
          </div>
          <div class="dev-row-actions">
            <button type="button" class="dev-more-btn" aria-label="Qo'shimcha" data-dev-more="${esc(row.device_id)}">
              <span class="dev-dots" aria-hidden="true">···</span>
            </button>
            <div class="dev-menu" data-dev-menu="${esc(row.device_id)}">
              <button type="button" class="dev-menu-item" data-dev-adv="${esc(row.device_id)}">Kengaytirilgan</button>
              ${isMe ? '' : `<button type="button" class="dev-menu-item dev-menu-danger" data-dev-revoke="${esc(row.device_id)}">Chiqarib yuborish</button>`}
            </div>
          </div>
          <div class="dev-advanced" data-dev-adv-panel="${esc(row.device_id)}" hidden>
            ${renderAdvanced(row)}
          </div>
        </div>`;
    }).join('');
  } catch (e) {
    list.innerHTML = `<div class="dev-loading">Xato: ${esc(e.message || 'yuklanmadi')}</div>`;
  }
}

function bindDevicesUi() {
  const root = $('settingsOverlay');
  if (!root || root.dataset.devicesBound) return;
  root.dataset.devicesBound = '1';

  root.addEventListener('click', async (e) => {
    const more = e.target.closest('[data-dev-more]');
    if (more && root.contains(more)) {
      e.stopPropagation();
      const id = more.getAttribute('data-dev-more');
      const menu = root.querySelector(`[data-dev-menu="${CSS.escape(id)}"]`);
      const open = menu?.classList.contains('show');
      closeDeviceMenus();
      if (!open && menu) {
        menu.classList.add('show');
        _menuOpenId = id;
      }
      return;
    }

    const adv = e.target.closest('[data-dev-adv]');
    if (adv && root.contains(adv)) {
      e.stopPropagation();
      const id = adv.getAttribute('data-dev-adv');
      closeDeviceMenus();
      const panel = root.querySelector(`[data-dev-adv-panel="${CSS.escape(id)}"]`);
      if (panel) panel.hidden = !panel.hidden;
      return;
    }

    const rev = e.target.closest('[data-dev-revoke]');
    if (rev && root.contains(rev)) {
      e.stopPropagation();
      const id = rev.getAttribute('data-dev-revoke');
      closeDeviceMenus();
      if (id === getDeviceId()) {
        toast('Joriy qurilmani bu yerdan chiqarib bo\'lmaydi', 'error');
        return;
      }
      showConfirm(
        'Bu qurilma SpaceMR dan chiqariladi. Agar u hozir ochiq bo\'lsa — darhol, aks holda keyingi kirishda login sahifasiga o\'tadi.',
        async () => {
          try {
            await revokeDevice(id);
            await broadcastSessionRevoked([id]);
            toast('Qurilma chiqarildi', 'success');
            await paintDevicesList();
          } catch (err) {
            toast('Xato: ' + (err.message || err), 'error');
          }
        },
        'Chiqarib yuborish'
      );
      return;
    }

    if (!e.target.closest('.dev-menu') && !e.target.closest('.dev-more-btn')) {
      closeDeviceMenus();
    }
  });

  const allBtn = $('revokeAllDevicesBtn');
  if (allBtn) {
    allBtn.onclick = () => {
      showConfirm(
        'Barcha boshqa qurilmalar SpaceMR dan chiqariladi. Joriy qurilma ochiq qoladi.',
        async () => {
          try {
            const res = await revokeAllOtherDevices();
            const ids = res?.device_ids || [];
            if (ids.length) await broadcastSessionRevoked(ids);
            toast(ids.length ? `${ids.length} ta qurilma chiqarildi` : 'Boshqa faol qurilma yo\'q', 'success');
            await paintDevicesList();
          } catch (err) {
            toast('Xato: ' + (err.message || err), 'error');
          }
        },
        'Barchasini chiqarish'
      );
    };
  }

  // Accordion ochilganda ro'yxatni yangilash
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('.pe-acc-toggle');
    if (!btn) return;
    const acc = btn.closest('.pe-accordion[data-pe-acc="devices"]');
    if (!acc) return;
    // open class toggle auth-settings da keyinroq — microtask
    setTimeout(() => {
      if (acc.classList.contains('open')) paintDevicesList();
    }, 0);
  });
}

export function initDeviceSessionsUi() {
  bindDevicesUi();
}

