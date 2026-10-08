/** Hisob darajasidagi qoralama: post, story, dm, guruh.
 *  Avval xotira/localStorage, keyin composer_drafts (Supabase). */
import { sb, state } from './config.js';

const mem = new Map();
const timers = new Map();
const dirty = new Set();   // lokal o'zgargan, serverga hali muvaffaqiyatli yozilmagan scope lar (server ularni bosib ketmasin)
let _memUid = null;

/* Akkaunt almashsa xotira/taymerlar tozalanadi: aks holda oldingi akkaunt qoralamasi yangisida chiqib, uning serveriga yozilardi */
function _ensureUid() {
  const uid = state.me?.uid || null;
  if (uid === _memUid) return;
  mem.clear();
  dirty.clear();
  timers.forEach(t => clearTimeout(t));
  timers.clear();
  _memUid = uid;
}

export function resetDrafts() {
  mem.clear(); dirty.clear();
  timers.forEach(t => clearTimeout(t)); timers.clear();
  _memUid = null;
}

function lsKey(scope) {
  return 'spacemr_draft_' + (state.me?.uid || 'anon') + '_' + scope;
}

export function getDraft(scope) {
  if (!scope) return '';
  _ensureUid();
  if (mem.has(scope)) return mem.get(scope) || '';
  try { return localStorage.getItem(lsKey(scope)) || ''; } catch (_) { return ''; }
}

export function setDraft(scope, text) {
  if (!scope) return;
  _ensureUid();
  const t = String(text || '').slice(0, 4000);
  mem.set(scope, t);
  dirty.add(scope);
  try {
    if (t) localStorage.setItem(lsKey(scope), t);
    else localStorage.removeItem(lsKey(scope));
  } catch (_) {}
  clearTimeout(timers.get(scope));
  timers.set(scope, setTimeout(() => flush(scope), 350));
  try { window.dispatchEvent(new CustomEvent('spacemr:draft', { detail: scope })); } catch (_) {}
}

export function clearDraft(scope) { setDraft(scope, ''); }

export async function flush(scope) {
  _ensureUid();
  const uid = state.me?.uid;
  if (!uid || !scope) return;
  const sent = (mem.get(scope) || '');
  const body = sent.trim();
  try {
    let res;
    if (!body) {
      res = await sb.from('composer_drafts').delete().eq('user_id', uid).eq('scope', scope);
    } else {
      res = await sb.from('composer_drafts').upsert(
        { user_id: uid, scope, body, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,scope' }
      );
    }
    // Supabase xatoni throw qilmaydi — error maydonini tekshiramiz; faqat muvaffaqiyatda va matn o'zgarmagan bo'lsa "toza"
    if (!res?.error && (mem.get(scope) || '') === sent && _memUid === uid) dirty.delete(scope);
  } catch (_) {}
}

export function flushAll() {
  for (const scope of mem.keys()) flush(scope);
}

export async function loadDrafts() {
  _ensureUid();
  const uid = state.me?.uid;
  if (!uid) return;
  try {
    const { data, error } = await sb.from('composer_drafts').select('scope, body').eq('user_id', uid);
    if (error || state.me?.uid !== uid) return;
    const seen = new Set();
    for (const row of data || []) {
      seen.add(row.scope);
      if (dirty.has(row.scope)) continue;   // yuklash paytida yozilgan/yuborilgan lokal o'zgarish eski server nusxasidan ustun
      mem.set(row.scope, row.body || '');
      try { if (row.body) localStorage.setItem(lsKey(row.scope), row.body); else localStorage.removeItem(lsKey(row.scope)); } catch (_) {}
    }
    // Serverda yo'q (boshqa qurilmada yuborilgan/tozalangan) va bu yerda kutilayotgan o'zgarishi yo'q qoralamalar — o'chiriladi
    const pre = lsKey('');
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (!k || !k.startsWith(pre)) continue;
        const scope = k.slice(pre.length);
        if (!seen.has(scope) && !dirty.has(scope)) { localStorage.removeItem(k); mem.set(scope, ''); }
      }
    } catch (_) {}
    for (const scope of [...mem.keys()]) if (!seen.has(scope) && !dirty.has(scope)) mem.set(scope, '');
    window.dispatchEvent(new CustomEvent('spacemr:draft', { detail: '*' }));
  } catch (_) {}
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushAll);
  window.addEventListener('beforeunload', flushAll);
}
