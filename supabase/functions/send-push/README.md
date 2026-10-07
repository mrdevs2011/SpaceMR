# send-push (Web Push yuboruvchi)

Yangi xabar (`messages`), guruh xabari (`group_messages`) va qo'ng'iroq (`calls`) INSERT bo'lganda
obunachilarga push yuboradi. Client tomoni: `modules/push.js` + `sw.js`.

## Sozlash (bir marta)
1. SQL Editor'da `supabase/patch-push.sql` ni ishga tushiring.
2. VAPID kalitlar (`../mrtube-secrets/vapid.env` da, repo'dan tashqarida). Ochiq kalit `modules/push.js` da turibdi.
   Secret'larni qo'ying:
   ```
   supabase secrets set VAPID_PUBLIC_KEY=... VAPID_SECRET_KEY=... VAPID_SUBJECT=mailto:sizning@emailingiz PUSH_WEBHOOK_SECRET=<tasodifiy uzun matn>
   ```
   (`SUPABASE_URL` va `SUPABASE_SERVICE_ROLE_KEY` avtomatik beriladi.)
3. Deploy: `supabase functions deploy send-push --no-verify-jwt`
4. Dashboard → Database → Webhooks: 3 ta webhook (Event: **Insert**, Type: HTTP Request, Method: POST)
   - jadvallar: `messages`, `group_messages`, `calls`
   - URL: `https://<PROJECT>.supabase.co/functions/v1/send-push`
   - Header: `x-webhook-secret: <PUSH_WEBHOOK_SECRET qiymati>`

## Emoji (2026-10-07)
Bildirishnoma matnini tizim chizadi va u PNG ko'rsata olmaydi, shuning uchun push'da emoji ko'rsatilmaydi:
matn va sarlavhadan emoji (belgi ham, `[[emoji/2d/<kalit>.png]]` token ham) olib tashlanadi; xizmat yozuvlari
("Ovozli xabar", "Fayl: ...", "Post: ...") belgisiz. Xabar FAQAT emoji bo'lsa — matn "Emoji", birinchi emoji PNG'i
bildirishnoma rasmi (`image`) bo'ladi. Mantiq: `emoji-text.ts` (server) va `sw.js` `stripPushEmoji()` (klient, xuddi shu qoida).
Sinov: `deno run --allow-env --allow-read --import-map=tests/push/import-map.json tests/push/send-push.test.ts`
va `node tests/push/sw-push.test.mjs`. Deploy: `supabase functions deploy send-push --no-verify-jwt` (SW esa Vercel bilan o'zi yangilanadi).
