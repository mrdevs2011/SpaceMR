# send-push (Web Push)

Bitta Edge Function quyidagilarni yuboradi:
- `messages`, `group_messages`, `calls` database webhooklari orqali DM/guruh xabarlari va qo‘ng‘iroqlar;
- post like/comment: alohida Vercel `/api/social-push` endpoint va alohida service worker/VAPID juftligi orqali.

Social eventlarda client faqat event IDlarini Vercel endpointiga yuboradi. Endpoint JWTni tekshiradi, like/comment qatorini va post egasini bazadan qayta tekshiradi, qabul qiluvchini o‘zi aniqlaydi. Client qabul qiluvchi yoki push matnini tanlay olmaydi.

## Mavjud loyiha uchun

Hozirgi SpaceMR bazasida `push_tokens`, `register_push_token`, `origin` va uchta message/call webhook triggeri allaqachon mavjud. Shu holatda **yangi SQL yoki yangi jadval kerak emas**. Social push ham mavjud `posts`, `post_likes`, `comments` va `push_tokens` jadvallaridan foydalanadi.

Eski chat/guruh/call push Edge Function'da qoladi va uning secret/webhook sozlamalari o'zgartirilmaydi. Social push uchun Vercel Production va Preview env'lari: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (mavjud), `VAPID_PUBLIC_KEY`, `VAPID_SECRET_KEY`, `VAPID_SUBJECT`, `PUSH_CANONICAL_ORIGIN`. `VAPID_SECRET_KEY` faqat Vercel server env'da turadi; clientga yoki Git'ga qo'yilmaydi.

Social endpoint deployi SpaceMR GitHub `main` pushidan keyin Vercel Git Integration orqali avtomatik amalga oshadi. Supabase login, SQL yoki yangi DB trigger kerak emas.

Database webhooklar `messages`, `group_messages`, `calls` INSERT hodisalari uchun mavjud holatda qoladi. Yangi SQL yoki yangi webhook sozlamasi kiritilmaydi.

## Push matni

`emoji-text.ts` va `sw.js` tizim notification matnidan emoji tokenlarini tozalaydi; spoiler matni ham yashiriladi. Xabar faqat emoji bo‘lsa, `Emoji` matni va emoji PNG rasmi ko‘rsatiladi.

## Testlar

`api/social-push.js` — Vercel serverless social endpoint; `social-push/sw.js` — uning alohida worker'i. `modules/push.js` ikkinchi subscriptionni eski root workerga tegmasdan ro'yxatdan o'tkazadi va logoutda ikkalasini ham bekor qiladi.


```sh
deno run --allow-env --allow-read --import-map=tests/push/import-map.json tests/push/send-push.test.ts
node tests/push/sw-push.test.mjs
node tests/image-compress.test.mjs
node tests/upload-policy.test.mjs
```
