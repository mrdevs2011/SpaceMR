/**
 * chat-storage.js — chat pins / recent searches / localStorage yordamchilari
 * chat.js dan ajratilgan (sifat: monolitni yengillashtirish).
 */
import { state } from '../core/config.js';
import { safeStorage } from '../core/utils.js';

export function getPins() {
  if (!state.me?.uid) return { dms: [], groups: [] };
  const p = safeStorage.getJSON(`chat_pins_${state.me.uid}`);
  if (!p) return { dms: [], groups: [] };
  return {
    dms: Array.isArray(p.dms) ? p.dms : [],
    groups: Array.isArray(p.groups) ? p.groups : [],
  };
}

export function isPinned(type, id) {
  const pins = getPins();
  return type === 'dm' ? pins.dms.includes(id) : pins.groups.includes(id);
}

export function togglePin(type, id) {
  const pins = getPins();
  const list = type === 'dm' ? pins.dms : pins.groups;
  const idx = list.indexOf(id);
  let isNowPinned = false;
  if (idx >= 0) {
    list.splice(idx, 1);
    isNowPinned = false;
  } else {
    list.unshift(id);
    isNowPinned = true;
  }
  if (type === 'dm') pins.dms = list;
  else pins.groups = list;
  safeStorage.set(`chat_pins_${state.me.uid}`, pins);
  return isNowPinned;
}

export function getRecents() {
  if (!state.me?.uid) return [];
  const list = safeStorage.getJSON(`chat_recent_searches_${state.me.uid}`);
  return Array.isArray(list) ? list : [];
}

export function saveRecent(item) {
  if (!state.me?.uid || !item || !item.id) return;
  const list = getRecents().filter(x => x.id !== item.id);
  list.unshift(item);
  safeStorage.set(`chat_recent_searches_${state.me.uid}`, list.slice(0, 10));
}

export function removeRecent(id) {
  if (!state.me?.uid) return;
  const list = getRecents().filter(x => x.id !== id);
  safeStorage.set(`chat_recent_searches_${state.me.uid}`, list);
}

export function clearAllRecents() {
  if (!state.me?.uid) return;
  safeStorage.remove(`chat_recent_searches_${state.me.uid}`);
}

export function markChatDeletedLocal(uid) {
  if (!state.me?.uid || !uid) return;
  safeStorage.set(`deleted_chat_${state.me.uid}_${uid}`, String(Date.now()));
}

export function clearChatDeletedLocal(uid) {
  if (!state.me?.uid || !uid) return;
  safeStorage.remove(`deleted_chat_${state.me.uid}_${uid}`);
}

export function getChatDeletedAt(uid) {
  const raw = safeStorage.get(`deleted_chat_${state.me?.uid}_${uid}`);
  if (!raw) return null;
  return Number(raw) || null;
}
