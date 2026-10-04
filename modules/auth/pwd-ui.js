/**
 * pwd-ui.js — parol oynalari uchun umumiy yordamchilar:
 * ko'z tugmasi (ko'rsatish/yashirish), parol kuchi chizig'i, "mos keldi" belgisi.
 */
const EYE = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

const LABELS = ['', 'Juda qisqa', "O'rtacha", 'Yaxshi', 'Kuchli'];

/** root ichidagi barcha .pw-eye tugmalarini ishga tushiradi (bir marta) */
export function bindEye(root) {
  if (!root) return;
  root.querySelectorAll('.pw-eye').forEach(btn => {
    if (btn._pwBound) return;
    btn._pwBound = true;
    btn.innerHTML = EYE;
    btn.addEventListener('click', e => {
      e.preventDefault();
      const inp = document.getElementById(btn.dataset.target);
      if (!inp) return;
      const show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      btn.innerHTML = show ? EYE_OFF : EYE;
      btn.setAttribute('aria-label', show ? 'Parolni yashirish' : "Parolni ko'rsatish");
      inp.focus();
    });
  });
}

/** 0 = bo'sh, 1 = juda qisqa (<6), 2..4 = uzunlik/aralashmaga qarab */
export function scorePassword(p) {
  if (!p) return 0;
  if (p.length < 6) return 1;
  const extras =
    (p.length >= 10 ? 1 : 0) +
    (/[a-z]/.test(p) && /[A-Z]/.test(p) ? 1 : 0) +
    (/\d/.test(p) && /[A-Za-z]/.test(p) ? 1 : 0) +
    (/[^A-Za-z0-9]/.test(p) ? 1 : 0);
  return extras >= 2 ? 4 : extras === 1 ? 3 : 2;
}

/** Parol kuchi chizig'i va "mos keldi" belgisini jonli yangilaydi */
export function bindMeter({ input, confirm, meter, text, match }) {
  if (!input || input._pwMeter) return;
  input._pwMeter = true;
  const upd = () => {
    const p = input.value || '';
    const s = scorePassword(p);
    if (meter) meter.dataset.s = String(s);
    if (text) text.textContent = LABELS[s];
    if (match) {
      const c = confirm?.value || '';
      if (!c) { match.textContent = ''; match.className = 'pw-match'; }
      else if (c === p) { match.textContent = '✓ Parollar mos keldi'; match.className = 'pw-match ok'; }
      else { match.textContent = 'Parollar mos kelmadi'; match.className = 'pw-match bad'; }
    }
  };
  input.addEventListener('input', upd);
  confirm?.addEventListener('input', upd);
  upd();
}

/** Kartani silkitadi (xato bo'lganda) */
export function shake(card) {
  if (!card) return;
  card.classList.remove('rc-shake');
  void card.offsetWidth;
  card.classList.add('rc-shake');
  setTimeout(() => card.classList.remove('rc-shake'), 450);
}
