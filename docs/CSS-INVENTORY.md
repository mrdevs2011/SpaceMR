# CSS inventar (joriy — 2026-10-04)

> Manba: `CSS/*.css` → `node scripts/build-css.mjs` → **bitta** `app.css`.
> Kaskad: tokens → base → features → layers → admin → mono-x.

| Fayl | Qator | Hajm |
|------|------:|-----:|
| `tokens.css` | 107 | 3.6 KB |
| `base.css` | 264 | 9.2 KB |
| `features.css` | 3235 | 131.8 KB |
| `layers.css` | 1221 | 60.9 KB |
| `admin.css` | 690 | 29.7 KB |
| `mono-x.css` | 7337 | 207.1 KB |
| **app.css** (build) | 12849 | 468.5 KB |

## SSOT

| Domen | Fayl |
|-------|------|
| Tokenlar | tokens.css |
| Auth / splash / toast | base.css (+ mono theme) |
| Feed, call, guruh forma | features.css |
| Chat thread + bubble + voice UI | mono-x.css |
| Nav / right-rail / X-theme | mono-x.css |
| Admin | admin.css |
| Legacy qatlam | layers.css (yangi chat yozilmasin) |

## Qoida
Yangi chat stillari faqat `mono-x.css`. Call — `features.css`. `app.css` qo‘lda tahrirlanmasin.

Batafsil: `docs/CONSOLIDATE-ROADMAP.md`.
