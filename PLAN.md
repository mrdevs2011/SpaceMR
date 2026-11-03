# SpaceMR — loyiha kontrakti

- Frontend: vanilla JavaScript ES modules, HTML/CSS.
- Backend: Supabase (Postgres, Auth, Storage, Realtime); migrations: supabase/migrations/.
- Build: npm run build; tests: node tests/*.test.mjs; smoke: node tests/smoke.mjs.
- Production repo: mrdevs2011/SpaceMR, main; Vercel main deploy (repo sozlamasiga bog‘liq).
- UI emoji: Unicode glyph emas; /emoji/2d/<hex>.png PNG yoki mavjud SVG iconlardan foydalan.
- story_views composite PK (story_id, user_id), id ustuni yo‘q; SELECT RLS faqat viewer o‘zi yoki story egasi.
- Stories moduli: modules/feed/stories.js; media: Supabase media bucket.
