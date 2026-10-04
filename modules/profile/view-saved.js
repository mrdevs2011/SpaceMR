/**
 * Saqlanganlar — saqlangan postlar sahifasi (/saved)
 */
import { sb, state, mapPost } from '../core/config.js';
import { renderFeedTo, ensureSavedLoaded } from '../feed/feed.js';
import { navigateTo } from '../router.js';

const $ = id => document.getElementById(id);
let _bound = false;
let _seq = 0;

const EMPTY = `<div class="empty saved-empty">
  <div class="empty-icon"><img src="./svg/social/bookmark.svg" alt="" class="icon" width="36" height="36"></div>
  <div class="empty-title">Saqlangan postlar yo'q</div>
  <div class="empty-sub">Post ostidagi belgini bossangiz, u shu yerda saqlanadi.</div>
</div>`;

async function load() {
  const feed = $('savedFeed');
  if (!feed || !state.me) return;
  const seq = ++_seq;
  if (!feed.querySelector('.post')) feed.innerHTML = '<div class="spin-wrap"><div class="spinner"></div></div>';
  await ensureSavedLoaded();
  let rows = [];
  try {
    const { data, error } = await sb.from('saved_posts')
      .select('post_id, created_at, posts(*)')
      .eq('user_id', state.me.uid).order('created_at', { ascending: false }).limit(200);
    if (error) throw error;
    rows = data || [];
  } catch (e) {
    if (seq === _seq) feed.innerHTML = '<div class="empty saved-empty"><div class="empty-title">Yuklab bo\'lmadi</div><div class="empty-sub">Birozdan so\'ng qayta urinib ko\'ring.</div></div>';
    return;
  }
  if (seq !== _seq) return; // yangiroq so'rov boshlandi
  const posts = rows.map(r => mapPost(r.posts)).filter(Boolean);
  state.mySavedPosts = new Set(rows.filter(r => r.posts).map(r => r.post_id));
  if (!posts.length) { feed.innerHTML = EMPTY; return; }
  await renderFeedTo(feed, posts);
  return;
}

function showEmptyIfNone() {
  const feed = $('savedFeed');
  if (feed && state.view === 'saved' && !feed.querySelector('.post')) feed.innerHTML = EMPTY;
}

export async function initView() {
  if (!_bound) {
    _bound = true;
    $('savedBack')?.addEventListener('click', () => navigateTo('home'));
    window.addEventListener('spacemr:saved-changed', showEmptyIfNone);
  }
  // Auth kechikishi: me kelguncha 200ms oralatib 15 marta (3s) kutamiz
  for (let n = 0; !state.me && n < 15; n++) await new Promise(r => setTimeout(r, 200));
  if (state.view !== 'saved') return;
  await load();
}

export function destroyView() {
  _seq++; // kutilayotgan yuklashni bekor qilamiz
}
