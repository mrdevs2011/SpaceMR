/**
 * onboarding.js — birinchi kirish tanishtiruvi (ROADMAP 1).
 * 3 qadam: lenta, chat, SpaceMR guruhi. Bir marta: localStorage spacemr_onboard_done.
 */
const KEY = 'spacemr_onboard_done';

const STEPS = [
  {
    title: 'Lenta',
    body: 'Bu yerda do\'stlaringiz postlari va hikoyalari ko\'rinadi. Yangi post yozish uchun pastki + tugmasini bosing.',
  },
  {
    title: 'Suhbat',
    body: 'Shaxsiy va guruh suhbatlari. Pastki menyudan Chat belgisini bosing yoki odam profilidan yozing.',
  },
  {
    title: 'SpaceMR guruhi',
    body: 'Muammo yoki taklif bo\'lsa — headerdagi SpaceMR yozuviga bosing yoki sozlamalardan "Muammo haqida yozish"ni tanlang.',
  },
];

function done() {
  try { localStorage.setItem(KEY, '1'); } catch (_) {}
}

function isDone() {
  try { return localStorage.getItem(KEY) === '1'; } catch (_) { return false; }
}

function paint(step) {
  const s = STEPS[step] || STEPS[0];
  const total = STEPS.length;
  return `
  <div class="ob-card" role="dialog" aria-modal="true" aria-labelledby="obTitle">
    <div class="ob-step">${step + 1} / ${total}</div>
    <h2 id="obTitle" class="ob-title">${s.title}</h2>
    <p class="ob-body">${s.body}</p>
    <div class="ob-actions">
      <button type="button" class="ob-btn ob-skip" data-ob="skip">O\'tkazib yuborish</button>
      <button type="button" class="ob-btn ob-next" data-ob="next">${step + 1 >= total ? 'Boshlash' : 'Keyingi'}</button>
    </div>
  </div>`;
}

export function startOnboarding(force) {
  if (!force && isDone()) return;
  let step = 0;
  let root = document.getElementById('onboardOverlay');
  if (!root) {
    root = document.createElement('div');
    root.id = 'onboardOverlay';
    document.body.appendChild(root);
  }
  const render = () => {
    root.innerHTML = paint(step);
    root.querySelector('[data-ob="skip"]')?.addEventListener('click', () => {
      done();
      root.remove();
    });
    root.querySelector('[data-ob="next"]')?.addEventListener('click', () => {
      if (step + 1 >= STEPS.length) {
        done();
        root.remove();
        return;
      }
      step += 1;
      render();
    });
  };
  render();
}

window._startOnboarding = function (force) {
  startOnboarding(!!force);
};

// Agar yangi signup emas, lekin hech qachon ko'rsatilmagan (eski foydalanuvchi) — majburiy emas
