/** File type icons — feed + chat (inline SVG, Telegram/Claude uslubi) */

const TYPES = [
  { test: (e, m) => m.startsWith('audio') || ['mp3','wav','ogg','aac','flac','m4a','wma','opus','aiff','mid','midi'].includes(e), label: 'AUDIO', color: '#a855f7', icon: 'audio' },
  { test: (e, m) => e === 'pdf' || m === 'application/pdf', label: 'PDF', color: '#ef4444', icon: 'pdf' },
  { test: (e, m) => ['doc','docx','dot','dotx','odt','rtf','pages'].includes(e) || m.includes('msword') || m.includes('wordprocessingml'), label: 'DOC', color: '#3b82f6', icon: 'doc' },
  { test: (e, m) => ['xls','xlsx','xlsm','xlsb','csv','tsv','ods','numbers'].includes(e) || m.includes('spreadsheet') || m.includes('excel') || m === 'text/csv', label: 'XLS', color: '#22c55e', icon: 'sheet' },
  { test: (e) => ['ppt','pptx','pps','ppsx','odp','key'].includes(e), label: 'PPT', color: '#f97316', icon: 'slide' },
  { test: (e, m) => ['zip','rar','7z','tar','gz','bz2','xz','lz','lzma'].includes(e), label: 'ZIP', color: '#eab308', icon: 'zip' },
  { test: (e, m) => m.startsWith('video/') || ['mp4','webm','mov','mkv','avi'].includes(e), label: 'VIDEO', color: '#06b6d4', icon: 'video' },
  { test: (e, m) => m.startsWith('image/') || ['jpg','jpeg','png','gif','webp','avif','heic','bmp','svg'].includes(e), label: 'IMG', color: '#14b8a6', icon: 'image' },
  { test: (e, m) => ['js','mjs','cjs'].includes(e) || m.includes('javascript'), label: 'JS', color: '#eab308', icon: 'code' },
  { test: (e) => ['jsx','tsx'].includes(e), label: 'JSX', color: '#38bdf8', icon: 'code' },
  { test: (e) => ['ts'].includes(e), label: 'TS', color: '#3b82f6', icon: 'code' },
  { test: (e, m) => e === 'py' || m === 'text/x-python', label: 'PY', color: '#38bdf8', icon: 'code' },
  { test: (e, m) => e === 'json' || m === 'application/json', label: 'JSON', color: '#a3e635', icon: 'code' },
  { test: (e) => ['css','scss','sass','less'].includes(e), label: 'CSS', color: '#22d3ee', icon: 'code' },
  { test: (e, m) => ['html','htm'].includes(e) || m === 'text/html', label: 'HTML', color: '#f97316', icon: 'code' },
  { test: (e) => ['md','mdx','markdown','epub','tex'].includes(e), label: 'MD', color: '#94a3b8', icon: 'doc' },
  { test: (e, m) => ['txt','log','ini','cfg','conf'].includes(e) || m === 'text/plain', label: 'TXT', color: '#94a3b8', icon: 'doc' },
  { test: (e) => ['apk','ipa','dmg','exe','msi'].includes(e), label: 'APP', color: '#a855f7', icon: 'app' },
];

function glyph(kind, c) {
  // Simple white glyphs on colored page
  if (kind === 'pdf') return `<path d="M18 28V18h3.2c1.7 0 2.8 1 2.8 2.5S22.9 23 21.2 23H20.2v5H18zm2.2-7v2.2h.9c.7 0 1.2-.3 1.2-1.1s-.5-1.1-1.2-1.1h-.9zM26.5 28l2.2-10h2.4l2.2 10h-2.1l-.4-1.8h-2.8l-.4 1.8h-2.1zm3.2-3.6h1.8l-.9-3.9-.9 3.9zM35 28V18h4.6v1.8H37v2.2h2.3v1.8H37V28H35z" fill="${c}"/>`;
  if (kind === 'audio') return `<path d="M20 30a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0-2a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm5-10v12.2a3 3 0 1 0 2-2.8V15.5l8-1.5V26a3 3 0 1 0 2-2.8V11l-12 2.2z" fill="${c}"/>`;
  if (kind === 'zip') return `<path d="M22 14h2v2h-2v-2zm0 4h2v2h-2v-2zm0 4h2v2h-2v-2zm2 2h2v2h-2v-2zm-2 2h2v2h-2v-2zm3.5 1.5c0 1.9-1.3 3.5-3.5 3.5s-3.5-1.6-3.5-3.5c0-1.4.8-2.5 2-3.1V14h3v8.9c1.2.6 2 1.7 2 3.1zM24 28.5c0 .8-.7 1.5-1.5 1.5S21 29.3 21 28.5s.7-1.5 1.5-1.5 1.5.7 1.5 1.5z" fill="${c}"/>`;
  if (kind === 'video') return `<path d="M18 16.5A2.5 2.5 0 0 1 20.5 14h7A2.5 2.5 0 0 1 30 16.5v11a2.5 2.5 0 0 1-2.5 2.5h-7A2.5 2.5 0 0 1 18 27.5v-11zm14 1.2 4.2-2.5a1 1 0 0 1 1.5.8v11a1 1 0 0 1-1.5.9L32 26.3V17.7z" fill="${c}"/>`;
  if (kind === 'image') return `<path d="M16 17.5A2.5 2.5 0 0 1 18.5 15h15A2.5 2.5 0 0 1 36 17.5v13a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 16 30.5v-13zM20 22a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm-2 7.5 4.5-5.5 3.5 4 5-6.5 5 8H18z" fill="${c}"/>`;
  if (kind === 'code') return `<path d="M21.5 24l-3.2-3.2 1.4-1.4L24.3 24l-4.6 4.6-1.4-1.4L21.5 24zm9 0l3.2 3.2-1.4 1.4L27.7 24l4.6-4.6 1.4 1.4L30.5 24zM26.2 16l-3.4 16h-2.1l3.4-16h2.1z" fill="${c}"/>`;
  if (kind === 'sheet') return `<path d="M17 15h18v18H17V15zm2 2v3h3v-3h-3zm5 0v3h3v-3h-3zm5 0v3h4v-3h-4zm-10 5v3h3v-3h-3zm5 0v3h3v-3h-3zm5 0v3h4v-3h-4zm-10 5v4h3v-4h-3zm5 0v4h3v-4h-3zm5 0v4h4v-4h-4z" fill="${c}"/>`;
  if (kind === 'slide') return `<path d="M16 16h20v14H16V16zm2 2v10h16V18H18zm6 14h4v2h-4v-2z" fill="${c}"/>`;
  if (kind === 'app') return `<path d="M20 16h4v4h-4v-4zm8 0h4v4h-4v-4zM20 24h4v4h-4v-4zm8 0h4v4h-4v-4z" fill="${c}"/>`;
  // doc default
  return `<path d="M20 18h12v2H20v-2zm0 4h12v2H20v-2zm0 4h8v2h-8v-2z" fill="${c}"/>`;
}

function resolve(name = '', mime = '') {
  const _n = String(name || '');
  const ext = _n.includes('.') ? (_n.split('.').pop() || '').toLowerCase().replace(/[^a-z0-9]/g, '') : '';
  const m = (mime || '').toLowerCase();
  for (const t of TYPES) {
    if (t.test(ext, m)) {
      const label = (ext && ext.length <= 5 ? ext : t.label).toUpperCase();
      return { label, color: t.color, icon: t.icon, ext };
    }
  }
  const label = (ext || 'FILE').toUpperCase().slice(0, 5);
  return { label, color: '#64748b', icon: 'doc', ext };
}

/** Colored document page + extension ribbon */
export function fileIconSvg(name = '', mime = '', size = 48) {
  const { label, color, icon } = resolve(name, mime);
  const text = label.slice(0, 4);
  const fs = text.length > 3 ? 9 : 11;
  return `<svg class="file-type-icon" viewBox="0 0 48 48" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <path d="M10 6h17l11 11v23a4 4 0 0 1-4 4H10a4 4 0 0 1-4-4V10a4 4 0 0 1 4-4z" fill="#2f3540"/>
    <path d="M27 6v9a2 2 0 0 0 2 2h9" fill="#3d4450"/>
    <path d="M27 6l11 11" fill="none" stroke="#1a1f28" stroke-width="1" opacity=".5"/>
    <rect x="6" y="30" width="36" height="14" rx="4" fill="${color}"/>
    <text x="24" y="40.5" text-anchor="middle" font-family="system-ui,-apple-system,Segoe UI,Roboto,sans-serif" font-size="${fs}" font-weight="800" fill="#fff" letter-spacing="0.5">${text}</text>
    <g opacity=".92">${glyph(icon, '#c8cdd5')}</g>
  </svg>`;
}

export function getFileIcon(name = '', mime = '') {
  return fileIconSvg(name, mime, 48);
}

export function getChatFileIcon(name, mime) {
  return fileIconSvg(name, mime, 40);
}

export function getFileTypeInfo(name = '', mime = '') {
  const { label, color } = resolve(name, mime);
  return {
    label,
    color,
    svg: fileIconSvg(name, mime, 48),
  };
}
