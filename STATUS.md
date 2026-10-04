# AI Context — .

## Oxirgi holat
- Sana: 2026-10-01 23:03
- Nima qilindi: Barcha cardlar, modallar va login cardlar to'liq OLED pitch-black (#000000) rangiga o'tkazildi; .admin-reset-card, .auth-card, .ua-modal, .sheet, .composer-sheet va barcha overlay modallari chuqur qora (#000000) fon, 1px oq shaffof hoshiya va 0 24px 70px qora soya bilan professional darajaga keltirildi; Zaxira email maydoni (sign-up va profil tahririda) "Zaxira email (ixtiyoriy)" shaklida belgilandi va ro'yxatdan o'tishda ixtiyoriy qilindi (kiritilsa formati tekshiriladi, kiritilmasa majburiy qilinmaydi); app.css qayta yig'ildi; Smoke (14/14) va mesh (7/7) testlari muvaffaqiyatli o'tdi.
- Hozirgi muammo/blocker: Yo'q.
- Keyingi qadam: main va feat/realtime-03s ga commit va push qilish.

## Muhim fayllar
- `supabase/migrations/018_group-public-private.sql` — ommaviy va maxfiy guruhlar, username unikal tekshiruvi va invite_code
- `modules/stories.js` — story ko'rgich freeze va tap navigatsiyasi
- `modules/groups.js` — guruh sozlamalari, 64-xonali invite URL va deep link
- `modules/chat.js` — ultra-smooth ovoz pulsatsiyasi, mobil klaviatura adaptori, guruh qidiruvi
- `modules/auth.js` — ro'yxatdan o'tishda profil va guruh username larini birgalikda tekshirish
- `CSS/mono-x.css`, `CSS/features.css`, `app.css` — dark popup va guruh interfeysi

## Eslatmalar (arxitektura, qarorlar, "buni qilma" kabi)
- Git push uchun doim `GIT_ASKPASS="$HOME/.gh-askpass.sh" GIT_TERMINAL_PROMPT=0` ishlatiladi.
- 0% kesh talabi: service worker va runtime cache hech qachon sahifani keshlamaydi.

---

---
### 2026-10-04 12:27
- Qilindi: **Konsolidatsiya roadmap**  (SSOT, faza A–E, DoD). CSS chat dedupe; getChatFileIcon → chat-shared.
- Keyingi: A2 (features∩mono strip), keyin B1 (chat CSS bitta manba).

### 2026-10-04 12:05
- Qilindi: **ULTRA tez / lag-free UI + realtime lenta**
  1) Feed event delegation — har renderda N listener o'rniga 1 ta (xotira + CPU)
  2) Infinite scroll: 300ms sun'iy kechikish olib tashlandi; passive + rAF scroll
  3) Like/izoh realtime: DOM da bor post uchun faqat patchCounts (to'liq re-render yo'q)
  4) Posts render schedule: setTimeout(0) → requestAnimationFrame (bir frame batch)
  5) Rasm: decoding=async; CSS content-visibility + GPU layer (translateZ) postlarda
  6) Touch: act-btn touch-action manipulation, like press scale feedback
- Fayllar: modules/feed/feed.js, modules/auth/auth.js, CSS/features.css, app.css
- Keyingi: 2 qurilmada lenta like/izoh/scroll/yangi post sinovi

---
---
### 2026-10-04 11:40
- Qilindi: Chat media (ovoz/fayl) ham tezkor yo'lga ulandi — upload+insert dan keyin WebRTC DataChannel / broadcast orqali peer darhol ko'radi (faqat postgres_changes kutmaydi). DM va guruh.
- Fayllar: modules/chat/rt-chat.js (send payload kengaytirildi), chat-actions.js, chat.js (_rtIncoming), groups.js (_gIncoming, sendGroupFile/Voice).
- Keyingi: 2 qurilmada ovoz/fayl sinovi; keyin feed/stories boshqa joylarni ham bir xil darajaga olib kelish.

### 2026-09-29 22:45
- Qilindi: F1-F4 draft fixlari kodda tuzatildi va commit qilindi (1480a7d, branch fix/draft-f1-f4, push qilinmagan). MR ko'zi bilan 2 qurilmada tasdiqlashi kerak
- Keyingi qadam: MR tasdiqlasa main ga merge/push; rasm preview qora muammosi va qo'ng'iroq taymeri qayta sinash
- Git holati: 1480a7d fix(F2-F4): sarlavha status ko'rinadi, presence yangilanishi, badge fon (--tg-blue), qo'ng'iroq oynasi halqa/avatar, fayl izohi kontrasti

---
### 2026-09-30 07:32 (Claude-2, mantiq/infra)
- Qilindi (lokal commitlar, PUSH QILINMAGAN): 4ed6171 chat.js skeleton/${} tuzatish; c8d493c 7.7 `error-log.js` + 014 SQL; dccb5e5 7.2 `admin-storage.js` + 015 SQL; 9c3e412 Playwright `tests/smoke.mjs` (14/14) + docs.
- Boshqa Claude (UI/CSS) bilan kelishuv: `~/Claude/.messages/`; CSS/F4 unda, mantiq/infra menda. `git add -A` yo'q.
- MR ishi qoldi: Vercel Preview + TURN_* env; contract SQL 007–013 (eng erta 2026-10-06); 014/015 (expand, istalgan vaqtda); 3.6 so'rov natijasi; `000_schema` dump; qarorlar Q2/Q4/Q5/Q8/Q9/Q10/Q11; `main` ga merge/push.
- Keyingi qadam: MR tasdiqlasa `main` ga merge; F4 (4.2/4.6/4.8) — CSS Claude'da.

---
### 2026-09-30 17:15 (Claude-4, CSS/DB/docs)
- Qilindi: 014/015 -> migrations/ (2c190cd); 000_schema jonli dump (ed8c6a3); 010/011 no-op ekani tekshirildi (20bfa82); 4.6 !important audit: 127 -> 12 (6e8342d, 04d6ec6, 5e40387, 666b5d0). Hammasi origin/main da (666b5d0).
- 4.6 usuli: har flag alohida olib tashlanib, headless Chromium (1280 va 390) da ~4500 element computed-style asl holat bilan solishtirildi. Control = xuddi shu usuldagi base (fresh --user-data-dir; profilsiz base bilan solishtirma, u ~66-74 shovqin beradi). 115 ta flag 0/0 -> olib tashlandi; 12 tasi farq berdi -> qoldi (.view.on, .vc-mute, .inc-call-btn, .c-red, .chat-voice-btn va h.k.).
- Blocker/ogohlik: harness faqat statik holat; hover, dark tema, boshqa view'lar o'lchanmagan. MR brauzerda tekshirishi kerak. Buzilsa: tegishli commit'ni git revert (har fayl alohida).
- Keyingi qadam (MR): Vercel deploy "Ready" + docs/SMOKE.md telefonda; TURN sinovi (Wi-Fi -> mobil); 2026-10-06 dan keyin zaxira olib 013; 007-012 ni migrations/ ga ko'chirish yoki o'chirish; Q9, Q11.
- Harness (vaqtincha): /tmp/h (perflag2.mjs, apply2.mjs, ver.sh); asl nusxa ~/Claude/tools/css-regress.

## Muhim fayllar
- docs/MR-QOLGAN.md (MR ishlari), supabase/unfulfilled/CHECKLIST.md (contract SQL tartibi), CSS/*.css -> `node scripts/build-css.mjs` -> app.css (qo'lda tahrirlanmaydi)

## Eslatmalar
- Contract SQL'ni kod bilan bir vaqtda yurgizma (roadmap 3-qoida). 013: eng erta 2026-10-06, zaxiradan keyin.

---
### 2026-10-01 16:00
- Qilindi: realtime <=0.3s: guruh mesh, rt-bus, presence, inbox, like/izoh/post broadcast
- Keyingi qadam: MR 2 qurilmada sinaydi, keyin main ga merge/push
- Git holati: 145b58e feat(realtime): <=0.3s — guruh WebRTC mesh, global broadcast shina (like/izoh/post), presence, kirish qutisi (DM/guruh ro'yxati), P2P typing, eventsPerSecond 60

---
### 2026-10-01 16:03
- Qilindi: guruh UI/logika DM bilan bir xil
- Keyingi qadam: MR sinaydi; 016 SQL; keyin main
- Git holati: 1db9e0f feat(groups): guruh thread DM bilan bir xil painter/menyu/yozmoqda/fayl/ovoz; yagona farq — pufak sarlavhasida yuboruvchi ismi

---
### 2026-10-01 17:30
- Qilindi: chatlar ro'yxatida barcha foydalanuvchilar ko'rinishi (yangi hisob ochilganda faqat bo'sh _myContacts bilan cheklanib qolmaslik) va qidiruv (search) to'g'rilandi: jonli debounced qidiruv (ism, username va guruhlar bo'yicha), tozalash tugmasi (clear btn) qo'shildi.
- Fayllar: modules/chat.js

---
### 2026-10-01 18:05
- Qilindi:
  1) Yangi ochilgan hisobda chatlar ro'yxatida begona userlar bo'lmasligi, faqat Admin ko'rinishi. Qolganlar qidiruvdan topilib, xabar yozilgandan so'nggina ro'yxatda saqlanishi.
  2) So'nggi qidiruvlar tarixi (recent searches): search inputga bosganda ko'rinishi va har birida "X" o'chirish tugmasi.
  3) Suhbat va guruhlarni qadash (pin) hamda kontekst menyu (bosib turganda): user uchun "Suhbatni qadash" va "Suhbatni o'chirish", guruh uchun "Guruhni qadash" va "Guruhdan chiqish". Qadalganlar eng yuqorida qadash ikonchasi bilan chiqadi.
  4) Guruhga a'zo bo'lmaganda input o'rnida "Guruhga qo'shilish" tugmasi chiqishi. Bosilganda guruhga qo'shilish va agar faqat yaratgan odam yoza oladigan bo'lsa, tugma kulrang bo'lib "Faqat guruhni yaratgan odam yoza oladi" deb yozilishi.
  5) Suhbat va guruh header o'ng tarafida 3 nuqta menyusi: DM da "Suhbatdan chiqish", guruhda "Guruhdan chiqish".
  6) Barcha interfeys va bildirishnomalar to'liq o'zbek tilida.
- Fayllar: index.html, modules/chat.js, modules/groups.js, STATUS.md
- Testlar: smoke.mjs (14/14), rt-mesh.mjs (7/7) muvaffaqiyatli o'tdi.

---
### 2026-10-01 18:15
- Qilindi:
  - Barcha 17 ta jadval, ustunlar, cheklovlar, RPC funksiyalari va triggerlar Supabase jonli bazasida tekshirildi.
  - Guruhda ovozli xabarlar yuborishdagi nosozlik aniqlandi (`duration` ustuni va `group_messages_type_check` constraint da 'voice' turi yo'qligi).
  - Supabase CLI orqali `016_group-voice.sql` yurgizildi: `group_messages.duration` ustuni qo'shildi, `group_messages_type_check` 'voice' ga kengaytirildi va `on_group_message_insert()` triggeri ovozli xabar uchun `last_message = 'Ovozli xabar'` yozadigan qilindi.
  - Migratsiya `supabase/migrations/016_group-voice.sql` ga ko'chirildi, `unfulfilled/` bo'shatildi.
- Fayllar: supabase/migrations/016_group-voice.sql, supabase/migrations/README.md, supabase/unfulfilled/CHECKLIST.md, STATUS.md

---
### 2026-10-01 18:30
- Qilindi:
  - Fayl va uning tagidagi matn (caption) tarqoq 2 ta xabar bo'lib emas, bitta xabarda yuborilishi ta'minlandi.
  - `handleSendAction()` fayl tanlanganda matnni alohida matnli xabar qilib yubormasdan, `sendChatFile(null, text)` ga caption qilib uzatadi va inputni tozalaydi.
  - `sendChatFile()` va `sendGroupFile()` funksiyalari `caption` parametrini qabul qilib, DB (`messages` va `group_messages`) ga `text: caption || null` sifatida saqlaydi, peer inbox va suhbatlar ro'yxatida prevyuni `📎 <caption matni>` qilib yangilaydi.
  - `paintMessages()` da fayl (rasm, video va boshqa hujjatlar) pufagi ichida agar `m.text` bo'lsa, fayl ostida `.cfm-caption` matn bloki chiziladi.
  - `CSS/features.css` ga `.cfm-caption` va `.cfm-file-wrap` stillari qo'shildi va `app.css` qayta yig'ildi.
  - Supabase jonli bazasida `on_message_insert()` va `on_group_message_insert()` triggerlari yangilangan (migratsiya: `017_file-caption.sql`).
- Fayllar: modules/chat.js, modules/groups.js, CSS/features.css, app.css, supabase/migrations/017_file-caption.sql, STATUS.md
- Testlar: smoke.mjs (14/14), rt-mesh.mjs (7/7) muvaffaqiyatli o'tdi.

---
### 2026-10-01 18:35
- Qilindi:
  - Rasm va videolar pufakka (bubble) o'ralib qolmasligi ta'minlandi (Telegram/WhatsApp uslubi).
  - Standalone media (matnsiz rasm/video): pufak foni, ramkasi va paddingi to'liq olib tashlandi (`.bubble-media-only`), media 16px burchaklar bilan o'zi chiqadi, vaqt va chek belgisi rasm ustida suzuvchi yarim shaffof nishon (`.cfm-media-badge`) sifatida ko'rsatiladi, fayl nomi/hajmi yozuvi olib tashlandi.
  - Matnli media (caption bor rasm/video): media pufakning eng tepasida hech qanday ramka/paddinglarsiz chekkagacha (flush edge-to-edge) joylashadi, uning tagida esa izoh matni va vaqt chiqadi.
- Fayllar: modules/chat.js, CSS/features.css, app.css, STATUS.md
- Testlar: smoke.mjs (14/14), rt-mesh.mjs (7/7) muvaffaqiyatli o'tdi.

---
### 2026-10-01 20:30
- Qilindi:
  - Mikrofonga bosib turib gapirish (Telegram Push-to-Talk) va qo'yib yuborganda darhol yuborilishi joriy qilindi.
  - Mikrofon bosilganda Telegram uslubidagi jonli pulsatsiya halqalari: 3 qavatli konsentrik radial to'lqinlar (`#cvPulse1`, `#cvPulse2`, `#cvPulse3`) Web Audio API `AnalyserNode` orqali foydalanuvchi ovozi balandligi va nafas olish ritmiga mos ravishda kengayadi va porlaydi.
  - Ovoz yozish paytida yozuv paneli (`#chatRecordBar`): qizil miltillovchi nuqta, real-vaqt sekundomer taymeri (`0:01`, `0:02`...) va "‹ Bekor qilish uchun suring" animatsiyali ko'rsatmasi chiqadi.
  - Chapga surish orqali bekor qilish (swipe-to-cancel): 55px dan ortiq chapga surilganda to'lqinlar va matn qizil rangga aylanadi va barmoq qo'yib yuborilsa yozuv bekor qilinadi.
  - Agar 0.5s dan qisqa bosilsa, bekor qilinib "Ovoz yozish uchun mikrofoni bosib turing" bildirishnomasi chiqadi.
  - Agar maydonda matn yoki fayl bo'lsa, tugma xabarni yuborish vazifasini bajaradi.
- Fayllar: index.html, modules/chat.js, CSS/features.css, app.css, STATUS.md
- Testlar: smoke.mjs (14/14), rt-mesh.mjs (7/7) muvaffaqiyatli o'tdi.

---
### 2026-10-01 20:45
- Qilindi:
  - Ilova nomi to'liq `MRspace` dan `SpaceMR` ga o'zgartirildi (HTML sarlavhalari, splash, brend so'zlari, logotip, PWA manifest, service worker, bildirishnomalar, keshlar, kalitlar, JS modullari, SQL migratsiyalari, CSS banner va kommentarilar, package.json va README).
  - Foydalanuvchilarning mavjud sessiyalari va ma'lumotlari uzilib qolmasligi uchun `spacemr-auth` (fallback: `mrspace-auth`), `spacemr_theme`, `spacemr_emoji_recent`, `spacemr_errors`, `spacemrNotifsEnabled` avtomatik migratsiyasi ta'minlandi.
  - Yangi logotip manbasi `/svg/SpaceMR.png` yaratildi va PWA keshiga kiritildi.
- Fayllar: index.html, 404.html, manifest.json, package.json, firebase-messaging-sw.js, README.md, scripts/build-css.mjs, CSS/*.css, app.css, modules/router.js, modules/config.js, modules/auth.js, modules/chat.js, modules/emoji-picker.js, modules/error-log.js, modules/push.js, modules/local-cache.js, modules/script.js, modules/utils.js, modules/groups.js, modules/admin-badge.js, modules/view-actions.js, modules/view-users.js, modules/no-autocomplete.js, supabase/functions/send-push/index.ts, supabase/migrations/005_stories.sql, supabase/migrations/006_stories-caption.sql, svg/SpaceMR.png, STATUS.md
---
### 2026-10-01 22:10
- Qilindi:
  1) Story va Postlardagi videolar uchun 2X tezlashtirish va 2X orqaga qaytarish: o'ng tarafga bosib turganda `2X ▶▶` indikatori bilan 2x tezlikda oldinga, chap tarafga bosib turganda `◀◀ 2X` indikatori bilan 2x silliq orqaga qaytarish. Qo'yib yuborganda 1x ijroga qaytadi. Hikoyalarda rasm bo'lsa muzlatish (freeze), qisqa bosganda navigatsiya saqlangan.
  2) Ovoz yozish paneli (`#chatRecordBar`): "‹ Bekor qilish uchun suring" matni kiritish maydonining to'g'ri o'rtasiga (center) joylashtirildi (`.crb-cancel` flex: 1, justify-content: center).
  3) Suhbat va guruhlar kontekst menyusi (`#chatCtxOverlay` — Suhbatni qadash / Suhbatni o'chirish): `Escape` tugmasi bosilganda darhol yopilishi ta'minlandi (`modules/chat.js` va `modules/shortcuts.js`).
  4) Admin tomonidan hisob o'chirilishi (Instant Logout + Cascade Delete):
     - Agar foydalanuvchi o'sha paytda saytda bo'lsa: `user-session-${uid}` Realtime broadcast orqali o'sha soniyaning o'zidayoq sessiyadan butunlay chiqarib yuboriladi (`_forceSignOut`).
     - Agar u vaqtda saytda bo'lmagan bo'lsa: keyinchalik saytga kirganda `_fetchProfile` profil yo'qligini aniqlaydi va barcha lokal tokenlar, auth keshlar, push tokenlar tozalangan holda darhol login ekraniga qaytaradi.
     - Jonli Supabase bazasiga `019_cascade_delete_user.sql` migratsiyasi qo'llandi: `storage.objects` (foydalanuvchining barcha rasm, video, audio fayllari), `push_tokens`, `profiles` (barcha postlar, izohlar, layklar, hikoyalar, xabarlar, chatlar va guruhlar CASCADE bilan) va `auth.users` dan to'liq tozalash.
- Fayllar: CSS/features.css, app.css, modules/stories.js, modules/utils.js, modules/chat.js, modules/shortcuts.js, modules/auth.js, modules/view-users.js, supabase/migrations/019_cascade_delete_user.sql, supabase/migrations/README.md, STATUS.md
- Testlar: smoke.mjs (14/14), rt-mesh.mjs (7/7) muvaffaqiyatli o'tdi.

---
### 2026-10-02 18:50
- Qilindi:
  1) Right-rail desktopda doimiy floating: border + border-radius 16px + shadow (CSS/mono-x.css → app.css).
  2) modules/ domen papkalarga ajratildi: core, auth, chat, feed, ui, call, profile, admin, vendor.
  3) chat.js / groups.js umumiy logikasi `modules/chat/chat-shared.js` ga ajratildi (sana, post-share matn, pending bubble, progress upload). chat.js re-export saqlanadi.
- Fayllar: CSS/mono-x.css, app.css, modules/**, index.html, docs/ARCHITECTURE.md
- Keyingi: brauzerda smoke; chat/groups funksionalligini tekshirish; kerak bo'lsa paintMessages yanada bo'linadi.

---
### 2026-10-02 19:05
- Qilindi (davomi):
  1) router.js view importlari: `./profile/view-*.js`
  2) scripts/build-env.mjs → `modules/core/env.js`
  3) sw.js PRECACHE_URLS yangi papka yo'llariga
  4) tests/rt-mesh.mjs yo'llari tuzatildi
  5) README error-log yo'li
- Testlar: smoke 14/14, rt-mesh 7/7 muvaffaqiyatli
