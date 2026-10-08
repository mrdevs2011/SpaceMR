/**
 * SpaceMR — config.js (Supabase)
 * Bitta Supabase client + state + Firestore-uslubidagi ma'lumotni
 * (camelCase, createdAt = epoch-ms number) Supabase qatorlaridan yasovchi mapperlar.
 * Mapperlar qolgan modullarni bosqichma-bosqich ko'chirish imkonini beradi.
 */

import { createClient } from '../vendor/vendor-supabase.js';

// URL va anon key modules/env.js dan keladi — uni Vercel build (scripts/build-env.mjs)
// Environment Variables'dan yozadi. service_role ni BU YERGA YOZMANG.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './env.js';
import { assertAllowedUpload } from './upload-policy.js';
export { SUPABASE_URL, SUPABASE_ANON_KEY };
export const MEDIA_BUCKET      = 'media';

export const SB_CONFIGURED = !/YOUR-/.test(SUPABASE_URL + SUPABASE_ANON_KEY);
if (!SB_CONFIGURED) {
  console.error('config.js: SUPABASE_URL va SUPABASE_ANON_KEY hali kiritilmagan');
}

try {
  if (typeof localStorage !== 'undefined' && !localStorage.getItem('spacemr-auth') && localStorage.getItem('mrspace-auth')) {
    localStorage.setItem('spacemr-auth', localStorage.getItem('mrspace-auth'));
  }
} catch (_) {}

export const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storageKey: 'spacemr-auth',
  },
  realtime: { params: { eventsPerSecond: 60 } },
});

/* Server darvozasi: api/shell.js shu cookie'dagi access_token bilan kirganingni tekshiradi.
   Cookie faqat sessiya bor paytda turadi; chiqishda yoki muddat tugaganda o'chadi. */
(function syncGateCookie() {
  const put = s => {
    try {
      const sec = location.protocol === 'https:' ? '; Secure' : '';
      if (s?.access_token) {
        const age = Math.max(60, (s.expires_at || 0) - Math.floor(Date.now() / 1000));
        document.cookie = `sp_at=${s.access_token}; Path=/; Max-Age=${age}; SameSite=Lax${sec}`;
      } else {
        document.cookie = `sp_at=; Path=/; Max-Age=0; SameSite=Lax${sec}`;
      }
    } catch (_) {}
  };
  sb.auth.onAuthStateChange((ev, s) => put(ev === 'SIGNED_OUT' ? null : s));
})();

/* ── Vaqt: hamma joyda oddiy epoch-millisekund (number) ─────────────── */
/** ISO string | ms | Date → ms (yoki null) */
export function ts(v) {
  if (v == null || v === '') return null;
  const ms = typeof v === 'number' ? v : (v instanceof Date ? v.getTime() : Date.parse(v));
  return Number.isNaN(ms) ? null : ms;
}
/** ms | Date | ISO → ISO string (DB'ga yozish uchun) */
export function toIso(v) {
  const ms = ts(v);
  return ms == null ? null : new Date(ms).toISOString();
}

/* ── Storage ─────────────────────────────────────────────────────────── */
export function mediaPublicUrl(path) {
  if (!path) return null;
  return sb.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;
}

/** Private bucket / CORS muammosida — imzolangan vaqtinchalik URL */
export async function mediaSignedUrl(path, expiresSec = 3600) {
  if (!path) return null;
  try {
    const { data, error } = await sb.storage.from(MEDIA_BUCKET).createSignedUrl(path, expiresSec);
    if (error) { console.warn('[media] signedUrl:', error.message); return null; }
    return data?.signedUrl || null;
  } catch (e) {
    console.warn('[media] signedUrl:', e?.message || e);
    return null;
  }
}

/* ── Mapperlar (DB qatori → eski Firestore ko'rinishi) ──────────────── */

function parseProfileWebsites(raw) {
  if (!raw) return [];
  try {
    if (typeof raw === 'string' && raw.trim().startsWith('[')) {
      const j = JSON.parse(raw);
      if (Array.isArray(j)) return j.map(s => String(s || '').trim()).filter(Boolean).slice(0, 5);
    }
  } catch (_) {}
  const one = String(raw).trim();
  return one ? [one] : [];
}
function parseProfileWebsitePrimary(raw) {
  const list = parseProfileWebsites(raw);
  return list[0] || '';
}

export function mapProfile(r) {
  if (!r) return null;
  return {
    uid: r.id, id: r.id,
    username: r.username,
    fullName: r.full_name || '',
    email: r.email || null,
    bio: r.bio || '',
    avatar: r.avatar || '',
    approval: r.approval,
    approved: r.approval === 'approved' ? true : (r.approval === 'rejected' ? 'rejected' : false),
    blocked: r.blocked === true,
    blockedUntil: ts(r.blocked_until),
    isAdmin: r.is_admin === true,
    lastSeenAt: ts(r.last_seen),
    lastLoginAt: ts(r.last_login),
    lastUserAgent: r.last_user_agent || null,
    mustChangePassword: r.must_change_password === true,
    passwordChangedAt: ts(r.password_changed_at),
    recoveryEmail: r.recovery_email || '',
    website: parseProfileWebsitePrimary(r.website),
    websites: parseProfileWebsites(r.website),
    phone: r.phone || '',
    createdAt: ts(r.created_at),
  };
}

export function mapPost(r) {
  if (!r) return null;
  return {
    id: r.id,
    userId: r.user_id,
    userFullName: r.user_full_name || '',
    text: r.text,
    mediaPath: r.media_path,
    mediaUrl: mediaPublicUrl(r.media_path),
    mediaType: r.media_type,
    mediaWidth: r.media_width,
    mediaHeight: r.media_height,
    fileName: r.file_name,
    fileSize: r.file_size,
    isPublic: r.is_public === true,
    isMaxPrivate: r.is_max_private === true,
    likes: r.likes_count || 0,
    commentCount: r.comment_count || 0,
    createdAt: ts(r.created_at),
  };
}

/** Post uchun media URL (mapPost allaqachon mediaUrl beradi) */
export async function getMediaUrl(post) {
  if (post.mediaUrl) return post.mediaUrl;
  return mediaPublicUrl(post.mediaPath);
}

/** Global upload lock — Ctrl+R / F5 ni bloklash uchun */
let _uploadCount = 0;
export function isUploading() { return _uploadCount > 0; }
export function beginUpload() { _uploadCount++; }
export function endUpload() { _uploadCount = Math.max(0, _uploadCount - 1); }

/**
 * Faylni 'media' bucket'ga yuklash. Yo'l: {uid}/{folder}/{vaqt}_{nom}
 * (storage policy birinchi papka = auth.uid() bo'lishini talab qiladi)
 * @param {{ track?: boolean }} [opts] track:false — ichki chaqiruv (progress fallback)
 */
function _uploadTimeoutMs(file) {
  const mb = (file?.size || 0) / (1024 * 1024);
  return Math.min(180000, Math.max(25000, 15000 + mb * 8000));
}

function _xhrUpload(url, file, token, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('Authorization', 'Bearer ' + token);
    xhr.setRequestHeader('apikey', SUPABASE_ANON_KEY);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.setRequestHeader('cache-control', '3600');
    xhr.timeout = _uploadTimeoutMs(file);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / Math.max(1, e.total));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText || '{}')); }
        catch (_) { resolve({}); }
      } else {
        reject(new Error('Yuklash xatosi ' + xhr.status));
      }
    };
    xhr.onerror = () => reject(new Error('Tarmoq xatosi'));
    xhr.ontimeout = () => reject(new Error('Yuklash vaqti tugadi'));
    xhr.send(file);
  });
}

export async function uploadViaController(file, folder = 'posts', opts = {}) {
  const track = opts.track !== false;
  if (track) beginUpload();
  try {
    if (!state.me) throw new Error('Tizimga kirilmagan');
    assertAllowedUpload(file, folder);
    const safeName = file.name.replace(/[^\w.\-]/g, '_').replace(/_+/g, '_');
    const path = `${state.me.uid}/${folder}/${Date.now()}_${(crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2))}_${safeName}`;
    const { data: sess } = await sb.auth.getSession();
    const token = sess?.session?.access_token;
    if (!token) throw new Error('Tizimga kirilmagan');
    const url = `${SUPABASE_URL}/storage/v1/object/${MEDIA_BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`;
    const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
    let lastErr = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await _xhrUpload(url, file, token, onProgress);
        return { path, url: mediaPublicUrl(path) };
      } catch (e) {
        lastErr = e;
        if (attempt === 0) await new Promise(r => setTimeout(r, 600));
      }
    }
    console.error('Storage:', lastErr);
    throw lastErr || new Error('Yuklash amalga oshmadi');
  } finally {
    if (track) endUpload();
  }
}

export async function fetchAllRows(table, columns = '*', orderCol = 'created_at') {
  const PAGE = 1000, out = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb.from(table).select(columns)
      .order(orderCol, { ascending: false }).range(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

/** 'media' bucket'dagi {uid}/... fayllarini o'chiradi (best-effort; egasi yoki admin) */
export async function purgeUserMedia(uid) {
  if (!uid) return;
  const bucket = sb.storage.from(MEDIA_BUCKET);
  const walk = async (prefix, depth) => {
    const out = [];
    const { data } = await bucket.list(prefix, { limit: 1000 });
    for (const it of data || []) {
      const path = `${prefix}/${it.name}`;
      if (it.id) out.push(path);                                    // fayl
      else if (depth < 3) out.push(...await walk(path, depth + 1)); // papka
    }
    return out;
  };
  try {
    const files = await walk(uid, 0);
    for (let i = 0; i < files.length; i += 100) await bucket.remove(files.slice(i, i + 100));
  } catch (e) {
    console.warn('[Media] Tozalanmadi:', e?.message);
  }
}

// Constants
// Yuklash limiti: 49.9 MB (Supabase Free storage chegarasi 50 MB dan oshmasin)
export const MAX_FILE = Math.floor(49.9 * 1024 * 1024);
export const CAP_LIMIT = 280; // X kabi: 280 belgigacha to'liq ko'rinadi

/** Joriy foydalanuvchi admin (profiles.is_admin) */
export function isAdmin() {
  return !!(state.me && state.me.isAdmin);
}

// State
export const state = {
  me: null, allPosts: [], tab: 'all', search: '', view: 'home',
  selFile: null, _objUrl: null, visibleN: 10, loadingMore: false,
  reelObs: null, viewedSet: new Set(),
  myLikedPosts: new Set(), _knownUnliked: new Set(), cmtPostId: null,
  mySavedPosts: new Set(), _savedFor: null,
  pendingReelId: null, pendingReelTime: 0, _lastPostIds: '',
  currentChatUid: null, currentChatId: null,
  currentViewingUserId: null,
  currentViewingUserPosts: [], viewObserver: null,
  _userCache: {},         // uid -> { fullName, avatar, ... }
  _likeStatusCache: {},   // postId -> boolean (liked/unliked)
};

/** Parolni tekshirish — asosiy sessiyaga tegmaydi (bitta vaqtinchalik client) */
let _verifyClient = null;
function _getVerifyClient() {
  if (!_verifyClient) {
    _verifyClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'spacemr-verify' },
    });
  }
  return _verifyClient;
}
export async function verifyPassword(email, password) {
  const tmp = _getVerifyClient();
  const { error } = await tmp.auth.signInWithPassword({ email, password });
  if (error) {
    const e = new Error(error.message);
    e.code = /invalid login credentials/i.test(error.message) ? 'wrong-password' : (error.code || 'auth-error');
    throw e;
  }
  await tmp.auth.signOut({ scope: 'local' }).catch(() => {});
  return true;
}

/** chats qatori (+ chat_members embed) → eski Firestore ko'rinishi */
export function mapChat(r) {
  if (!r) return null;
  const unread = {};
  (r.chat_members || []).forEach(m => {
    unread[m.user_id] = m.unread_count || 0;
  });
  return {
    id: r.id,
    participants: [r.user_a, r.user_b],
    lastMessage: r.last_message || '',
    lastSenderId: r.last_sender_id || null,
    lastMessageAt: ts(r.last_message_at),
    unreadCount: unread,
    createdAt: ts(r.created_at),
  };
}

/** messages qatori → eski Firestore ko'rinishi */
export function mapMessage(r) {
  if (!r) return null;
  return {
    id: r.id,
    chatId: r.chat_id || r.group_id || null,
    groupId: r.group_id || null,
    seq: r.seq == null ? null : Number(r.seq),
    senderId: r.sender_id,
    type: r.type,
    text: r.text || '',
    mediaPath: r.media_path,
    mediaUrl: mediaPublicUrl(r.media_path) || '',
    mediaType: r.media_type,
    fileName: r.file_name,
    fileSize: r.file_size,
    duration: (r.duration == null ? null : Number(r.duration)) || null,
    waveform: Array.isArray(r.waveform) && r.waveform.length ? r.waveform : null,
    status: r.status,
    readAt: ts(r.read_at),
    editedAt: ts(r.edited_at),
    createdAt: ts(r.created_at),
    replyTo: r.reply_to || null,
  };
}

/** groups qatori (+ group_members embed) → eski Firestore ko'rinishi */
export function mapGroup(r) {
  if (!r) return null;
  const members = [], adminIds = [], unread = {};
  (r.group_members || []).forEach(m => {
    members.push(m.user_id);
    unread[m.user_id] = m.unread_count || 0;
    if (m.role === 'owner' || m.role === 'admin') adminIds.push(m.user_id);
  });
  return {
    id: r.id,
    type: r.type,
    name: r.name,
    avatar: r.avatar || '',
    description: r.description || '',
    ownerId: r.owner_id,
    adminIds,
    members,
    isPrivate: r.is_private === true,
    inviteCode: r.invite_code || null,
    username: r.username || '',
    msgPermission: r.msg_permission || 'all',
    lastMessage: r.last_message || '',
    lastSenderId: r.last_sender_id || null,
    lastMessageAt: ts(r.last_message_at),
    unreadCount: unread,
    subscriberCount: members.length,
    createdAt: ts(r.created_at),
  };
}
