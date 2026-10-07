# SpaceMR — Production STATUS

**Sana:** 2026-10-07  
**Roadmap:** `docs/PRODUCTION-ROADMAP.md`  
**Tag (lokal):** `pre-prod-2026-10-07` (push/MR kutilyapti)

## Qisqa xulosa

Lokal ishlar: xavfsizlik fixlari, emoji path, CSS minify, CI skeleton, RUNBOOK, maxfiylik/shartlar sahifalari.  
**Hali ochiq:** `main` merge/push, prod SQL 094/095, jonli RLS test, MR §10 qarorlari, go-live smoke.

## Bosqichlar

| # | Nom | Holat |
|---|-----|--------|
| 0 | Muzlatish | Commitlar tayyor; merge/tag push/zaxira — MR |
| 1 | Xavfsizlik | Asosiy kod fix ✅; jonli RLS negativ — MR |
| 2 | Ishonchlilik | RUNBOOK + client_errors ✅; bo'sh DB/yuk/uptime — ochiq |
| 3 | Tezlik | CSS gzip ~82 KB ✅; JS minify/Lighthouse — ochiq |
| 4 | Mahsulot | Profil-pro + apps tablet ✅; vizual QA/a11y — ochiq |
| 5 | Qonuniy | privacy.html, terms.html, RUNBOOK ✅ |
| 6 | CI | GitHub Actions skeleton ✅ |
| 7 | Go-live | Kutilmoqda |

## Asosiy commitlar (feat/prod-*)

- Profil pro, emoji SVG/png, 3d olib tashlash, reaksiya path, 094/095
- XSS/website, deploy hygiene, SVG upload block
- RUNBOOK, CSP.md, CSS minify, CI
- Apps phone/tablet/desktop
- privacy.html / terms.html

## Metrikalar (lokal)

- `app.css` gzip ≈ **82 KB** (maqsad ≤120)
- `npm audit`: 0 vulnerabilities
- `tests/store-policy.mjs`: PASS
- `tests/flags.mjs`: 2 fail (muhit)
- Playwright smoke: paketi yo'q bo'lishi mumkin

## MR dan kerak (§10)

1. Emoji 49 MB: SVG to'liq / saqlash?
2. Storage 1 GB: plan yoki limit?
3. Alohida prod Supabase?
4. Maxsus domen?
5. `/apps` prod yoqiladimi?
6. Monitoring: client_errors yoki Sentry?

## Keyingi amallar

1. Branchlarni merge → push `main`
2. Prod: backup → 094 → 095
3. Preview SMOKE (iOS+Android)
4. Production promote + `v1.0.0`
