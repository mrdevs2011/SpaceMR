// Supabase Edge Function: yangi xabar / guruh xabari / qo'ng'iroq → Web Push
// Database Webhook (INSERT) shu funksiyani chaqiradi. Sozlash: README.md
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

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

const ok = (b = "ok") => new Response(b, { status: 200 });

/** bo'sh joylarni yig'ib, uzun matnni "…" bilan qisqartiradi */
function clip(s: string, n = 110): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t;
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

/** Bildirishnoma matni: xom JSON hech qachon ko'rinmaydi */
function preview(r: any): string {
  if (r.type === "voice") return "🎤 Ovozli xabar";
  if (r.type === "file") return `📎 ${clip(String(r.file_name || "Fayl"), 60)}`;
  const share = parseShare(r.text);
  if (share) {
    const c = String(share.comment ?? "").trim();
    return c ? `📌 ${clip(c)}` : `📌 Post: ${share.post?.authorName || "ulashilgan post"}`;
  }
  const t = String(r.text ?? "");
  // Qo'ng'iroq yozuvi ({"__callLog":true,"s":"ok"|"no"}) — chaqiruvchi yuboradi, qabul qiluvchiga: kiruvchi / o'tkazib yuborilgan
  if (t.includes('"__callLog"')) {
    try { return JSON.parse(t).s === "ok" ? "📞 Qo'ng'iroq" : "📞 O'tkazib yuborilgan qo'ng'iroq"; } catch { /* pastga */ }
  }
  // Kutilmagan xom JSON (boshqa maxsus xabar) — chiroyli umumiy matn
  if (t.trim().startsWith('{"__')) return "💬 Yangi xabar";
  return clip(t);
}

/** Ulashilgan postda rasm bo'lsa — bildirishnomada ko'rsatiladi (faqat https) */
function shareImage(r: any): string | undefined {
  const u = parseShare(r.text)?.post?.mediaUrl;
  return typeof u === "string" && u.startsWith("https://") ? u : undefined;
}

Deno.serve(async (req) => {
  if (req.headers.get("x-webhook-secret") !== Deno.env.get("PUSH_WEBHOOK_SECRET")) {
    return new Response("forbidden", { status: 403 });
  }

  let body: any;
  try { body = await req.json(); } catch { return ok("bad json"); }
  const { type, table, record: r } = body ?? {};
  if (type !== "INSERT" || !r) return ok("skip");

  let recipients: string[] = [];
  let payload: Record<string, unknown> = {};
  let ttl = 3600;
  let urgency: "high" | "normal" = "normal";

  const { data: sender } = await sb.from("profiles")
    .select("full_name, avatar").eq("id", r.sender_id ?? r.caller_id).maybeSingle();
  const senderName = sender?.full_name || "SpaceMR";
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
    payload = { type: "message", title: senderName, body: preview(r), icon: senderIcon, image: shareImage(r), chatId: r.chat_id, fromUid: r.sender_id };
  } else if (table === "group_messages") {
    const { data: g } = await sb.from("groups").select("name, type, avatar").eq("id", r.group_id).maybeSingle();
    const { data } = await sb.from("group_members").select("user_id")
      .eq("group_id", r.group_id).neq("user_id", r.sender_id);
    recipients = (data ?? []).map((m) => m.user_id);
    const isChannel = g?.type === "channel";
    payload = {
      type: "group",
      title: g?.name || "Guruh",
      body: isChannel ? preview(r) : `${senderName}: ${preview(r)}`,
      icon: iconOf(g?.avatar) ?? senderIcon,
      image: shareImage(r),
      groupId: r.group_id,
      fromUid: r.sender_id,
    };
  } else if (table === "calls") {
    if (r.status !== "ringing") return ok("skip");
    recipients = [r.callee_id];
    payload = { type: "call", title: senderName, body: "📞 Qo'ng'iroq qilmoqda...", icon: senderIcon, fromUid: r.caller_id, callId: r.id };
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
