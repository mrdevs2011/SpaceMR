/* ── rt-chat.js — tezkor yo'l: WebRTC DataChannel (peer-to-peer) ─────────
 * Xabar yuborilganda DB'ni (postgres_changes + qayta yuklash) kutmaymiz:
 *   1) WebRTC DataChannel (peer-to-peer, server aylanmaydi) — asosiy yo'l
 *   2) DataChannel hali ulanmagan peer'lar uchun — Supabase Realtime broadcast (WebSocket)
 * Baza (messages / group_messages) baribir haqiqat manbai: bu modul faqat
 * "ko'rsatish"ni tezlashtiradi. Dedup: xabar ID'si klientda yaratiladi.
 *
 *  - openRt(chatId, peerUid, h)         — DM (1 peer)
 *  - openRtGroup(groupId, uids, h)      — guruh: to'liq mesh (<= MAX_MESH a'zo), kattaroq guruhda faqat broadcast
 * Xabar turlari: m (matn), r (o'qildi), x (qaytarib olish), y (yozmoqda).
 * Signalizatsiya: `rt-<chatId>` / `rtg-<groupId>` broadcast kanali.
 */
import { sb, state } from '../core/config.js';

import { TURN_URLS, TURN_USERNAME, TURN_CREDENTIAL } from '../core/env.js';

const STUN = [{ urls: 'stun:stun.l.google.com:19302' }];
let _ice = { iceServers: STUN };
let _iceAt = 0;
let _icePromise = null;
const MAX_MESH = 12;

const _turnList = (TURN_URLS || '').split(',').map(x => x.trim()).filter(Boolean);
if (_turnList.length) {
  _ice.iceServers.push({ urls: _turnList, username: TURN_USERNAME, credential: TURN_CREDENTIAL });
}

function ensureIce() {
  if (Date.now() - _iceAt < 6 * 3600e3) return Promise.resolve(_ice);
  if (_icePromise) return _icePromise;
  _icePromise = (async () => {
    try {
      if (location.hostname === '127.0.0.1' || location.hostname === 'localhost') {
        _icePromise = null;
        return _ice;
      }
      const { data: { session } } = await sb.auth.getSession();
      const token = session?.access_token;
      if (token) {
        const r = await fetch('/api/turn', { headers: { Authorization: 'Bearer ' + token } });
        if (r.ok) {
          const j = await r.json();
          if (Array.isArray(j.iceServers) && j.iceServers.length) {
            _ice = { iceServers: [...STUN, ...j.iceServers] };
            _iceAt = Date.now();
          }
        }
      }
    } catch (_) { /* STUN bilan davom etamiz */ }
    _icePromise = null;
    return _ice;
  })();
  return _icePromise;
}

const _rid = () => Math.random().toString(36).slice(2, 10);
const MAX_TEXT = 4000;

/**
 * @typedef {{onMsg?:(m:{id:string,text:string,from:string})=>void, onRead?:(ids:string[],from:string)=>void,
 *            onRetract?:(id:string,from:string)=>void, onTyping?:(typing:boolean,from:string)=>void}} RtHandlers
 */

function createMesh(chName, peerUids, h = {}, groupMode = false) {
  const me = state.me?.uid;
  const peers = [...new Set(peerUids || [])].filter(u => u && u !== me);
  if (!me || !peers.length || !chName || typeof RTCPeerConnection === 'undefined') return null;
  const p2pOk = peers.length <= MAX_MESH;
  const single = peers.length === 1 && !groupMode;

  const sid = _rid();               // shu sahifa nusxasining sessiya belgisi
  let dead = false, ready = false;
  /** uid → holat. initiator: ikkala tomon bir xil qoida (uid kichigi) bilan hal qiladi */
  const P = new Map(peers.map(u => [u, {
    uid: u, init: me < u, pc: null, dc: null, peerSid: null,
    pend: [], retries: 0, failT: null, retryT: null,
  }]));

  const ch = sb.channel(chName, { config: { broadcast: { self: false } } });

  const sig = (kind, data, to) => {
    if (!ready || dead) return;
    ch.send({ type: 'broadcast', event: 'sig', payload: { from: me, to, sid, kind, data } });
  };

  /* ── kelgan xabarni qayta ishlash (DC ham, broadcast ham shu yerga keladi) ── */
  const handle = (o) => {
    if (!o || !P.has(o.from)) return;
    if (Array.isArray(o.skip) && o.skip.includes(me)) return;   // bu nusxa bizga DC orqali ham yetgan
    if (o.t === 'm') {
      if (typeof o.id === 'string' && o.id.length <= 64) {
        const type = (typeof o.type === 'string' && o.type) ? o.type : 'text';
        const msg = { id: o.id, from: o.from, type };
        if (typeof o.text === 'string') msg.text = o.text.slice(0, MAX_TEXT);
        if (typeof o.mediaPath === 'string') msg.mediaPath = o.mediaPath.slice(0, 500);
        if (typeof o.mediaType === 'string') msg.mediaType = o.mediaType.slice(0, 120);
        if (typeof o.fileName === 'string') msg.fileName = o.fileName.slice(0, 240);
        if (typeof o.fileSize === 'number') msg.fileSize = o.fileSize;
        if (typeof o.duration === 'number') msg.duration = o.duration;
        // Matnli xabar uchun text majburiy; media uchun mediaPath yetarli
        if (type === 'text' && typeof msg.text !== 'string') return;
        if (type !== 'text' && !msg.mediaPath && typeof msg.text !== 'string') return;
        h.onMsg?.(msg);
      }
    } else if (o.t === 'r') {
      if (Array.isArray(o.ids)) h.onRead?.(o.ids.filter(x => typeof x === 'string').slice(0, 100), o.from);
    } else if (o.t === 'x') {
      if (typeof o.id === 'string') h.onRetract?.(o.id, o.from);
    } else if (o.t === 'y') {
      h.onTyping?.(!!o.v, o.from);
    }
  };

  const sendRaw = (obj) => {
    obj.from = me;
    const s = JSON.stringify(obj);
    let sent = 0;
    const missing = [];
    for (const p of P.values()) {
      if (p.dc && p.dc.readyState === 'open') {
        try { p.dc.send(s); sent++; continue; } catch (_) { /* zaxiraga o'tamiz */ }
      }
      missing.push(p.uid);
    }
    if (missing.length && ready && !dead) {
      const skip = peers.filter(u => !missing.includes(u));
      ch.send({ type: 'broadcast', event: 'rt', payload: skip.length ? { ...obj, skip } : obj });
      return sent ? 'mixed' : 'ws';
    }
    return sent ? 'p2p' : null;
  };

  const bindDc = (p, d) => {
    p.dc = d;
    d.onmessage = (e) => { try { handle(JSON.parse(e.data)); } catch (_) {} };
    d.onopen = () => { p.retries = 0; };
  };

  const teardown = (p) => {
    clearTimeout(p.failT);
    p.pend = [];
    try { if (p.dc) { p.dc.onmessage = p.dc.onopen = null; p.dc.close(); } } catch (_) {}
    try { if (p.pc) { p.pc.onicecandidate = p.pc.onconnectionstatechange = p.pc.ondatachannel = null; p.pc.close(); } } catch (_) {}
    p.dc = null; p.pc = null;
  };

  const scheduleRetry = (p) => {
    if (dead || p.retries >= 5) return;      // 5 urinishdan keyin broadcast zaxirasi yetarli
    p.retries++;
    clearTimeout(p.retryT);
    p.retryT = setTimeout(() => {
      if (dead) return;
      if (p.init) start(p);
      else { teardown(p); sig('hello', { force: true }, p.uid); }
    }, 800 * p.retries);
  };

  const mkPc = (p) => {
    const pc = new RTCPeerConnection(_ice);
    pc.onicecandidate = (e) => { if (e.candidate && pc === p.pc) sig('ice', e.candidate.toJSON(), p.uid); };
    pc.ondatachannel = (e) => { if (pc === p.pc) bindDc(p, e.channel); };
    pc.onconnectionstatechange = () => {
      if (pc !== p.pc || dead) return;
      const s = pc.connectionState;
      clearTimeout(p.failT);
      if (s === 'failed' || s === 'closed') { teardown(p); scheduleRetry(p); }
      else if (s === 'disconnected') {
        p.failT = setTimeout(() => { if (pc === p.pc && pc.connectionState !== 'connected') { teardown(p); scheduleRetry(p); } }, 4000);
      }
    };
    return pc;
  };

  /* ── tashabbuskor (uid kichik) tomon: offer yaratadi ── */
  const start = async (p) => {
    if (dead) return;
    teardown(p);
    await ensureIce();
    if (dead) return;
    const pc = p.pc = mkPc(p);
    bindDc(p, pc.createDataChannel('chat', { ordered: true }));
    try {
      const offer = await pc.createOffer();
      if (pc !== p.pc) return;
      await pc.setLocalDescription(offer);
      sig('offer', pc.localDescription.toJSON(), p.uid);
    } catch (e) { console.warn('[rt] offer:', e?.message || e); scheduleRetry(p); }
  };

  const flushIce = (p) => {
    const q = p.pend; p.pend = [];
    q.forEach(c => p.pc?.addIceCandidate(c).catch(() => {}));
  };

  const onOffer = async (p, desc) => {
    teardown(p);                       // sinxron — shundan keyin kelgan ICE navbatga tushadi
    await ensureIce();
    if (dead) return;
    const pc = p.pc = mkPc(p);
    try {
      await pc.setRemoteDescription(desc);
      flushIce(p);
      const ans = await pc.createAnswer();
      if (pc !== p.pc) return;
      await pc.setLocalDescription(ans);
      sig('answer', pc.localDescription.toJSON(), p.uid);
    } catch (e) { console.warn('[rt] answer:', e?.message || e); scheduleRetry(p); }
  };

  ch.on('broadcast', { event: 'sig' }, ({ payload: o }) => {
    if (dead || !o || !p2pOk) return;
    const p = P.get(o.from);
    if (!p) return;
    if (o.to && o.to !== me) return;                 // boshqa peer'ga mo'ljallangan
    if (!o.to && !single && o.kind !== 'hello') return;
    switch (o.kind) {
      case 'hello': {
        const fresh = o.sid !== p.peerSid;
        p.peerSid = o.sid;
        if (p.init) { if (fresh || o.data?.force) start(p); }
        else if (!o.data?.re) sig('hello', { re: true }, p.uid);
        break;
      }
      case 'offer':
        if (!p.init) { p.peerSid = o.sid; onOffer(p, o.data); }
        break;
      case 'answer':
        if (p.init && p.pc && p.pc.signalingState === 'have-local-offer') {
          p.pc.setRemoteDescription(o.data).then(() => flushIce(p)).catch(() => {});
        }
        break;
      case 'ice':
        if (p.pc && p.pc.remoteDescription) p.pc.addIceCandidate(o.data).catch(() => {});
        else p.pend.push(o.data);
        break;
    }
  });
  ch.on('broadcast', { event: 'rt' }, ({ payload }) => handle(payload));
  ch.subscribe((st) => {
    if (dead) return;
    ready = st === 'SUBSCRIBED';
    if (ready && p2pOk) sig('hello', {});
  });

  if (p2pOk) ensureIce();   // TURN'ni oldindan isitib qo'yamiz

  return {
    /** Matn: send(id, text) yoki to'liq media: send({ id, type, text?, mediaPath?, ... }) */
    send: (idOrObj, text) => {
      if (idOrObj && typeof idOrObj === 'object') {
        const o = idOrObj;
        if (typeof o.id !== 'string') return null;
        return sendRaw({
          t: 'm', id: o.id,
          type: o.type || 'text',
          text: typeof o.text === 'string' ? o.text : undefined,
          mediaPath: typeof o.mediaPath === 'string' ? o.mediaPath : undefined,
          mediaType: typeof o.mediaType === 'string' ? o.mediaType : undefined,
          fileName: typeof o.fileName === 'string' ? o.fileName : undefined,
          fileSize: typeof o.fileSize === 'number' ? o.fileSize : undefined,
          duration: typeof o.duration === 'number' ? o.duration : undefined,
        });
      }
      return sendRaw({ t: 'm', id: idOrObj, type: 'text', text });
    },
    sendRead: (ids) => { if (ids?.length) sendRaw({ t: 'r', ids }); },
    retract: (id) => sendRaw({ t: 'x', id }),
    sendTyping: (v) => sendRaw({ t: 'y', v: !!v }),
    /** hamma peer bilan DC ochiq (DM da: yagona peer) */
    isP2P: () => [...P.values()].every(p => p.dc && p.dc.readyState === 'open'),
    p2pCount: () => [...P.values()].filter(p => p.dc && p.dc.readyState === 'open').length,
    close: () => {
      dead = true;
      for (const p of P.values()) { clearTimeout(p.retryT); teardown(p); }
      try { sb.removeChannel(ch); } catch (_) {}
    },
  };
}

/**
 * DM uchun tezkor kanal.
 * @param {string} chatId
 * @param {string} peerUid
 * @param {RtHandlers} h
 */
export function openRt(chatId, peerUid, h = {}) {
  if (!chatId || !peerUid) return null;
  return createMesh('rt-' + chatId, [peerUid], h, false);
}

/**
 * Guruh uchun tezkor kanal (to'liq mesh).
 * @param {string} groupId
 * @param {string[]} memberUids  guruh a'zolari (o'zim ham bo'lishi mumkin — chiqarib tashlanadi)
 * @param {RtHandlers} h
 */
export function openRtGroup(groupId, memberUids, h = {}) {
  if (!groupId) return null;
  return createMesh('rtg-' + groupId, memberUids, h, true);
}
