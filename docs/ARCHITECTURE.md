# MRspace — modul arxitekturasi

## Maqsad
Har bir fayl bitta aniq vazifaga ega. Umumiy logika alohida modulda.
Papkalar domen bo'yicha guruhlangan.

## Papka tuzilmasi

```
modules/
  core/          # asos: config, env, utils, rt-bus, local-cache, rate-limit, error-log
  auth/          # kirish, sozlamalar, recovery, pending
  chat/          # DM + guruhlar + ovoz + media + umumiy yordamchilar
  feed/          # lenta, izohlar, hikoyalar, yuklash, siqish
  ui/            # sidebar, right-rail, toast, emoji, dissolve, shortcuts
  call/          # WebRTC qo'ng'iroq
  profile/       # profil + view-* sahifalar
  admin/         # admin vositalari
  vendor/        # uchinchi tomon (supabase client)
  script.js      # SPA kirish nuqtasi
  router.js      # marshrutlash
  push.js        # Web Push
  explore.js     # qidiruv overlay
```

## Chat qatlami

| Fayl | Vazifa |
|------|--------|
| `chat/chat.js` | 1v1 DM: ro'yxat, thread, yuborish, paint |
| `chat/groups.js` | Guruhlar: a'zolik, thread, yaratish |
| `chat/chat-shared.js` | Umumiy: sana, post-share matn, pending bubble, progress upload |
| `chat/chat-storage.js` | Pin / recent / deleted localStorage |
| `chat/chat-media.js` | Media ochish |
| `chat/chat-voice-*` | Ovoz yozish / ijro |
| `chat/rt-chat.js` | Realtime WebRTC mesh (chat) |
| `chat/msg-menu.js` | Xabar kontekst menyusi |

**Qoida:** `groups.js` endi sana/pending/upload uchun `chat-shared.js` ga tayanadi.
`chat.js` shu yordamchilarni qayta eksport qiladi (eski importlar buzilmasin).

## CSS
Manba: `CSS/*.css` → `npm run build` → `app.css` (qo'lda tahrirlanmaydi).

## Right-rail (desktop ≥1200px)
Floating karta: `position: fixed`, `border: 1px`, `border-radius: 16px`,
`box-shadow`, yuqori/past 12px bo'shliq.

## CSS domen SSOT (2026-10-04)

Brauzerga bitta `app.css` (build: tokens → base → features → layers → admin → mono-x).

| Domen | Manba |
|-------|--------|
| Chat thread + guruh bubble + voice | `mono-x.css` |
| Call | `features.css` |
| Feed / stories | `features.css` |
| Guruh forma / picker / a'zolar | `features.css` |
| Right-rail / nav / shell | `mono-x.css` |
| Auth / splash | `base.css` + mono theme |
| Admin | `admin.css` |

**JS:** bubble HTML → `chat/components/message-bubble.js`; file icon → `core/file-icons.js`; DM+guruh paint → `chat.js` `paintMessages`.

Batafsil: `docs/CONSOLIDATE-ROADMAP.md`.
