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
    title: 'Chat',
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

function ensureCss() {
  if (document.getElementById('obStyle')) return;
  const st = document.createElement('style');
  st.id = 'obStyle';
  st.textContent = `
#onboardOverlay{position:fixed;inset:0;z-index:12000;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;padding:24px;}
.ob-card{max-width:360px;width:100%;background:#16181c;border:1px solid #2f3336;border-radius:16px;padding:24px 22px 20px;color:#e7e9ea;}
.ob-step{font-size:12px;color:#71767b;margin-bottom:8px;font-weight:600;}
.ob-title{font-size:22px;font-weight:800;margin:0 0 10px;letter-spacing:-.3px;}
.ob-body{font-size:15px;line-height:1.45;color:#c8cdd0;margin:0 0 22px;}
.ob-actions{display:flex;gap:10px;justify-content:flex-end;}
.ob-btn{height:44px;min-width:44px;padding:0 18px;border-radius:999px;font:600 14px system-ui,sans-serif;cursor:pointer;border:0;}
.ob-skip{background:transparent;color:#71767b;border:1px solid #2f3336;}
.ob-next{background:#e7e9ea;color:#000;}
`;
  document.head.appendChild(st);
}

export function startOnboarding(force) {
  if (!force && isDone()) return;
  ensureCss();
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
