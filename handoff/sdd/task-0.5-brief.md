### Task 0.5: `vercel.json`, health skeleton, static security tests

**Files:** Create `vercel.json`, `api/health.ts`, `test/health.test.ts`, `test/security-static.test.ts`, `scripts/preview-quote.mjs` (smoke stub that exits 0 with "no renderer yet" until Task 6.4), `docs/VERIFIED.md` rows filled for Vercel/Supabase/OpenRouter/Resend.

**Interfaces:** `GET /api/health` → SPEC §12 fields (services from env only in this task; counts added in Task 11.2). `?ping=1` → `{ok:true}` after `select 1`.

- [ ] **Step 1: Failing tests** `[C-1529][C-1535][C-1537][C-1539]`, static `[C-1572][C-1573][C-1592][C-1593][C-1439]` (the static tests grep `api/` and `public/`; they pass trivially now and bite later).
- [ ] **Step 2–4.** Functions in `vercel.json`: `api/voice.ts` 60 s/1024 MB, `api/worker.ts` 300 s, `api/app.ts` 30 s, `api/meeting.ts` 60 s, `api/render-pdf.ts` 120 s/2048 MB with `includeFiles` for chromium, `api/health.ts` 15 s, `api/cron/*` 120 s; crons `/api/worker?tick=1`, `/api/cron/retention`, `/api/cron/keepalive`, `/api/cron/freshness` at schedules the Hobby plan allows (record the allowed minimum in VERIFIED.md; if once a day, the worker's hand-on and the webhook's kick carry the load, as in Charlie).
- [ ] **Step 5: Commit** `Vercel config, health skeleton, static security tests`

