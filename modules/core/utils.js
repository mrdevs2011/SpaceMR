// test 4: diff uchun izoh
import { state, sb }  from './config.js';
import { toast }  from '../ui/toast.js';
import { protectSecrets } from './secrets.js';

/* ── DOM / formatting helpers ─────────────────────────────────────────── */
export const $    = id => document.getElementById(id);
export const esc  = s  => s ? String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;') : '';

/* ── Spoiler vault: maxfiy matn DOM/HTML da EMAS — faqat xotirada.
   Kenglik character soniga mos (--spoiler-ch). Ochilganda vault dan ~0ms. */
const _spoilerVault = new Map();
let _spoilerSeq = 0;

export function spoilerVaultGet(id) {
  return _spoilerVault.get(String(id)) ?? null;
}

export function spoilerVaultHas(id) {
  return _spoilerVault.has(String(id));
}

/* SPOILER_DEPLOY t-1792259696568 */
/** Approximate display width in "ch" units (emoji/CJK wider). */
function spoilerChCount(text) {
  let n = 0;
  for (const ch of String(text || '')) {
    if (ch === '\n' || ch === '\r' || ch === '\t') continue;
    const cp = ch.codePointAt(0);
    if (cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f)) continue;
    if (cp > 0xffff || (cp >= 0x1f300 && cp <= 0x1faff) || (cp >= 0x2600 && cp <= 0x27bf)) n += 2;
    else if (cp >= 0x1100 && cp <= 0xd7af) n += 2;
    else if (cp >= 0x2e80 && cp <= 0x9fff) n += 2;
    else n += 1;
  }
  return Math.max(2, n);
}

/** Per-line metrics for multi-line spoilers (matches real text shape). */
function spoilerLineMetrics(text) {
  const raw = String(text || '');
  let parts = raw.length ? raw.split(/\r?\n/) : [''];
  while (parts.length > 1 && !String(parts[0]).trim()) parts.shift();
  while (parts.length > 1 && !String(parts[parts.length - 1]).trim()) parts.pop();
  if (!parts.length) parts = [''];
  return parts.map(line => ({
    ch: Math.max(3, spoilerChCount(line.length ? line : '...')),
    line: line
  }));
}

function measureSpoilerPx(text, fontSourceEl) {
  const t = String(text || '').replace(/[\r\n\t]+/g, ' ');
  if (!t) return 0;
  try {
    const cs = getComputedStyle(fontSourceEl || document.body);
    const canvas = measureSpoilerPx._c || (measureSpoilerPx._c = document.createElement('canvas'));
    const ctx = canvas.getContext('2d');
    if (!ctx) return 0;
    const size = cs.fontSize || '15px';
    const family = cs.fontFamily || 'sans-serif';
    const weight = cs.fontWeight || '400';
    const style = cs.fontStyle || 'normal';
    ctx.font = style + ' ' + weight + ' ' + size + ' ' + family;
    const w = ctx.measureText(t).width;
    let ls = 0;
    try {
      const raw = cs.letterSpacing;
      if (raw && raw !== 'normal') ls = parseFloat(raw) || 0;
    } catch (_) {}
    if (ls) return Math.ceil(w + ls * Math.max(0, t.length - 1));
    return Math.ceil(w);
  } catch (_) {
    return 0;
  }
}

function spoilerLineBarsHtml(metrics) {
  return metrics.map(m => {
    const ch = Math.max(3, m.ch || 3);
    return '<span class="md-spoiler-line" style="--spoiler-ch:' + ch +
      ';width:min(100%,' + ch + 'ch);min-width:3ch" aria-hidden="true"></span>';
  }).join('');
}

function spoilerPlaceholder(rawInner, meta) {
  meta = meta || {};
  const text = String(rawInner ?? '');
  let metrics;
  if (text) {
    metrics = spoilerLineMetrics(text);
  } else if (meta.lineCh && meta.lineCh.length) {
    metrics = meta.lineCh.map(ch => ({ ch: Math.max(2, Number(ch) || 2), line: '' }));
  } else {
    metrics = [{ ch: Math.max(2, meta.ch != null ? Number(meta.ch) : 4), line: '' }];
  }
  const totalCh = metrics.reduce((s, m) => s + m.ch, 0);
  const ch = Math.max(2, meta.ch != null ? Number(meta.ch) : totalCh);
  const multi = metrics.length > 1;
  const bars = multi ? spoilerLineBarsHtml(metrics) : '';
  const cls = 'md-spoiler' + (bars ? ' md-spoiler-block' : '');
  const style = bars
    ? '--spoiler-ch:' + ch
    : '--spoiler-ch:' + ch + ';min-width:min(100%,' + ch + 'ch);width:min(100%,' + ch + 'ch)';

  if (meta.msgId != null && meta.ord != null) {
    return '<span class="' + cls + '" data-scope="' + (meta.scope || 'dm') +
      '" data-msg="' + String(meta.msgId).replace(/"/g, '') +
      '" data-ord="' + String(meta.ord) +
      '" data-ch="' + ch +
      '" data-lines="' + metrics.length +
      '" style="' + style +
      '" role="button" tabindex="0" aria-label="Spoiler">' + bars + '</span>';
  }
  const id = 'sp' + (++_spoilerSeq);
  _spoilerVault.set(id, text);
  return '<span class="' + cls + '" data-sid="' + id + '" data-ch="' + ch +
    '" data-lines="' + metrics.length +
    '" style="' + style +
    '" role="button" tabindex="0" aria-label="Spoiler">' + bars + '</span>';
}

/** Har qanday konteynerdagi blur bar kengligini aniq qil (post, chat, izoh, ...). */
export function layoutSpoilers(root) {
  const scope = root && root.querySelectorAll ? root : document;
  scope.querySelectorAll('.md-spoiler:not(.revealed)').forEach(el => {
    const id = el.getAttribute('data-sid');
    const text = id ? _spoilerVault.get(id) : null;
    const lines = el.querySelectorAll('.md-spoiler-line');

    if (text != null && text.length && lines.length) {
      const metrics = spoilerLineMetrics(text);
      // Rebuild bars if line count mismatch
      if (metrics.length !== lines.length) {
        el.innerHTML = spoilerLineBarsHtml(metrics);
        el.classList.add('md-spoiler-block');
        el.setAttribute('data-lines', String(metrics.length));
      }
      const bars = el.querySelectorAll('.md-spoiler-line');
      metrics.forEach((m, i) => {
        const bar = bars[i];
        if (!bar) return;
        const px = measureSpoilerPx(m.line.length ? m.line : ' ', el.parentElement || el);
        const ch = Math.max(2, m.ch);
        if (px > 0) {
          bar.style.width = 'min(100%, ' + px + 'px)';
          bar.style.minWidth = Math.min(px, 24) + 'px';
        } else {
          bar.style.width = 'min(100%, ' + ch + 'ch)';
        }
        bar.style.setProperty('--spoiler-ch', String(ch));
      });
      el.setAttribute('data-ch', String(metrics.reduce((s, m) => s + m.ch, 0)));
      return;
    }

    if (text != null && text.length && !lines.length) {
      // single-line bar (or upgrade to multi)
      const metrics = spoilerLineMetrics(text);
      if (metrics.length > 1) {
        el.innerHTML = spoilerLineBarsHtml(metrics);
        el.classList.add('md-spoiler-block');
        el.style.width = 'auto';
        el.style.height = 'auto';
        el.setAttribute('data-lines', String(metrics.length));
        layoutSpoilers(el.parentElement || el);
        return;
      }
      const px = measureSpoilerPx(text, el.parentElement || el);
      const ch = Math.max(2, spoilerChCount(text));
      if (px > 0) {
        el.style.width = 'min(100%, ' + px + 'px)';
        el.style.minWidth = Math.min(px, 48) + 'px';
      } else {
        el.style.width = 'min(100%, ' + ch + 'ch)';
      }
      el.style.setProperty('--spoiler-ch', String(ch));
      el.setAttribute('data-ch', String(ch));
      return;
    }

    // marker-only: single bar from data-ch
    let ch = parseInt(el.getAttribute('data-ch') || '0', 10);
    ch = Math.max(2, ch || 4);
    el.style.setProperty('--spoiler-ch', String(ch));
    if (!lines.length) {
      el.style.width = 'min(100%, ' + ch + 'ch)';
      el.style.minWidth = Math.min(ch, 8) + 'ch';
    }
    el.setAttribute('data-ch', String(ch));
  });
}

async function revealSpoilerEl(el) {
  if (!el || el.classList.contains('revealed')) return false;
  const id = el.getAttribute('data-sid');
  if (id) {
    const text = _spoilerVault.get(id);
    if (text == null) return false;
    el.classList.remove('md-spoiler-block');
    el.textContent = text;
    el.classList.add('revealed');
    el.style.removeProperty('--spoiler-ch');
    el.style.removeProperty('width');
    el.style.removeProperty('min-width');
    el.style.removeProperty('height');
    return true;
  }
  const msg = el.getAttribute('data-msg');
  const ord = el.getAttribute('data-ord');
  const scope = el.getAttribute('data-scope') || 'dm';
  if (!msg || ord == null) return false;
  el.classList.add('md-spoiler-loading');
  try {
    const { data, error } = await sb.rpc('reveal_spoiler', {
      p_scope: scope,
      p_message_id: msg,
      p_ordinal: parseInt(ord, 10)
    });
    if (error || data == null) {
      el.classList.remove('md-spoiler-loading');
      return false;
    }
    el.textContent = String(data);
    el.classList.add('revealed');
    el.classList.remove('md-spoiler-loading');
    el.style.removeProperty('--spoiler-ch');
    el.style.removeProperty('width');
    el.style.removeProperty('min-width');
    const vid = 'rpc:' + scope + ':' + msg + ':' + ord;
    _spoilerVault.set(vid, String(data));
    el.setAttribute('data-sid', vid);
    return true;
  } catch (_) {
    el.classList.remove('md-spoiler-loading');
    return false;
  }
}

function hideSpoilerEl(el) {
  if (!el || !el.classList.contains('revealed')) return;
  const id = el.getAttribute('data-sid');
  const text = id ? _spoilerVault.get(id) : null;
  el.textContent = '';
  el.classList.remove('revealed');
  if (text != null && text.length) {
    const metrics = spoilerLineMetrics(text);
    if (metrics.length > 1) {
      el.innerHTML = spoilerLineBarsHtml(metrics);
      el.classList.add('md-spoiler-block');
      el.style.width = 'auto';
      el.style.height = 'auto';
      el.setAttribute('data-lines', String(metrics.length));
    } else {
      const ch = Math.max(2, metrics[0]?.ch || 4);
      el.classList.remove('md-spoiler-block');
      el.style.setProperty('--spoiler-ch', String(ch));
      el.style.width = 'min(100%, ' + ch + 'ch)';
      el.setAttribute('data-ch', String(ch));
    }
  } else {
    const ch = parseInt(el.getAttribute('data-ch') || '4', 10) || 4;
    el.style.setProperty('--spoiler-ch', String(ch));
    el.style.width = 'min(100%, ' + ch + 'ch)';
  }
  requestAnimationFrame(() => layoutSpoilers(el.parentElement || document));
}

let _spoilerUiBound = false;
export function bindSpoilerUI() {
  if (_spoilerUiBound) return;
  if (typeof document === 'undefined') return; // Node / SSR
  _spoilerUiBound = true;
  let _lastSpoilerAct = 0;
  const act = (el) => {
    if (!el || !el.classList.contains('md-spoiler')) return;
    const now = Date.now();
    if (now - _lastSpoilerAct < 350) return; // click+pointerup double-fire
    _lastSpoilerAct = now;
    if (el.classList.contains('revealed')) hideSpoilerEl(el);
    else revealSpoilerEl(el);
  };
  const onPointer = (e) => {
    const el = e.target?.closest?.('.md-spoiler');
    if (!el) return;
    // only primary button / primary touch
    if (e.type === 'click' && e.button != null && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    act(el);
  };
  document.addEventListener('click', onPointer, true);
  document.addEventListener('pointerup', (e) => {
    // iOS/Android: some feeds swallow click; pointerup is reliable
    if (e.pointerType === 'mouse') return; // mouse uses click
    const el = e.target?.closest?.('.md-spoiler');
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    act(el);
  }, true);
  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const el = e.target.closest?.('.md-spoiler');
    if (!el) return;
    e.preventDefault();
    act(el);
  }, true);
  // Yangi .md-spoiler qo'shilganda kenglikni aniqla (debounce, faqat spoiler node)
  try {
    let _layoutSched = false;
    const scheduleLayout = () => {
      if (_layoutSched) return;
      _layoutSched = true;
      requestAnimationFrame(() => {
        _layoutSched = false;
        try { layoutSpoilers(document); } catch (_) {}
      });
    };
    const hasSpoiler = (node) => {
      if (!node || node.nodeType !== 1) return false;
      if (node.classList && node.classList.contains('md-spoiler')) return true;
      return !!(node.querySelector && node.querySelector('.md-spoiler'));
    };
    const mo = new MutationObserver(muts => {
      for (const m of muts) {
        if (!m.addedNodes) continue;
        for (const n of m.addedNodes) {
          if (hasSpoiler(n)) { scheduleLayout(); return; }
        }
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  } catch (_) {}
  if (document.readyState !== 'loading') requestAnimationFrame(() => layoutSpoilers(document));
  else document.addEventListener('DOMContentLoaded', () => layoutSpoilers(document));
}


/**
 * Foydalanuvchi yozgan oddiy Markdown belgilarini xavfsiz
 * HTML'ga aylantiradi: **qalin**, *egik*, ~~chizilgan~~, `kod`, ```kod bloki```,
 * # ## ### sarlavhalar, - / * ro'yxat elementlari (ichma-ich/indent bilan ham),
 * 1. raqamlangan ro'yxat, > iqtibos, [matn](url) havolalar. Butun SpaceMR
 * bo'ylab ishlatiladi (shaxsiy/guruh chatlar, post tavsiflari, izohlar) —
 * HAR QANDAY foydalanuvchi shu belgilardan foydalansa
 * chiroyli ko'rinadi.
 *
 * XAVFSIZLIK: eng avval esc() orqali butun matn HTML-escape qilinadi (< > &
 * xavfli belgilar zararsizlantiriladi), FAQAT shundan keyin Markdown
 * belgilari (*, #, `, -, >, []()) HTML teglariga aylantiriladi — shuning
 * uchun foydalanuvchi hech qachon o'zboshimcha HTML/skript kiritib ulgira
 * olmaydi. Havolalarda ham faqat http(s)/mailto sxemalariga ruxsat
 * beriladi (masalan "javascript:" kabi xavfli sxemalar rad etiladi).
 */
export function renderMarkdown(rawText, opts) {
  if (!rawText) return '';
  bindSpoilerUI();
  opts = opts || {};
  const msgId = opts.messageId || opts.msgId || null;
  const scope = opts.scope || 'dm';
  const _spHold = [];
  // Display-time shield: DB dagi eski ochiq kalitlar ham ||spoiler|| ga aylanadi (DOM ga tushmasdan vault)
  let s = protectSecrets(String(rawText)).replace(/\|\|@(\d+):([\d,]+)\|\|/g, (_m, ord, lenSpec) => {
    const idx = _spHold.push(spoilerPlaceholder('', {
      msgId: msgId, ord: parseInt(ord, 10), ch: (String(lenSpec).split(',').reduce((a,b)=>a+(parseInt(b,10)||0),0)), lineCh: String(lenSpec).split(',').map(x=>parseInt(x,10)||2), scope: scope
    })) - 1;
    return '\u0000SP' + idx + '\u0000';
  });
  s = s.replace(/\|\|([\s\S]*?)\|\|/g, (_m, inner) => {
    if (inner.charAt(0) === '@') return _m;
    const idx = _spHold.push(spoilerPlaceholder(inner)) - 1;
    return '\u0000SP' + idx + '\u0000';
  });
  s = esc(s);
  s = s.replace(/\u0000SP(\d+)\u0000/g, (_m, i) => _spHold[parseInt(i, 10)] || '');
  const codeBlocks = [];
  s = s.replace(/```([a-z0-9]*)\n([\s\S]*?)```/gi, (_m, lang, code) => {
    const safeCode = code.trim();
    const idx = codeBlocks.push(
      '<div class="md-code-wrapper">' +
        '<div class="md-code-header">' +
          '<span class="md-code-lang">' + (lang || 'code') + '</span>' +
          '<button class="md-code-copy" onclick="navigator.clipboard.writeText(this.parentElement.nextElementSibling.innerText); const t=this.innerText; this.innerText=\'Nusxa olindi!\'; setTimeout(()=>this.innerText=t,2000)">Nusxa olish</button>' +
        '</div>' +
        '<pre class="md-codeblock"><code class="language-' + (lang || 'none') + '">' + safeCode + '</code></pre>' +
      '</div>'
    ) - 1;
    return '\u0000CB' + idx + '\u0000';
  });

  const inlineCodes = [];
  s = s.replace(/`([^`\n]+)`/g, (_m, code) => {
    const idx = inlineCodes.push('<code class="md-code">' + code + '</code>') - 1;
    return '\u0000IC' + idx + '\u0000';
  });

  /* spoilers already vaulted above */

  s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+?)(?:\s+"[^"]*")?\)/g,
    '<a href="$2" class="md-link" target="_blank" rel="noopener noreferrer">$1</a>');

  const htmlTags = [];
  s = s.replace(/<[^>]+>/g, m => {
    const idx = htmlTags.push(m) - 1;
    return '\u0000TG' + idx + '\u0000';
  });

  // \u0000 (placeholder) va qo'shtirnoqlarda to'xtaydi — aks holda tayyor <a> tegi href ichiga tushib, atribut in'ektsiyasi bo'ladi
  s = s.replace(/(https?:\/\/[^\s<\u0000"']+)/g, '<a href="$1" class="md-link" target="_blank" rel="noopener noreferrer">$1</a>');

  s = s.replace(/\u0000TG(\d+)\u0000/g, (_m, idx) => htmlTags[parseInt(idx, 10)]);

  const htmlTags2 = [];
  s = s.replace(/<[^>]+>/g, m => {
    const idx = htmlTags2.push(m) - 1;
    return '\u0000TH' + idx + '\u0000';
  });

  s = s.replace(/(^|\s)@([a-zA-Z0-9_.]+)(?=\s|[.,!?]|$)/g, '$1<span class="md-mention" onclick="window.dispatchEvent(new CustomEvent(\'open-mention\', {detail: \'$2\'}))">@$2</span>');

  s = s.replace(/\u0000TH(\d+)\u0000/g, (_m, idx) => htmlTags2[parseInt(idx, 10)]);

  s = s.replace(/^[ \t]*###\s+(.+)$/gm, '<div class="md-h3">$1</div>');
  s = s.replace(/^[ \t]*##\s+(.+)$/gm,  '<div class="md-h2">$1</div>');
  s = s.replace(/^[ \t]*#\s+(.+)$/gm,   '<div class="md-h1">$1</div>');

  s = s.replace(/^[ \t]*&gt;\s?(.+)$/gm, '<div class="md-quote">$1</div>');

  s = s.replace(/^([ \t]*)(\d+)\.\s+(.+)$/gm, (_m, indent, num, txt) => {
    const depth = Math.floor(indent.replace(/\t/g, '  ').length / 2);
    return '<div class="md-li md-li-ol" style="padding-left:' + (2 + depth * 16) + 'px">' + num + '. ' + txt + '</div>';
  });
  s = s.replace(/^([ \t]*)[-*]\s+\[([ xX])\]\s+(.+)$/gm, (_m, indent, checked, txt) => {
    const depth = Math.floor(indent.replace(/\t/g, '  ').length / 2);
    const isChecked = checked.toLowerCase() === 'x';
    return '<div class="md-li md-task-list" style="padding-left:' + (2 + depth * 16) + 'px">' +
      '<input type="checkbox" disabled ' + (isChecked ? 'checked' : '') + ' class="md-task-checkbox"> ' + txt + '</div>';
  });
  s = s.replace(/^([ \t]*)[-*]\s+(.+)$/gm, (_m, indent, txt) => {
    const depth = Math.floor(indent.replace(/\t/g, '  ').length / 2);
    return '<div class="md-li" style="padding-left:' + (2 + depth * 16) + 'px">• ' + txt + '</div>';
  });

  const tables = [];
  s = s.replace(/(?:^[ \t]*\|.*\|[ \t]*\n)+^[ \t]*\|.*\|[ \t]*/gm, (match) => {
    let rows = match.trim().split('\n');
    let html = '<div class="md-table-wrap"><table class="md-table">';
    rows.forEach((row, i) => {
      if (row.match(/^\|?[ \t:-]+\|[ \t:\-|]+$/)) return;
      const tag = (i === 0 && rows.length > 1 && rows[1].match(/^\|?[ \t:-]+\|[ \t:\-|]+$/)) ? 'th' : 'td';
      let cols = row.trim().replace(/^\||\|$/g, '').split('|');
      html += '<tr>' + cols.map(c => '<' + tag + '>' + c.trim() + '</' + tag + '>').join('') + '</tr>';
    });
    html += '</table></div>';
    const idx = tables.push(html) - 1;
    return '\u0000TB' + idx + '\u0000';
  });

  s = s.replace(/~~([^~\n]+)~~/g, '<del class="md-del">$1</del>');
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  s = s.replace(/(^|[^\w])_([^_\n]+)_(?!\w)/g, '$1<em>$2</em>');

  s = s.replace(/\n/g, '<br>');

  s = s.replace(/\u0000TB(\d+)\u0000/g, (_m, idx) => tables[parseInt(idx, 10)]);
  s = s.replace(/\u0000IC(\d+)\u0000/g, (_m, idx) => inlineCodes[parseInt(idx, 10)]);
  s = s.replace(/\u0000CB(\d+)\u0000/g, (_m, idx) => codeBlocks[parseInt(idx, 10)]);

  // Kenglikni keyingi frame da aniq o'lchaymiz (post/chat/izoh)
  try { requestAnimationFrame(() => layoutSpoilers(document)); } catch (_) {}
  return s;
}


/* X uslubidagi qisqa vaqt: "hozir", "5 daq", "3 soat", "4-okt", "4-okt, 2025" */
const UZ_MON = ['yan', 'fev', 'mar', 'apr', 'may', 'iyn', 'iyl', 'avg', 'sen', 'okt', 'noy', 'dek'];
export const fmt  = ts => {
  if (!ts) return '';
  const d = new Date(ts);
  const t = d.getTime();
  if (Number.isNaN(t)) return '';
  const sec = Math.max(0, (Date.now() - t) / 1000);
  if (sec < 60) return 'hozir';
  if (sec < 3600) return Math.floor(sec / 60) + ' daq';
  if (sec < 86400) return Math.floor(sec / 3600) + ' soat';
  const day = `${d.getDate()}-${UZ_MON[d.getMonth()]}`;
  return d.getFullYear() === new Date().getFullYear() ? day : `${day}, ${d.getFullYear()}`;
};

/* Faqat soat:minut (chat xabarlari ostidagi vaqt uchun, masalan "11:55") */
export const fmtTime = ts => {
  if (!ts) return '';
  const d = new Date(ts);
  return new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
};

export const fmtSz  = b  => b > 1048576 ? (b/1048576).toFixed(1)+' MB' : (b/1024).toFixed(0)+' KB';

/* ── Onlayn holat / oxirgi faollik ────────────────────────────────────
 * Presence uchun alohida "online" maydon ishlatilmaydi — buning o'rniga
 * `lastSeenAt` (heartbeat orqali har ~25s da yangilanadi) asos qilib
 * olinadi. Agar oxirgi yangilanishdan beri ONLINE_THRESHOLD_MS dan kam
 * vaqt o'tgan bo'lsa — foydalanuvchi "onlayn" hisoblanadi.
 */
export const ONLINE_THRESHOLD_MS = 60 * 1000; // faqat shina (presence) uzilganda zaxira: heartbeat 25s, 2 ta o'tkazib yuborishga bufer

export function isOnline(lastSeenAt) {
  if (!lastSeenAt) return false;
  const d = new Date(lastSeenAt);
  return (Date.now() - d.getTime()) < ONLINE_THRESHOLD_MS;
}

export function formatLastSeen(lastSeenAt) {
  if (!lastSeenAt) return "faollik ma'lumoti yo'q";
  // 'onlayn' bu yerda qaytarilmaydi: onlayn/oflayn qarorini rt-bus (presence) beradi.

  const d = new Date(lastSeenAt);
  // Soat daqiqalari bo'yicha: hozir 12:45 bo'lsa, 12:44 (yoki 12:45) — "hozirgina"; 12:43 va undan oldin — aniq vaqt
  const minAgo = Math.floor(Date.now() / 60000) - Math.floor(d.getTime() / 60000);
  if (minAgo <= 1) return 'hozirgina faol edi';

  // Aniq vaqt — bugun "23:45", kecha "kecha 23:45", undan oldin "23-avgust 22:45"
  const pad = n => String(n).padStart(2, '0');
  const timeStr = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const y = new Date(); y.setDate(y.getDate() - 1);
  const isYesterday = d.toDateString() === y.toDateString();

  if (isToday)     return `oxirgi marta ${timeStr} da faol edi`;
  if (isYesterday) return `oxirgi marta kecha ${timeStr} da faol edi`;
  const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr'];
  const yr = d.getFullYear() !== now.getFullYear() ? ` ${d.getFullYear()}` : '';
  return `oxirgi marta ${d.getDate()}-${MONTHS[d.getMonth()]}${yr} ${timeStr} da faol edi`;
}
export const initL  = n  => (n && n[0] ? n[0].toUpperCase() : 'U');
export const uToEmail = u => `${u.toLowerCase().replace(/[^a-z0-9_]/g,'')}@gmail.com`;
export const clr    = n  => {
  const c = ['#202327','#2f3336','#71767b'];
  return c[Math.abs((n||'').length) % c.length];
};
export const defAvi = n => {
  const l = initL(n), c = clr(n);
  return `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect width='100' height='100' fill='${encodeURIComponent(c)}' rx='50'/%3E%3Ctext x='50' y='68' text-anchor='middle' fill='%23e7e9ea' font-size='44' font-weight='700' font-family='-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif'%3E${l}%3C/text%3E%3C/svg%3E`;
};

/* ── Tasdiqlash dialog ───────────────────────────────────────────────────── */
export function showConfirm(msg, onOk, title = 'Aniqmi?', okLabel = 'Mayli', onCancel = null) {
  const confirmTitle   = $('confirmTitle');
  const confirmMsg     = $('confirmMsg');
  const confirmOverlay = $('confirmOverlay');
  const ok             = $('confirmOkBtn');
  const cancel         = $('confirmCancelBtn');
  if (!confirmTitle || !confirmMsg || !confirmOverlay || !ok || !cancel) {
    if (window.confirm(msg)) onOk();
    return;
  }
  confirmTitle.textContent = title;
  confirmMsg.textContent   = msg;
  ok.textContent = okLabel; // klon ham shu matnni oladi
  confirmOverlay.classList.add('show');
  const close  = () => confirmOverlay.classList.remove('show');
  const newOk  = ok.cloneNode(true);
  ok.parentNode.replaceChild(newOk, ok);
  newOk.onclick  = () => { close(); onOk(); };
  cancel.onclick = () => { close(); onCancel?.(); };
}

/* ── Heart burst animation ────────────────────────────────────────────── */
export function showHeartBurst(x, y, container) {
  const el = document.createElement('div');
  el.className = 'heart-burst';
  el.style.left = x + 'px';
  el.style.top  = y + 'px';
  el.innerHTML = `<img src="./svg/extra/icon-9d6229c40a8d.svg" alt="" class="icon" width="80" height="80">`;
  container.appendChild(el);
  setTimeout(() => el.remove(), 900);
}

/* ── File download ────────────────────────────────────────────────────── */
export async function dlFile(url, name) {
  toast('Yuklab olinmoqda...', 'info', 8000);
  try {
    const res  = await fetch(url);
    if (!res.ok) throw new Error('Tarmoq xatosi');
    const blob = await res.blob();
    const burl = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = burl;
    a.download = name || 'file';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(burl); a.remove(); }, 1000);
    toast('Yuklab olindi!', 'success');
  } catch {
    location.assign(url);
  }
}

/* ── Zoom modal ───────────────────────────────────────────────────────── */
/* ── Zoom lightbox: qorong'u fon, pinch / trackpad zoom, tashqariga bosib yopish ── */
let _z = { scale: 1, x: 0, y: 0, base: 1, px: 0, py: 0, pinching: false, panning: false, lastTap: 0, didDrag: false };

function _zApply() {
  const im = $('zoomImg');
  if (!im) return;
  im.style.transform = `translate(${_z.x}px, ${_z.y}px) scale(${_z.scale})`;
}

function _zReset() {
  _z.scale = 1; _z.x = 0; _z.y = 0; _z.base = 1; _z.px = 0; _z.py = 0;
  _z.pinching = false; _z.panning = false;
  _zApply();
}

function _zClose() {
  const zm = $('zoomModal');
  if (!zm) return;
  zm.classList.remove('show');
  _zReset();
  const im = $('zoomImg');
  if (im) { im.src = ''; im.style.display = 'none'; }
}

function _zDist(t) {
  const a = t[0], b = t[1];
  return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
}
function _zMid(t) {
  return { x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 };
}

export function openZoom(url, type) {
  const im = $('zoomImg'), zm = $('zoomModal');
  if (!im || !zm) { location.assign(url); return; }
  _zReset();
  const isAvi = type === 'avatar';
  zm.classList.toggle('zoom-avatar', isAvi);
  zm.classList.toggle('zoom-image', !isAvi && type === 'image');
  im.style.display = 'block';
  im.src = url;
  if (isAvi) {
    im.style.borderRadius = '50%';
    im.style.width = 'min(72vw, 340px)';
    im.style.height = 'min(72vw, 340px)';
    im.style.objectFit = 'cover';
    im.style.maxWidth = 'none';
    im.style.maxHeight = 'none';
  } else if (type === 'image') {
    im.style.borderRadius = '8px';
    im.style.width = '';
    im.style.height = '';
    im.style.objectFit = 'contain';
    im.style.maxWidth = 'min(90vw, calc(100vw - 48px))';
    im.style.maxHeight = 'min(86dvh, calc(100dvh - 56px))';
  } else {
    location.assign(url);
    return;
  }
  im.style.transform = 'translate(0,0) scale(1)';
  im.style.transformOrigin = 'center center';
  im.style.transition = 'none';
  zm.classList.add('show');
}

function _bindZoomOnce() {
  const zm = $('zoomModal');
  const im = $('zoomImg');
  if (!zm || !im || zm._zoomBound) return;
  zm._zoomBound = true;

  const zoomClose = $('zoomClose');
  if (zoomClose) zoomClose.onclick = (e) => { e.stopPropagation(); _zClose(); };

  // Fon bosilsa yopish (rasm emas)
  zm.addEventListener('click', e => {
    if (e.target === zm && !_z.didDrag) _zClose();
    _z.didDrag = false;
  });

  // Double-tap / double-click → 2.5x / 1x
  im.addEventListener('click', e => {
    e.stopPropagation();
    if (_z.didDrag) { _z.didDrag = false; return; }
    const now = Date.now();
    if (now - _z.lastTap < 280) {
      if (_z.scale > 1.05) { _z.scale = 1; _z.x = 0; _z.y = 0; }
      else { _z.scale = 2.5; }
      _zApply();
    }
    _z.lastTap = now;
  });

  // Trackpad: ctrl/pinch wheel = zoom; 2-barmoq scroll = pan (kattalashtirilganda)
  zm.addEventListener('wheel', e => {
    if (!zm.classList.contains('show')) return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const delta = -e.deltaY * 0.01;
      const next = Math.min(6, Math.max(1, _z.scale * (1 + delta)));
      if (next <= 1.02) { _z.scale = 1; _z.x = 0; _z.y = 0; }
      else _z.scale = next;
      _zApply();
    } else if (_z.scale > 1.05) {
      _z.x -= e.deltaX;
      _z.y -= e.deltaY;
      _zApply();
    }
  }, { passive: false });

  // ── Touch: 2 barmoq pinch + 1 barmoq pan (zoom > 1) ──
  let startDist = 0, startScale = 1, startX = 0, startY = 0, mid0 = null, pan0x = 0, pan0y = 0;
  zm.addEventListener('touchstart', e => {
    if (!zm.classList.contains('show')) return;
    _z.didDrag = false;
    if (e.touches.length === 2) {
      e.preventDefault();
      _z.pinching = true;
      _z.panning = false;
      startDist = _zDist(e.touches);
      startScale = _z.scale;
      mid0 = _zMid(e.touches);
      pan0x = _z.x; pan0y = _z.y;
    } else if (e.touches.length === 1 && _z.scale > 1.05) {
      _z.panning = true;
      startX = e.touches[0].clientX - _z.x;
      startY = e.touches[0].clientY - _z.y;
    }
  }, { passive: false });

  zm.addEventListener('touchmove', e => {
    if (!zm.classList.contains('show')) return;
    if (_z.pinching && e.touches.length === 2) {
      e.preventDefault();
      const d = _zDist(e.touches);
      const mid = _zMid(e.touches);
      if (startDist > 0) {
        _z.scale = Math.min(6, Math.max(1, startScale * (d / startDist)));
        if (_z.scale <= 1.02) { _z.scale = 1; _z.x = 0; _z.y = 0; }
        else if (mid0) {
          // Pinch markaziga nisbatan pan
          _z.x = pan0x + (mid.x - mid0.x);
          _z.y = pan0y + (mid.y - mid0.y);
        }
        _z.didDrag = true;
        _zApply();
      }
    } else if (_z.panning && e.touches.length === 1) {
      e.preventDefault();
      _z.x = e.touches[0].clientX - startX;
      _z.y = e.touches[0].clientY - startY;
      _z.didDrag = true;
      _zApply();
    }
  }, { passive: false });

  zm.addEventListener('touchend', e => {
    if (e.touches.length < 2) _z.pinching = false;
    if (e.touches.length === 0) {
      _z.panning = false;
      if (_z.scale < 1.05) { _z.scale = 1; _z.x = 0; _z.y = 0; _zApply(); }
    }
  });

  // ── Mouse: left-click ushlab surish (faqat zoom > 1) ──
  let mousePan = false, mStartX = 0, mStartY = 0;
  im.addEventListener('pointerdown', e => {
    if (!zm.classList.contains('show')) return;
    if (e.pointerType === 'touch') return; // touch alohida
    if (e.button !== 0) return;
    if (_z.scale <= 1.05) return;
    mousePan = true;
    _z.didDrag = false;
    mStartX = e.clientX - _z.x;
    mStartY = e.clientY - _z.y;
    im.setPointerCapture?.(e.pointerId);
    im.style.cursor = 'grabbing';
    e.preventDefault();
  });
  im.addEventListener('pointermove', e => {
    if (!mousePan) return;
    _z.x = e.clientX - mStartX;
    _z.y = e.clientY - mStartY;
    _z.didDrag = true;
    _zApply();
  });
  const endMouse = e => {
    if (!mousePan) return;
    mousePan = false;
    im.style.cursor = '';
    try { im.releasePointerCapture?.(e.pointerId); } catch (_) {}
  };
  im.addEventListener('pointerup', endMouse);
  im.addEventListener('pointercancel', endMouse);

  // Capture + stopPropagation: Esc faqat rasmni yopadi. Aks holda umumiy Esc (shortcuts.js)
  // ham ishlab, rasm ostidagi oyna/profil/chatni ham yopib, bosh sahifagacha qaytarib yuborardi.
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && zm.classList.contains('show')) {
      e.stopPropagation();
      e.preventDefault();
      _zClose();
    }
  }, true);
}

// DOM tayyor bo'lganda bir marta bog'lash
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', _bindZoomOnce);
  else _bindZoomOnce();
}

// Offline/online notifications o'chirildi
/* ═══════════════════════════════════════════════════════════════════════
   iOS 27 HAPTIC ENGINE
   navigator.vibrate — iOS Safari 16.4+ qo'llab-quvvatlaydi
   Fallback: CSS .haptic-flash animatsiyasi
   ═══════════════════════════════════════════════════════════════════════ */

const _hap = () => 'vibrate' in navigator;

export const haptic = {
  /** Engil tap — nav, like, checkbox */
  light  () { _hap() && navigator.vibrate(6);  },
  /** O'rta tap — tugmalar, post yuborish */
  medium () { _hap() && navigator.vibrate(10); },
  /** Og'ir tap — xato, ogohlantirish */
  heavy  () { _hap() && navigator.vibrate([12, 6, 12]); },
  /** Muvaffaqiyat — post, xabar yuborildi */
  success() { _hap() && navigator.vibrate([6, 4, 8]); },
  /** Xato — form validation, network error */
  error  () { _hap() && navigator.vibrate([14, 6, 14, 6, 14]); },
  /** Tanlash o'zgardi — tab, toggle, picker */
  select () { _hap() && navigator.vibrate(4);  },
};

/** Elementga visual + haptic touch feedback qo'shish */
export function addHapticTouch(el, type = 'light') {
  el.addEventListener('pointerdown', () => {
    haptic[type]?.();
  });
}

/* ═══════════════════════════════════════════════════════════════════════
   SCROLL LOCK — modal/sheet ochilganda orqa sahifa scroll bo'lmasin
   ═══════════════════════════════════════════════════════════════════════ */

/* Scroll qulfi. MUHIM: har qulf o'z KALITI bilan ro'yxatga olinadi (masalan 'uploadOverlay'):
   - bir kalit bilan takror lockScroll — qo'shimcha hisoblanmaydi (qulf "oqib" qolmaydi, scroll o'lmaydi);
   - qulflanmagan kalit bilan unlockScroll — hech narsa qilmaydi (eski xato: ortiqcha unlock
     window.scrollTo(0, eski_scrollY) chaqirib lentani tepaga otib yuborardi).
   Kalitsiz chaqiruv (eski kod) — oddiy hisoblagich, lekin u ham 0 dan pastga tushmaydi. */
const _scrollLocks = new Set();
let _scrollLockAnon = 0;
let _scrollLockApplied = false;   // body haqiqatan qulflanganmi
let _scrollY = 0;

const _scrollLockTotal = () => _scrollLocks.size + _scrollLockAnon;

function _applyScrollLock() {
  if (_scrollLockApplied) return;
  _scrollLockApplied = true;
  _scrollY = window.scrollY;
  document.body.style.overflow = 'hidden';
  document.body.style.position = 'fixed';
  document.body.style.top = `-${_scrollY}px`;
  document.body.style.width = '100%';
}

function _releaseScrollLock(restore) {
  if (!_scrollLockApplied) return;   // qulflanmagan bo'lsa — scroll joyiga umuman tegmaymiz
  _scrollLockApplied = false;
  document.body.style.overflow = '';
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.width = '';
  if (restore) window.scrollTo(0, _scrollY);
}

/** Body scrollini bloklash — modal/sheet ochilganda. key = qulf egasi (masalan overlay id). */
export function lockScroll(key) {
  if (key) _scrollLocks.add(key); else _scrollLockAnon++;
  _applyScrollLock();
}

/** Body scrollini qayta ochish — modal/sheet yopilganda. Shu key bilan lock qilinmagan bo'lsa — e'tiborsiz. */
export function unlockScroll(key) {
  if (key) { if (!_scrollLocks.delete(key)) return; }
  else { if (_scrollLockAnon === 0) return; _scrollLockAnon--; }
  if (_scrollLockTotal() === 0) _releaseScrollLock(true);
}

/** Barcha qulflarni majburan tozalash (sahifa/route almashganda). Scroll joyi tiklanmaydi. */
export function resetScrollLock() {
  _scrollLocks.clear();
  _scrollLockAnon = 0;
  _releaseScrollLock(false);
}

/** 1234 -> "1.2K", 0 -> "" (X uslubi) */
export const fmtCount = n => {
  n = Number(n) || 0;
  if (!n) return '';
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'K';
  return String(n);
};

/* ── Clipboard nusxalash (barcha brauzer lar uchun xavfsiz) ─────────────── */
export async function copyToClipboard(text) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = Object.assign(document.createElement('textarea'), {
      value: text,
    });
    ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0;pointer-events:none';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch (_) {}
    ta.remove();
  }
}

/* ── Foydalanuvchi holati tekshiruvi (chat.js va groups.js umumiy) ───── */
/** Tasdiqlangan va (muddati o'tmagan) bloklanmagan foydalanuvchi */
export function isActiveUser(u) {
  if (u.approval !== 'approved') return false;
  if (!u.blocked) return true;
  return !!(u.blockedUntil && u.blockedUntil < Date.now());
}

/* ── SpaceMR sekin smooth scroll (barcha auto-scroll uchun) ─────────────
   Brauzer native smooth (~300ms) juda tez — bu yerda ~750ms ease-in-out. */
export const SMOOTH_MS = 750;

function _easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Scrollable konteynerda `top` ga sekin silliq scroll */
export function smoothScrollContainer(box, top, duration = SMOOTH_MS) {
  if (!box) return Promise.resolve();
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const target = Math.max(0, Math.min(top, box.scrollHeight - box.clientHeight));
  if (reduced || duration <= 0) {
    box.scrollTop = target;
    return Promise.resolve();
  }
  const start = box.scrollTop;
  const delta = target - start;
  if (Math.abs(delta) < 1) return Promise.resolve();
  // native smooth ni bekor qilish uchun vaqt belgisi
  box._smoothUntil = Date.now() + duration + 80;
  const t0 = performance.now();
  return new Promise(resolve => {
    const step = (now) => {
      const p = Math.min(1, (now - t0) / duration);
      box.scrollTop = start + delta * _easeInOutCubic(p);
      if (p < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}

/** Elementni viewport yoki eng yaqin scroll ota ichida markazga sekin olib kelish */
export function smoothScrollIntoView(el, { block = 'center', duration = SMOOTH_MS } = {}) {
  if (!el || !el.isConnected) return Promise.resolve();
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced || duration <= 0) {
    try { el.scrollIntoView({ block, behavior: 'auto' }); } catch (_) {}
    return Promise.resolve();
  }
  // Scroll ota: overflow auto/scroll bo'lgan eng yaqin ota (yoki window)
  let box = el.parentElement;
  while (box && box !== document.body && box !== document.documentElement) {
    const st = getComputedStyle(box);
    const oy = st.overflowY;
    if ((oy === 'auto' || oy === 'scroll' || oy === 'overlay') && box.scrollHeight > box.clientHeight + 2) break;
    box = box.parentElement;
  }
  if (!box || box === document.body || box === document.documentElement) {
    const rect = el.getBoundingClientRect();
    const vh = window.innerHeight || document.documentElement.clientHeight;
    let deltaY = 0;
    if (block === 'center') deltaY = rect.top + rect.height / 2 - vh / 2;
    else if (block === 'start') deltaY = rect.top - 12;
    else if (block === 'end') deltaY = rect.bottom - vh + 12;
    else deltaY = rect.top + rect.height / 2 - vh / 2;
    const start = window.scrollY || document.documentElement.scrollTop || 0;
    const target = start + deltaY;
    const t0 = performance.now();
    return new Promise(resolve => {
      const step = (now) => {
        const p = Math.min(1, (now - t0) / duration);
        window.scrollTo(0, start + (target - start) * _easeInOutCubic(p));
        if (p < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
  }
  const er = el.getBoundingClientRect();
  const br = box.getBoundingClientRect();
  let nextTop = box.scrollTop;
  if (block === 'center') nextTop += (er.top - br.top) - (box.clientHeight - er.height) / 2;
  else if (block === 'start') nextTop += (er.top - br.top) - 12;
  else if (block === 'end') nextTop += (er.bottom - br.bottom) + 12;
  else nextTop += (er.top - br.top) - (box.clientHeight - er.height) / 2;
  return smoothScrollContainer(box, nextTop, duration);
}

/**
 * Faqat ||spoiler|| belgisini qo'llaydigan yengil render (bio kabi joylar uchun).
 * Matn avval esc() dan o'tadi, shuning uchun HTML in'ektsiya imkoni yo'q.
 */
export function renderSpoilers(rawText) {
  if (!rawText) return '';
  bindSpoilerUI();
  const hold = [];
  let s = String(rawText).replace(/\|\|([\s\S]*?)\|\|/g, (_m, inner) => {
    const idx = hold.push(spoilerPlaceholder(inner)) - 1;
    return '\u0000SP' + idx + '\u0000';
  });
  s = esc(s);
  return s.replace(/\u0000SP(\d+)\u0000/g, (_m, i) => hold[parseInt(i, 10)] || '');
}

/**
 * Markdown/spoiler belgilarini olib tashlab, oddiy matn qaytaradi (clipboard uchun).
 * renderMarkdown() qo'llab-quvvatlagan sintaksis bilan bir xil: ||spoiler||, **qalin**, *kursiv*,
 * ~~chizilgan~~, `kod`, ```blok```, # sarlavha, > iqtibos, ro'yxat, [matn](url), jadval.
 * Kod ichidagi belgilar o'zgartirilmaydi.
 */
export function markdownToPlain(rawText) {
  if (!rawText) return '';
  let s = String(rawText).replace(/\r\n?/g, '\n');
  const keep = [];
  const hold = t => '\u0000K' + (keep.push(t) - 1) + '\u0000';

  s = s.replace(/```[a-z0-9]*\n([\s\S]*?)```/gi, (_m, code) => hold(code.trim()));
  s = s.replace(/`([^`\n]+)`/g, (_m, code) => hold(code));

  s = s.replace(/\|\|([\s\S]*?)\|\|/g, '$1');
  s = s.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+?)(?:\s+"[^"]*")?\)/g, '$1 ($2)');

  s = s.replace(/(?:^[ \t]*\|.*\|[ \t]*\n)+^[ \t]*\|.*\|[ \t]*/gm, match =>
    match.trim().split('\n')
      .filter(r => !/^\|?[ \t:-]+\|[ \t:\-|]+$/.test(r))
      .map(r => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim()).join('\t'))
      .join('\n'));

  s = s.replace(/^[ \t]*#{1,3}\s+(.+)$/gm, '$1');
  s = s.replace(/^[ \t]*>\s?(.+)$/gm, '$1');
  s = s.replace(/^([ \t]*)[-*]\s+\[([ xX])\]\s+(.+)$/gm, (_m, ind, c, t) => ind + (c === ' ' ? '\u2610 ' : '\u2611 ') + t);
  s = s.replace(/^([ \t]*)[-*]\s+(.+)$/gm, '$1\u2022 $2');

  s = s.replace(/~~([^~\n]+)~~/g, '$1');
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '$1');
  s = s.replace(/__([^_\n]+)__/g, '$1');
  s = s.replace(/\*([^*\n]+)\*/g, '$1');
  s = s.replace(/(^|[^\w])_([^_\n]+)_(?!\w)/g, '$1$2');

  s = s.replace(/\u0000K(\d+)\u0000/g, (_m, i) => keep[parseInt(i, 10)]);
  return s.trim();
}
