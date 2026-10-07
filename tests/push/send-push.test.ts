// send-push (Edge Function) emoji sinovi — haqiqiy index.ts, soxta supabase/web-push bilan.
// Ishlatish: deno run --allow-env --allow-read --import-map=tests/push/import-map.json tests/push/send-push.test.ts
import { sent } from "./stub-webpush.ts";
import { cleanPushText } from "../../supabase/functions/send-push/emoji-text.ts";

for (const [k, v] of Object.entries({
  SUPABASE_URL: "http://x", SUPABASE_SERVICE_ROLE_KEY: "k", VAPID_PUBLIC_KEY: "p", VAPID_SECRET_KEY: "s",
  PUSH_WEBHOOK_SECRET: "sec", PUSH_CANONICAL_ORIGIN: "https://spacemr.vercel.app",
})) Deno.env.set(k, v);

let handler: (r: Request) => Promise<Response> = async () => new Response("");
(Deno as any).serve = (h: any) => { handler = h; };
await import("../../supabase/functions/send-push/index.ts");

const FIRE = String.fromCodePoint(0x1f525), LAUGH = String.fromCodePoint(0x1f602), HEART = "\u2764\uFE0F";
const FAMILY = "\u{1F468}\u200D\u{1F469}\u200D\u{1F467}", THUMB = "\u{1F44D}\u{1F3FD}", FLAG = "\u{1F1FA}\u{1F1FF}", KEY = "1\uFE0F\u20E3";
const EMO_ANY = /\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20E3|\uFE0F|\u200D|\[\[|\]\]|emoji\/2d/u;

(globalThis as any).__DB = {
  profiles: [{ id: "u1", full_name: `Ali ${FIRE}`, avatar: "https://x/a.png" }],
  chat_members: [{ chat_id: "c1", user_id: "u1" }, { chat_id: "c1", user_id: "u2" }],
  groups: [{ id: "g1", name: `Oila ${HEART}`, type: "group", avatar: null }],
  group_members: [{ group_id: "g1", user_id: "u1" }, { group_id: "g1", user_id: "u2" }],
  push_tokens: [{ token: '{"e":1}', user_id: "u2", origin: "https://spacemr.vercel.app" }],
};

async function push(table: string, record: any) {
  sent.length = 0;
  const res = await handler(new Request("http://f", { method: "POST", headers: { "x-webhook-secret": "sec" }, body: JSON.stringify({ type: "INSERT", table, record }) }));
  if (res.status !== 200) throw new Error("status " + res.status);
  return sent[0]?.payload;
}
let fails = 0, n = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  n++; if (got !== want) { fails++; console.error(`FAIL ${name}\n   got:  ${JSON.stringify(got)}\n   want: ${JSON.stringify(want)}`); }
};
const noEmoji = (name: string, p: any) => {
  n++; const bad = [p?.title, p?.body].find((s) => EMO_ANY.test(String(s ?? "")));
  if (bad !== undefined) { fails++; console.error(`FAIL ${name}: emoji qolgan -> ${JSON.stringify(bad)}`); }
};
const dm = (text: string, extra: any = {}) => push("messages", { chat_id: "c1", sender_id: "u1", type: "text", text, ...extra });

let p = await dm(`Salom ${LAUGH} qalaysan [[emoji/2d/1f525.png]]!`);
eq("dm aralash", p.body, "Salom qalaysan !"); noEmoji("dm aralash", p); eq("dm sarlavha", p.title, "Ali"); eq("dm aralash image yo'q", p.image, undefined);

p = await dm(FIRE);
eq("faqat belgi", p.body, "Emoji"); eq("faqat belgi image", p.image, "https://spacemr.vercel.app/emoji/2d/1f525.png");
p = await dm("[[emoji/2d/2764-200d-1f525.png]][[emoji/2d/1f525.png]]");
eq("faqat token", p.body, "Emoji"); eq("faqat token image", p.image, "https://spacemr.vercel.app/emoji/2d/2764-200d-1f525.png");
p = await dm(HEART); eq("yurak (FE0F tashlanadi)", p.image, "https://spacemr.vercel.app/emoji/2d/2764.png");
p = await dm(FAMILY); eq("ZWJ oila", p.image, "https://spacemr.vercel.app/emoji/2d/1f468-200d-1f469-200d-1f467.png");
p = await dm(THUMB); eq("teri tusi", p.image, "https://spacemr.vercel.app/emoji/2d/1f44d-1f3fd.png");
p = await dm(FLAG); eq("bayroq", p.image, "https://spacemr.vercel.app/emoji/2d/1f1fa-1f1ff.png");
p = await dm(KEY); eq("keycap", p.image, "https://spacemr.vercel.app/emoji/2d/31-20e3.png");
p = await dm(`${FAMILY} ${THUMB} ${FLAG} ${KEY} matn`); eq("murakkab aralash", p.body, "matn"); noEmoji("murakkab aralash", p);
p = await dm("© 2026 SpaceMR® ™ 123 #1"); eq("oddiy belgilar saqlanadi", p.body, "© 2026 SpaceMR® ™ 123 #1");
p = await dm("   "); eq("bo'sh matn", p.body, "Yangi xabar");
p = await dm('{"__callLog":true,"s":"ok"}'); eq("callLog push yo'q", p, undefined);

p = await dm("", { type: "voice" }); eq("ovozli", p.body, "Ovozli xabar"); eq("ovozli image yo'q", p.image, undefined);
p = await dm("", { type: "file", file_name: `hisobot ${FIRE}.pdf` }); eq("fayl", p.body, "Fayl: hisobot .pdf"); noEmoji("fayl", p);
p = await dm("", { type: "file" }); eq("fayl nomsiz", p.body, "Fayl");
p = await dm(JSON.stringify({ __postShare: true, comment: `zo'r post ${LAUGH}`, post: { mediaUrl: "https://m/x.jpg", authorName: "Vali" } }));
eq("post ulashish", p.body, "Post: zo'r post"); eq("post rasmi ustun", p.image, "https://m/x.jpg"); noEmoji("post", p);
p = await dm(JSON.stringify({ __postShare: true, comment: "", post: { authorName: `Vali ${FIRE}` } })); eq("post izohsiz", p.body, "Post: Vali");
p = await dm('{"__gif":1}'); eq("xom json", p.body, "Yangi xabar");

p = await push("group_messages", { group_id: "g1", sender_id: "u1", type: "text", text: `${LAUGH} salom ${FIRE}` });
eq("guruh sarlavha", p.title, "Oila"); eq("guruh body", p.body, "Ali: salom"); noEmoji("guruh", p);
p = await push("group_messages", { group_id: "g1", sender_id: "u1", type: "text", text: LAUGH });
eq("guruh emoji-only", p.body, "Ali: Emoji"); eq("guruh emoji image", p.image, "https://spacemr.vercel.app/emoji/2d/1f602.png");
p = await push("calls", { id: "k1", status: "ringing", caller_id: "u1", callee_id: "u2" });
eq("qo'ng'iroq", p.body, "Qo'ng'iroq qilmoqda..."); noEmoji("qo'ng'iroq", p); eq("qo'ng'iroq sarlavha", p.title, "Ali");

eq("cleanPushText stray", cleanPushText("a\uFE0F\u200Db").text, "ab");
eq("xavfli kalit rad", cleanPushText("[[emoji/2d/../x.png]]").hadEmoji, false);

console.log(`${n - fails}/${n} OK`);
Deno.exit(fails ? 1 : 0);
