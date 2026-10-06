/* admin-storage.js — 7.2: admin uchun Storage sarfi (bitta qator + chiziq).
   Supabase Free: 1 GB. RPC admin_storage_usage() — migrations/015.
   Har chaqiruvda yangilanadi; admin panel ochiq bo'lsa 15s da bir qayta o'qiydi. */
import { sb } from '../core/config.js';

const LIMIT_BYTES = 1024 * 1024 * 1024;
const WARN_AT = 0.8;
let _poll = null;

const _fmt = b => b >= 1073741824 ? (b / 1073741824).toFixed(2) + ' GB'
  : b >= 1048576 ? (b / 1048576).toFixed(0) + ' MB' : Math.round(b / 1024) + ' KB';

function _paint(box, used) {
  const pct = Math.min(100, Math.round(used / LIMIT_BYTES * 100));
  const warn = used / LIMIT_BYTES >= WARN_AT;
  box.innerHTML =
    `<div>Storage: <b>${_fmt(used)}</b> / ${_fmt(LIMIT_BYTES)} (${pct}%)` +
    (warn ? ' — <span style="color:var(--red,#f4212e)">to\'lib qoldi, Pro\'ga o\'tishni o\'ylang</span>' : '') + '</div>' +
    `<div style="height:4px;border-radius: 28px;margin-top:6px;background:var(--line,rgba(113, 118, 123, 0.2));overflow:hidden">` +
    `<div style="height:100%;width:${pct}%;background:${warn ? 'var(--red,#f4212e)' : 'var(--text3,#71767b)'}"></div></div>`;
}

export async function refreshStorageUsage() {
  const box = document.getElementById('actionsStorageInfo');
  if (!box) return;
  try {
    const { data, error } = await sb.rpc('admin_storage_usage');
    if (error) throw error;
    _paint(box, Number(data) || 0);
  } catch (_) {
    box.textContent = "Storage sarfi hisoblanmadi (DB patch 015 ishga tushirilmagan).";
  }
}

export async function renderStorageUsage(anchor) {
  if (!anchor) return;
  let box = document.getElementById('actionsStorageInfo');
  if (!box) {
    box = document.createElement('div');
    box.id = 'actionsStorageInfo';
    box.className = 'adm-storage';
    // Ichida: overflow clip bo'lmasin, layout tartibli
    if (anchor.id === 'admSystemMount') anchor.appendChild(box);
    else anchor.insertAdjacentElement('afterend', box);
  }
  box.textContent = 'Storage hisoblanmoqda…';
  await refreshStorageUsage();
  // Realtime hisobi yo'q (storage.objects realtime emas) — panel ochiq paytda polling
  if (_poll) clearInterval(_poll);
  _poll = setInterval(() => {
    if (!document.getElementById('actionsStorageInfo')) {
      clearInterval(_poll); _poll = null; return;
    }
    refreshStorageUsage();
  }, 5000);
}

export function removeStorageUsage() {
  if (_poll) { clearInterval(_poll); _poll = null; }
  document.getElementById('actionsStorageInfo')?.remove();
}
