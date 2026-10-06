/**
 * Toast bildirishnomalari o'chirilgan: ilovada hech qanday ichki toast ko'rsatilmaydi.
 * `toast()` API'si saqlangan (200+ chaqiruv buzilmasin), lekin hech narsa chizmaydi.
 * Xatolar yo'qolib ketmasligi uchun faqat brauzer konsoliga yoziladi.
 */

/**
 * @param {string} msg
 * @param {'success'|'error'|'info'|''} [type]
 * @param {number} [dur]
 */
export function toast(msg, type = '', dur = 2200) { // eslint-disable-line no-unused-vars
  if (type === 'error') console.warn('[toast]', msg);
}
