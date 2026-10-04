/* admin-storage.js — 7.2: admin uchun Storage sarfi ko'rsatkichi (bitta qator + chiziq).
   Supabase Free rejasi: 1 GB (roadmap Q10 — oshsa Pro'ga o'tish).
   RPC `admin_storage_usage()` — supabase/unfulfilled/015 patch. Yo'q bo'lsa jim: faqat kichik izoh. */
import { sb } from '../core/config.js';

const LIMIT_BYTES = 1024 * 1024 * 1024;
const WARN_AT = 0.8;

const _fmt = b => b >= 1073741824 ? (b / 1073741824).toFixed(2) + ' GB'
  : b >= 1048576 ? (b / 1048576).toFixed(0) + ' MB' : Math.round(b / 1024) + ' KB';

export async function renderStorageUsage(anchor) {
  if (!anchor || document.getElementById('actionsStorageInfo')) return;
  const box = document.createElement('div');
  box.id = 'actionsStorageInfo';
  box.style.cssText = 'margin:14px 18px;font-size:12.5px;color:var(--text3,#71767b);';
  anchor.insertAdjacentElement('afterend', box);
  try {
    const { data, error } = await sb.rpc('admin_storage_usage');
    if (error) throw error;
    const used = Number(data) || 0;
    const pct = Math.min(100, Math.round(used / LIMIT_BYTES * 100));
    const warn = used / LIMIT_BYTES >= WARN_AT;
    box.innerHTML =
      `<div>Storage: <b>${_fmt(used)}</b> / ${_fmt(LIMIT_BYTES)} (${pct}%)` +
      (warn ? ' — <span style="color:var(--red,#f4212e)">to\'lib qoldi, Pro\'ga o\'tishni o\'ylang</span>' : '') + '</div>' +
      `<div style="height:4px;border-radius:4px;margin-top:6px;background:var(--line,rgba(113, 118, 123, 0.2));overflow:hidden">` +
      `<div style="height:100%;width:${pct}%;background:${warn ? 'var(--red,#f4212e)' : 'var(--text3,#71767b)'}"></div></div>`;
  } catch (_) {
    box.textContent = 'Storage sarfi hisoblanmadi (DB patch 015 ishga tushirilmagan).';
  }
}

export function removeStorageUsage() {
  const el = document.getElementById('actionsStorageInfo');
  if (el) el.remove();
}
