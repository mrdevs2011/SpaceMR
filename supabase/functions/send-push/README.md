# send-push (Web Push)

Bitta Edge Function quyidagilarni yuboradi:
- `messages`, `group_messages`, `calls` database webhooklari orqali DM/guruh xabarlari va qo‘ng‘iroqlar;
- autentifikatsiyalangan client chaqiruvi orqali post like va comment bildirishnomalari.

Social eventlarda client faqat event IDlarini yuboradi. Edge Function JWTni tekshiradi, like/comment qatorini va post egasini bazadan qayta tekshiradi, qabul qiluvchini o‘zi aniqlaydi. Client qabul qiluvchi yoki push matnini tanlay olmaydi.

## Mavjud loyiha uchun

Hozirgi SpaceMR bazasida `push_tokens`, `register_push_token`, `origin` va uchta message/call webhook triggeri allaqachon mavjud. Shu holatda **yangi SQL yoki yangi jadval kerak emas**. Social push ham mavjud `posts`, `post_likes`, `comments` va `push_tokens` jadvallaridan foydalanadi.

Kerakli Edge secrets:
- `VAPID_PUBLIC_KEY`
- `VAPID_SECRET_KEY`
- `VAPID_SUBJECT`
- `PUSH_WEBHOOK_SECRET`

`SUPABASE_URL` va `SUPABASE_SERVICE_ROLE_KEY` Supabase Edge runtime tomonidan beriladi. VAPID maxfiy kalitini hech qachon client kodiga qo‘ymang.

Deploy (Supabase CLI login yoki `SUPABASE_ACCESS_TOKEN` talab qiladi):

```sh
supabase functions deploy send-push --no-verify-jwt
```

Database webhooklar `messages`, `group_messages`, `calls` INSERT hodisalari uchun mavjud holatda qoladi. Yangi SQL yoki yangi webhook sozlamasi kiritilmaydi.

## Push matni

`emoji-text.ts` va `sw.js` tizim notification matnidan emoji tokenlarini tozalaydi; spoiler matni ham yashiriladi. Xabar faqat emoji bo‘lsa, `Emoji` matni va emoji PNG rasmi ko‘rsatiladi.

## Testlar

```sh
deno run --allow-env --allow-read --import-map=tests/push/import-map.json tests/push/send-push.test.ts
node tests/push/sw-push.test.mjs
node tests/image-compress.test.mjs
node tests/upload-policy.test.mjs
```
