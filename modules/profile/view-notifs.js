/**
 * Bildirishnomalar sahifasi (/notifications) — router controlleri.
 * Ro'yxat mantiqi modules/ui/notifs.js da; bu yerda faqat sahifa ochilganda yuklaymiz.
 */
import { loadNotifs } from '../ui/notifs.js';

export function initView() {
  loadNotifs();
}
