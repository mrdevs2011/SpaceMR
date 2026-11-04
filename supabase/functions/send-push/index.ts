// Supabase Edge Function: yangi xabar / guruh xabari / qo'ng'iroq → Web Push
// Database Webhook (INSERT) shu funksiyani chaqiradi. Sozlash: README.md
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";
import { cleanPushText, emojiImageUrl } from "./emoji-text.ts";

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);
webpush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT") ?? "mailto:admin@example.com",
  Deno.env.get("VAPID_PUBLIC_KEY")!,
  Deno.env.get("VAPID_SECRET_KEY")!,
);

// Asosiy domen. Foydalanuvchida shu domendan obuna bo'lsa, eski/qo'shimcha domenlarga (mrspace, mrgram ...) yuborilmaydi —
// aks holda bitta xabar har domen uchun alohida bildirishnoma bo'lib, 3 marta keladi.
const CANON_ORIGIN = (Deno.env.get("PUSH_CANONICAL_ORIGIN") ?? "https://spacemr.vercel.app").replace(/\/$/, "");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const ok = (b = "ok") => new Response(b, { status: 200, headers: corsHeaders });
const recentSocialPush = new Map<string, number>();

/** bo'sh joylarni yig'ib, uzun matnni "…" bilan qisqartiradi */
function clip(s: string, n = 110): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t;
}

/** ||yashirin|| matn (yopilmagan bo'lsa ham) push bildirishnomada ko'rinmasin */
function maskSpoilers(s: string): string {
  return s.includes("||") ? s.replace(/\|\|[\s\S]*?(?:\|\||$)/g, "••••") : s;
}

/** Chatdagi ulashilgan post xabari ({"__postShare":true,...}) bo'lsa — obyektni qaytaradi */
function parseShare(raw: unknown): any | null {
  const t = String(raw ?? "").trim();
  if (!t.startsWith("{") || !t.includes('"__postShare"')) return null;
  try {
    const p = JSON.parse(t);
    return p && (p.__postShare === true || p.__postShare === "true") ? p : null;
  } catch { return null; }
}

/** "Uzatilgan xabar" belgisi (core/fwd.js bilan bir xil format) — bildirishnomada ko'rinmasin */
const stripFwd = (t: unknown): string => String(t ?? "").replace(/^\u2063fwd:[^\u2063]*\u2063/, "");

/** Bildirishnoma matni: xom JSON hech qachon ko'rinmaydi */
function previewRaw(r: any): string {
  r = { ...r, text: stripFwd(r.text) };
  if (r.type === "voice") return "Ovozli xabar";
  if (r.type === "file") return r.file_name ? `Fayl: ${clip(String(r.file_name), 60)}` : "Fayl";
  const share = parseShare(r.text);
  if (share) {
    const c = String(share.comment ?? "").trim();
    return c ? `Post: ${clip(maskSpoilers(c))}` : `Post: ${share.post?.authorName || "ulashilgan post"}`;
  }
  const t = String(r.text ?? "");
  // Qo'ng'iroq yozuvi ({"__callLog":true,"s":"ok"|"no"}) — chaqiruvchi yuboradi, qabul qiluvchiga: kiruvchi / o'tkazib yuborilgan
  if (t.includes('"__callLog"')) {
    try { return JSON.parse(t).s === "ok" ? "Qo'ng'iroq" : "O'tkazib yuborilgan qo'ng'iroq"; } catch { /* pastga */ }
  }
  // Kutilmagan xom JSON (boshqa maxsus xabar) — chiroyli umumiy matn
  if (t.trim().startsWith('{"__')) return "Yangi xabar";
  return clip(maskSpoilers(t));
}

/** Bildirishnoma matni: emoji (belgi va [[emoji/..png]] token) hech qachon ko'rinmaydi. Faqat emoji bo'lsa — "Emoji". */
function preview(r: any): string {
  const c = cleanPushText(previewRaw(r));
  return c.text || (c.hadEmoji ? "Emoji" : "Yangi xabar");
}

/** Sarlavha (ism / guruh nomi) dagi emoji ham olib tashlanadi */
function plain(s: unknown, fallback: string): string {
  return cleanPushText(s).text || fallback;
}

/** Xabar FAQAT emoji'dan iborat bo'lsa — birinchi emoji PNG'i bildirishnoma rasmi bo'ladi */
function emojiImage(r: any): string | undefined {
  r = { ...r, text: stripFwd(r.text) };
  if (r.type === "voice" || r.type === "file") return undefined;
  const t = String(r.text ?? "");
  if (t.trim().startsWith("{")) return undefined;
  const c = cleanPushText(t);
  return !c.text && c.hadEmoji ? emojiImageUrl(CANON_ORIGIN, c.key) : undefined;
}

/** Ulashilgan postda rasm bo'lsa — bildirishnomada ko'rsatiladi (faqat https) */
function shareImage(r: any): string | undefined {
  const u = parseShare(r.text)?.post?.mediaUrl;
  return typeof u === "string" && u.startsWith("https://") ? u : undefined;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("method not allowed", { status: 405, headers: corsHeaders });

  const isWebhook = req.headers.get("x-webhook-secret") === Deno.env.get("PUSH_WEBHOOK_SECRET");
  let body: any;
  try { body = await req.json(); } catch { return ok("bad json"); }

  // Social push: ilova muvaffaqiyatli like/comment yozilgach JWT bilan chaqiradi.
  // Actor va event serverda qayta tekshiriladi; client recipient yoki matnni belgilay olmaydi.
  if (body?.kind === "social") {
    const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!bearer || isWebhook) return new Response("unauthorized", { status: 401, headers: corsHeaders });
    const { data: authData, error: authError } = await sb.auth.getUser(bearer);
    const actorId = authData?.user?.id;
    if (authError || !actorId) return new Response("unauthorized", { status: 401, headers: corsHeaders });

    const event = body.event;
    const postId = String(body.postId || "");
    if (!postId || !["like", "comment"].includes(event)) return ok("invalid social event");
    const { data: post } = await sb.from("posts").select("id, user_id, media_path, media_type").eq("id", postId).maybeSingle();
    if (!post || post.user_id === actorId) return ok("no recipient");

    let commentText = "";
    let eventKey = "";
    if (event === "like") {
      const { data: like } = await sb.from("post_likes").select("post_id, created_at").eq("post_id", postId).eq("user_id", actorId).maybeSingle();
      if (!like) return ok("like not found");
      eventKey = `like:${postId}:${actorId}:${like.created_at || ""}`;
    } else {
      const commentId = String(body.commentId || "");
      const { data: comment } = await sb.from("comments").select("id, text").eq("id", commentId).eq("post_id", postId).eq("user_id", actorId).maybeSingle();
      if (!comment) return ok("comment not found");
      eventKey = `comment:${commentId}`;
      commentText = clip(maskSpoilers(String(comment.text || "")), 90);
    }
    const now = Date.now();
    for (const [key, at] of recentSocialPush) if (now - at > 10 * 60_000) recentSocialPush.delete(key);
    if (recentSocialPush.has(eventKey)) return ok("duplicate social event");
    recentSocialPush.set(eventKey, now);

    const { data: actor } = await sb.from("profiles").select("full_name, avatar").eq("id", actorId).maybeSingle();
    const actorName = plain(actor?.full_name, "SpaceMR");
    const { data: subscriptions } = await sb.from("push_tokens").select("token, user_id, origin").eq("user_id", post.user_id);
    const canon = (subscriptions || []).some(t => t.origin === CANON_ORIGIN);
    const rows = (subscriptions || []).filter(t => !canon || t.origin === CANON_ORIGIN);
    const image = post.media_path && String(post.media_type || "").startsWith("image/")
      ? sb.storage.from("media").getPublicUrl(post.media_path).data?.publicUrl : undefined;
    const payload = JSON.stringify({
      type: "social", title: actorName,
      body: event === "like" ? "Postingizga yoqdi" : `Izoh: ${commentText || "Yangi izoh"}`,
      icon: typeof actor?.avatar === "string" && actor.avatar.startsWith("https://") ? actor.avatar : undefined,
      image: typeof image === "string" && image.startsWith("https://") ? image : undefined,
      fromUid: actorId, postId, commentId: event === "comment" ? String(body.commentId) : undefined,
    });
    const dead: string[] = [];
    await Promise.all(rows.map(async ({ token }) => {
      try { await webpush.sendNotification(JSON.parse(token), payload, { TTL: 3600, urgency: "normal" }); }
      catch (e: any) { if (e?.statusCode === 404 || e?.statusCode === 410) dead.push(token); else console.error("[send-push social]", e?.statusCode, e?.body ?? e?.message); }
    }));
    if (dead.length) await sb.from("push_tokens").delete().in("token", dead);
    return ok(`social sent ${rows.length - dead.length}`);
  }

  if (!isWebhook) return new Response("forbidden", { status: 403, headers: corsHeaders });
  const { type, table, record: r } = body ?? {};
  if (type !== "INSERT" || !r) return ok("skip");

  let recipients: string[] = [];
  let payload: Record<string, unknown> = {};
  let ttl = 3600;
  let urgency: "high" | "normal" = "normal";

  const { data: sender } = await sb.from("profiles")
    .select("full_name, avatar").eq("id", r.sender_id ?? r.caller_id).maybeSingle();
  const senderName = plain(sender?.full_name, "SpaceMR");
  const iconOf = (u: unknown) => (typeof u === "string" && u.startsWith("https://") ? u : undefined);
  const senderIcon = iconOf(sender?.avatar);

  // Qo'ng'iroq yozuvi ({"__callLog":...}) — alohida bildirishnoma kerak emas (qo'ng'iroqning o'zi allaqachon bildirilgan)
  if ((table === "messages" || table === "group_messages") && String(r.text ?? "").includes('"__callLog"')) {
    return ok("skip call log");
  }

  if (table === "messages") {
    const { data } = await sb.from("chat_members").select("user_id")
      .eq("chat_id", r.chat_id).neq("user_id", r.sender_id);
    recipients = (data ?? []).map((m) => m.user_id);
    payload = { type: "message", title: senderName, body: preview(r), icon: senderIcon, image: shareImage(r) ?? emojiImage(r), chatId: r.chat_id, fromUid: r.sender_id };
  } else if (table === "group_messages") {
    const { data: g } = await sb.from("groups").select("name, type, avatar").eq("id", r.group_id).maybeSingle();
    const { data } = await sb.from("group_members").select("user_id")
      .eq("group_id", r.group_id).neq("user_id", r.sender_id);
    recipients = (data ?? []).map((m) => m.user_id);
    const isChannel = g?.type === "channel";
    payload = {
      type: "group",
      title: plain(g?.name, "Guruh"),
      body: isChannel ? preview(r) : `${senderName}: ${preview(r)}`,
      icon: iconOf(g?.avatar) ?? senderIcon,
      image: shareImage(r) ?? emojiImage(r),
      groupId: r.group_id,
      fromUid: r.sender_id,
    };
  } else if (table === "calls") {
    if (r.status !== "ringing") return ok("skip");
    recipients = [r.callee_id];
    payload = { type: "call", title: senderName, body: "Qo'ng'iroq qilmoqda...", icon: senderIcon, fromUid: r.caller_id, callId: r.id };
    ttl = 30; urgency = "high";
  } else {
    return ok("skip");
  }

  if (!recipients.length) return ok("no recipients");

  const { data: all } = await sb.from("push_tokens").select("token, user_id, origin").in("user_id", recipients);
  const canonUsers = new Set((all ?? []).filter((t) => t.origin === CANON_ORIGIN).map((t) => t.user_id));
  const rows = (all ?? []).filter((t) => !canonUsers.has(t.user_id) || t.origin === CANON_ORIGIN);
  const msg = JSON.stringify(payload);
  const dead: string[] = [];

  await Promise.all((rows ?? []).map(async ({ token }) => {
    try {
      await webpush.sendNotification(JSON.parse(token), msg, { TTL: ttl, urgency });
    } catch (e: any) {
      // 404/410 — obuna o'lgan, jadvaldan olib tashlaymiz
      if (e?.statusCode === 404 || e?.statusCode === 410) dead.push(token);
      else console.error("[send-push]", e?.statusCode, e?.body ?? e?.message);
    }
  }));

  if (dead.length) await sb.from("push_tokens").delete().in("token", dead);
  return ok(`sent ${(rows?.length ?? 0) - dead.length}`);
});
