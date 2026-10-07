// Push matni uchun emoji yordamchilari.
// Bildirishnoma matnini telefon/brauzer tizimi chizadi — u PNG ko'rsata olmaydi. Shuning uchun matndagi emoji
// (belgi ham, "[[emoji/2d/<kalit>.png]]" token ham) olib tashlanadi; faqat emoji'dan iborat xabarda birinchi emoji
// bildirishnoma RASMI (image) sifatida PNG bo'lib ko'rsatiladi. Mantiq sw.js dagi stripPushEmoji() bilan bir xil.

const SEQ =
  "(?![\\u00A9\\u00AE\\u2122](?!\\uFE0F))" +
  "(?:\\p{Extended_Pictographic}|\\p{Regional_Indicator}{2}|[#*0-9]\\uFE0F?\\u20E3)" +
  "(?:\\uFE0F|\\u200D\\p{Extended_Pictographic}|[\\u{1F3FB}-\\u{1F3FF}])*";
const ANY_RE = new RegExp(
  "\\[\\[emoji/2d/([0-9a-f]{2,6}(?:-[0-9a-f]{2,6})*)\\.png\\]\\]|(" + SEQ + ")",
  "gu",
);
const STRAY_RE = /[\uFE0F\u200D\u20E3\u{1F3FB}-\u{1F3FF}]/gu;

/** Emoji belgisi -> kalit (kodpointlar kichik harf hex, '-' bilan, FE0F tashlangan). Klientdagi emojiKey() bilan bir xil. */
export function emojiKeyOf(glyph: string): string {
  const out: string[] = [];
  for (const ch of glyph) {
    const h = ch.codePointAt(0)!.toString(16);
    if (h !== "fe0f") out.push(h);
  }
  return out.join("-");
}

/** Matndan barcha emoji (belgi va tokenlar) ni olib tashlaydi. key — birinchi emoji kaliti ('' bo'lsa emoji yo'q). */
export function cleanPushText(raw: unknown): { text: string; key: string; hadEmoji: boolean } {
  let key = "";
  const s = String(raw ?? "").replace(ANY_RE, (_m, tokKey: string | undefined, glyph: string | undefined) => {
    if (!key) key = tokKey || emojiKeyOf(glyph || "");
    return " ";
  });
  const text = s.replace(STRAY_RE, "").replace(/\s+/g, " ").trim();
  return { text, key, hadEmoji: key !== "" };
}

/** Emoji PNG'ining to'liq manzili (bildirishnoma rasmi uchun). Kalit tekshiriladi. */
export function emojiImageUrl(origin: string, key: string): string | undefined {
  return /^[0-9a-f]{2,6}(?:-[0-9a-f]{2,6})*$/.test(key) ? `${origin}/emoji/2d/${key}.png` : undefined;
}
