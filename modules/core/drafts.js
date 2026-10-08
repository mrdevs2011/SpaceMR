/** Hisob darajasidagi qoralama: post, story, dm, guruh.
 *  Avval xotira/localStorage, keyin composer_drafts (Supabase). */
import { sb, state } from './config.js';

const mem = new Map();
const timers = new Map();

function lsKey(scope) {
  return 'spacemr_draft_' + (state.me?.uid || 'anon') + '_' + scope;
}

export function getDraft(scope) {
  if (!scope) return '';
  if (mem.has(scope)) return mem.get(scope) || '';
  try { return localStorage.getItem(lsKey(scope)) || ''; } catch (_) { return ''; }
}

export function setDraft(scope, text) {
  if (!scope) return;
  const t = String(text || '').slice(0, 4000);
  mem.set(scope, t);
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
  const uid = state.me?.uid;
  if (!uid || !scope) return;
  const body = (mem.get(scope) || '').trim();
  try {
    if (!body) {
      await sb.from('composer_drafts').delete().eq('user_id', uid).eq('scope', scope);
      return;
    }
    await sb.from('composer_drafts').upsert(
      { user_id: uid, scope, body, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,scope' }
    );
  } catch (_) {}
}

export function flushAll() {
  for (const scope of mem.keys()) flush(scope);
}

export async function loadDrafts() {
  const uid = state.me?.uid;
  if (!uid) return;
  try {
    const { data } = await sb.from('composer_drafts').select('scope, body').eq('user_id', uid);
    for (const row of data || []) {
      mem.set(row.scope, row.body || '');
      try { if (row.body) localStorage.setItem(lsKey(row.scope), row.body); } catch (_) {}
    }
    window.dispatchEvent(new CustomEvent('spacemr:draft', { detail: '*' }));
  } catch (_) {}
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', flushAll);
  window.addEventListener('beforeunload', flushAll);
}
