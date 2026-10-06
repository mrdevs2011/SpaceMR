/* admin-keys.js — admin paneldagi "Kalitlarni tekshirish": qaysi kalit/sozlama ishlamayotganini ko'rsatadi.
   3 qatlam: brauzer (anon kalit, RLS, storage, realtime, push) · Vercel /api/keys-check (env, TURN) ·
   Supabase Edge `admin-check-keys` (service_role, VAPID, webhook secret).
   Sirlar hech qachon qaytarilmaydi yoki ko'rsatilmaydi — faqat ok/ogohlantirish/xato + qisqa sabab. */
import { sb, MEDIA_BUCKET } from '../core/config.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../core/env.js';

const ICO = {
  ok: '<img src="./svg/admin/ok.svg" alt="" class="icon" width="14" height="14" style="vertical-align:-2px;margin-right:5px">',
  warn: '<img src="./svg/admin/warn.svg" alt="" class="icon" width="14" height="14" style="vertical-align:-2px;margin-right:5px">',
  fail: '<img src="./svg/admin/fail.svg" alt="" class="icon" width="14" height="14" style="vertical-align:-2px;margin-right:5px">',
  key: '<img src="./svg/admin/key.svg" alt="" class="icon" width="14" height="14" style="vertical-align:-2px;margin-right:5px">',
};
const _row = (kind, text) => { const s = document.createElement('span'); s.innerHTML = ICO[kind] || ''; s.append(text); return s; };
const COL = { ok: 'inherit', warn: 'var(--text3,#71767b)', fail: 'var(--red,#f4212e)' };

const withTimeout = (p, ms, msg) => Promise.race([
  p, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms)),
]);
const run = (id, name, fn) => withTimeout(fn(), 9000, 'vaqt tugadi (9 s)')
  .then(([status, detail]) => ({ id, name, status, detail }))
  .catch(e => ({ id, name, status: 'fail', detail: String(e?.message || e) }));

async function getToken() {
  const { data } = await sb.auth.getSession();
  let t = data?.session?.access_token;
  if (!t) { const { data: r } = await sb.auth.refreshSession(); t = r?.session?.access_token; }
  if (!t) throw new Error('Sessiya topilmadi — qayta kiring');
  return t;
}

function vapidShape(s) {
  try {
    const t = s.replace(/-/g, '+').replace(/_/g, '/');
    const b = atob(t + '='.repeat((4 - (t.length % 4)) % 4));
    return b.length === 65 && b.charCodeAt(0) === 4;
  } catch { return false; }
}

async function browserRows(vapid) {
  const hdr = { apikey: SUPABASE_ANON_KEY };
  const host = (() => { try { return new URL(SUPABASE_URL).host; } catch { return ''; } })();
  return Promise.all([
    run('SUPABASE_URL', 'SUPABASE_URL (brauzer)', async () => {
      const r = await fetch(`${SUPABASE_URL}/auth/v1/health`, { headers: hdr });
      return r.ok ? ['ok', host] : ['fail', `HTTP ${r.status}`];
    }),
    run('SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY (brauzer)', async () => {
      const r = await fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: hdr });
      return r.ok ? ['ok', 'Supabase qabul qildi'] : ['fail', `kalit rad etildi (HTTP ${r.status})`];
    }),
    run('RLS', 'Sessiya + baza o\'qish (profiles, RLS)', async () => {
      const { count, error } = await sb.from('profiles').select('id', { count: 'exact', head: true });
      return error ? ['fail', error.message] : ['ok', `${count ?? '?'} ta profil ko'rinadi`];
    }),
    run('STORAGE', `Storage bucket "${MEDIA_BUCKET}"`, async () => {
      const { error } = await sb.storage.from(MEDIA_BUCKET).list('', { limit: 1 });
      return error ? ['fail', error.message] : ['ok', 'o\'qiladi'];
    }),
    run('REALTIME', 'Realtime (WebSocket)', () => new Promise(resolve => {
      const seen = [];
      const ch = sb.channel('keycheck-' + Math.random().toString(36).slice(2, 8));
      const info = () => {
        let app = '';
        try { const all = sb.getChannels().filter(c => c !== ch); app = `; ilova kanallari: ${all.filter(c => c.state === 'joined').length}/${all.length} joined`; } catch { /* noop */ }
        let ws = '';
        try { ws = `; ws: ${sb.realtime.isConnected() ? 'ulangan' : 'uzilgan'}`; } catch { /* noop */ }
        return 'holatlar: ' + (seen.join(' → ') || 'yo\'q') + ws + app;
      };
      const t = setTimeout(() => { sb.removeChannel(ch); resolve(['fail', 'SUBSCRIBED bo\'lmadi. ' + info()]); }, 8000);
      ch.subscribe(st => {
        if (seen[seen.length - 1] !== st) seen.push(st);
        if (st === 'SUBSCRIBED') { clearTimeout(t); sb.removeChannel(ch); resolve(['ok', 'ulandi']); }
      });
    })),
    run('VAPID_CLIENT', 'VAPID ochiq kalit (push.js)', async () =>
      typeof vapid !== 'string' ? ['warn', 'push.js eski versiyada yuklangan (keshda) — sahifani yangilab qayta tekshiring']
      : vapidShape(vapid) ? ['ok', 'format to\'g\'ri'] : ['fail', 'format noto\'g\'ri (65 bayt base64url bo\'lishi kerak)']),
    run('PUSH_SUB', 'Push obunasi (shu qurilma)', async () => {
      if (!('Notification' in window) || !('serviceWorker' in navigator)) return ['warn', 'brauzer push\'ni qo\'llamaydi'];
      if (Notification.permission === 'denied') return ['warn', 'bildirishnoma ruxsati BLOKLANGAN'];
      if (Notification.permission !== 'granted') return ['warn', 'ruxsat hali so\'ralmagan'];
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = await reg?.pushManager?.getSubscription();
      return sub ? ['ok', 'obuna bor'] : ['warn', 'ruxsat bor, lekin obuna yo\'q'];
    }),
  ]);
}

async function serverRows(token, vapid) {
  const host = (() => { try { return new URL(SUPABASE_URL).host; } catch { return ''; } })();
  const vercel = run('API', 'Vercel /api/keys-check', async () => {
    const r = await fetch('/api/keys-check', { headers: { Authorization: `Bearer ${token}` } });
    const j = await r.json().catch(() => ({}));
    if (r.status === 404 || r.status === 405) return ['fail', `HTTP ${r.status}: API deploy qilinmagan (Vercel)`];
    if (!r.ok) return ['fail', `HTTP ${r.status}: ${j.hint || j.error || 'xato'}`];
    return ['ok', { rows: j.rows || [], host: j.supabaseHost }];
  });
  const edge = run('EDGE', 'Supabase Edge admin-check-keys', async () => {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/admin-check-keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify({ vapidPublic: vapid }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 404) return ['fail', 'HTTP 404: funksiya deploy qilinmagan (supabase functions deploy admin-check-keys)'];
    if (!r.ok) return ['fail', `HTTP ${r.status}: ${j.error || j.message || 'xato'}`];
    return ['ok', { rows: j.rows || [] }];
  });
  const [v, e] = await Promise.all([vercel, edge]);
  const out = { vercel: [], edge: [] };
  if (v.status === 'ok') {
    out.vercel = v.detail.rows;
    if (v.detail.host && host && v.detail.host !== host) {
      out.vercel.push({ id: 'HOST_MISMATCH', name: 'SUPABASE_URL: Vercel ↔ brauzer', status: 'fail',
        detail: 'boshqa loyiha! env deploydan keyin o\'zgargan — Vercel\'da Redeploy qiling' });
    }
  } else out.vercel = [v];
  out.edge = e.status === 'ok' ? e.detail.rows : [e];
  return out;
}

function paint(box, groups) {
  const all = groups.flatMap(g => g.rows);
  const bad = all.filter(r => r.status === 'fail').length;
  const warn = all.filter(r => r.status === 'warn').length;
  box.replaceChildren();
  const sum = document.createElement('div');
  sum.style.cssText = 'font-weight:600;margin:10px 0 6px';
  if (bad) {
    sum.append(_row('fail', `${bad} ta ishlamayapti`));
    if (warn) sum.append(', ', _row('warn', `${warn} ta ogohlantirish`));
  } else if (warn) {
    sum.append(_row('ok', 'Hammasi ishlaydi'), ', ', _row('warn', `${warn} ta ogohlantirish`));
  } else sum.append(_row('ok', 'Hammasi ishlaydi'));
  box.appendChild(sum);
  for (const g of groups) {
    const h = document.createElement('div');
    h.style.cssText = 'margin:10px 0 3px;font-size:11.5px;text-transform:uppercase;letter-spacing:.04em;color:var(--text3,#71767b)';
    h.textContent = g.title;
    box.appendChild(h);
    for (const r of g.rows) {
      const d = document.createElement('div');
      d.style.cssText = `padding:3px 0;color:${COL[r.status] || 'inherit'};word-break:break-word`;
      d.appendChild(_row(r.status, `${r.name} — ${r.detail}`));
      box.appendChild(d);
    }
  }
  const t = document.createElement('div');
  t.style.cssText = 'margin-top:8px;font-size:11.5px;color:var(--text3,#71767b)';
  t.textContent = new Date().toLocaleTimeString() + ' da tekshirildi';
  box.appendChild(t);
}

export async function renderKeysCheck(anchor) {
  if (!anchor || document.getElementById('actionsKeysCheck')) return;
  const wrap = document.createElement('div');
  wrap.id = 'actionsKeysCheck';
  wrap.style.cssText = 'margin:14px 18px;font-size:12.5px;';
  const btn = document.createElement('button');
  btn.type = 'button';
  const setBtn = txt => { btn.replaceChildren(_row('key', txt)); };
  setBtn('Kalitlarni tekshirish');
  btn.style.cssText = 'padding:8px 14px;border-radius: 28px;border:1px solid var(--line,rgba(113, 118, 123, 0.2));background:transparent;color:inherit;font-size:13px;cursor:pointer';
  const box = document.createElement('div');
  wrap.append(btn, box);
  anchor.insertAdjacentElement('afterend', wrap);

  btn.addEventListener('click', async () => {
    btn.disabled = true; btn.textContent = 'Tekshirilmoqda…'; box.textContent = '';
    try {
      const { VAPID_PUBLIC_KEY } = await import('../push.js');
      const token = await getToken();
      const [brows, srv] = await Promise.all([browserRows(VAPID_PUBLIC_KEY), serverRows(token, VAPID_PUBLIC_KEY)]);
      paint(box, [
        { title: 'Brauzer', rows: brows },
        { title: 'Vercel (server env)', rows: srv.vercel },
        { title: 'Supabase Edge (secrets)', rows: srv.edge },
      ]);
    } catch (e) {
      box.replaceChildren(_row('fail', 'Tekshiruv boshlanmadi: ' + (e?.message || e)));
    } finally { btn.disabled = false; setBtn('Qayta tekshirish'); }
  });
}
