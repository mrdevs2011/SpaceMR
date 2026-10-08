# SpaceMR — Production STATUS

**Sana:** 2026-10-08  
**Mahsulot roadmap:** `docs/ROADMAP.md` (10 band — yopilgan)  
**Production roadmap:** `docs/ROADMAP2.md`  
**Branch ish:** `feat/4-offline-banner` → `main`

## Qisqa xulosa

Kod tomoni productionga tayyor: oflayn, xato matnlari, feedback (SpaceMR guruhi),
onboarding, chat qidiruv, mute, push prefs, toast, skelet, RUNBOOK/KILL_SWITCH.

**MR qarori kerak (operatsion):** alohida prod Supabase, storage plan, maxsus domen,
Sentry vs client_errors, beta ro'yxati, jonli RLS negativ test va zaxira tiklash mashqi.

## ROADMAP2 fazalar

| Faza | Kod | Operatsion (MR) |
|------|-----|------------------|
| 1 Production blokerlari | CSP, rate limit, npm audit 0, shell 302, RUNBOOK rollback | Jonli RLS test, prod Supabase, zaxira tiklash |
| 2 Mobil sifat | safe-area, dvh, klaviatura adapt, 44px, oflayn banner, PWA guide | Qurilma matritsasi qo'lda |
| 3 Kundalik ishonch | toast, empty states, kesh, minify, modulepreload | Smoke iOS+Android |
| 4 Kuzatuv | client_errors, force-reload, KILL_SWITCH, SpaceMR guruh | Uptime monitor, ogohlantirish |
| 5 Go-live | STATUS yangilandi | Beta 5–10 kishi, v1.0.0 teg |

## Metrikalar

- `npm audit`: 0 vulnerabilities
- `app.css` gzip maqsad ≤120 KB (build minify yoqilgan)
- Offline banner + post draft + failed msg retry

## Keyingi (faqat egasi)

1. Preview smoke + telefon
2. Prod promote / teg
3. Beta SpaceMR guruhi orqali
