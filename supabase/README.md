# supabase/

| Yo'l | Vazifasi |
|---|---|
| `setup.sql` | **Butun baza sxemasi — bitta fayl, idempotent.** Supabase → SQL Editor → New query → hammasini paste → Run. Yangi loyihada ham, mavjud bazada ham ishlaydi (qayta ishga tushirsa xato bermaydi, ma'lumotga tegmaydi). |
| `functions/` | Edge Functions (send-push, send-recovery-email, admin-*). |
| `queries/` | Faqat o'qish uchun diagnostika so'rovlari. |

> Eski `migrations/000…116` o'chirildi (2026-11-17): ularning yakuniy holati `setup.sql` da. Tarix kerak bo'lsa: `git log -- supabase/migrations`.

## setup.sql tarkibi (tartib bilan)
1 kengaytmalar → 2 funksiyalar → 3 jadvallar → 4 cheklovlar → 5 indekslar → 6 triggerlar → 7–8 RLS va siyosatlar →
9 huquqlar → 10 realtime → 11 media bucket + storage siyosatlari → 12 auth→profil triggeri → 13 cron →
14 push webhooklari → 15 eski obyektlarni tozalash.

## Qoidalar
- **Fayl turi/hajmi bo'yicha cheklov yo'q.** Hajmni faqat Supabase Storage global limiti belgilaydi
  (Dashboard → Storage → Settings). `media` bucket'i ommaviy, yozish/o'chirish faqat egasi (yoki admin).
- **Push webhooklari (14-bo'lim):** `__WEBHOOK_SECRET__` ni Edge Functions → Secrets dagi `PUSH_WEBHOOK_SECRET` bilan
  almashtirib, shu bo'limni ishga tushiring. Almashtirilmasa — qolgan hammasi ishlaydi, push triggerlari o'tkazib yuboriladi
  va mavjud triggerlar o'zgarmaydi. **Sirni repoga commit qilmang.**
- Yangi o'zgarish: `setup.sql` ni tahrirlang (idempotent saqlang: `IF NOT EXISTS` / `CREATE OR REPLACE` / `DROP POLICY IF EXISTS`),
  keyin SQL Editor'da yana ishga tushiring.
