# Migrations

Bazada ISHGA TUSHIRILGAN SQL fayllar, tartib raqami bilan. Yangi bazada `000_schema.sql`, keyin qolganlarini raqam tartibida.

- Ishga tushirilishi kutilayotgan patchlar `supabase/unfulfilled/` da turadi. Bazada bajarilgach shu yerga keyingi raqam bilan ko'chiriladi (`013_nom.sql`).
- Har patch idempotent (`if exists` / `if not exists`).
- Tartib `git` tarixi va bog'liqlik bo'yicha tuzilgan. `001`–`008` bir vaqtda import qilingani uchun ularning o'zaro tartibi taxminiy.
- `000_schema.sql` = jonli bazadan olingan dump (2026-09-30, `supabase db dump --linked`; sxema-only bu standart). Webhook siri `__WEBHOOK_SECRET__` bilan yashirilgan.
- Dump 001-006, 014, 015 ni o'z ichiga oladi: yangi bazada faqat 000 + undan keyingi patchlar kerak bo'ladi.
- Dump olganda sirni yashirishni unutma: `sed -E 's/("x-webhook-secret":")[^"]*(")/\1__WEBHOOK_SECRET__\2/g'`.
- 007-012 (2026-10-01): contract patchlari; jonli bazada allaqachon no-op edi (000_schema dump ko'rsatadi), idempotent. 013 (`posts.views`) `unfulfilled/` da, 2026-10-06 dan keyin.
- 013 (2026-10-01): `posts.views` + `increment_post_view()` drop; `posts_insert` policy `views = 0` shartisiz qayta yaratildi. `000_schema.sql` dump bundan OLDINGI holat — yangi bazada 000 dan keyin 013 ham kerak.
- 016 (2026-10-01): `group_messages.duration` ustuni qo'shildi, `group_messages_type_check` 'voice' turiga kengaytirildi va `on_group_message_insert()` triggeri ovozli xabar uchun `last_message = 'Ovozli xabar'` yozadigan qilindi.
- 018 (2026-10-01): `groups.group_username` va `groups.group_invite_token` ustunlari, `claim_group_username()` RPC, va umumiy nomlar fazosi (profiles username bilan ziddiyatsiz).
- 019 (2026-10-01): `profiles` uchun REPLICA IDENTITY FULL, `admin_delete_user()` va `delete_my_account()` orqali storage.objects, profiles (CASCADE) va auth.users ni to'liq tozalash.
- 020 (2026-10-01): `profiles.must_change_password` va `password_changed_at` ustunlari, `admin_reset_user_password()` va `user_password_updated()` RPC lari. Parol o'zgarganda boshqa barcha qurilmalardan force logout va admin resetdan keyin birinchi kirishda majburiy yangi parol o'rnatish.
- 021 (2026-10-01): `profiles.recovery_email` ustuni, `set_recovery_email()`, `get_recovery_email_hint()` va `request_password_reset()` RPC lari.
- 022 (2026-10-02): `admin_delete_user()` va `delete_my_account()` da `storage.allow_delete_query = true` sozlanishi va xatoliklarni xavfsiz tutish (Direct deletion from storage tables is not allowed xatosini to'liq bartaraf etish).
- 023 (2026-10-02): `recovery_code` va `reset_password_with_code()` RPC. Parolni tiklash so'ralganda foydalanuvchining eski paroli o'chib ketmaydi va eski parol bilan kirish ochiq qoladi; 8 xonali kod faqat kod orqali yangi parol o'rnatish oynasida ishlaydi.
- 024 (2026-10-02): `verify_recovery_code()` RPC. Foydalanuvchi emailga kelgan 8 xonali kodni login parol maydoniga kiritganda avtomatik aniqlash va yangi parol o'rnatish oynasini ochish.
- 025 (2026-10-02): `change_my_password()` RPC. Sozlamalarda profil tahririda joriy parolni to'g'ridan-to'g'ri bazada tekshirib yangi parolni atomik o'rnatish (notif chalkashligini va poyga holatini to'liq bartaraf etish).
- 026 (2026-10-02): `change_my_username()` RPC va `guard_profile_update()`. Foydalanuvchi nomini o'zgartirish va login sinxronlash.
- 027 (2026-10-02): `admin_reset_user_password()` va `admin_issue_recovery_code()`. Admin tomonidan parolni to'g'ridan-to'g'ri o'zgartirmasdan, xuddi "Parolni unutdingizmi" kabi 8 xonali OTP tiklash kodini yaratish va zaxira emailga yuborish.



- 054 (2026-10-03): faqat JPG/PNG yuklash. media bucket allowed_mime_types, storage.objects va messages/group_messages/posts/stories INSERT triggerlari video/audio/ovozli xabarni rad etadi. Eski qatorlarga tegilmagan.
- 055 (2026-10-03): 054 tuzatildi — ovozli xabar (audio, faqat chat-voice papkasi va type='voice') qaytarildi; video taqiqligicha. Bucket MIME ro'yxati olib tashlandi (codecs parametri sababli), cheklov triggerlarda.
- 056 (2026-10-03): siyosat o'zgardi (054/055 ni almashtiradi): faqat VIDEO taqiqlangan; rasm formatlari, hujjat/arxiv, audio ruxsat; story/avatar/guruh avatari faqat rasm.
- 057 (2026-10-03): chat/guruhga FAYL sifatida (chat-files, group-files, type='file') video (mp4...) ruxsat; post/story/avatar uchun video taqiqligicha.
- 058 (2026-10-04): `saved_posts` jadvali (user_id, post_id, created_at) — saqlangan postlar. RLS: faqat o'ziniki (select/insert/delete), insert uchun is_approved() va post_is_visible(). Bazada yurgizilgan.
- 060 (2026-10-04): foydalanuvchi va guruh username lari ALOHIDA nomlar fazosi: username_available faqat profiles, yangi group_username_available(text, uuid) faqat groups, change_my_username guruhlar bilan solishtirmaydi. Ishga tushirish shart (Supabase SQL editor).
- 063 (2026-10-05): `message_reactions` jadvali (DM + guruh, bir foydalanuvchi — bir xabarga bitta reaksiya), RLS, xabar o'chsa reaksiyalarni tozalovchi triggerlar, realtime. Bazada yurgizilgan (2026-10-05 tekshirildi).
- 064 (2026-10-05): xabar o'chirilganda chat/guruh ro'yxatidagi `last_message` prevyusi qayta hisoblanadi (`on_message_delete`, `on_group_message_delete` statement-level triggerlari) + bir martalik tuzatish. Bazada yurgizilgan (triggerlar bor, 2026-10-05 tekshirildi).
