/**
 * modules/core/file-icons.js
 * Universal, canonical File Types and Icons Engine for SpaceMR.
 * Inline SVG rendering with zero network dependencies and 100% vector fidelity.
 * Supports standard office, media, archive, code, apps, dotfiles, and custom/unknown file types.
 */

import { fmtSz } from './utils.js';

/* Harmonious vibrant palette for custom & unknown file extensions */
const CUSTOM_PALETTE = [
  '#6366f1', // Indigo
  '#0284c7', // Sky Blue
  '#059669', // Emerald
  '#d97706', // Amber
  '#7c3aed', // Violet
  '#db2777', // Rose Pink
  '#0d9488', // Teal
  '#ea580c', // Orange
  '#0891b2', // Cyan
  '#84cc16', // Lime
];

/**
 * Deterministically hash any extension string to a consistent vibrant color
 */
export function hashExtToColor(str = '') {
  const s = String(str || '').toLowerCase().trim();
  if (!s) return '#64748b';
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return CUSTOM_PALETTE[Math.abs(h) % CUSTOM_PALETTE.length];
}

/**
 * Robustly extract normalized file extension and base name
 */
export function parseFileExt(name = '', mime = '') {
  let raw = String(name ?? '').trim();
  // Strip URL query strings, hashes, and decode URI percent-encoding
  raw = raw.split(/[?#]/)[0];
  try { raw = decodeURIComponent(raw); } catch (_) {}
  const base = raw.split('/').filter(Boolean).pop() || '';
  const lower = base.toLowerCase().trim();

  // Multi-dot compound archive formats
  if (lower.endsWith('.tar.gz')) return { ext: 'tar.gz', baseName: base };
  if (lower.endsWith('.tar.bz2')) return { ext: 'tar.bz2', baseName: base };
  if (lower.endsWith('.tar.xz')) return { ext: 'tar.xz', baseName: base };
  if (lower.endsWith('.tar.zst')) return { ext: 'tar.zst', baseName: base };

  // Dotfiles (.gitignore, .env, .bashrc)
  if (base.startsWith('.') && base.indexOf('.', 1) === -1) {
    const ext = base.slice(1).toLowerCase().replace(/[^a-z0-9]/g, '');
    return { ext, baseName: base };
  }

  // Standard extension after last dot
  if (base.includes('.')) {
    const rawExt = base.split('.').pop() || '';
    const cleanExt = rawExt.toLowerCase().replace(/[^a-z0-9]/g, '');
    return { ext: cleanExt, baseName: base };
  }

  // Known dotless files
  if (lower === 'dockerfile') return { ext: 'dockerfile', baseName: base };
  if (lower === 'makefile') return { ext: 'makefile', baseName: base };
  if (lower === 'license' || lower === 'licence') return { ext: 'license', baseName: base };
  if (lower === 'readme') return { ext: 'readme', baseName: base };

  // Fallback to mime type if provided
  const m = String(mime ?? '').toLowerCase().trim();
  if (m === 'application/pdf' || m === 'application/x-pdf') return { ext: 'pdf', baseName: base };
  if (m.includes('wordprocessingml') || m.includes('msword') || m.includes('opendocument.text')) return { ext: 'docx', baseName: base };
  if (m.includes('spreadsheetml') || m.includes('excel') || m.includes('opendocument.spreadsheet')) return { ext: 'xlsx', baseName: base };
  if (m.includes('presentationml') || m.includes('powerpoint') || m.includes('opendocument.presentation')) return { ext: 'pptx', baseName: base };
  if (m === 'text/plain') return { ext: 'txt', baseName: base };
  if (m === 'text/csv') return { ext: 'csv', baseName: base };
  if (m === 'application/json') return { ext: 'json', baseName: base };
  if (m === 'application/zip') return { ext: 'zip', baseName: base };
  if (m.startsWith('image/')) {
    const sub = m.split('/')[1]?.split(/[+;]/)[0] || 'jpg';
    return { ext: sub === 'jpeg' ? 'jpg' : sub, baseName: base };
  }
  if (m.startsWith('video/')) {
    const sub = m.split('/')[1]?.split(/[+;]/)[0] || 'mp4';
    return { ext: sub, baseName: base };
  }
  if (m.startsWith('audio/')) {
    const sub = m.split('/')[1]?.split(/[+;]/)[0] || 'mp3';
    return { ext: sub, baseName: base };
  }

  return { ext: '', baseName: base };
}

/* Canonical type descriptors */
const TYPES = [
  // 1. Audio
  {
    test: (e, m) => m.startsWith('audio') || ['mp3','wav','ogg','aac','flac','m4a','wma','opus','aiff','mid','midi','weba'].includes(e),
    label: (e) => (['mp3','wav','ogg','flac','m4a','aac','opus'].includes(e) ? e.toUpperCase() : 'AUDIO'),
    color: '#9333ea',
    icon: 'audio',
  },
  // 2. PDF
  {
    test: (e, m) => e === 'pdf' || m === 'application/pdf' || m === 'application/x-pdf',
    label: 'PDF',
    color: '#ef4444',
    icon: 'pdf',
  },
  // 3. Word / Documents
  {
    test: (e, m) => ['doc','docx','dot','dotx','odt','rtf','pages'].includes(e) || m.includes('msword') || m.includes('wordprocessingml') || m.includes('opendocument.text'),
    label: (e) => (['docx','odt','rtf','pages'].includes(e) ? e.toUpperCase() : 'DOC'),
    color: '#2563eb',
    icon: 'doc',
  },
  // 4. Spreadsheets / Tables
  {
    test: (e, m) => ['xls','xlsx','xlsm','xlsb','csv','tsv','ods','numbers'].includes(e) || m.includes('spreadsheet') || m.includes('excel') || m === 'text/csv' || m === 'text/tab-separated-values' || m.includes('opendocument.spreadsheet'),
    label: (e) => (['xlsx','csv','tsv','ods'].includes(e) ? e.toUpperCase() : 'XLS'),
    color: '#16a34a',
    icon: 'sheet',
  },
  // 5. Presentations / Slides
  {
    test: (e, m) => ['ppt','pptx','pps','ppsx','odp','key'].includes(e) || m.includes('presentation') || m.includes('powerpoint') || m.includes('opendocument.presentation'),
    label: (e) => (['pptx','key','odp'].includes(e) ? e.toUpperCase() : 'PPT'),
    color: '#ea580c',
    icon: 'slide',
  },
  // 6. Archives & Compression
  {
    test: (e, m) => ['zip','rar','7z','tar','gz','tgz','bz2','tbz2','xz','txz','lz','lzma','iso','deb','rpm','tar.gz','tar.bz2','tar.xz'].includes(e) || m.includes('zip') || m.includes('compressed') || m.includes('x-tar') || m.includes('7z') || m.includes('x-rar'),
    label: (e) => (e === 'tar.gz' || e === 'tgz' ? 'TGZ' : ['rar','7z','tar','iso','deb','rpm','xz'].includes(e) ? e.toUpperCase() : 'ZIP'),
    color: '#ca8a04',
    icon: 'zip',
  },
  // 7. Video
  {
    test: (e, m) => m.startsWith('video/') || ['mp4','webm','mov','mkv','avi','m4v','3gp','flv','wmv'].includes(e),
    label: (e) => (['mp4','webm','mov','mkv','avi','3gp'].includes(e) ? e.toUpperCase() : 'VIDEO'),
    color: '#0284c7',
    icon: 'video',
  },
  // 8. Image
  {
    test: (e, m) => m.startsWith('image/') || ['jpg','jpeg','png','gif','webp','avif','heic','heif','bmp','svg','ico','tiff','psd','ai'].includes(e),
    label: (e) => (e === 'jpeg' ? 'JPG' : ['png','gif','webp','avif','svg','bmp','ico','psd','ai'].includes(e) ? e.toUpperCase() : 'IMG'),
    color: '#0d9488',
    icon: 'image',
  },
  // 9. Web & Scripting Code
  { test: (e, m) => ['js','mjs','cjs'].includes(e) || m.includes('javascript'), label: 'JS', color: '#eab308', icon: 'code' },
  { test: (e) => e === 'jsx', label: 'JSX', color: '#38bdf8', icon: 'code' },
  { test: (e) => e === 'ts', label: 'TS', color: '#2563eb', icon: 'code' },
  { test: (e) => e === 'tsx', label: 'TSX', color: '#38bdf8', icon: 'code' },
  { test: (e, m) => e === 'py' || e === 'pyw' || e === 'ipynb' || m === 'text/x-python', label: 'PY', color: '#38bdf8', icon: 'code' },
  { test: (e, m) => e === 'json' || m === 'application/json', label: 'JSON', color: '#84cc16', icon: 'code' },
  { test: (e) => ['css','scss','sass','less'].includes(e), label: (e) => (e === 'scss' ? 'SCSS' : 'CSS'), color: '#06b6d4', icon: 'code' },
  { test: (e, m) => ['html','htm'].includes(e) || m === 'text/html', label: 'HTML', color: '#ea580c', icon: 'code' },
  { test: (e) => ['vue','svelte'].includes(e), label: (e) => e.toUpperCase(), color: '#10b981', icon: 'code' },

  // 10. Systems & Backend Programming
  { test: (e) => ['c','h'].includes(e), label: 'C', color: '#64748b', icon: 'code' },
  { test: (e) => ['cpp','cc','cxx','hpp'].includes(e), label: 'CPP', color: '#0284c7', icon: 'code' },
  { test: (e) => e === 'cs', label: 'C#', color: '#16a34a', icon: 'code' },
  { test: (e) => ['java','jar'].includes(e), label: 'JAVA', color: '#ea580c', icon: 'code' },
  { test: (e) => ['kt','kts'].includes(e), label: 'KT', color: '#a855f7', icon: 'code' },
  { test: (e) => e === 'go', label: 'GO', color: '#00add8', icon: 'code' },
  { test: (e) => e === 'rs', label: 'RUST', color: '#ea580c', icon: 'code' },
  { test: (e) => e === 'php', label: 'PHP', color: '#6366f1', icon: 'code' },
  { test: (e) => e === 'rb', label: 'RUBY', color: '#dc2626', icon: 'code' },
  { test: (e) => e === 'swift', label: 'SWIFT', color: '#f97316', icon: 'code' },
  { test: (e) => e === 'dart', label: 'DART', color: '#0284c7', icon: 'code' },
  { test: (e) => ['sh','bash','zsh'].includes(e), label: 'BASH', color: '#22c55e', icon: 'code' },
  { test: (e) => e === 'sql', label: 'SQL', color: '#0284c7', icon: 'code' },
  { test: (e) => e === 'lua', label: 'LUA', color: '#000080', icon: 'code' },
  { test: (e) => e === 'wasm', label: 'WASM', color: '#6366f1', icon: 'code' },
  { test: (e) => e === 'zig', label: 'ZIG', color: '#f59e0b', icon: 'code' },

  // 11. Configuration & Data
  { test: (e) => ['yaml','yml'].includes(e), label: 'YAML', color: '#ef4444', icon: 'code' },
  { test: (e) => e === 'toml', label: 'TOML', color: '#9a3412', icon: 'code' },
  { test: (e) => e === 'xml', label: 'XML', color: '#f97316', icon: 'code' },
  { test: (e) => e === 'env', label: 'ENV', color: '#15803d', icon: 'code' },
  { test: (e) => e === 'dockerfile', label: 'DOCK', color: '#0ea5e9', icon: 'code' },
  { test: (e) => e === 'makefile', label: 'MAKE', color: '#eab308', icon: 'code' },
  { test: (e) => ['graphql','gql'].includes(e), label: 'GQL', color: '#e11d48', icon: 'code' },

  // 12. Text & Documentation
  { test: (e) => ['md','mdx','markdown','epub','tex'].includes(e), label: 'MD', color: '#64748b', icon: 'doc' },
  { test: (e, m) => ['txt','log','ini','cfg','conf','sub','srt','license','readme'].includes(e) || m === 'text/plain', label: (e) => (['log','ini','cfg'].includes(e) ? e.toUpperCase() : 'TXT'), color: '#64748b', icon: 'doc' },

  // 13. Executables & Apps
  { test: (e) => ['apk','aab','ipa','dmg','exe','msi','appimage'].includes(e), label: (e) => (['apk','exe','dmg','ipa','aab'].includes(e) ? e.toUpperCase() : 'APP'), color: '#8b5cf6', icon: 'app' },

  // 14. Keys & Certificates
  { test: (e) => ['key','pem','crt','cer','cert'].includes(e), label: 'KEY', color: '#eab308', icon: 'doc' },
];

function glyph(kind, c) {
  // Vector glyphs centered on document upper canvas
  if (kind === 'pdf') {
    return `<path d="M18 27V17h3.2c1.7 0 2.8 1 2.8 2.5S22.9 22 21.2 22H20.2v5H18zm2.2-7v2h.9c.7 0 1.2-.2 1.2-1s-.5-1-1.2-1h-.9zM26.5 27l2.2-10h2.4l2.2 10h-2.1l-.4-1.8h-2.8l-.4 1.8h-2.1zm3.2-3.6h1.8l-.9-3.9-.9 3.9zM35 27V17h4.6v1.8H37v2.2h2.3v1.8H37V27H35z" fill="${c}"/>`;
  }
  if (kind === 'audio') {
    return `<path d="M20 29a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0-2a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm5-10v12.2a3 3 0 1 0 2-2.8V14.5l8-1.5V25a3 3 0 1 0 2-2.8V10l-12 2.2z" fill="${c}"/>`;
  }
  if (kind === 'zip') {
    return `<path d="M22 13h2v2h-2v-2zm0 4h2v2h-2v-2zm0 4h2v2h-2v-2zm2 2h2v2h-2v-2zm-2 2h2v2h-2v-2zm3.5 1.5c0 1.9-1.3 3.5-3.5 3.5s-3.5-1.6-3.5-3.5c0-1.4.8-2.5 2-3.1V13h3v8.9c1.2.6 2 1.7 2 3.1zM24 27.5c0 .8-.7 1.5-1.5 1.5S21 28.3 21 27.5s.7-1.5 1.5-1.5 1.5.7 1.5 1.5z" fill="${c}"/>`;
  }
  if (kind === 'video') {
    return `<path d="M18 15.5A2.5 2.5 0 0 1 20.5 13h7A2.5 2.5 0 0 1 30 15.5v11a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 18 26.5v-11zm14 1.2 4.2-2.5a1 1 0 0 1 1.5.8v11a1 1 0 0 1-1.5.9L32 25.3V16.7z" fill="${c}"/>`;
  }
  if (kind === 'image') {
    return `<path d="M16 16.5A2.5 2.5 0 0 1 18.5 14h15A2.5 2.5 0 0 1 36 16.5v13a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 16 29.5v-13zM20 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm-2 7.5 4.5-5.5 3.5 4 5-6.5 5 8H18z" fill="${c}"/>`;
  }
  if (kind === 'code') {
    return `<path d="M21.5 23l-3.2-3.2 1.4-1.4L24.3 23l-4.6 4.6-1.4-1.4L21.5 23zm9 0l3.2 3.2-1.4 1.4L27.7 23l4.6-4.6 1.4 1.4L30.5 23zM26.2 15l-3.4 16h-2.1l3.4-16h2.1z" fill="${c}"/>`;
  }
  if (kind === 'sheet') {
    return `<path d="M17 14h18v18H17V14zm2 2v3h3v-3h-3zm5 0v3h3v-3h-3zm5 0v3h4v-3h-4zm-10 5v3h3v-3h-3zm5 0v3h3v-3h-3zm5 0v3h4v-3h-4zm-10 5v4h3v-4h-3zm5 0v4h3v-4h-3zm5 0v4h4v-4h-4z" fill="${c}"/>`;
  }
  if (kind === 'slide') {
    return `<path d="M16 15h20v14H16V15zm2 2v10h16V17H18zm6 14h4v2h-4v-2z" fill="${c}"/>`;
  }
  if (kind === 'app') {
    return `<path d="M20 15h4v4h-4v-4zm8 0h4v4h-4v-4zM20 23h4v4h-4v-4zm8 0h4v4h-4v-4z" fill="${c}"/>`;
  }
  // doc default (clean lined page)
  return `<path d="M20 17h12v2H20v-2zm0 4h12v2H20v-2zm0 4h8v2h-8v-2z" fill="${c}"/>`;
}

function resolve(name = '', mime = '') {
  const { ext, baseName } = parseFileExt(name, mime);
  const m = String(mime || '').toLowerCase().trim();

  for (const t of TYPES) {
    if (t.test(ext, m)) {
      const computed = typeof t.label === 'function' ? t.label(ext, m) : t.label;
      const label = (computed || ext || 'FILE').toUpperCase().slice(0, 5);
      return { label, color: t.color, icon: t.icon, ext, isCustom: false, baseName };
    }
  }

  // Custom or unknown file type (e.g. file.asdf, data.xyz)
  if (ext) {
    const label = ext.toUpperCase().slice(0, 5);
    const color = hashExtToColor(ext);
    return { label, color, icon: 'doc', ext, isCustom: true, baseName };
  }

  // Pure extensionless file
  return { label: 'FILE', color: '#64748b', icon: 'doc', ext: '', isCustom: false, baseName };
}

/**
 * Universal Inline SVG File Card.
 * Renders a crisp document page with a colorful bottom ribbon badge and icon glyph.
 * Guaranteed 0 network calls, 0 404s, and infinite vector scalability.
 *
 * @param {string} [name=''] - File name or path
 * @param {string} [mime=''] - Optional MIME type
 * @param {number} [size=48] - Dimensions in px
 * @returns {string} Inline SVG markup
 */
export function fileIconSvg(name = '', mime = '', size = 48) {
  const { label, color, icon } = resolve(name, mime);
  const text = label.slice(0, 5);

  let fs = 11;
  let ls = '0.5';
  if (text.length === 4) {
    fs = 9.5;
    ls = '0.3';
  } else if (text.length >= 5) {
    fs = 8.2;
    ls = '0.1';
  }

  return `<svg class="file-type-icon" viewBox="0 0 48 48" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M10 6h17l11 11v23a4 4 0 0 1-4 4H10a4 4 0 0 1-4-4V10a4 4 0 0 1 4-4z" fill="#2f3540"/>
    <path d="M27 6v9a2 2 0 0 0 2 2h9" fill="#3d4450"/>
    <path d="M27 6l11 11" fill="none" stroke="#1a1f28" stroke-width="1" opacity=".5"/>
    <rect x="6" y="30" width="36" height="14" rx="4" fill="${color}"/>
    <text x="24" y="40.5" text-anchor="middle" font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif" font-size="${fs}" font-weight="800" fill="#fff" letter-spacing="${ls}">${text}</text>
    <g opacity=".92">${glyph(icon, '#c8cdd5')}</g>
  </svg>`;
}

export function getFileIcon(name = '', mime = '') {
  return fileIconSvg(name, mime, 48);
}

export function getChatFileIcon(name = '', mime = '') {
  return fileIconSvg(name, mime, 40);
}

export function getFileTypeInfo(name = '', mime = '') {
  const { label, color, icon, ext, isCustom } = resolve(name, mime);
  return {
    label,
    color,
    icon,
    ext,
    isCustom,
    svg: fileIconSvg(name, mime, 48),
  };
}

export function formatFileSize(bytes) {
  return fmtSz(bytes);
}
