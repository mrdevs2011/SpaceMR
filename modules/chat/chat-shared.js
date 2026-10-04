/**
 * chat-shared.js — DM (chat.js) va Groups (groups.js) uchun umumiy yordamchilar.
 *
 * Maqsad: ikki katta modul orasidagi bog'liqlikni kamaytirish.
 * Bu fayl DOM-agnostik yoki umumiy thread DOM (#chatThreadMessages) ga tayanadi.
 * DM-maxsus yoki guruh-maxsus biznes-logika bu yerga kiritilmaydi.
 */

import { sb, state, uploadViaController, mediaPublicUrl, SUPABASE_URL, SUPABASE_ANON_KEY, MEDIA_BUCKET } from '../core/config.js';
import { $, esc, fmtSz, fmtTime } from '../core/utils.js';
import { toast } from '../ui/toast.js';
import { assertAllowedUpload } from '../core/upload-policy.js';

/* ── Sana yordamchilari (Telegram uslubidagi separatorlar) ─────────────── */

export function _toDateSafe(ts) {
  if (!ts) return null;
  return new Date(ts);
}

export function _isSameDay(a, b) {
  if (!a || !b) return false;
  return a.getFullYear() === b.getFullYear() &&
         a.getMonth()    === b.getMonth()    &&
         a.getDate()     === b.getDate();
}

const _UZ_MONTHS = ['yanvar','fevral','mart','aprel','may','iyun','iyul','avgust','sentabr','oktabr','noyabr','dekabr'];

export function _dateSepLabel(ts) {
  const d = _toDateSafe(ts);
  if (!d) return '';
  const now = new Date();
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (_isSameDay(d, now)) return 'Bugun';
  if (_isSameDay(d, yesterday)) return 'Kecha';
  const sameYear = d.getFullYear() === now.getFullYear();
  return sameYear
    ? `${d.getDate()}-${_UZ_MONTHS[d.getMonth()]}`
    : `${d.getDate()}-${_UZ_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/* ── Post ulashish (chat ichida post kartochkasi) ──────────────────────── */

export function parsePostShare(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && (parsed.__postShare === true || parsed.__postShare === 'true')) {
      return parsed;
    }
  } catch (_) {}
  return null;
}

export function formatLastMessageText(raw) {
  if (!raw) return '';
  const ps = parsePostShare(raw);
  if (ps) {
    if (ps.comment && ps.comment.trim()) {
      return `📌 ${ps.comment.trim()}`;
    }
    const name = ps.post?.authorName ? `${ps.post.authorName}` : 'Post';
    return `📌 Post: ${name}`;
  }
  return raw;
}

/* ── Pending upload bubble (umumiy thread DOM) ─────────────────────────── */

export { getChatFileIcon, getFileIcon } from '../core/file-icons.js';

export function _showPendingBubble(id, type, size, name = '', mime = '') {
  const box = $('chatThreadMessages');
  if (!box) return;
  const szTxt = size ? fmtSz(size) : '';
  const isVoice = type === 'voice';
  const inner = isVoice
    ? `<div class="cpb-voice">
        <div class="cpb-mic-icon">
          <img src="./svg/extra/icon-527cb9523916.svg" alt="" class="icon" width="16" height="16">
        </div>
        <div class="cpb-info">
          <div class="cpb-label">Ovoz yuborilmoqda...</div>
          ${szTxt ? `<div class="cpb-size">${szTxt}</div>` : ''}
        </div>
      </div>`
    : `<div class="cpb-file">
        <div class="cpb-file-icon">${getChatFileIcon(name, mime)}</div>
        <div class="cpb-info">
          <div class="cpb-label">${esc(name || 'Fayl')}</div>
          ${szTxt ? `<div class="cpb-size">${szTxt}</div>` : ''}
        </div>
      </div>`;

  const el = document.createElement('div');
  el.className = 'chat-msg mine cpb-wrap';
  el.id = id;
  el.innerHTML = `<div class="chat-bubble cpb-bubble">
    <div class="chat-bubble-wrap">
      ${inner}
      <div class="cpb-progress-bar"><div class="cpb-progress-fill" id="${id}_fill"></div></div>
      <div class="cpb-pct" id="${id}_pct">0%</div>
    </div>
  </div>`;
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
}

export function _updatePendingProgress(id, pct) {
  const fill = document.getElementById(id + '_fill');
  const lbl  = document.getElementById(id + '_pct');
  if (fill) fill.style.width = pct + '%';
  if (lbl)  lbl.textContent  = Math.round(pct) + '%';
}

export function _removePendingBubble(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

/* ── XHR upload with progress ─────────────────────────────────────────── */

export async function uploadViaControllerProgress(file, folder, onProgress) {
  const { data: { session } } = await sb.auth.getSession();
  const token = session?.access_token;
  if (!token || !state.me) throw new Error('Tizimga kirilmagan');
  assertAllowedUpload(file, folder); // video taqiq; story/avatar faqat rasm

  const safeName = file.name.replace(/[^\w.\-]/g, '_').replace(/_+/g, '_');
  const path = `${state.me.uid}/${folder}/${Date.now()}_${(crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2))}_${safeName}`;
  const uploadUrl = `${SUPABASE_URL}/storage/v1/object/${MEDIA_BUCKET}/${path}`;

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', uploadUrl);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('apikey', SUPABASE_ANON_KEY);
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');

    xhr.upload.onprogress = e => {
      if (e.lengthComputable && onProgress) onProgress((e.loaded / e.total) * 100);
    };
    const fallback = () => uploadViaController(file, folder)
      .then(res => { if (onProgress) onProgress(100); resolve(res); })
      .catch(reject);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        if (onProgress) onProgress(100);
        resolve({ path, url: mediaPublicUrl(path) });
      } else fallback();
    };
    xhr.onerror = fallback;
    xhr.send(file);
  });
}

export const _uuid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2));
