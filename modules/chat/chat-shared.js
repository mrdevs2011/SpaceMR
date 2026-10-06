/**
 * chat-shared.js — DM (chat.js) va Groups (groups.js) uchun umumiy yordamchilar.
 *
 * Maqsad: ikki katta modul orasidagi bog'liqlikni kamaytirish.
 * Bu fayl DOM-agnostik yoki umumiy thread DOM (#chatThreadMessages) ga tayanadi.
 * DM-maxsus yoki guruh-maxsus biznes-logika bu yerga kiritilmaydi.
 */

import "./chat-pin.js";
import { sb, state, uploadViaController, mediaPublicUrl, SUPABASE_URL, SUPABASE_ANON_KEY, MEDIA_BUCKET, beginUpload, endUpload } from '../core/config.js';
import { $, esc, fmtSz, fmtTime } from '../core/utils.js';
import { toast } from '../ui/toast.js';
import { assertAllowedUpload } from '../core/upload-policy.js';
import { getChatFileIcon } from '../core/file-icons.js';

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

/* ── Qo'ng'iroq yozuvi (chatda saqlanadi): {"__callLog":true,"s":"ok"|"no","d":soniya}.
   Qo'ng'iroq qilgan odam yuboradi (sender = chaqiruvchi) — shuning uchun faqat u o'chira oladi. */
export function parseCallLog(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const t = raw.trim();
  if (!t.startsWith('{') || !t.includes('"__callLog"')) return null;
  try {
    const p = JSON.parse(t);
    if (p && (p.__callLog === true || p.__callLog === 'true')) return { ok: p.s === 'ok', d: Math.max(0, Math.round(+p.d || 0)) };
  } catch (_) {}
  return null;
}

export function fmtCallDur(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  if (sec < 60) return `${sec} soniya`;
  const m = Math.floor(sec / 60), s = sec % 60;
  return s ? `${m} daq ${s} soniya` : `${m} daq`;
}

/** mine = yozuvni men (chaqiruvchi) yuborganman. kind: 'out' | 'in' | 'miss' | 'cancel' */
export function callLogInfo(cl, mine) {
  if (mine) return cl.ok ? { kind: 'out', title: "Chiquvchi qo'ng'iroq" } : { kind: 'cancel', title: "Bekor qilingan qo'ng'iroq" };
  return cl.ok ? { kind: 'in', title: "Kiruvchi qo'ng'iroq" } : { kind: 'miss', title: "O'tkazib yuborilgan qo'ng'iroq" };
}

/* ── GIF xabar: {"__gif":true,"u":url,"w":kenglik,"h":balandlik}. Faqat Klipy hostidan. ── */
export function parseGif(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const t = raw.trim();
  if (!t.startsWith('{') || !t.includes('"__gif"')) return null;
  try {
    const p = JSON.parse(t);
    if (p && (p.__gif === true || p.__gif === 'true') && typeof p.u === 'string' && /^https:\/\/static\.klipy\.com\//.test(p.u)) {
      return { u: p.u, w: Math.max(0, +p.w | 0), h: Math.max(0, +p.h | 0) };
    }
  } catch (_) {}
  return null;
}

/** Chat prevyusi: hech qachon JSON/URL ko'rsatilmasin */
export function formatLastMessageText(raw, mine = false) {
  if (!raw) return '';
  if (parseGif(raw)) return 'GIF';
  const cl = parseCallLog(raw);
  if (cl) return callLogInfo(cl, mine).title;
  const ps = parsePostShare(raw);
  if (ps) {
    if (ps.comment && String(ps.comment).trim()) return String(ps.comment).trim();
    const name = ps.post?.authorName ? String(ps.post.authorName) : 'Yozuv';
    return `Yozuv: ${name}`;
  }
  const t = String(raw).trim();
  // JSON / ichki format — foydalanuvchiga ko'rsatilmasin
  if (t.startsWith('{') && (t.includes('"__gif"') || t.includes('"__postShare"') || t.includes('"__callLog"'))) {
    return 'Xabar';
  }
  // Yalang'och media URL
  if (/^https?:\/\/\S+\.(gif|webp|mp4|webm|mov)(\?\S*)?$/i.test(t)) return 'Media';
  if (/^https?:\/\/static\.klipy\.com\//i.test(t)) return 'GIF';
  return raw;
}

/** Reply / quote / list: type + text + fileName asosida odam o'qiydigan matn */
export function humanMsgPreview(m) {
  if (!m) return 'Xabar';
  if (m.type === 'voice') return 'Ovozli xabar';
  if (m.type === 'file') {
    const fn = m.fileName || m.file_name || '';
    const mime = (m.mediaType || m.mime || m.media_type || '').toLowerCase();
    if (/^vnote_/i.test(fn)) return 'Dumaloq video';
    if (mime.startsWith('video/') || /\.(mp4|webm|mov|mkv)(\?|$)/i.test(fn)) return 'Video';
    if (mime === 'image/gif' || /\.(gif)(\?|$)/i.test(fn)) return 'GIF';
    if (mime.startsWith('image/') || /\.(jpe?g|png|webp|heic|avif)(\?|$)/i.test(fn)) return 'Rasm';
    if (mime.startsWith('audio/')) return 'Audio';
    return (m.fileName || fn || 'Fayl');
  }
  const raw = m.text || '';
  const nice = formatLastMessageText(raw, false);
  if (nice && nice !== raw) return nice;
  const t = String(raw).replace(/\s+/g, ' ').trim();
  if (!t) return 'Xabar';
  if (t.startsWith('{') && t.includes('"__')) return 'Xabar';
  return t.slice(0, 140);
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

  beginUpload();
  return new Promise((resolve, reject) => {
    const done = (fn) => (v) => { endUpload(); fn(v); };
    const xhr = new XMLHttpRequest();
    xhr.open('POST', uploadUrl);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('apikey', SUPABASE_ANON_KEY);
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');

    xhr.upload.onprogress = e => {
      if (e.lengthComputable && onProgress) onProgress((e.loaded / e.total) * 100);
    };
    const fallback = () => uploadViaController(file, folder, { track: false })
      .then(res => { if (onProgress) onProgress(100); done(resolve)(res); })
      .catch(done(reject));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        if (onProgress) onProgress(100);
        done(resolve)({ path, url: mediaPublicUrl(path) });
      } else fallback();
    };
    xhr.onerror = fallback;
    xhr.send(file);
  });
}

export const _uuid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2));


/**
 * Chat/guruh oynasi (#chatThreadModal) faqat Chatlar sahifasi ichida to'g'ri joylashadi
 * (CSS: body:has(#chatsView.on)). Boshqa sahifadan (bildirishnoma, o'ng panel, profil)
 * ochilsa u butun ekranni egallab olardi — shuning uchun avval Chatlar sahifasiga o'tamiz.
 */
export async function ensureChatsView() {
  if (state.view !== 'chats') {
    const { navigateTo } = await import('../router.js');
    navigateTo('chats', false);
  }
  const v = document.getElementById('chatsView');
  for (let i = 0; i < 20 && v && !v.classList.contains('on'); i++) {
    await new Promise(r => requestAnimationFrame(r));
  }
}
