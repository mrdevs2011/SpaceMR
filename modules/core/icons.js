/** SpaceMR icon helper — external SVGs under ./svg/{category}/{name}.svg */
export function icon(cat, name, { size = 20, cls = '', alt = '', style = '' } = {}) {
  const s = size ? ` width="${size}" height="${size}"` : '';
  const c = cls ? ` ${cls}` : '';
  const st = style ? ` style="${style}"` : '';
  return `<img src="./svg/${cat}/${name}.svg" alt="${alt}" class="icon${c}"${s}${st}>`;
}

export const ICONS = {
  close: () => icon('action', 'close', { size: 16 }),
  search: () => icon('action', 'search', { size: 17 }),
  plus: () => icon('action', 'plus', { size: 20 }),
  settings: () => icon('action', 'settings', { size: 18 }),
  edit: () => icon('action', 'edit', { size: 16 }),
  send: () => icon('action', 'send', { size: 16 }),
  trash: () => icon('action', 'trash', { size: 16 }),
  reply: () => icon('action', 'reply', { size: 16 }),
  copy: () => icon('action', 'copy', { size: 16 }),
  home: () => icon('nav', 'home'),
  back: () => icon('nav', 'chevron-left', { size: 22 }),
  chevronDown: () => icon('nav', 'chevron-down', { size: 14 }),
  chat: () => icon('social', 'chat'),
  user: () => icon('social', 'user'),
  bookmark: () => icon('social', 'bookmark'),
  mic: () => icon('media', 'mic', { size: 24, cls: 'icon-mic' }),
  phone: () => icon('call', 'phone', { size: 17 }),
  eyeOpen: () => icon('ui', 'eye-open', { size: 16, cls: 'pe-eye-open' }),
  eyeClosed: () => icon('ui', 'eye-closed', { size: 16, cls: 'pe-eye-closed' }),
};
