# 12 — Model layer, health, alerts, limits, cron, RLS, links, webhooks, jobs

Owner: `test/models.test.ts`, `test/health.test.ts`, `test/alerts.test.ts`, `test/limits.test.ts`, `test/cron.test.ts`, `test/rls.test.ts`, `test/links.test.ts`, `test/crypto.test.ts`, `test/queue.test.ts`, `test/security-static.test.ts`.

| id | area | journey | criterion | owner |
|---|---|---|---|---|
| C-1500 | models | truncation | Given a response with `finish_reason=length`, then the same model is retried with `max_tokens` doubled (cap 8000). | test/models.test.ts |
| C-1501 | models | truncation | Given JSON that parses but `finish_reason=length`, then still retried (size problem, not format). | test/models.test.ts |
| C-1502 | models | truncation | Given two truncations, then the next fallback is tried with the larger budget. | test/models.test.ts |
| C-1503 | models | truncation | Given the `MIN_MAX_TOKENS` floor (Charlie's hidden-reasoning lesson), then no call is ever sent with fewer than 1200 `max_tokens`. | test/models.test.ts |
| C-1504 | models | truncation | Given the retry, then `usage_ledger` records tokens for every attempt. | test/models.test.ts |
| C-1505 | models | truncation | Given a deadline nearer than the retry needs, then `DeadlineError` is thrown and the job requeued. | test/models.test.ts |
| C-1506 | models | truncation | Given success, then `model_usage`/`usage_ledger` carries the model slug that answered. | test/models.test.ts |
| C-1507 | models | fallback | Given 429 from the primary, then the first `fallbacks` entry is called immediately (no sleep). | test/models.test.ts |
| C-1508 | models | fallback | Given 5xx, then same. | test/models.test.ts |
| C-1509 | models | fallback | Given a network error, then same. | test/models.test.ts |
| C-1510 | models | fallback | Given all configured fallbacks fail, then `HARD_FALLBACKS` in order. | test/models.test.ts |
| C-1511 | models | fallback | Given every model fails, then `ModelUnavailable` and the job retries with backoff. | test/models.test.ts |
| C-1512 | models | fallback | Given a 400 (bad request), then no fallback (it is our bug) and the error is surfaced with the body excerpt. | test/models.test.ts |
| C-1513 | models | fallback | Given a 401, then critical incident `openrouter_credential` and no fallback. | test/models.test.ts |
| C-1514 | models | fallback | Given a fallback answered, then `safety_events(check=model_fallback, detail.from/to)`. | test/models.test.ts |
| C-1515 | models | json | Given a response wrapped in ```json fences, then unwrapped. | test/models.test.ts |
| C-1516 | models | json | Given trailing commas, then repaired. | test/models.test.ts |
| C-1517 | models | json | Given prose before the JSON, then the first balanced object is extracted. | test/models.test.ts |
| C-1518 | models | json | Given unrepairable output, then one retry with "Return JSON only" appended, then failure. | test/models.test.ts |
| C-1519 | models | json | Given `response_format: json_object` is set when `params.json_mode=true`, then the request carries it; otherwise not. | test/models.test.ts |
| C-1520 | models | json | Given the schema validator rejects (missing required key), then treated as unrepairable (retry once). | test/models.test.ts |
| C-1521 | models | config | Given `model_config` row `enabled=false`, then the role goes straight to fallbacks and an incident `role_disabled` once a day. | test/models.test.ts |
| C-1522 | models | config | Given the row missing, then `HARD_FALLBACKS` and incident `role_missing`. | test/models.test.ts |
| C-1523 | models | config | Given the table unreadable, then `HARD_FALLBACKS` and incident critical. | test/models.test.ts |
| C-1524 | models | config | Given `params.temperature`, then passed through; default 0.2. | test/models.test.ts |
| C-1525 | models | config | Given the config is cached, then for at most 60 s (an UPDATE is live within a minute). | test/models.test.ts |
| C-1526 | models | config | Given `db/0002` seeds roles extract, needs, writer, checker, safety, voice, summary, then `test/seed.test.ts` asserts all seven exist with `max_tokens ≥ 1200`. | test/seed.test.ts |
| C-1527 | models | grep | Given `scripts/grep-models.sh`, then it exits 1 when a slug literal is added to `api/_lib/extract.ts` (test writes a temp file and runs the script). | test/security-static.test.ts |
| C-1528 | models | grep | Given `api/_lib/models.ts` holds `HARD_FALLBACKS`, then the script exits 0. | test/security-static.test.ts |
| C-1529 | health | fields | Given `GET /api/health`, then JSON with `ok`, `services.{supabase,openrouter,elevenlabs_webhook,voice_tools,resend,whatsapp,jev}` each `configured`/`unconfigured`. | test/health.test.ts |
| C-1530 | health | fields | Given health, then `guardrails_live` true only when Jev or the checker/safety rows are usable. | test/health.test.ts |
| C-1531 | health | fields | Given health, then `jobs.{queued,running,failed_24h}`. | test/health.test.ts |
| C-1532 | health | fields | Given health, then `webhooks.last_hour` and `last_post_call_at`. | test/health.test.ts |
| C-1533 | health | fields | Given health, then `catalogue.{products,oldest_verified_on,stale}`. | test/health.test.ts |
| C-1534 | health | fields | Given health, then `limits.{agent_minutes_used,included,emails_today,openrouter_today}`. | test/health.test.ts |
| C-1535 | health | fields | Given `?ping=1`, then a single cheap query (`select 1`) and `{ok:true}` in < 100 ms. | test/health.test.ts |
| C-1536 | health | fields | Given the DB is down, then `ok:false`, 503, and the other fields filled from env. | test/health.test.ts |
| C-1537 | health | fields | Given health, then no secrets or their lengths appear. | test/health.test.ts |
| C-1538 | health | fields | Given `?detail=1` with `WORKER_SECRET`, then the last 20 incidents. | test/health.test.ts |
| C-1539 | health | fields | Given health, then `version` = the git SHA from `VERCEL_GIT_COMMIT_SHA` or "dev". | test/health.test.ts |
| C-1540 | health | fields | Given health, then `forgets_last_30d` count. | test/health.test.ts |
| C-1541 | alerts | thresholds | Given a job failed after 3 attempts, then an immediate alert email (rate-limited to one per 5 min). | test/alerts.test.ts |
| C-1542 | alerts | thresholds | Given 3 signature failures in an hour, then one alert. | test/alerts.test.ts |
| C-1543 | alerts | thresholds | Given a delivery failed, then digest alert. | test/alerts.test.ts |
| C-1544 | alerts | thresholds | Given guardrails unavailable, then immediate critical. | test/alerts.test.ts |
| C-1545 | alerts | thresholds | Given 80% of included agent minutes, then one alert per month. | test/alerts.test.ts |
| C-1546 | alerts | thresholds | Given 80 emails today, then one alert per day. | test/alerts.test.ts |
| C-1547 | alerts | thresholds | Given OpenRouter daily budget at 80%, then one alert per day. | test/alerts.test.ts |
| C-1548 | alerts | thresholds | Given `ALERT_EMAIL_TO` unset, then alerts are recorded in `incidents` only and health says `alerts: unconfigured`. | test/alerts.test.ts |
| C-1549 | alerts | thresholds | Given the daily summary hour, then one email with counts (calls, quotes, sent, failed, cost). | test/alerts.test.ts |
| C-1550 | alerts | thresholds | Given an incident fingerprint repeats, then `count` increments and `last_at` updates; no new email within the window. | test/alerts.test.ts |
| C-1551 | alerts | thresholds | Given alert emails, then no client phone/email in them. | test/alerts.test.ts |
| C-1552 | alerts | thresholds | Given `TRACKING_OFF=1`, then no emails and no self-calls, but incidents still rows. | test/alerts.test.ts |
| C-1553 | limits | guards | Given `limits.agentMinutesThisMonth()`, then sums `usage_ledger` for the calendar month. | test/limits.test.ts |
| C-1554 | limits | guards | Given `limits.emailsToday()`, then counts `deliveries` + alert emails in the UTC day. | test/limits.test.ts |
| C-1555 | limits | guards | Given `limits.openrouterToday()`, then counts model calls today (attempts, not successes). | test/limits.test.ts |
| C-1556 | limits | guards | Given OpenRouter budget exhausted, then non-critical model work (`summary`) is skipped with `safety_events(skipped_budget)`; critical work (extract/write/check) still runs. | test/limits.test.ts |
| C-1557 | limits | guards | Given the budget is reset at UTC midnight, then counts reset. | test/limits.test.ts |
| C-1558 | limits | guards | Given `ELEVENLABS_MINUTES_INCLUDED=0` (unknown plan), then no minutes alert. | test/limits.test.ts |
| C-1559 | limits | guards | Given storage usage estimate (sum of `recordings.bytes`) > 800 MB, then alert `storage_80`. | test/limits.test.ts |
| C-1560 | limits | guards | Given > 950 MB, then new recordings are not stored (`recording: not kept (storage full)`) and critical alert. | test/limits.test.ts |
| C-1561 | limits | guards | Given the Supabase idle-pause risk, then `/api/cron/keepalive` (daily) calls `/api/health?ping=1` and records `last_ping_at`. | test/cron.test.ts |
| C-1562 | limits | guards | Given `/app/costs`, then it reads the same `limits` functions (one source of truth). | test/app.test.ts |
| C-1563 | cron | auth | Given any `/api/cron/*` without `Authorization: Bearer {CRON_SECRET}`, then 401. | test/cron.test.ts |
| C-1564 | cron | auth | Given `CRON_SECRET` unset, then 503 (fail closed). | test/cron.test.ts |
| C-1565 | cron | auth | Given `vercel.json`, then crons for `/api/worker?tick=1`, `/api/cron/retention`, `/api/cron/keepalive`, `/api/cron/freshness` exist with schedules a Hobby plan allows (documented in VERIFIED.md). | test/cron.test.ts |
| C-1566 | cron | auth | Given `/api/cron/freshness`, then products with `verified_on` > 90 days create incident `catalogue_stale` listing names. | test/cron.test.ts |
| C-1567 | rls | lockdown | Given `db/0001`, then `products`, `product_categories`, `disclosures` have a `SELECT` policy for `anon, authenticated`. | test/rls.test.ts |
| C-1568 | rls | lockdown | Given every other table in the migrations, then RLS enabled and no policies (the test parses `db/*.sql`). | test/rls.test.ts |
| C-1569 | rls | lockdown | Given a new `CREATE TABLE` in a later migration without `ENABLE ROW LEVEL SECURITY` in the same file, then the test fails. | test/rls.test.ts |
| C-1570 | rls | lockdown | Given the Storage bucket `recordings`, then it is created `public=false` in the migration. | test/rls.test.ts |
| C-1571 | rls | lockdown | Given the Storage bucket `quotes`, then private. | test/rls.test.ts |
| C-1572 | rls | lockdown | Given `api/`, then no file imports the publishable/anon key (static grep for `SUPABASE_ANON`). | test/security-static.test.ts |
| C-1573 | rls | lockdown | Given `public/`, then no file contains a Supabase URL or key (static grep). | test/security-static.test.ts |
| C-1574 | rls | lockdown | Given `docs/SUPABASE-PROMPT.md`, then it is generated from `db/*.sql` by `scripts/supabase-prompt.ts` and contains a precheck query and a success table (the test regenerates and diffs). | test/supabase-prompt.test.ts |
| C-1575 | rls | lockdown | Given migrations, then each is re-runnable (`IF NOT EXISTS`, `DROP POLICY IF EXISTS`), tested by running the SQL twice against a local Postgres when `TEST_DATABASE_URL` is set, else skipped with a visible "skipped" line. | test/migrations.test.ts |
| C-1576 | rls | lockdown | Given `model_config`, then RLS on, no policies. | test/rls.test.ts |
| C-1577 | rls | lockdown | Given `usage_ledger`, then RLS on, no policies. | test/rls.test.ts |
| C-1578 | rls | lockdown | Given the `claim_job` function, then `SECURITY DEFINER` with `search_path` pinned. | test/rls.test.ts |
| C-1579 | rls | lockdown | Given every table with `client_id`, then `ON DELETE CASCADE` to `clients` or an explicit delete in `forgetClient` (test cross-checks). | test/rls.test.ts |
| C-1580 | rls | lockdown | Given every table, then a `created_at timestamptz default now()` column (operability rule). | test/rls.test.ts |
| C-1581 | links | signed | Given `signLink(path, ttl)`, then a URL with `exp` and an HMAC over `path:exp` using `SESSION_SECRET`. | test/links.test.ts |
| C-1582 | links | signed | Given a valid link within 72 h, then the PDF is served with `Content-Disposition: inline`. | test/links.test.ts |
| C-1583 | links | signed | Given an expired link, then 404 with a plain page "This link has expired; ask your broker for a new one". | test/links.test.ts |
| C-1584 | links | signed | Given a tampered `exp` or signature, then 404 (same page, no detail). | test/links.test.ts |
| C-1585 | links | signed | Given the link is opened, then `deliveries.status=read` if not already and `quotes.status=read`. | test/links.test.ts |
| C-1586 | links | signed | Given the link, then no cookie is set and no client identity is in the URL beyond the opaque quote id. | test/links.test.ts |
| C-1587 | webhooks | raw | Given the ElevenLabs verifier, then it is called with the raw `Buffer`, not a parsed object. | test/crypto.test.ts |
| C-1588 | webhooks | raw | Given the Resend verifier (svix-style headers `svix-id`, `svix-timestamp`, `svix-signature`), then HMAC over `id.timestamp.body` with the base64 secret; tolerance 5 min. | test/crypto.test.ts |
| C-1589 | webhooks | raw | Given the Meta verifier (`X-Hub-Signature-256`), then sha256 HMAC over raw bytes with the app secret. | test/crypto.test.ts |
| C-1590 | webhooks | raw | Given all three, then `timingSafeEqual` with length check first. | test/crypto.test.ts |
| C-1591 | webhooks | raw | Given a body with a UTF-8 multibyte character, then verification still passes (bytes, not string length). | test/crypto.test.ts |
| C-1592 | webhooks | raw | Given Vercel's body parsing, then every webhook handler disables it (`export const config = { api: { bodyParser: false } }` or reads the stream) — static test. | test/security-static.test.ts |
| C-1593 | webhooks | raw | Given an event stored, then processing happens in the job, never inline (static: no model call in `api/voice.ts`). | test/security-static.test.ts |
| C-1594 | webhooks | raw | Given a 10 MB webhook body, then accepted up to the platform limit and larger → 413 with an incident. | test/post-call.test.ts |
| C-1595 | webhooks | raw | Given webhook handlers, then they return within 1 s on the fake and never await the worker kick. | test/post-call.test.ts |
| C-1596 | webhooks | raw | Given `webhook_events`, then rows older than 30 days with `processed_at` set have `raw` nulled by retention (C-1408). | test/retention.test.ts |
| C-1597 | jobs | fencing | Given a job claimed with `locked_by=A, locked_at=t`, then worker B cannot claim it before `t+120s`. | test/queue.test.ts |
| C-1598 | jobs | fencing | Given `t+120s` passes, then B claims it and A's later `finishJob` is rejected (`stillOwnJob` false) and A's writes are not applied. | test/queue.test.ts |
| C-1599 | jobs | fencing | Given A touches the job every 30 s while working, then B never claims it. | test/queue.test.ts |
| C-1600 | jobs | fencing | Given a job for session S is running, then another job for S is held (`otherJobRunningFor`). | test/queue.test.ts |
| C-1601 | jobs | fencing | Given jobs for different sessions, then up to 3 run concurrently. | test/queue.test.ts |
| C-1602 | jobs | fencing | Given `run_after` in the future, then not claimable. | test/queue.test.ts |
| C-1603 | jobs | fencing | Given `status=cancelled`, then never claimed. | test/queue.test.ts |
| C-1604 | jobs | fencing | Given a job kind unknown to the worker, then marked `failed` with `unknown_kind` and an incident (never silently dropped). | test/queue.test.ts |
| C-1605 | jobs | fencing | Given the worker's hand-on self-call fails, then the next cron tick picks up the work (no job lost). | test/queue.test.ts |
| C-1606 | jobs | fencing | Given a job payload references a deleted session, then `skipped`. | test/queue.test.ts |
| C-1607 | jobs | fencing | Given `jobs` grows past 10,000 done rows, then retention deletes done rows older than 30 days. | test/retention.test.ts |
| C-1608 | jobs | fencing | Given a pipeline step enqueues the next, then it does so only after its own writes commit (ordering test with a failing write). | test/queue.test.ts |
| C-1609 | jobs | fencing | Given `/admin` "retry", then `attempts=0, status=queued, run_after=now`. | test/admin.test.ts |
| C-1610 | jobs | fencing | Given the worker, then it flushes tracking and returns a `DrainReport` `{claimed, done, failed, held, fenced}`. | test/queue.test.ts |
