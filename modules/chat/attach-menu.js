/* attach-menu.js — "skrepka" tugmasi menyusi: 1) Kamera  2) Fayl  3) Media. DM va guruh uchun bitta.
   Kamera qurilmasi topilmasa "Kamera" bandi ko'rinmaydi. Kamera ruxsati har bosishda qayta so'raladi. */
import { hasCameraDevice } from './camera-access.js';
import { openCameraCapture } from './camera-capture.js';

const _ico = p => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const ICONS = {
  camera: _ico('<path d="M20 7h-3l-1.5-2h-7L7 7H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1z"/><circle cx="12" cy="13" r="3.5"/>'),
  file: _ico('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/>'),
  media: _ico('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M21 16l-5-5-8 9"/>'),
};

let _menu = null, _off = null;
function closeMenu() {
  if (_off) { _off(); _off = null; }
  _menu?.remove(); _menu = null;
}

export function initAttachMenu({ btn, fileInput, isBusy, onPick }) {
  if (!btn || !fileInput) return;
  const mediaInput = document.createElement('input');
  mediaInput.type = 'file'; mediaInput.accept = 'image/*,video/*'; mediaInput.style.display = 'none';
  fileInput.after(mediaInput);
  mediaInput.addEventListener('change', () => {
    const f = mediaInput.files?.[0];
    mediaInput.value = '';
    if (f) onPick(f);
  });

  const actions = {
    camera: async () => { const f = await openCameraCapture(); if (f) onPick(f); },
    file: () => fileInput.click(),
    media: () => mediaInput.click(),
  };

  function openMenu(withCamera) {
    const items = [...(withCamera ? [['camera', 'Kamera']] : []), ['file', 'Fayl'], ['media', 'Media']];
    const m = document.createElement('div');
    m.className = 'attach-menu'; m.setAttribute('role', 'menu');
    m.innerHTML = items.map(([k, t]) => `<button type="button" class="am-item" role="menuitem" data-k="${k}">${ICONS[k]}<span>${t}</span></button>`).join('');
    document.body.appendChild(m);
    const r = btn.getBoundingClientRect();
    m.style.left = Math.max(8, Math.min(r.left, window.innerWidth - m.offsetWidth - 8)) + 'px';
    m.style.bottom = (window.innerHeight - r.top + 8) + 'px';
    m.addEventListener('click', e => {
      const it = e.target.closest('.am-item'); if (!it) return;
      const k = it.dataset.k; closeMenu(); actions[k]();
    });
    const onDown = e => { if (!m.contains(e.target) && !btn.contains(e.target)) closeMenu(); };
    const onKey = e => { if (e.key === 'Escape') closeMenu(); };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', closeMenu);
    _off = () => { document.removeEventListener('pointerdown', onDown, true); document.removeEventListener('keydown', onKey, true); window.removeEventListener('resize', closeMenu); };
    _menu = m;
  }

  btn.addEventListener('click', async e => {
    e.preventDefault();
    if (isBusy?.()) return;
    if (_menu) { closeMenu(); return; }
    openMenu(await hasCameraDevice());   // har ochilganda qayta tekshiriladi (kamera ulandi/uzildi)
  });
}
