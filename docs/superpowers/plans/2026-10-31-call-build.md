# Call — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task (BEHAVIOR-MATRIX A1 requires execution agents here). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A phone number and a browser button that run a fact-find with a client, read it back, and within minutes hand the broker a matched, drafted quotation to approve and send by email or WhatsApp — plus the same pipeline on a recorded in-person meeting — with every call recorded, every fact sourced, every figure from the catalogue, and every cost on a ledger.

**Architecture:** ElevenLabs Agents does the talking and calls our Vercel functions before (init), during (server tools) and after (post-call webhooks) the call. Everything after the webhook is a job queue in Supabase worked by `/api/worker`: ingest → facts (sourced, refusal rules) → needs (rules first) → match (one product per need, price from pricing bands in code) → write (model repeats numbers, never produces them) → check (rules, then Jev or a small model) → notify. The broker approves in a server-rendered dashboard; delivery is Resend or Meta. No framework, no build step; TypeScript run natively by Node ≥ 22.6, exactly as Charlie.

**Tech Stack:** Node ≥ 22.6 (native type stripping), TypeScript 5, Vercel functions, `@supabase/supabase-js`, `puppeteer-core` + `@sparticuz/chromium` (PDF only), ElevenLabs Agents (REST for config push; webhooks in), OpenRouter (chat + audio endpoints), Resend, Meta WhatsApp Cloud API, optional Jev (TypeSafe). No other dependencies.

**Spec:** `docs/SPEC.md` (design), `docs/AGENT-PROMPT.md` (agent), `BEHAVIOR-MATRIX.md` Part B (state × event), `criteria/*.md` (1,337 acceptance criteria), `docs/INTEL-CONTRACT.md` + `docs/INTEL-PHASE0.md` (Chase Intelligence), `docs/RESEARCH.md` (why). Executors read SPEC §0 and the task's criteria rows before starting.

**Reference implementation to port from:** `../charlie` (checked out beside this repo). Files named "port" below are copied, attributed in the header comment ("Ported from Charlie `api/_lib/x.ts`; the why-comments are kept"), then trimmed to what this repo uses.

## Global Constraints

- Node `>=22.6`; `"type": "module"`; every relative import in `api/` ends in `.js` (CI greps). Tests import `.ts` directly.
- No framework, no bundler, no build step. `npm run typecheck`, `npm test`, `npm run verify`.
- Dependencies: exactly the four in `package.json` plus dev `typescript`, `@types/node`. Adding one is a plan change.
- No model slug anywhere in `api/` except `HARD_FALLBACKS` in `api/_lib/models.ts` (SPEC R10). Roles: `extract`, `needs`, `writer`, `checker`, `safety`, `voice`, `summary`.
- Documents (`quotedoc.ts`, `roa.ts`, `docparts.ts`): `<table role="presentation">`, inline hex, no grid/flex/`var()`/external CSS (SPEC R8). Brand hex: charcoal `#171f1a`, green `#1f7a4d`, light `#f4f6f5`, rule `#d9e0dc`, text `#222`.
- Every test name carries its criteria ids: `test("[C-0412][C-0413] …")`. A task is not done until `npm run criteria -- --check` shows its ids tagged.
- Test numbers only in the range `+2779993xxxx`; emails `*@example.test`; providers "Demo …" (BEHAVIOR-MATRIX A11/A12).
- Every webhook verifies HMAC over raw bytes with `timingSafeEqual` before parsing; events are stored, then processed in a job.
- Every table: RLS on; only `products`, `product_categories`, `disclosures` have a `SELECT` policy for `anon, authenticated`. Every table has `created_at timestamptz not null default now()`.
- Every model call: through `askJSON()` in `models.ts` with retries, fallbacks, truncation handling, `max_tokens ≥ 1200`.
- Money is integer cents in the database; `formatRand(cents)` renders "R 1 235" (space thousands, whole rand).
- Dates in documents: "31 October 2026"; times in the dashboard: SAST (`Africa/Johannesburg`).
- **Chase Intelligence v1** (SPEC §16, BEHAVIOR-MATRIX A21, `criteria/13-intel.md`): every task that adds an entry point, a model call, a check, a tool, a send, a job, a person action or a status change adds its `capture()` call **in that task**, and its test asserts the row (kind, name, trace id). The Capture map below says which task captures what. Capture never throws, never awaits, never changes a result.
- `jobs.id` is `bigint generated always as identity` (the contract's `job_id` is bigint).
- **Merge, don't wait** (A13): each phase ends with a PR into `main`, merged as soon as verify and CI are green. **Test it yourself** (A19): the founder is never asked to test.
- Commit after every task with a message in the imperative, ending with the session's attribution lines; never a model identifier in the commit.

## Review Focus

Inputs the spec implies but no single task's happy path exercises; each line's test is added to the owning task below.

1. **A caller who gives money as "ten" in an income context and "ten" again as a count of years.** `figures.ts` must scale only when the prior agent turn asked a money question (Task 2.1 test `[C-0525][C-0526]`).
2. **ElevenLabs delivers the audio event, then the transcript event for a conversation whose init never fired (widget preview).** Session must be created on the audio event and merged on the transcript, no duplicate (Task 3.5 test `[C-0427][C-0430]`).
3. **A read-back correction after the channel question** ("oh and actually I'm 43" after the email was confirmed). The correction still supersedes; the channel stays (Task 2.3 test `[C-0600]`).
4. **A broker edits a fact after the quote was sent.** A new version must exist, labelled not sent, and the sent version untouched (Task 8.3 test `[C-1162]`).
5. **Resend's daily cap is hit mid-batch during a demo.** `send_quote` must queue to the next UTC day with status `approved`, not `failed`, and the dashboard must say so (Task 7.3 test `[C-1067][C-1068][C-1070]`).

## Capture map (Chase Intelligence: which task adds which capture)

| Task | Captures (kind `name`) | Criteria |
|---|---|---|
| 0.3 models | `model` per attempt, whole prompt and answer; transcription with audio as type and size | C-1721, C-1722 |
| 0.4 queue, track | `job` enqueued/started/finished/failed/held/skipped; `track` and `error` for every `track()`/`trackFailure()` | C-1713, C-1732, C-1733 |
| 0.6 intel core | `capture()`, buffer, flush, switch, ids, redaction, missing-table behaviour, `readTrace`, `forgetIntel` | C-1700–C-1716, C-1734–C-1743, C-1745–C-1746, C-1753–C-1754, C-1758, C-1765–C-1767 |
| 1.1 migrations | `intel_events` in `db/0006_platform.sql`, RLS, revoke | C-1751, C-1752 |
| 1.2 seeds | `data_use` disclosure says what is kept | C-1748 |
| 3.1 init | `track voice:init` | C-1727 |
| 3.2 tools | `tool <name>`, actor `model` | C-1726 |
| 3.3 post-call | `track webhook:post_call_*` | C-1710 |
| 3.4 ingest | `ask` per client turn, `say` per agent turn, `check` per ElevenLabs evaluation/data-collection result; declined consent → meta only; "forget me" on the call | C-1717, C-1718, C-1725, C-1744, C-1771 |
| 2.3 / 4.2 facts | `check check:fact_refusal` | C-1724 |
| 4.3, 6.2 checkers, safety | `check check:<name>` for every `safety_events` write | C-1723 |
| 4.4 agent prompt | first message says what is kept and how to delete; "forget me" line | C-1747, C-1772 |
| 6.4 pdf | `track pdf:rendered` | C-1735, C-1770 |
| 7.1, 7.2 delivery | `say` (text) + `send` (payload minus address); `track delivery:<status>`; `ask` for WhatsApp in | C-1719, C-1720, C-1728, C-1729 |
| 7.3 status machine | `track quote:<from>-><to>` | C-1731 |
| 8.1 auth | login-code email as kind only | C-1741 |
| 8.3–8.7 dashboard | `track broker:<action>`, actor `person`, channel `dashboard`, before/after/reason | C-1730, C-1769 |
| 8.7 forget | `forgetIntel()` inside `forgetClient()` | C-1745 |
| 8.8 admin, 11.2 health | intel counts, mode, buffered, dropped | C-1763, C-1764 |
| 9.1 push-agent | `track agent:pushed` | C-1768 |
| 10.1 meeting | consent panel says what is kept | C-1749 |
| 11.1 retention | never touches `intel_events` | C-1750 |
| 12.5 export, trace, proof | export, `intel-trace`, the one-id read-back, capture-off-vs-on, `test:intel` | C-1755–C-1757, C-1759–C-1762 |

---

## How the orchestrator runs this plan (BEHAVIOR-MATRIX A1–A3)

1. Read `CLAUDE.md`, `BEHAVIOR-MATRIX.md`, `docs/SPEC.md`, this plan. Run `npm install && npm run criteria -- --count --matrix`.
2. For each task, in order within a phase (phases may interleave only where the task says "parallel-safe"): dispatch a **fresh execution agent** with the brief template below; when it returns, dispatch a **fresh reviewer agent** with the review template; apply the reviewer's required changes via the same executor (SendMessage) or a new one; then run `npm run typecheck && npm test` yourself.
3. At the end of each phase: `npm run typecheck && npm test && npm run test:intel`; `npm run criteria -- --missing | head -60` to see what the phase left; a **phase reviewer** agent reads the whole phase diff against SPEC §0, Part B and the Capture map; fix; commit; push; **open a PR into `main` and merge it once CI is green** (BEHAVIOR-MATRIX A13). Before Phase 0's PR: if the remote has no `main`, create it from the planning commit (`git push origin <planning-sha>:refs/heads/main`).
   Until Task 12.2, CI's criteria step runs `--count --matrix` (untested criteria are expected mid-build); Task 12.2 switches it to `--check --matrix`.
4. An executor spawns no agents. An executor that needs a decision the plan does not make stops and reports; the orchestrator decides and records the decision in the task's notes in this file.
5. Never mark a criterion tagged without a test that would fail on the old code. The reviewer checks the red step's output is in the executor's report.

**Executor brief template** (fill the brackets; paste the task verbatim):

> You are implementing Task N of `docs/superpowers/plans/2026-10-31-call-build.md` in `/home/user/call`. Read `CLAUDE.md`, `docs/SPEC.md` §[sections], `BEHAVIOR-MATRIX.md` Part B §[B-sections], and the criteria rows [ids] in `criteria/[file]`. Charlie's reference file is `../charlie/api/_lib/[x].ts`. Follow the task's steps exactly: write the failing test first and paste its failing output in your report, then implement, then paste the passing output, then commit with the given message plus the attribution lines in the system reminder. Do not touch files outside the task's list. Do not add dependencies. Do not spawn agents. Report: files changed, test output (red and green), criteria ids tagged, anything the plan left undecided.

**Reviewer template:**

> Review the diff for Task N (`git diff HEAD~1`) against the task text in the plan and criteria rows [ids]. Check: (1) the red step genuinely failed for the right reason; (2) every listed criterion has a tag in a test that asserts the row's then-clause, not a weaker one; (3) SPEC §0 rules R1–R15 are not violated; (4) no model slug, no grid/flex/var() in documents, no secrets, no real numbers; (5) names and signatures match the task's Interfaces block. Reply with "APPROVE" or a numbered list of required changes with file:line.

---

## Phase 0 — Scaffold, fakes, and the ported foundations

### Task 0.1: Environment, database client, and the in-memory fakes

**Files:**
- Create: `api/_lib/env.ts`, `api/_lib/db.ts`, `api/_lib/types.ts`, `test/_fakes.ts`, `test/_env.ts`, `test/fakes.test.ts`
- Port from: `../charlie/api/_lib/env.ts`, `../charlie/api/_lib/db.ts` (client creation only), `../charlie/test/_fakes.ts`

**Interfaces:**
- Produces: `env` (frozen snapshot of every variable in `.env.example`, with defaults as listed there); `db(): SupabaseClient` (service role); `installFakeDb(seed?)` returning `FakeDb { client, tables, log, reset() }` with tables for every table in SPEC §4; `installFakeNet()` returning `FakeNet { onModel(re, fn), onFetch(urlRe, fn), calls }` intercepting `fetch`; `fakeStorage()` with `upload/download/remove/list` and `files: Map<string, Uint8Array>`; `fakeClock(iso)` controlling `Date.now()`; `test/_env.ts` setting the fake env before any import (as Charlie's e2e tests do).
- Fake DB supports: `from().select().eq/is/in/gte/lt/order/limit/single/maybeSingle`, `insert`, `upsert` (with `onConflict`), `update().eq`, `delete().eq/in`, `rpc("claim_job")`, `storage.from(bucket)`; anything else throws `FakeDbUnsupported` naming the shape.

- [x] **Step 1: Write the failing test** `test/fakes.test.ts`: `[C-1580]`-adjacent smoke — insert a `brokers` row, select it back, `upsert` with `onConflict: "broker_id,phone_e164"` twice yields one `clients` row; an unsupported shape (`.textSearch`) throws `FakeDbUnsupported`.
- [x] **Step 2: Run** `npm test -- test/fakes.test.ts` → FAIL (module not found).
- [x] **Step 3: Implement** `env.ts` (snapshot at import; `required(name)` helper), `db.ts` `db()`, `types.ts` (row types for SPEC §4 tables as TypeScript interfaces), `_fakes.ts` (port; add Storage and clock).
- [x] **Step 4: Run** → PASS. `npm run typecheck` → clean.
- [x] **Step 5: Commit** `Scaffold: env snapshot, db client, in-memory fakes`

**Notes (decided while building):** `env` is `export let env` — a frozen snapshot taken at first import and an ES live binding — with `reloadEnv()` as the test seam (production never calls it), chosen over lazy getters so production keeps true snapshot semantics; `required(name)` throws naming the variable; a number that is unset, blank, negative or not a number falls back to its `.env.example` default (never NaN); `readiness()` is not ported (it lands with `health.ts` in 0.5). `test/_env.ts` sets or deletes every `.env.example` variable except `INTEL_CAPTURE`/`TRACKING_OFF` (the npm scripts own those, C-1757), `_fakes.ts` imports it first so a test importing only the fakes is covered, and `setEnv(values)` changes variables mid-file and re-snapshots (`fakes.test.ts` fails if `.env.example` gains a variable `_env.ts` does not cover). `db.ts` keeps Charlie's `__setClient` seam; `installFakeDb()` uses it and `uninstall()` is idempotent. The fake DB knows exactly the 31 tables of `api/_lib/types.ts` (an unlisted table is a type error; an unknown table, rpc, client property, or filterless update/delete throws `FakeDbUnsupported`), returns `data: null` for a write without `.select()`, errors `.single()` on 0 or >1 rows (PGRST116), returns copies, refuses `upsert({onConflict})` on columns with no declared unique constraint (42P10), and emulates 23505 for the `UNIQUE` table in `_fakes.ts`. `fakeClock` fakes `Date` only (timers stay real). `FakeNet` has `onModel`, `onFetch`, `calls`, `modelCalls`, and no built-in Resend/Meta/ElevenLabs fakes (later tasks register them with `onFetch`); a chat reply is always `finish_reason: "stop"` unless the responder returns its own `Response` (Task 0.3 may add a helper). **For Task 1.1 (the fake mirrors these; make the SQL agree):** (1) `clients` needs a plain `UNIQUE (broker_id, phone_e164)`, not SPEC §4's partial index `WHERE phone_e164 IS NOT NULL` — supabase-js `upsert({onConflict})` cannot name an index predicate, so a partial index fails in production with 42P10, and NULLs are already distinct so behaviour is identical; (2) also unique: `sessions.conversation_id`, `turns(session_id, idx)`, `webhook_events(provider, external_id, event_type)`, `jobs.dedupe_key`, `intel_events.source_ref`, `model_config.role` (PK); (3) defaults the fake applies: brokers `country 'ZA'`, `currency 'ZAR'`, `auto_send false`, `retention_days 30`; `products.is_demo true`; `facts.approx false`; jobs `status 'queued'`, `attempts 0`, `run_after now()`; (4) `claim_job(p_worker text)` returns the oldest runnable job (queued and due, or running with a lock over five minutes old), `attempts + 1`, `locked_by`, as a set of rows; (5) `jobs.id` and `intel_events.id` are bigint identity, every other id a uuid; (6) `callbacks`, `client_messages` and `meeting_chunks` columns in `types.ts` are the minimum the criteria need (SPEC §4 does not list them) — the migration is the authority; (7) SPEC §3.2 says `meeting_turns` but §4 and this task list have no such table, so `turns` (role `broker`/`client`/`unknown`) is used and `types.ts` follows the Task 1.1 list. **Fix round 1 (review), also for Task 1.1:** (8) the fake's `DEFAULTS` (test/_fakes.ts) now cover every non-null column with a default, and the SQL must match: besides (3), sessions `readback_confirmed false`, `cost_cents 0`; facts `status 'active'`; recommendations `status 'draft'`; quotes `version 1`, `status 'draft'`, `flags '{}'`; deliveries `status 'queued'`; hardship_notes `quotes_from_client '{}'`; product_categories `need_kinds '{}'`; products `active true`, `exclusions '{}'`, `keywords '{}'`; model_config `fallbacks '{}'`, `params '{}'`, `enabled true`; jobs `payload '{}'`; webhook_events `received_at now()`; audit_log `at now()`; incidents `first_at now()`, `last_at now()`, `count 1`; intel_events `at now()`, `seq 0`, `v 1`, `content_mode 'full'` and **no `created_at`** (orchestrator ruling: the contract's columns are exact, so Task 1.1's C-1580 check must exempt it); (9) Storage has exactly the buckets `recordings` and `quotes` (any other is "Bucket not found"); (10) `claim_job` compares with NULL as SQL does (a NULL `run_after` is never due, a NULL `locked_at` never stale). The fake also now checks every column name against `types.ts` (filters, order, select, writes, seeds), accepts only `col` or `col->>key` on a jsonb column, throws on unimplemented options, undefined filter values, null outside `is()`, and a batch whose rows have different keys (PostgREST writes NULL, not the default, into the gaps); upsert and update are one statement (21000 on a repeated conflict key; uniqueness checked on the end state); an explicit id on `jobs`/`intel_events` is 428C9; `rpc()` is a lazy builder with `single()`/`maybeSingle()`.

### Task 0.2: Webhook signature verifiers

**Files:** Create `api/_lib/crypto.ts`, `test/crypto.test.ts`. Port the HMAC helpers from `../charlie/api/_lib/crypto.ts`.

**Interfaces:**
- `verifyElevenLabs(raw: Buffer, header: string | null, secrets: string[], nowSecs?: number): { ok: boolean; reason?: "missing"|"malformed"|"stale"|"future"|"mismatch"; secretIndex?: number }` — header `t=<unix>,v0=<hex>[,v0=<hex>]`, HMAC-SHA256 hex over `${t}.${raw}`, reject `t` older than 1800 s or more than 300 s ahead.
- `verifyResend(raw: Buffer, headers: {id, timestamp, signature}, secretB64: string): boolean` — svix scheme, 300 s tolerance.
- `verifyMeta(raw: Buffer, header: string | null, appSecret: string): boolean` — `sha256=<hex>`.
- `safeEqualHex(a: string, b: string): boolean` — length check then `timingSafeEqual`.
- `hmacHex(secret, data)`, `sha256Hex(data)`.

- [x] **Step 1: Write failing tests** tagged `[C-0412][C-0414][C-0415][C-0416][C-0417][C-0418][C-0419][C-0421][C-0422][C-1587][C-1588][C-1589][C-1590][C-1591]`: build a signed body with a known secret; assert each reason; multibyte body; two `v0=` values; two secrets (rotation) returns `secretIndex: 1`.
- [x] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [x] **Step 5: Commit** `Verify ElevenLabs, Resend and Meta webhooks over raw bytes`

**Notes (decided while building):** The interfaces are as listed, with compatible widenings: header arguments also take `undefined` (Node's `req.headers[x]`), the body may be any `Uint8Array`, and the result types are exported as `SignatureReason` / `SignatureCheck`. Each verifier throws a `TypeError` naming the wiring bug when handed anything but bytes, so a platform-parsed `req.body` fails the handler's first test loudly instead of answering 401 in production; it never throws on request input. An empty secret never verifies (anyone can compute an HMAC with an empty key); an empty slot in `secrets` is skipped but keeps its index, so `secretIndex` always names the same variable. `safeEqualHex("", "")` is `false` (Charlie's returned true). ElevenLabs: age ≤ 1800 s and ≤ 300 s ahead verify; two `t=` values are `malformed`; unknown parts are ignored; `v0` hex is case-insensitive; the `t` string as sent is what is signed. `verifyResend` keeps the 3-argument interface (no `nowSecs`; tests use `fakeClock`), the window is 300 s either side, only `v1,` entries count, and the `whsec_` prefix is optional. `verifyMeta` requires the `sha256=` prefix. node:crypto is used through its module object so the test counts the `timingSafeEqual` calls. **Owed by Task 3.3:** C-0412, C-0414–C-0418 and C-0422 are not tagged here (their then-clauses are HTTP answers and the rotation log line); the verifier half of each is pinned in `test/crypto.test.ts`. `env.ts` has no `ELEVENLABS_WEBHOOK_SECRET_PREVIOUS` yet: 3.3 adds it (with `.env.example` and `test/_env.ts`), passes `[current, previous]`, logs `secretIndex`, and decides how the "24 h" in C-0422 is enforced (the verifier has no notion of when a rotation began). Signature checks get their `capture()` in the handlers (`intel.ts` arrives in Task 0.6).

### Task 0.3: Model layer (port) and `model_config` loading

**Files:** Create `api/_lib/models.ts` (port of `../charlie/api/_lib/models.ts`), `api/_lib/jobctx.ts` (port), `test/models.test.ts`. Modify `test/_fakes.ts` if `onModel` needs `finish_reason` support.

**Interfaces:**
- `type Role = "extract"|"needs"|"writer"|"checker"|"safety"|"voice"|"summary"`.
- `askJSON<T>(role: Role, prompt: string, opts: { maxTokens?: number; schema?: (x: unknown) => x is T; jsonMode?: boolean; deadlineMs?: number; sessionId?: string }): Promise<{ value: T; model: string; usage: {in: number; out: number} }>`.
- `askText(role, prompt, opts)` same shape with `value: string`.
- `transcribeAudio(bytes: Uint8Array, mime: string, opts): Promise<{ text: string; segments?: {start: number; end: number; text: string}[]; language?: string }>` using the `voice` row (`provider` openrouter|groq|openai).
- `HARD_FALLBACKS: string[]` (copy Charlie's current list), `MIN_MAX_TOKENS = 1200`, `loadModelConfig(role): Promise<ModelConfig>` cached 60 s.
- Errors: `ModelUnavailable`, `ModelBadRequest`, `DeadlineError`.

- [x] **Step 1: Failing tests** `[C-1500]…[C-1525]`: scripted gateway returns `finish_reason: "length"` once → second call has doubled `max_tokens`; 429 → fallback called with no delay (fake clock unchanged); 400 → `ModelBadRequest`, no fallback; fences/trailing commas/prose → parsed; row disabled → fallbacks + incident; cache 60 s.
- [x] **Step 2–4:** red → port → green. **Step 5: Commit** `Port the model layer: roles from model_config, fallbacks, truncation retries`

**Notes (decided while building):** `models.ts` exports the listed interface plus `MAX_MAX_TOKENS` (8000), `DEFAULT_TEMPERATURE` (0.2), `CONFIG_CACHE_MS`, `MIN_CALL_MS`, `JSON_ONLY`, `candidatesFor`, `costCents`, `callOpenRouter`, `extractJSON` and `__clearModelCache()` (the test seam; it also clears the once-a-day incident memory). `loadModelConfig` never throws: it returns a `ModelConfig` with `source` `row`|`missing`|`unreadable`; a successful read (row or no row) is cached 60 s, an error is not (recovery is the next call). The chain is the row's model (skipped when `enabled=false`), its `fallbacks`, then `HARD_FALLBACKS`, each slug once; missing/unreadable → `HARD_FALLBACKS` alone. Truncation or an empty answer doubles `room` (cap 8000) and retries the same model once (two attempts per model), then the next model keeps the larger room (A@1200, A@2400, B@4800). 429/5xx/404/408/network/HTTP-200-with-error → next model, no sleep (404 is a retired model: what fallbacks are for); other 4xx → `ModelBadRequest` (body excerpt ≤ 400 chars in the message, never in the incident); 401/403 → `ModelUnavailable(kind auth)` + critical incident `openrouter_credential`, no fallback; a 402 on a `:free` slug (balance below zero) → `ModelUnavailable(kind credit)` + `openrouter_credit`, no fallback; a 402 on a paid slug skips the paid slugs left and goes on to the `:free` ones, raising `openrouter_credit` only if none answers (fix round 1). Unreadable JSON or a schema rejection → one retry on the same model with `JSON_ONLY` appended → `ModelUnavailable(kind bad_output)`, no fallback (BEHAVIOR B12 "fail the step"). Incidents: `role_disabled:<role>` (warn), `role_missing:<role>` (error), once a day per role per instance; `model_config_unreadable` (critical) every time; `model_call_failed:<role>:<kind>` when an ask gives up. `usage_ledger`: one `llm_tokens` row per attempt that spent tokens, `qty` = in + out, `unit` `tokens`, `provider_ref` = the slug called, `cost_cents` = ceil((in·`cost_per_mtok_in` + out·`cost_per_mtok_out`)/1e6) with the rates in cents per million tokens from the role's params, 0 for a `:free` slug or no rates. `safety_events` `model_fallback`: `engine rules`, `outcome flag`, `detail {role, from (row model or null), to, reason, tries}` whenever the answer is not from the row's own enabled model. `deadlineMs` is a budget from the start of the ask; the nearer of it and the job's `deadlineAt` applies; a call needs `MIN_CALL_MS` (20 s) + 5 s wrap-up left or `DeadlineError` is thrown before it is sent, unchanged to the job. `askText` gets the same truncation retry (Charlie's known gap). `json_mode` is opt-in per row (`opts.jsonMode` overrides). Not ported from Charlie: streaming/stall detection, `require_parameters`/ignored providers, embeddings, the per-request model-call trace, `LAST_RESORT_VOICE` (decision: slugs only in `HARD_FALLBACKS`), the `openrouter_chat` voice route. `transcribeAudio` routes `openrouter` (default) / `groq` / `openai` with Charlie's multipart request, namespace stripped for direct providers, `verbose_json` for groq/openai with a plain retry on 400, the row's `fallbacks` on the same provider; a disabled/missing/unreadable voice row throws `ModelUnavailable` and sends nothing (HARD_FALLBACKS cannot hear); an empty transcript is returned for the job to judge (C-1335); the transcription ledger row (C-1333) is the job's, from the returned `duration`. `env.ts`, `.env.example` and `test/_env.ts` gain `GROQ_API_KEY` and `OPENAI_API_KEY` (optional, for those two routes). `jobctx.ts` is ported without `retriesOnDeadline`/`rethrowGuardrailDeadline` (Charlie's plan-build kinds) and `fenceCheck` (comes back with `queue.ts`'s `stillOwnJob`, Task 0.4). `track.ts` (ported now, per the orchestrator, for `models.ts`): context via AsyncLocalStorage (`sessionId`, `clientId`, `brokerId`, `channel`, `stage`, `jobId`, `traceId`), `track`/`trackFailure` (severity, alert, fingerprint, summary), listeners/flushers registry for intel.ts, `holdForFlush`, `flushTracking`, `tracked()` with `waitUntil`, `trackingOff()`; no `events` table exists in Call, so `track()` reaches only listeners, and a problem bumps `incidents` through `rpc("bump_incident", {p_fingerprint, p_kind, p_severity, p_summary})` even under `TRACKING_OFF=1` (C-1552); summaries are masked for emails and phone numbers (C-1437). Console capture, excerpts and the forget buffer are not ported (Task 0.4 may add console capture with alerts). **For Task 1.1 (the fake mirrors these; make the SQL agree):** (11) `incidents.fingerprint` is UNIQUE (the fake's `UNIQUE` now lists it); (12) `bump_incident(p_fingerprint text, p_kind text, p_severity text, p_summary text) returns void`, `SECURITY DEFINER`: insert `{kind, severity, left(summary, 500), fingerprint}` or on conflict `count + 1`, `last_at = now()`, the worse severity of the two (info < warn < error < critical), the new summary; severity is CHECKed to those four (23514). Task 0.4 extends its arguments when `alerts.ts` needs alert levels. The fake also gained `modelReply(content, {finishReason, usage, model, id})` and `failTable(table, error?)` (every query on the table answers with the error, default 42P01, until `failTable(table, null)`; `reset()` clears it) — Task 0.6 can use it for the missing `intel_events` switch. **Fix round 1:** `extractJSON` rejects a top-level list (as Charlie's first-`{`-to-last-`}` slice did; the JSON-only retry asks for one object), strips only a fence that opens or closes the reply, and an object or list that never closes counts as truncation (more room, same model) whatever `finish_reason` says; with `json_mode`, a 400 naming `response_format` retries the same model once without it (Charlie's, restored; per model, not per ask); a non-`ModelError` thrown inside the request is our bug and is thrown as it is, to no other model, its text in the log line and the incident summary (the request body is now built outside the fetch `try`, and a 200 body that is JSON but not an object is the provider's failure); `track.ts` `errorText` gives a `ModelBadRequest` as `ModelBadRequest: <status> (<model>) for <role>`, never the provider body, and `holdForFlush` uses `then(del, del)` so a held promise that rejects is not an unhandled rejection.

### Task 0.4: Queue, tracking, alerts, email (ports)

**Files:** Create `api/_lib/queue.ts`, `api/_lib/track.ts`, `api/_lib/alerts.ts`, `api/_lib/email.ts`, `api/worker.ts`, `test/queue.test.ts`, `test/alerts.test.ts`. Port from Charlie's files of the same names; `email.ts` gains `sendEmailTo(msg & { to: string[]; replyTo?: string; attachments?: {filename: string; content: Buffer}[]; idempotencyKey?: string })`.

**Interfaces:**
- `enqueue(kind: JobKind, sessionId: string | null, payload: object, opts?: { runAfter?: Date; dedupeKey?: string }): Promise<string>`.
- `JobKind = "ingest_transcript"|"store_audio"|"extract_facts"|"analyse_needs"|"match"|"write_quote"|"check_quote"|"notify_broker"|"send_quote"|"forget_client"|"transcribe_meeting"|"label_speakers"`.
- `drain(opts: DrainOptions): Promise<DrainReport>`; `registerHandler(kind, fn: (job: JobRow, ctx: JobCtx) => Promise<void>)`.
- Fencing: `lock_timeout` 120 s, `touchJob` every 30 s, `stillOwnJob`, per-session serialisation, 3 parallel sessions, backoff 10/60/300 s, 3 attempts then `failed` + incident.
- `track(event, props)`, `trackFailure(event, message, {severity, alert, fingerprint, summary})`, `runAlerts()`; `incidents` table semantics as Charlie.
- `api/worker.ts`: `POST/GET /api/worker` with `WORKER_SECRET` or `CRON_SECRET` (`?tick=1`); 240 s budget; hand-on self-call.

- [x] **Step 1: Failing tests** `[C-0485]…[C-0499]`, `[C-1597]…[C-1610]`, `[C-1541][C-1548][C-1550][C-1552]`.
- [x] **Step 2–4.** **Step 5: Commit** `Port the job queue, tracking, alerts and email sender`

**Notes (decided while building):** `track.ts` needed no change; its tests are in `test/alerts.test.ts`. **Queue** (`queue.ts`, with Charlie's job helpers from `db.ts` and `chain.ts` folded in): `enqueue` returns the job id as a string; a duplicate `dedupeKey` returns the first job's id and leaves it alone, unless it is `failed`, when it is revived once (queued, attempts 0, `last_error` null — C-0488); `enqueueNext(kind, sessionId, payload, opts)` inside a job is written only after the step returns and only while the attempt still owns its job (C-1608), so a step queues its successor with it and a dedupe key; `registerHandler` returns an undo, and **`api/worker.ts` imports every handler module** (Task 3.4's "registers the handler in queue.ts" = `registerHandler` in `ingest.ts` plus that import); `fenceCheck({maxAgeMs})` lives here (it needs `stillOwnJob`); `kickWorker(label)` is the webhook's kick (Task 3.3). `DrainReport` = `{claimed, done, failed, held, fenced, skipped}` (`skipped` added). `MAX_ATTEMPTS` 3: retried after 10 s then 60 s, `failed` on the third failure with incident `job_failed:<kind>` (error, summary names the kind and the session's first 8 characters); `BACKOFF_SECONDS` [10, 60, 300] and 300 s is the ceiling no 3-attempt job reaches, kept for a kind later allowed more attempts (three attempts is fixed by C-0486, C-1541 and SPEC §12; C-0485's row now reads "10 s, then 60 s; a third failure is final per C-0486"; B4's "retried ×3" is read as three attempts); no jitter. Not counted as an attempt: a busy session (`otherJobRunningFor` → held `HOLD_MS` 5 s), a `JobHoldError` (held for its delay), and the first `DeadlineError` (requeued at once, `last_error` "out of time…"); a second consecutive `DeadlineError` counts, so a job that never fits cannot loop. A job claim_job reclaims with attempts > 3 (its worker died on the last attempt) is failed without running. An unregistered kind is failed at once, `last_error` `unknown_kind: …`, incident `unknown_kind:<kind>` (error). A job whose session (`session_id`, or `payload.session_id`) no longer exists is `skipped` without running; `forget_client` is exempt (and see Fix round 1: CASCADE, forget first). A drain runs 3 lanes, each its own fencing token (`<label>-<region>-<pid>-<8 hex>-<lane>`), heartbeat 30 s, stops claiming at max(0.6·budget, budget − 90 s) when it can hand on (else at the budget), hard stop budget + 10 s (Fix round 1), then flushes tracking and hands on (`/api/worker?async=1&max=10&hop=n`, one retry, `self_call_failed`/`self_call_refused` warn incidents); `MAX_WORKER_HOP` 2. `TRACKING_OFF=1` stops every self-call. Not ported: the watchdog chain, the overrun guard, long-job deferral, apologies — a job hung past the hard stop is reclaimed 120 s after its last heartbeat by the next drain. **Worker:** 401 with `WWW-Authenticate: Bearer` (Charlie answered 403; C-0496 says 401); `max` 1–50, default 10; `?tick=1` drains and answers the report plus `alerts`; every form ends with `runAlerts()`, because the cron runs daily. **Alerts:** (superseded by Fix round 1: `incidents.alert_level` decides, not severity.) There is no `alert_state` table: each email is one `audit_log` row (`broker_user_id` null, `action` `alert_email_sent`, `entity` `incidents`, `after` `{kind: "immediate"|"digest", status, prev, subject, provider_id, incidents: {fingerprint: count}}`), read back for the 5-minute gap, the 60-a-day cap and the 30-minute same-problem cooldown (re-sent after it only if the count grew); incidents lookback 24 h. A send that fails raises `alert_email_failed` as a warning. Console capture is not ported. **Email:** `sendEmailTo({to, subject, text, html, fromName?, replyTo?, attachments?, idempotencyKey?})` → `{ok, id?, status?, retryable?, sandbox?, skipped?, error?}`; from = `fromName <address in QUOTE_EMAIL_FROM>` or `onboarding@resend.dev` (sandbox) when unset; "email not configured" without `RESEND_API_KEY`; "invalid_address" for an empty list, a malformed address or a CR/LF; 429/5xx/network retryable, other 4xx final; `Idempotency-Key` header; no address in any error, and no console call in the file. `alertsConfigured()` = key + one valid `ALERT_EMAIL_TO`; `/api/health` gains top-level `alerts: "configured"|"unconfigured"` (C-1548). Owed elsewhere: C-0487/C-1609 (Task 8.8: the admin retry sets `attempts=0, status=queued, run_after=now`), C-1607 (Task 11.1). **For Task 1.1 (the fake mirrors these; make the SQL agree):** (13) `claim_job(p_worker text) returns setof jobs`, `SECURITY DEFINER SET search_path = public`, revoked from anon/authenticated: runnable = (`status='queued' and run_after <= now()`) or (`status='running' and locked_at < now() - interval '120 seconds'`), **and** (`session_id is null` or no job with the same `session_id`, a lower `id` and `status in ('queued','running')`), `order by run_after, id`, `for update skip locked`, `limit 1`; set `status='running'`, `locked_at=now()`, `locked_by=p_worker`, `attempts=attempts+1`, returning the row; add the index `jobs (session_id, id) where session_id is not null`; **amended by Fix round 1:** the session condition is `kind = 'forget_client' or session_id is null or not exists (…earlier queued/running job of the session…)`, and the order is `order by (kind = 'forget_client') desc, run_after, id` (a runnable forget is claimed before anything else and never waits behind its session); (14) `audit_log.broker_user_id` is nullable (the alert rows), and `audit_log.id` takes an explicit uuid on insert (the alert email's slot id, Fix round 1); `bump_incident` gains a fifth argument (15). (15) **Fix round 1, for the Task 1.1 follow-up (the fake mirrors these; make the SQL agree):** `jobs.session_id uuid REFERENCES sessions(id) ON DELETE CASCADE` (was SET NULL): a forgotten session's queued jobs go with it, a running one loses its row and is fenced by `stillOwnJob` (a missing row is now `false`), and a job that still names a gone session (in `payload.session_id`, or a row claimed just before its session went) is `skipped`; `incidents.alert_level text NOT NULL DEFAULT 'digest' CHECK (alert_level IN ('immediate','digest','none'))`; `bump_incident(p_fingerprint text, p_kind text, p_severity text, p_summary text, p_alert_level text) returns void`: insert with `alert_level = p_alert_level`, and on conflict keep the loudest (`none` < `digest` < `immediate`) as severity keeps the worst (Charlie db/0025's coming-down needs `since_email`, which Call lacks); revoke/grant the new five-argument signature (and drop the four-argument one). **Fix round 1 (decided):** **forget:** `enqueue("forget_client", sessionId, payload)` stores `session_id` null and puts the session in `payload.session_id` (with CASCADE a forget tied to a session it deletes would delete itself, and the insert would break the foreign key once that session is gone); **`forgetClient()` (Task 3.4 minimal, 8.7 complete) must first set `status='cancelled'` on every queued job of the client's sessions, then delete** (C-1412: a forgotten client never receives a quotation, and the cancelled rows are the audit before the cascade removes them). **Alert levels:** `track()` passes its level (the caller's `alert`, else `immediate` for error/critical and `digest` below) to `bump_incident`; the immediate email selects `alert_level = 'immediate'`; the daily digest (`runDigest`, sent only by the `?tick=1` pass, at most once per 20 h, digest-level incidents new or grown since the last digest, 48 h lookback) carries `digest`; `none` is never emailed. `models.ts`' `model_call_failed` already passes `alert: "digest"` and is now a digest (a retried out-of-time one stays `none`); C-1550's test now uses an immediate-level fingerprint (a delivery failure is a digest, C-1543). **Alert email record:** written before the send as the claim on it: its id is `slotId(kind, prev)`, a uuid derived from the record it follows, so two passes at once compute the same id and the primary key admits one (the atomic 5-minute gap); the send carries `Idempotency-Key: alert:<id>`; the row is then marked `sent` (with `provider_id`) or `failed`; a row left `sending` counts as sent (never re-sent; a claimed-but-unsent email waits for its problem to grow); history is read per kind, newest 500 rows regardless of age, so "N new" counts from the last email that carried the problem ("seen again" when that email is older than the rows read). `sendEmail` takes `idempotencyKey`. **Waiting and overdue:** `DrainOptions.waitForDue` (replaces `waitForDueMs`): lane 0 waits in-process (via `__setSleep`'s injectable pause, the fake clock in tests) for the next queued job due before the drain stops claiming, even after claiming, and the other lanes wait on it; the hand-on (`?async=1`) and the tick set it, the plain sweep does not (it answers with what it did now); a drain that cannot hand on (`mayWakeWorker()` false at `MAX_WORKER_HOP`) claims until its whole budget. `overdueJobs(now)` → `{count, oldest: {id, kind, minutes}|null}` for queued jobs > `OVERDUE_MS` (10 min) past `run_after` (Task 11.2's health calls it); `noteOverdueJobs()` runs first in every worker run and raises `job_overdue` (error, immediate). **Machinery failures:** `DrainReport` gains `ok` and `errors`; a failed claim → `claim_job_failed` (critical, immediate), an unsettleable job → `job_unsettled:<kind>` (error, immediate), a hand-on that cannot read the queue → `hand_on_failed` (warn, digest), each `ok: false`; the sweep and the tick answer 500 with the report then. **Fenced settles:** `holdJob` (worker now required), `scheduleRetry` and `touchJob` are conditional on `locked_by` and `status='running'` and return whether they wrote; a settle that writes nothing (another worker reclaimed between the ownership check and the write), including the last attempt's `finishJob`, is counted `fenced` with no `job_retry`/`job_failed`. **Traces:** a heartbeat that errors or finds its lock taken raises `job_heartbeat_failed:<kind>` (warn) once per attempt; an unreadable `otherJobRunningFor` is `session_check_failed` (warn) and counts as busy (held). **Tail:** `VERCEL_KILL_MS` 300 s, `HARD_STOP_MARGIN_MS` 10 s (hard stop 250 s), `SELF_CALL_TIMEOUT_MS` 5 s, `FLUSH_TIMEOUT_MS` 4 s (track.ts), `ALERT_PASS_MAX_MS` = 2 × `SEND_TIMEOUT_MS` + flush + 4 s (alerts.ts): 250 + 4 + 10 + 28 ≤ 295. The fake: `claim_job` forget-first, deleting a session deletes its jobs, `bump_incident` takes `p_alert_level`, an rpc answers its table's `failTable()` error (claim_job → jobs, bump_incident → incidents). Deferred: Minor 1 (C-0494's idempotence is shown for the stand-ins only; each real step's task proves its own).

### Task 0.5: `vercel.json`, health skeleton, static security tests

**Files:** Create `vercel.json`, `api/health.ts`, `test/health.test.ts`, `test/security-static.test.ts`, `scripts/preview-quote.mjs` (smoke stub that exits 0 with "no renderer yet" until Task 6.4), `docs/VERIFIED.md` rows filled for Vercel/Supabase/OpenRouter/Resend.

**Interfaces:** `GET /api/health` → SPEC §12 fields (services from env only in this task; counts added in Task 11.2). `?ping=1` → `{ok:true}` after `select 1`.

- [x] **Step 1: Failing tests** `[C-1529][C-1535][C-1537][C-1539]`, static `[C-1572][C-1573][C-1592][C-1593][C-1439]` (the static tests grep `api/` and `public/`; they pass trivially now and bite later).
- [x] **Step 2–4.** Functions in `vercel.json`: `api/voice.ts` 60 s/1024 MB, `api/worker.ts` 300 s, `api/app.ts` 30 s, `api/meeting.ts` 60 s, `api/render-pdf.ts` 120 s/2048 MB with `includeFiles` for chromium, `api/health.ts` 15 s, `api/cron/*` 120 s; crons `/api/worker?tick=1`, `/api/cron/retention`, `/api/cron/keepalive`, `/api/cron/freshness` at schedules the Hobby plan allows (record the allowed minimum in VERIFIED.md; if once a day, the worker's hand-on and the webhook's kick carry the load, as in Charlie).
- [x] **Step 5: Commit** `Vercel config, health skeleton, static security tests`

**Notes (decided while building):**
- **Every task that creates an `api/*.ts` entry point adds its `functions` entry to `vercel.json` in the same commit.** `test/security-static.test.ts` fails on a key with no file (a failed deploy), an entry point with no key, or a cron with no handler. Values: Task 0.4 `api/worker.ts` `{"maxDuration": 300}`; 3.1 `api/voice.ts` `{"maxDuration": 60, "memory": 1024}`; 6.4 `api/render-pdf.ts` `{"maxDuration": 120, "memory": 2048, "includeFiles": "{node_modules/@sparticuz/chromium/bin/**,fonts/**}"}` (drop `fonts/**` if Call ships none); 8.1 `api/app.ts` 30; 10.1 `api/meeting.ts` 60; 11.1 `api/cron/*.ts` 120; any other (`api/resend-webhook.ts` 7.1, `api/wa.ts` 7.2, `api/admin.ts` 8.8, `api/demo.ts` 9.2) 30 unless its task says otherwise. `memory` on Hobby and every `maxDuration` are "confirm on deploy" (VERIFIED.md).
- **Task 11.1, crons.** Hobby allows one run a day, so in UTC: `/api/cron/retention` `0 1 * * *`, `/api/cron/freshness` `0 2 * * 1` (weekly, SPEC §12), `/api/worker?tick=1` `0 3 * * *` (catch-up only), `/api/cron/keepalive` `0 4 * * *`. An hour apart because Hobby fires anywhere in the hour; the webhook's kick and the worker's hand-on carry the queue, as in Charlie.
- **Task 3.1 (`api/voice.ts`), 7.1, 7.2 and every webhook** (also any `*webhook*` entry point, or one calling `verifyElevenLabs/Resend/Meta`), C-1592: name the request `req` or `request`; read its bytes once in the handler file (`req.arrayBuffer()`, `req.bytes()`, `req.body.getReader()`, `for await (… of req)`, or `bodyParser: false`); parse from those bytes; never call `req.json()/text()/formData()`. The check reads code with comments and strings removed.
- **The same handlers, C-1593:** no file a handler reaches through its relative imports may import `_lib/models`, call `askJSON/askText/transcribeAudio` or name `openrouter.ai`. The walk stops at `api/_lib/queue.ts` (enqueue is the door into job work), so job handlers are registered from `queue.ts` or the worker, never imported by a webhook file. Task 3.3 adds the behavioural half: `askJSON` is never called while the post-call webhook answers.
- **Every port, C-1439:** no `console.*` argument may hold "body" anywhere in its code (string text removed), `raw*`, or `req/request.text()/json()…`. Rename before porting: Charlie `transcribe.ts:231` (`body`) and `wa.ts:326` (`bodyText`, Task 7.2).
- **Task 11.2, health:** fold DB reachability into `ok` (C-1536); decide whether `guardrails_live` joins `ok` (Charlie's did); reconcile C-0411's `post_call` with C-1529's `services.elevenlabs_webhook`; add `capture()` (Task 0.6 builds `intel.ts`).
- **Health as built:** a Web handler, `GET(req)`. `services` come from env only, each `configured` only when every setting it needs is set (supabase: URL + service role key; whatsapp: token + phone number id + app secret; resend; elevenlabs_webhook: webhook secret; voice_tools: tool secret; openrouter; jev: `TYPESAFE_API_KEY`). `ok` = the six required settings of `.env.example`'s first block, `required_missing` their count, 503 when not ok. `guardrails_live: false` until the checkers exist. `version` = `VERCEL_GIT_COMMIT_SHA` or `"dev"`. `?ping=1` = `db().from("model_config").select("role").limit(1)` (its test records that whole chain), 200 `{ok:true}` or 503 `{ok:false}` with a `console.warn` saying why.
- `scripts/preview-quote.mjs` prints "no renderer yet" and exits 0 until Task 6.4.
- **C-1527/C-1528 (fix round 1):** the tests run `scripts/grep-models.sh` itself on temp trees, and check that `api/_lib/models.ts` with its `HARD_FALLBACKS` array cut out holds no slug: the script exempts the whole file, the rule only the array.

### Task 0.6: Chase Intelligence core

**Files:** Create `api/_lib/intel.ts` (port of Charlie `api/_lib/intel.ts` at commit `59b6cb4`, `APP = "call"`), `api/_lib/intelredact.ts` (port; add this deployment's secrets from `.env.example`, the `/q/…?sig=` signed-link shape, and the money-key allowlist for JSON numbers), `test/intel.test.ts`, `test/intel-redact.test.ts`. Modify `api/_lib/track.ts` (trace context carries `trace_id`, `session_id`, `client_id`, `broker_id`, `channel`, `stage`; every `track()`/`trackFailure()` also captures), `api/_lib/models.ts` (capture every attempt), `api/_lib/queue.ts` (capture job lifecycle; a job's context is its session's trace), `test/_fakes.ts` (an `intel_events` table; a switch to simulate the table missing).

**Interfaces:**
- `capture(kind: IntelKind, opts: { name: string; actor?: Actor; content?: unknown; meta?: Record<string, unknown>; ok?: boolean | null; ms?: number; channel?: Channel; turnId?: string }): void` — reads the trace context; never throws; never awaits.
- `withTrace<T>(ctx: { traceId: string; sessionId?: string; clientId?: string; brokerId?: string; channel?: Channel; stage?: string; jobId?: number; contentMode?: "full"|"meta" }, fn: () => Promise<T>): Promise<T>` (AsyncLocalStorage).
- `traceForSession(sessionId): string` → `"s_" + sessionId`; `requestTraceId(): string` → `"r_" + 16 hex`; `turnIdFor(sessionId, idx)`, `turnIdForWamid(wamid)`.
- `flushIntel(): Promise<{ written: number; dropped: number }>` (batches ≤ 500 rows / 1 MB; 3 attempts; missing-table backoff 10 min).
- `readTrace(id: string): Promise<IntelRow[]>`; `forgetIntel(clientId: string): Promise<number>` (written and buffered).
- `redactText(s)`, `redactJson(v)`, `redactDeep(v)` in `intelredact.ts`.
- `Channel = "phone"|"web"|"meeting"|"dashboard"|"email"|"whatsapp"|"system"`.

- [x] **Step 1: Failing tests** C-1700–C-1716, C-1721, C-1722, C-1732, C-1733, C-1734, C-1736–C-1743, C-1745, C-1746, C-1753, C-1754 (unit form, against the fakes), C-1758, C-1765–C-1767.
- [x] **Step 2: Run** → FAIL. **Step 3: Implement** (port, adapt per `docs/INTEL-PHASE0.md` §3). **Step 4: Run** `npm test` and `npm run test:intel` → PASS, same counts.
- [x] **Step 5: Commit** `Chase Intelligence: one id per session, every task recorded whole`

**Notes (decided while building):** **Ids:** `traceOf(ctx)` = `s_<sessionId>` when the context has a session (it wins over the request's `r_` id, so an entry point that learns its session with `setTrackContext({sessionId})` puts every later row in the session's trace), else `job_<jobId>`, else `ctx.traceId`, else a per-process `p_` + 16 hex (never forgotten whole). `withTrace(ctx, fn)` is `withTrackContext` (one store); `TrackContext` gained `turnId` and `contentMode` (`"meta"` = shape only whatever the switch: declined consent, C-1744 for Task 3.4). `turn_id`: a value that is not `t_` + 16 hex is hashed (`turnIdForWamid`), so no raw wamid or number is ever stored. `business_id` = `ctx.clientId` when it is a uuid (else null: one bad value would fail a 500-row batch); `meta.broker_id` = `ctx.brokerId` on every row; `channel` = `opts.channel ?? ctx.channel`, anything outside the seven → `"system"`. **Capture:** `capture(kind, {name, actor?, content?, meta?, ok?, ms?, channel?, turnId?, stage?})` (stage added: `track()`'s opts carry one); default actor ask→person, model/tool→model, say/send→app, else system; content serialised at capture with bytes as `{type, size}` (Uint8Array/Buffer/ArrayBuffer/Blob → `bytes`, a `data:` URL → its mime, a >200-char all-base64 string → `base64`); content over `MAX_CONTENT_BYTES` (1 MB less 32 KB, so the largest row still fits one insert) is cut by its longest strings first (shape kept), falling back to `{truncated, start}` of its redacted JSON, with `meta.truncated_bytes` = bytes removed; meta capped at 16 KB; `meta.kind = "login_code"` → content null, `content_mode` meta in every mode (C-1741). Buffer cap 20 000 rows / 64 MB, past it new rows are dropped and counted (never an early write). **Flush:** no timer and no size trigger (Charlie's 250 ms / 50 rows wrote mid-request): only `flushIntel()`, registered as a track.ts flusher, so `tracked()`'s `waitUntil(flushTracking())` writes after the response and the drain after its jobs; it yields one `setImmediate` before redacting. Batches ≤ 500 rows and ≤ 1 MB measured as `JSON.stringify(row)`; 3 attempts 100 ms and 400 ms apart; on the third failure the batch and the rest of that flush are dropped and counted, and `intel_flush_failed` (error, digest) is filed once per outage (re-armed by the next successful write). Missing table = code `42P01` or `PGRST205` (the fake's new `missingTable()` gives PostgREST's PGRST205/404): one console line per process naming `db/0006_platform.sql`, no incident, nothing tried for 10 min (`Date.now()`), rows in that window dropped and counted. `intelStats()` → `{mode, table_present (null until tried), buffered, flushed, dropped, last_flush_at}` for Tasks 8.8/11.2. **track.ts:** imports `./intel.js` for its side effect (the cycle is safe: intel.ts calls only hoisted declarations at load); listeners get a 4th argument `failure` (true from `trackFailure()`); every `track()` is a `track` row and every `trackFailure()` (any category) or `category: "failure"` event an `error` row, `content {props, summary?}`, `meta {category, severity}` (severity defaulting as track() does), `ok` false for errors; a name starting `broker:` is actor `person` (INTEL-PHASE0 §3). **models.ts:** `callOpenRouter` is one `model` row per attempt, name `model_call:<role>`, `content {messages, response (null on failure), reasoning, error_body?}`, `meta {model, role, label, served_by (OpenRouter's `model` field, now read into `CallResult.servedBy`), provider, usage, truncated, finish_reason, streamed false, first_token_ms null, max_tokens, temperature, json_mode, timeout_ms, error (errorText), error_kind, status}`, `ok` = not truncated; `CallOptions.label` added; a `DeadlineError` before the request is not a row (nothing was sent). `transcribeAudio`: one `model_call:voice` row per request, `content {audio: {type: mime, size}, prompt, language, response, segments?}`. **queue.ts:** exported `captureJob(event, job, more)` with `JobEvent` = enqueued|started|finished|failed|held|skipped|fenced|cancelled; rows `job_<event>`, `content.payload`, `meta {job_id (number), kind, attempt, …}`: enqueued (attempt 0, in the enqueuer's trace, also for a dedupe hit with `meta.existing`), started (before the handler), finished (ok, ms), failed (`meta.final`, `retry_in_s` or `reason`, `error`), held (`reason` session_busy|hold|out_of_time, `delay_ms`), skipped (`reason` session_gone), fenced. The queue has no cancel path: **`forgetClient()` (Tasks 3.4, 8.7) calls `captureJob("cancelled", job)` for each queued job it cancels.** **Redaction:** `redactText` (Charlie's rules + Call's secrets by value from `SECRET_ENV` = every KEY/SECRET/TOKEN variable of `.env.example` plus `ELEVENLABS_WEBHOOK_SECRET_PREVIOUS`, pinned by a test that reads `.env.example`; whole DB connection strings; cookie pairs; `sk_`/`xi-` keys; the whole `/q/<id>?…` link; `wamid.` ids; base64 runs > 200 → `[bytes]`; emails and SA/international phone numbers → `[contact]`; other 9+ digit runs → `[number]`; NUL and lone surrogates; uuids are held aside while the rules run, because their digit groups read across dashes are a 9+ digit run and the record needs its ids). `redactDeep(value)` walks the value: secret-named keys (whole key, any case: authorization, cookie, password, secret, token, api_key, signature, sig, pin, otp, `*-secret`, `*_token`, `*_signature`, …; not `*_tokens`, not `code`) → `[redacted]`; strings → `redactText`; a number of 9+ digits → `"[number]"` unless the key's last word is money, a time, a size or a count (`*_cents`, amount, premium, cover, budget, total, …, `*_at`, ms, secs, bytes, size, chars, tokens, count, qty; `value_num/min/max`). `redactJson(text)` = parse → `redactDeep` → stringify (text rules if not JSON). **Forget:** `forgetIntel(clientId)` tombstones the client (later captures about it in this process are not buffered), drops buffered rows of the client and of its traces, waits for writes in flight, pages the client's trace ids (1000 a page), drops buffered rows of those traces too, deletes by `business_id` then by `trace_id` (200 a statement), returns rows removed; a missing table → buffered count; any other error throws (the forget job retries). **readTrace(id):** `n`/`job_<n>` → `job_<n>` plus the traces of rows with `job_id = n` (a session's job reads back the whole session); `t_…` → the traces of rows with that `turn_id`; `s_`/`r_`/`p_` as given; a uuid → `s_<uuid>`; anything else → the session with that `conversation_id`, else as a trace id; then each `job_enqueued` folds in every row with `job_id = meta.job_id` (recursively, 50 links at most); paged reads; sorted by `at`, `seq`, `id`. **Tests touched outside the task's list:** `test/queue.test.ts` C-0491/C-1606's "nothing written but the jobs' own status" now also excludes `intel_events` (the record, written by the flush under `npm run test:intel`). C-1710 is tagged here in unit form (every kind of row in a session context carries `s_<id>`); Task 12.5 re-proves it with the real entry points.

**Phase 0 gate:** `npm run typecheck && npm test && npm run test:intel` green; criteria `--count --matrix` green. Push. Create `main` if missing; open the Phase 0 PR; merge when CI is green.

---

## Phase 1 — Database and seeds

### Task 1.1: Migrations

**Files:** Create `db/0001_core.sql` (brokers, broker_users, login_codes, sessions_auth, clients, sessions, turns, recordings, consents, callbacks, client_messages, meeting_chunks), `db/0002_model_config.sql`, `db/0003_facts.sql` (facts, fact_refusals), `db/0004_catalogue.sql` (product_categories, products, product_pricing, disclosures), `db/0005_quotes.sql` (needs, recommendations, quotes, deliveries, hardship_notes), `db/0006_platform.sql` (jobs with `id bigint generated always as identity` + `claim_job` function, webhook_events, safety_events, usage_ledger, audit_log, incidents, **`intel_events` exactly as `docs/INTEL-CONTRACT.md` §1 with its four indexes and `REVOKE ALL … FROM anon, authenticated`**, storage buckets `recordings` and `quotes` private), `db/0007_rls.sql` (enable on all; policies on the three public tables), `test/rls.test.ts`, `test/migrations.test.ts`.

Columns exactly as SPEC §4 plus: `facts.approx bool default false`, `facts.value_min/value_max numeric`, `sessions.provider_analysis jsonb`, `sessions.provider_summary text`, `sessions.provider_cost numeric`, `sessions.turn_count int`, `sessions.continues_session_id uuid`, `clients.whatsapp_e164`, `clients.last_inbound_at`, `recommendations.replaces_fact_id uuid`, `quotes.flags text[]`, `brokers.voice_id text`, `brokers.agent_llm text`, `webhook_events.processed_at`, `jobs.dedupe_key text unique`, `jobs.status check in ('queued','running','done','failed','cancelled','skipped')`.

- [ ] **Step 1: Failing tests** `[C-1567][C-1568][C-1569][C-1570][C-1571][C-1576][C-1577][C-1578][C-1579][C-1580][C-1089][C-1751][C-1752]` — `rls.test.ts` parses every `CREATE TABLE` in `db/*.sql` and asserts an `ENABLE ROW LEVEL SECURITY` in the same file, the policy set, `created_at` on every table, `auto_send default false`, `claim_job` is `SECURITY DEFINER SET search_path`; `migrations.test.ts` runs each file twice against `TEST_DATABASE_URL` when set, else prints "skipped: no TEST_DATABASE_URL" (`[C-1575]`).
- [ ] **Step 2–4.** **Step 5: Commit** `Migrations 0001–0007: schema, model_config, catalogue, quotes, platform, RLS`

### Task 1.2: Seeds — categories, demo catalogue, pricing, disclosures, model_config

**Files:** Create `seed/categories.json` (13 from SPEC §4 with `need_kinds`), `seed/products.json` (24 demo products per SPEC §8.3, each with `summary` ≤ 60 words, `eligibility` JSON, `exclusions`, `keywords`, `min/max_age`, `min/max_cover`, `term_rules`, `verified_on: "2026-10-31"`, `is_demo: true`, `external_id`), `seed/pricing.json` (6–8 bands per product; life/IP/disability/CI `rate_per_1000`, funeral/gap/credit `flat_cents` or rate, smoker split for life/CI), `seed/disclosures.json` (ZA keys per C-1451 with `required`/`condition`), `db/0008_seed.sql` (generated INSERTs from the JSON by `scripts/seed-sql.ts`), `scripts/seed-sql.ts`, `test/seed.test.ts`, `api/_lib/catalogue-load.ts` (`loadCatalogue(brokerId): Promise<{products, pricing, categories, disclosures}>` with the broker-over-demo rule and a 60 s cache).

- [ ] **Step 1: Failing tests** `[C-0815][C-0816][C-1451][C-1452][C-1455][C-1526]` plus `[C-0845][C-0846][C-0848]` for `loadCatalogue`.
- [ ] **Step 2–4.** **Step 5: Commit** `Demo catalogue, pricing bands, disclosures and model roles as data`

### Task 1.3: The paste-ready Supabase prompt

**Files:** Create `scripts/supabase-prompt.ts`, `docs/SUPABASE-PROMPT.md` (generated), `test/supabase-prompt.test.ts`. Model on `../charlie/docs/SUPABASE-PROMPT.md`: a precheck query that prints the project ref expectation, the SQL of every `db/*.sql` in order, one check query per migration printing `found` vs `expected`, and the success table at the bottom.

- [ ] **Step 1: Failing test** `[C-1574]` regenerates and diffs. **Step 2–4.** **Step 5: Commit** `Generate the paste-ready Supabase prompt from the migrations`

**Phase 1 gate.** Push; PR into `main`; merge when CI is green.

---

## Phase 2 — Figures, redaction, facts, distress (pure code, parallel-safe with Phase 3)

### Task 2.1: Figures

**Files:** Create `api/_lib/figures.ts`, `test/figures.test.ts`.

**Interfaces:**
- `figuresFrom(text: string, ctx?: { moneyContext?: boolean }): Set<number>` — every way of saying money in C-0563–C-0580; bare small numbers ("about ten") scaled ×1000 only when `moneyContext`.
- `ageFrom(text: string, today: Date): { age?: number; band?: AgeBand; approx: boolean } | null` (C-0581–C-0586).
- `countsFrom(text: string): { dependants?: number; children?: number; children_under_18?: number; parents?: number }` (C-0587–C-0590).
- `isApprox(text: string): boolean`; `rangeFrom(text): {min, max, mid} | null`; `bandFor(age): AgeBand`; `AgeBand = "18-24"|"25-34"|"35-44"|"45-54"|"55-64"|"65+"`.
- `formatRand(cents: number): string`; `parseMoneyInput(s: string): number | null` (dashboard inputs, C-1163).

- [ ] **Step 1: Failing tests** one `test()` per criterion C-0563…C-0590, C-0525, C-0526, C-0531, C-0532.
- [ ] **Step 2–4.** **Step 5: Commit** `Parse money, ages and counts the way South Africans say them`

### Task 2.2: Redaction

**Files:** Create `api/_lib/redact.ts`, `test/redact.test.ts`.

**Interfaces:** `redact(text: string): { text: string; found: RedactionKind[] }` with `RedactionKind = "id_number"|"card"|"account"|"password"|"policy"`; `IDENTIFIER: RegExp` exported for `facts.ts`; `MEDICAL_TERMS: string[]`.

- [ ] **Step 1: Failing tests** `[C-0175]…[C-0182]`, `[C-1429][C-1430]` (the fixture sweep part is wired in Task 4.4; here, unit cases).
- [ ] **Step 2–4.** **Step 5: Commit** `Redact identifiers before anything is stored`

### Task 2.3: Facts — `factUpdates()` and the slot rules

**Files:** Create `api/_lib/facts.ts`, `api/_lib/factkinds.ts` (the relation/label table from SPEC §7.3 with aliases: "funeral policy"→funeral, "own business"→self_employed, "bond"→home_loan, "RA"→retirement, "gap cover"→medical_gap, …), `test/facts.test.ts`, `test/_facts.ts` (helpers `fact(rel,label,value,opts)`, `clientTurn(idx,text)`).

**Interfaces:**
- `factUpdates(raw: unknown, turns: Turn[], opts: { source: "extract"|"tool"|"readback"|"broker"; today: string; sessionMode: SessionMode }): { kept: FactDraft[]; refused: { label: string; reason: RefusalReason; raw: unknown }[] }` implementing SPEC §7.3 rules 1–7; `RefusalReason = "relation"|"not_said"|"no_turn"|"ambiguous_turn"|"figure_not_said"|"negated"|"hypothetical"|"past"|"someone_else"|"identifier"|"not_a_kind"|"over_cap"|"bad_value"`.
- `slotOf(rel, label): string` (has_cover/lacks_cover share a slot per category; owes per kind; is per label).
- `applyFacts(sessionId, clientId, drafts: FactDraft[]): Promise<{ inserted: number; superseded: number }>` — supersede-by-slot, `supersedes_id`, idempotent on identical value (`last_seen` only).
- `confirmReadback(sessionId, readbackTurn: Turn, clientReply: Turn): Promise<{ confirmed: number; incomplete: string[] }>` (C-0595, C-0596, C-0599).
- `applyCorrection(sessionId, correctionTurn: Turn, proposals: FactDraft[])` (C-0591–C-0600).

- [ ] **Step 1: Failing tests** every row C-0500…C-0562, C-0591…C-0600, C-0615, C-0226, C-0261, C-0262, C-0267–C-0269, C-0271, C-0274–C-0276, C-0335–C-0339 (slot semantics; the HTTP side is Task 3.2), C-1346, C-1435.
- [ ] **Step 2–4.** **Step 5: Commit** `Facts: keep only what the client said, with the turn that says it`

### Task 2.4: Distress

**Files:** Create `api/_lib/distress.ts` (port `saysMoneyTrouble`, `saysSevereMoneyTrouble`, `saysSteadied` from `../charlie/api/_lib/safety.ts`, add SA phrasing), `test/distress.test.ts`.

- [ ] **Step 1: Failing tests** `[C-0205]…[C-0213]`, `[C-0549]`. **Step 2–4.** **Step 5: Commit** `Distress rules with South African phrasing`

---

## Phase 3 — The voice HTTP surface and ingestion

### Task 3.1: `/api/voice/init`

**Files:** Create `api/voice.ts` (one handler dispatching on path: `/init`, `/tool/:name`, `/post-call`), `api/_lib/voice-init.ts`, `api/_lib/phones.ts` (port `normaliseZa(raw): string | null` → E.164), `test/voice-init.test.ts`.

**Interfaces:** `handleInit(body: unknown, headers): Promise<{ status: 200; json: InitResponse }>` where `InitResponse = { type: "conversation_initiation_client_data"; dynamic_variables: Record<string,string>; conversation_config_override?: { agent: { first_message: string } } }` (field names confirmed against VERIFIED.md row "initiation webhook" before coding; if they differ, the task updates SPEC §3.1 and this plan). Defaults on any error; 2 s internal timeout with background write.

- [ ] **Step 1: Failing tests** C-0001…C-0030, C-0484. **Step 2–4.** **Step 5: Commit** `Voice init: who is calling, and never a non-200`

### Task 3.2: Server tools

**Files:** Create `api/_lib/voice-tools.ts`, `test/voice-tools.test.ts`. Modify `api/voice.ts`.

**Interfaces:** `handleTool(name: ToolName, body, headers): Promise<{status: number; json: object}>`; `ToolName = "save_fact"|"check_existing_cover"|"lookup_categories"|"request_callback"|"mark_hardship"|"set_channel"`; rate limit 60/min/conversation in memory + `tool_calls` count on the session; placeholder turns `[pending]` with `t_start_secs`; `normaliseEmail(s)`; uses `factUpdates` with `source: "tool"`.

- [ ] **Step 1: Failing tests** C-0301…C-0372 (minus the ingest-side rows C-0316, C-0317, C-0353, C-0355, C-0363 which Task 3.4 owns), C-0166, C-0284…C-0288.
- [ ] **Step 2–4.** **Step 5: Commit** `Server tools the agent calls mid-call`

### Task 3.3: Post-call webhook

**Files:** Create `api/_lib/post-call.ts`, `test/post-call.test.ts`, `test/_elevenlabs.ts` (event factory: `signedTranscriptEvent(conv: ScriptedConversation, secret, opts)`, `signedAudioEvent(...)`, builds the current payload shape recorded in VERIFIED.md). Modify `api/voice.ts` (raw body read, `bodyParser: false`).

- [ ] **Step 1: Failing tests** C-0400…C-0428, C-0434, C-1594, C-1595. **Step 2–4.** **Step 5: Commit** `Post-call webhook: verify, store, enqueue, answer fast`

### Task 3.4: `ingest_transcript`

**Files:** Create `api/_lib/ingest.ts`, `test/ingest.test.ts`. Registers the handler in `queue.ts`.

**Interfaces:** `ingestTranscript(job)`: upsert session, turns (redacted), resolve placeholders (C-0316/0317), consent detection (`consentFrom(turns)` → granted/declined/inferred with the agreement word list), duration/cost → `usage_ledger`, `provider_analysis`, DC cross-check (`crossCheckDc(session)` after facts exist — enqueued as part of `extract_facts` completion), evaluation handling, `turn_count`, `processed_at`; enqueue `extract_facts`. Exports `consentFrom`, `AGREEMENT_WORDS`.

- [ ] **Step 1: Failing tests** C-0441…C-0484 (except C-0481–C-0483 e2e), C-0316, C-0317, C-0353, C-0426, C-1436, C-0113, C-0118, C-0199, C-0461…C-0472, C-0617…C-0619.
- [ ] **Step 2–4.** **Step 5: Commit** `Ingest the transcript: turns, consent, cost, cross-checks`

### Task 3.5: `store_audio` and recordings

**Files:** Create `api/_lib/recordings.ts`, `test/recordings.test.ts`. Modify `ingest.ts` for linking.

- [ ] **Step 1: Failing tests** C-0427…C-0440 (store side), C-0114, C-1322, C-1560 (storage-full guard stub reading `limits.ts` later — write it to call a `storageBytes()` function in `limits.ts` created in Task 7.6; until then a local helper).
- [ ] **Step 2–4.** **Step 5: Commit** `Store call audio privately with a delete-after date`

**Phase 3 gate.** Push; PR into `main`; merge when CI is green.

---

## Phase 4 — Extraction, the conversation checker, the prompt, the fixtures

### Task 4.1: Conversation fixtures and the scripted-conversation format

**Files:** Create `test/fixtures/conversations/*.json` — the 40 named in SPEC §14 (happy-path, declined-consent, unclear-consent, dropped, silence, misheard-age, hardship, hardship-missed, what-do-you-offer, offers-id-number, someone-elses-cover, hypothetical-cover, negated-cover, two-needs-over-budget, known-client, web-no-caller-id, prompt-injection, afrikaans-money, approximate-figures, long-story, interrupted, medical-detail, agent-advised, agent-priced, no-channel, whatsapp-channel, email-channel, callback-request, budget-unknown, group-cover, replacement-funeral, no-product-fits, age-70, smoker, self-employed, retired, student, meeting (speaker-labelled), meeting-unknown-speakers, second-call-correction), `test/fixtures/README.md` describing the format `{ id, mode, caller_id, turns: [{role, text, t, tool_calls?, flags?}], expect: {...} }`, `test/fixtures.test.ts` (every fixture parses; ids unique; every §3 question stem appears in happy-path).

- [ ] **Step 1: Failing test** `fixtures.test.ts` `[C-1429][C-1430][C-1431][C-1432]` sweep (runs `redact` + later `factUpdates` over all fixtures — the facts part is enabled in Task 4.2). **Step 2–4.** **Step 5: Commit** `Forty scripted conversations the whole pipeline is tested on`

### Task 4.2: `extract_facts`

**Files:** Create `api/_lib/extract.ts`, `api/_lib/prompts.ts` (`base()` voice rules ported; `extractPrompt(turns, kinds)`), `test/extract.test.ts`.

**Interfaces:** `extractFacts(job)`: build prompt (client turns as data block, agent turns elided to `[agent asked about X]` using the §3 question stems, middle-truncation to 12k chars), `askJSON("extract")`, `factUpdates(..., {source:"extract"})`, `applyFacts`, then `applyCorrection`/`confirmReadback` over read-back turns (detected by the "read back" stem), DC cross-check, `injection_suspected` detection (`INJECTION_RE`), enqueue `analyse_needs`.

- [ ] **Step 1: Failing tests** C-0601…C-0614, C-0620, C-1345, C-1434, C-0226/C-0228 via fixture `medical-detail`. **Step 2–4.** **Step 5: Commit** `Extract facts from the client's own turns only`

### Task 4.3: The post-hoc conversation checker

**Files:** Create `api/_lib/checker.ts`, `test/checker.test.ts`.

**Interfaces:** `checkConversation(session, turns): Promise<CheckerResult>` writing one `safety_events` row per check listed in criteria 02 (`consent_wording`, `consent_before_questions`, `questions_after_decline`, `one_question_per_turn`, `skip_honoured`, `repeat_question`, `voice_rules`, `jargon`, `names_repeated`, `unsaved_answer`, `pressing`, `interrupted`, `provider_named`, `price_on_call`, `advice_on_call`, `promise`, `identifier_requested`, `medical_detail_requested`, `hardship_handled`, `readback_done`, `readback_incomplete`, `readback_invented`, `argued_correction`, `channel_captured`, `category_list_invalid`); regex tables exported (`ADVICE_RE`, `PRICE_RE`, `PROMISE_RE`, `JARGON`, `QUESTION_STEMS`). Called from `ingest.ts` after turns are stored; `block` outcomes set `quotes` to `held` later (Task 6.2 reads them).

- [ ] **Step 1: Failing tests** every `checker` row in criteria 02 (C-0104–C-0106, C-0116, C-0122–C-0123, C-0127–C-0130, C-0132, C-0136–C-0137, C-0139–C-0140, C-0151–C-0153, C-0155–C-0157, C-0159–C-0160, C-0163–C-0165, C-0167–C-0168, C-0170, C-0173–C-0174, C-0187–C-0196, C-0200, C-0214–C-0216, C-0225, C-0227, C-0231, C-0234, C-0238, C-0242, C-0246–C-0251, C-0253, C-0255, C-0260, C-0264–C-0266, C-0272, C-0280–C-0283, C-0295–C-0298), C-1463.
- [ ] **Step 2–4.** **Step 5: Commit** `Check every agent turn after the call, and write what was found`

### Task 4.4: The agent prompt renderer and its test

**Files:** Create `api/_lib/agent-prompt.ts` (`renderAgentPrompt(vars): { prompt: string; firstMessage: string; tools: ToolSpec[]; dataCollection: DcField[]; evaluation: EvalCriterion[] }` reading `docs/AGENT-PROMPT.md` at build time via `scripts/push-agent.ts`; in `api/` it reads a generated `api/_lib/agent-prompt.generated.ts` so the function has no filesystem access at runtime), `scripts/gen-agent-prompt.ts`, `test/agent-prompt.test.ts`.

- [ ] **Step 1: Failing tests** every `prompt` row in criteria 02 (C-0100–C-0103, C-0107–C-0108, C-0117, C-0121, C-0124–C-0126, C-0131, C-0133–C-0135, C-0138, C-0141–C-0150, C-0154, C-0158, C-0161–C-0162, C-0169, C-0171–C-0172, C-0183–C-0186, C-0201–C-0204, C-0223–C-0224, C-0229–C-0230, C-0237, C-0243–C-0245, C-0254, C-0256–C-0259, C-0273, C-0277–C-0279, C-0292–C-0294, C-0300), C-1433.
- [ ] **Step 2–4.** **Step 5: Commit** `The agent prompt is rendered from the document, never hand-edited`

**Phase 4 gate.** Push; PR into `main`; merge when CI is green.

---

## Phase 5 — Needs, price, match

### Task 5.1: Needs

**Files:** Create `api/_lib/needs.ts`, `test/needs.test.ts`. Modify `prompts.ts` (`needsPrompt(facts, candidates)`).

**Interfaces:** `needsFrom(facts: Fact[], country: string): NeedDraft[]` (SPEC §8.1 rules, deterministic, `basis` fact ids, `priority`, `cover_rule` output `{ default_cover?: number; min_cover?: number; flags: string[] }`); `analyseNeeds(job)`: rules → model re-order/annotate/add-with-citation → `needs` rows; stabilising short-circuit; enqueue `match`.

- [ ] **Step 1: Failing tests** C-0700…C-0752. **Step 2–4.** **Step 5: Commit** `Needs from the facts, rules first, the model may only annotate`

### Task 5.2: Price

**Files:** Create `api/_lib/price.ts`, `test/price.test.ts`.

**Interfaces:** `premiumFor(product, pricing: PricingRow[], args: { coverCents: number; age: number; smoker: boolean | null; today: Date }): { premiumCents: number; basis: PremiumBasis } | { premiumCents: null; reason: "no_rate"|"no_smoker_rate" }`; `PremiumBasis = { pricing_id, rate_per_1000?, flat_cents?, age_used, smoker_used, assumed_smoker?, cover_used, verified_on, stale: boolean }`; `isStale(verifiedOn, today)` (> 90 days).

- [ ] **Step 1: Failing tests** C-0796…C-0811, C-0789, C-0801. **Step 2–4.** **Step 5: Commit** `Premiums from pricing bands, in integer cents, with a staleness flag`

### Task 5.3: Match

**Files:** Create `api/_lib/match.ts`, `api/_lib/eligibility.ts` (tiny evaluator for `{all|any|fact,in|eq|gte|lte}`), `test/match.test.ts`.

**Interfaces:** `selectProduct(need: Need, facts: Fact[], catalogue: Catalogue, today: Date): Selection` where `Selection = { product: Product | null; coverCents: number; termMonths: number | null; premium: PremiumResult; considered: Considered[]; flags: string[]; replacesFactId?: string }`; `allocateBudget(selections, budgetCents | null, incomeCents | null): { kept: Selection[]; moved: {selection, reason: "budget"|"affordability"}[]; flags }`; `runMatch(job)`: writes `recommendations`, `quotes` draft with `total_premium_cents`, `flags`; enqueue `write_quote`. Deterministic; pure except the DB writes in `runMatch`.

- [ ] **Step 1: Failing tests** C-0761…C-0795, C-0817, C-0821…C-0850 (non-app rows), C-0263, C-0753–C-0760 (pipeline rows via a mini-pipeline test on the fakes). **Step 2–4.** **Step 5: Commit** `One product per need, every other one listed with why not`

**Phase 5 gate.** Push; PR into `main`; merge when CI is green.

---

## Phase 6 — Write, check, render

### Task 6.1: Writer

**Files:** Create `api/_lib/write.ts`, `test/write.test.ts`. Modify `prompts.ts` (`writerPrompt(ctx)` per SPEC §7.7 with facts and figures as data, the jargon replacement table, `REPLY_LIMITS = { opening: 40, why: 60, alternative_if: 25 }`).

**Interfaces:** `writeQuote(job)`: for each recommendation build the context, `askJSON("writer")`, trim to limits at sentence boundaries, jargon replacement, store `why`, `alternative_if`, `quotes.opening`; on fallback (`no why`) the fixed sentence; enqueue `check_quote`. `allowedNumbers(quote, recs, facts): Set<string>` exported for the checker.

- [ ] **Step 1: Failing tests** C-0819, C-0909, C-0987…C-0990, C-0614. **Step 2–4.** **Step 5: Commit** `The writer repeats the numbers it is given and explains one product per need`

### Task 6.2: Quote checker and the judgement layer

**Files:** Create `api/_lib/check.ts`, `api/_lib/safety.ts` (port Charlie's engine selection: Jev → model → none, `recordSafetyEvent`), `api/_lib/jev.ts` (port), `test/check.test.ts`, `test/safety.test.ts`.

**Interfaces:** `checkQuoteText(text, allowed: Set<string>, facts, products, disclosures): RuleReport` (numbers, menu, you-told-me by confidence, claims, stale hedge, disclosures, FSP, demo notice); `judgeQuote(quote, facts): Promise<{ engine: Engine; score: number | null; outcome }>`; `checkQuote(job)`: rules → regenerate once on fail → judge → status `checked` or `held` with `checker_report`; also folds in `agent_advised` blocks from the conversation checker and `income_uncertain`; enqueue `notify_broker` (and `send_quote` directly when `auto_send` and clean and all cited facts confirmed — the status machine helper lives in Task 7.3; here it calls `advanceAfterCheck(quote)` defined there, so write that stub now).

- [ ] **Step 1: Failing tests** C-0900…C-0946 (except render rows), C-1355, C-1457…C-1470 (safety events), C-0197–C-0198, C-0620.
- [ ] **Step 2–4.** **Step 5: Commit** `Check every number, every claim, and name which engine checked it`

### Task 6.3: Document parts and the quotation document

**Files:** Create `api/_lib/docparts.ts` (port the table/row/heading helpers and colour constants from `../charlie/api/_lib/plandoc.ts`: `page(title, bodyTables, opts)`, `section(heading)`, `kv(rows)`, `para(text)`, `esc()`), `api/_lib/quotedoc.ts` (`quoteDocHTML(data: QuoteDocData): string` with sections SPEC §9 1–9), `api/_lib/holidays.ts` (ZA public holidays 2026–2028; `addWorkingDays(date, n)`), `api/_lib/reasons.ts` (`reasonText(code): string` for considered reasons), `test/quotedoc.test.ts`, `test/holidays.test.ts`.

- [ ] **Step 1: Failing tests** C-0947…C-0969, C-0972…C-0986, C-0991…C-0993, C-0806, C-0810, C-0818, C-0824, C-0839, C-0840, C-0847, C-0793, C-0933, C-0934, C-1088, C-1453, C-1454, C-0270. The CSS grep rows assert over the rendered string, and `npm run grep-doc-css` now has files to scan.
- [ ] **Step 2–4.** **Step 5: Commit** `The quotation document: tables and inline hex, nine sections, prints`

### Task 6.4: PDF rendering and the print smoke

**Files:** Create `api/render-pdf.ts` (port of Charlie's `render-pdf.ts` + `chromium-env.ts` + `pdfclient.ts`: `renderPdf(html): Promise<Buffer>` behind `WORKER_SECRET`), `api/_lib/pdf.ts`, `scripts/preview-quote.mjs` (replaces the stub: renders the `two-needs-over-budget` fixture's quote to `preview/quote.pdf`, checks page count ≥ 2 and that the text layer has the FSP and "Indicative" — use `pdf-parse`-free approach: Chromium's own `page.pdf` plus `page.evaluate` text before printing), `test/render-pdf.test.ts`.

- [ ] **Step 1: Failing test** C-0970, C-0971 (script exit code checked by `test/render-pdf.test.ts` spawning it with `--smoke`). **Step 2–4.** **Step 5: Commit** `Render the quotation to PDF in Chromium, and prove it prints`

### Task 6.5: Record of advice

**Files:** Create `api/_lib/roa.ts` (`roaHTML(session, facts, needs, recs, quote, consents, safetyEvents, audit, broker, user): string`), `test/roa.test.ts`.

- [ ] **Step 1: Failing tests** C-1191…C-1204 (render rows), C-1441…C-1450, C-0844, C-1359, C-1424. **Step 2–4.** **Step 5: Commit** `The record of advice, section by section, with the turn each fact came from`

**Phase 6 gate.** `npm run grep-doc-css` and the print smoke green. Push; PR into `main`; merge when CI is green.

---

## Phase 7 — Delivery

### Task 7.1: Email delivery

**Files:** Create `api/_lib/deliver-email.ts`, `api/resend-webhook.ts`, `test/email.test.ts`. Uses `email.ts` from Task 0.4.

- [ ] **Step 1: Failing tests** C-1017…C-1036, C-0976. **Step 2–4.** **Step 5: Commit** `Send the quotation by email, and hear back from Resend`

### Task 7.2: WhatsApp (port) and the client's replies

**Files:** Create `api/_lib/wa.ts` (port of Charlie's `wa.ts`: `sendText`, `sendButtons`, `sendTemplate`, `sendDocument`, `uploadMedia`, `parseWebhook`, `withinServiceWindow`, limits), `api/_lib/deliver-wa.ts`, `api/wa.ts` (verify handshake + inbound + statuses, raw body), `api/_lib/wa-inbound.ts`, `test/wa.test.ts`, `test/wa-inbound.test.ts`, `docs/WHATSAPP-TEMPLATES.md` (the two template texts to submit to Meta, with placeholders, no prices).

- [ ] **Step 1: Failing tests** C-1037…C-1058, C-1071…C-1084, C-1415 (confirmation before deletion). **Step 2–4.** **Step 5: Commit** `WhatsApp: the quote as a template plus document, and what a client may reply`

### Task 7.3: The quote status machine, approve, fallback, auto-send

**Files:** Create `api/_lib/deliver.ts`, `test/deliver.test.ts`.

**Interfaces:** `approveQuote(quoteId, by: {userId} | {system: "auto_send"}, opts: { reviewedHeld?: boolean }): Promise<Approved | Blocked>` with `Blocked = { status: 422|409|404; reason: "unconfirmed_facts"|"held_numbers"|"superseded"|"not_found"|"held_unreviewed"; factIds?: string[] }`; `advanceAfterCheck(quote)`; `sendQuote(job)` (email or WhatsApp by `clients.preferred_channel`, PDF first, quota check via `limits.emailsToday()`, `run_after` next UTC midnight when ≥ 100); `fallbackToEmail(quoteId, by, opts: { confirmedConsent?: boolean })`; `transition(quoteId, to, by, note?)` writing `audit_log`.

- [ ] **Step 1: Failing tests** C-1000…C-1016, C-1059…C-1070, C-1085…C-1089, C-1440, C-1062. **Step 2–4.** **Step 5: Commit** `Nothing reaches a client until a broker approves it`

### Task 7.4: Signed links

**Files:** Create `api/_lib/links.ts`, `api/q.ts` (`GET /q/:quoteId?exp&sig` serves the PDF inline and marks read), `test/links.test.ts`.

- [ ] **Step 1: Failing tests** C-1581…C-1586. **Step 2–4.** **Step 5: Commit** `Signed, expiring links to the quotation`

### Task 7.5: Notify broker

**Files:** Create `api/_lib/notify.ts`, `test/notify.test.ts`.

**Interfaces:** `notifyBroker(job)`: subject/body variants (normal, hardship, dropped, abandoned, declined one-liner, meeting, no-channel, callback), channel by `brokers.notify_channel`, link `/app/calls/{id}`.

- [ ] **Step 1: Failing tests** C-0115, C-0220, C-0240–C-0241, C-0289, C-0355, C-0482–C-0483, C-1054, C-1358, C-1440. **Step 2–4.** **Step 5: Commit** `Tell the broker what landed, in one line`

### Task 7.6: Limits

**Files:** Create `api/_lib/limits.ts`, `test/limits.test.ts`.

**Interfaces:** `agentMinutesThisMonth()`, `emailsToday()`, `openrouterToday()`, `storageBytes()`, `budgetCheck(role): "ok"|"skip"` (critical roles never skipped), thresholds → `trackFailure` with daily/monthly fingerprints.

- [ ] **Step 1: Failing tests** C-1553…C-1560, C-1069, C-1323, C-1545–C-1547. **Step 2–4.** **Step 5: Commit** `Count what the free tiers give us, and warn at 80%`

**Phase 7 gate.** Push; PR into `main`; merge when CI is green.

---

## Phase 8 — The broker dashboard

### Task 8.1: Login and sessions

**Files:** Create `api/_lib/auth.ts`, `api/app.ts` (router: pages and `/app/actions`), `api/_lib/html.ts` (layout, escaping, CSRF token field), `test/auth.test.ts`.

- [ ] **Step 1: Failing tests** C-1100…C-1120, C-1251…C-1254. **Step 2–4.** **Step 5: Commit** `Magic-link login for broker users`

### Task 8.2: The calls list and `calls.json`

**Files:** Create `api/_lib/app-list.ts`, `test/app.test.ts` (grows through Phase 8).

- [ ] **Step 1: Failing tests** C-1121…C-1138, C-0120. **Step 2–4.** **Step 5: Commit** `The calls list, broker-scoped, polling`

### Task 8.3: Call detail: transcript, audio, facts actions

**Files:** Create `api/_lib/app-call.ts`, `api/_lib/app-actions.ts` (every action id → handler; `rerunPipelineFrom(sessionId, step)`), modify `test/app.test.ts`.

- [ ] **Step 1: Failing tests** C-1139…C-1168, C-0235, C-0616, C-1427, C-1011, C-0756–C-0757, C-1189. **Step 2–4.** **Step 5: Commit** `Call detail: every fact with the second it was said`

### Task 8.4: Recommendations, versions, status, outcome

**Files:** Modify `app-call.ts`, `app-actions.ts`; create `api/_lib/versions.ts` (`newVersion(quoteId, reason, by): Promise<string>` copying recs, superseding, re-running write/check), modify `test/app.test.ts`.

- [ ] **Step 1: Failing tests** C-1169…C-1190, C-0994…C-0999, C-0795, C-0829–C-0830, C-0835, C-0850, C-0911, C-1015, C-1068. **Step 2–4.** **Step 5: Commit** `Swap, edit, remove, re-match: every change is a new version`

### Task 8.5: Settings and the catalogue upload

**Files:** Create `api/_lib/catalogue.ts` (`validateCsv(text, brokerId): {rows, errors}`, `applyCatalogue(rows)`), `api/_lib/app-settings.ts`, `public/catalogue-template.csv`, `test/catalogue.test.ts`.

- [ ] **Step 1: Failing tests** C-1217…C-1240, C-0812…C-0814, C-1090. **Step 2–4.** **Step 5: Commit** `Settings, and a catalogue upload that is all-or-nothing`

### Task 8.6: Costs page

**Files:** Create `api/_lib/app-costs.ts`; modify `test/app.test.ts`.

- [ ] **Step 1: Failing tests** C-1241…C-1250, C-1562, C-1190. **Step 2–4.** **Step 5: Commit** `What each call cost, and what the month cost`

### Task 8.7: Forget a client

**Files:** Create `api/_lib/forget.ts` (`forgetClient(clientId, by): Promise<Counts>` enumerating tables from a single `CLIENT_TABLES` list that `test/forget.test.ts` cross-checks against the migrations), `test/forget.test.ts`.

- [ ] **Step 1: Failing tests** C-1205…C-1216, C-1409…C-1420, C-1428, C-0236. **Step 2–4.** **Step 5: Commit** `Forget a client completely, and prove nothing is left`

### Task 8.8: Operator admin

**Files:** Create `api/admin.ts` (port the shape of Charlie's: incidents, failed jobs with retry, safety events by check, webhook log, model config, limits, assumptions), `test/admin.test.ts`.

- [ ] **Step 1: Failing tests** C-0487, C-1466, C-1609, C-1538. **Step 2–4.** **Step 5: Commit** `The operator view`

**Phase 8 gate.** Push; PR into `main`; merge when CI is green.

---

## Phase 9 — The ElevenLabs agent itself

### Task 9.1: Push the agent from the repo

**Files:** Create `scripts/push-agent.ts` (reads `renderAgentPrompt`, builds the agent JSON — prompt, first message, tools with URL `${PUBLIC_BASE_URL}/api/voice/tool/{name}` and header `x-call-secret`, data collection, evaluation criteria, post-call webhook URL, initiation webhook on with `first_message` override — `GET` the current agent, print a diff, `PATCH`/`PUT` on `--apply`; refuses without `ELEVENLABS_API_KEY`), `test/push-agent.test.ts` (builds the JSON against the fakes and asserts the tool list, the webhook URL and that no secret is in the printed diff), `docs/VERIFIED.md` rows for the Agents API shape.

- [ ] **Step 1: Failing test** `[C-0166]`-adjacent build assertions and a new row if needed. **Step 2–4.** **Step 5: Commit** `Push the agent configuration from the repository`

### Task 9.2: The demo page with the browser widget

**Files:** Create `public/demo.html` (name + mobile form → starts the widget with dynamic variables `client_name`, `client_phone`; the embed per VERIFIED.md; a short "what will happen" panel; no Supabase, no secrets), `public/index.html` (one-paragraph landing: what Call is, a button to `/demo`, a link to `/app/login`; brand colours), `test/public.test.ts` (static: no keys, the agent id comes from a `data-agent-id` injected by `api/demo.ts` from `brokers.elevenlabs_agent_id`, not hardcoded), `api/demo.ts`.

- [ ] **Step 1: Failing test** C-1573 (already) plus `public.test.ts` rows asserting the form fields and the absence of literals. **Step 2–4.** **Step 5: Commit** `The demo page: call the agent from a browser`

### Task 9.3: Live check instructions

**Files:** Create `HANDOFF.md` §1–§3: ElevenLabs account steps (agent created by the push script; webhook secret; tool secret; voice chosen; LLM chosen), Twilio trial steps (verify the demo callers' numbers; buy the one US number; import into ElevenLabs), what to watch on `/api/health` during the first real call, and the five live checks from SPEC §14.

- [ ] **Step 1:** Write it. **Step 2:** Orchestrator reads it against SPEC §5 and VERIFIED.md. **Step 3: Commit** `Handoff: how to put a real call through`

---

## Phase 10 — In-person meeting mode

### Task 10.1: The meeting page and upload endpoints

**Files:** Create `public/meeting.html` (client picker, consent panel, "Client agreed" / "Client declined", `MediaRecorder` 60 s chunks with retry queue, timer, Stop, resume from `localStorage`), `api/meeting.ts` (`/start`, `/chunk`, `/finish`, `/upload`), `api/_lib/meeting.ts`, `test/meeting.test.ts`.

- [ ] **Step 1: Failing tests** C-1300…C-1325 (page rows by static HTML/JS assertions; endpoint rows by handler calls). **Step 2–4.** **Step 5: Commit** `Record a meeting in the browser, in chunks, with consent first`

### Task 10.2: Transcription and speaker labelling

**Files:** Create `api/_lib/transcribe.ts` (port Charlie's provider routing; `transcribeMeeting(job)`, `labelSpeakers(job)` using `askJSON("summary")` with the broker's name and the addressee rule), `test/transcribe.test.ts`.

- [ ] **Step 1: Failing tests** C-1326…C-1348 (non-app rows), C-1360. **Step 2–4.** **Step 5: Commit** `Transcribe the meeting and label who spoke, or say unknown`

### Task 10.3: Meeting journey end to end

**Files:** Create `test/journey-meeting.e2e.test.ts`.

- [ ] **Step 1: Failing tests** C-1349…C-1358, C-1347–C-1348 (app side), C-0981. **Step 2–4.** **Step 5: Commit** `A meeting lands in the same dashboard as a call`

**Phase 10 gate.** Push; PR into `main`; merge when CI is green.

---

## Phase 11 — Operations

### Task 11.1: Crons

**Files:** Create `api/cron/retention.ts`, `api/cron/keepalive.ts`, `api/cron/freshness.ts`, `api/_lib/cron-auth.ts`, `test/retention.test.ts`, `test/cron.test.ts`.

- [ ] **Step 1: Failing tests** C-1400…C-1408, C-1561, C-1563…C-1566, C-1596, C-1607, C-0440, C-1142. **Step 2–4.** **Step 5: Commit** `Retention, keep-alive and freshness on a schedule that fails closed`

### Task 11.2: Health, complete

**Files:** Modify `api/health.ts`, `test/health.test.ts`.

- [ ] **Step 1: Failing tests** C-1530…C-1534, C-1536, C-1538, C-1540, C-1461, C-0306, C-0411, C-1025, C-1236. **Step 2–4.** **Step 5: Commit** `Health says what is configured, what is live, and what is running out`

### Task 11.3: Alerts, complete

**Files:** Modify `alerts.ts`, `test/alerts.test.ts`.

- [ ] **Step 1: Failing tests** C-1542…C-1544, C-1549, C-1551, C-1437–C-1438, C-0304, C-0420. **Step 2–4.** **Step 5: Commit** `Alerts for the things that need a human`

---

## Phase 12 — The journeys end to end, criteria closure, handoff

### Task 12.1: The call journey end to end

**Files:** Create `test/journey.e2e.test.ts` (drives `api/voice.ts` handlers → worker drain → `api/app.ts` approve → delivery fakes, for the fixtures: happy-path email, whatsapp-channel, declined-consent, dropped, silence, hardship, misheard-age, prompt-injection, known-client second call, web-no-caller-id, two-needs-over-budget, no-product-fits, agent-advised, auto-send demo), `test/endpoints.e2e.test.ts` (every route answers; unknown route 404; methods).

- [ ] **Step 1: Failing tests** every `journey.e2e` row still untagged: C-0109–C-0115, C-0118–C-0119, C-0197–C-0198, C-0217–C-0222, C-0232–C-0233, C-0236, C-0239–C-0241, C-0252, C-0289–C-0291, C-0299, C-0355, C-0363, C-0470, C-0481–C-0483, C-0620, C-0753–C-0760, C-0794, C-0910, C-1352–C-1353 (meeting ones already), plus timing `[C-0006][C-0403]` assertions.
- [ ] **Step 2–4.** **Step 5: Commit** `The whole call, from the first webhook byte to the delivery row`

### Task 12.1b: Simulate a whole call locally and drive the dashboard in Chromium

The founder is never asked to test (A19). This task is how Claude tests the real thing itself.

**Files:** Create `scripts/dev-server.ts` (a plain `node:http` server mounting every `api/*.ts` handler at its Vercel path, against either the fakes (`--fake`, default) or a real Supabase when `SUPABASE_URL` is set), `scripts/simulate-call.ts` (plays a fixture as ElevenLabs would: POST `/api/voice/init`, the fixture's tool calls to `/api/voice/tool/*` at their timestamps, then signed `post_call_transcription` and `post_call_audio`; drains the worker; prints the session id and the `intel-trace` summary), `test/dashboard.browser.test.ts` (Playwright with the pre-installed Chromium — `require('playwright')`, `chromium.launch()`, no install: start the dev server, simulate the happy-path and misheard-age fixtures, log in with the code from the fake email outbox, open the call, tick facts, approve, assert the fake Resend received the email with the PDF, open the signed link, screenshot each page into `preview/` (git-ignored); skipped with a visible line when Chromium is absent).

- [ ] **Step 1: Failing test** the browser test, tagged with the dashboard criteria it exercises end to end (`[C-1105][C-1139][C-1150][C-1000][C-1017][C-1582]`) in addition to their unit tests. **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; look at the screenshots.
- [ ] **Step 5: Commit** `Simulate a whole call locally and drive the dashboard in Chromium`

### Task 12.5: Chase Intelligence export, trace reader, and the one-id proof

**Files:** Create `api/_lib/intelexport.ts` (port; `EXPORT_TABLES` for Call: sessions, turns, consents, facts, fact_refusals, needs, recommendations, quotes, deliveries, hardship_notes, callbacks, client_messages, meeting_chunks (metadata only), recordings (metadata only), safety_events, usage_ledger, audit_log, jobs, incidents, webhook_events (without `raw` signatures), products, product_pricing, product_categories, disclosures, model_config; never login_codes, sessions_auth, broker_users.email), `scripts/intel-export.ts`, `scripts/intel-trace.ts`, `test/intel-trace.e2e.test.ts`, `test/intel-export.test.ts`. Update `docs/INTEL-PHASE0.md` with anything learned while building.

- [ ] **Step 1: Failing tests** C-1755 (the happy-path call reads back whole, in order, from the session id), C-1756 (capture off vs on changes nothing), C-1757 (`npm run test:intel` counts equal `npm test`), C-1759–C-1762, C-1710 (end-to-end form).
- [ ] **Step 2–4.** **Step 5: Commit** `Export everything, read any task back from one id`

### Task 12.2: Criteria closure

- [ ] **Step 1:** `npm run criteria -- --missing`. For every remaining id: either add the test to the owning file (one executor per owning file, parallel-safe), or, if the criterion is wrong or duplicative, edit the row with a reason in the commit and note it in BEHAVIOR-MATRIX Part B.
- [ ] **Step 2:** Switch CI's criteria step from `--count --matrix` to `--check --matrix` (it is already in `verify`); confirm it passes.
- [ ] **Step 3:** `npm run verify` → all green; paste the counts in the PR.
- [ ] **Step 4: Commit** `Every criterion tagged; verify green`

### Task 12.3: Handoff and the Supabase prompt, final

**Files:** Modify `HANDOFF.md` (§4 Resend domain, §5 WhatsApp templates and test number, §6 Vercel env list from `.env.example`, §7 the first demo script for Mike: who calls, what they say, what the broker sees, how long it takes, what it cost), regenerate `docs/SUPABASE-PROMPT.md`, update `README.md` status, `docs/VERIFIED.md` complete.

- [ ] **Step 1:** Write. **Step 2:** The orchestrator walks the demo script against the e2e fixtures. **Step 3: Commit** `Handoff: the demo, step by step`

### Task 12.4: Drift audit, merge, and the reply

- [ ] **Step 1:** Phase reviewer agent reads the branch against BEHAVIOR-MATRIX Part A, SPEC §0, Part B; lists drift; orchestrator fixes.
- [ ] **Step 2:** Run `npm run verify` and `npm run simulate-call -- happy-path` one last time and paste the counts and the trace summary into the final PR: what changed, the verify counts (tests in both modes, criteria tagged of total, grep results, print smoke, browser test), and the founder's steps (keys to set, accounts to create, what costs money and is waiting for a yes). No tester prompt.
- [ ] **Step 3:** Merge the final PR into `main` once CI is green. Confirm `main` holds every phase (`git log origin/main --oneline | head`).
- [ ] **Step 4:** Reply briefly in chat (BEHAVIOR-MATRIX A19): what was built, the merged PR links, the counts, and only the steps that need the founder's hands.

---

## Self-review notes (written with the spec open)

- **Spec coverage:** SPEC §3.1 steps 1–10 → Tasks 3.1–3.4, 4.2, 5.x, 6.x, 7.x, 8.3; §3.2 → Phase 10; §3.3 → 2.4, 3.2, 5.1, 7.5; §3.4 → 3.4, 7.5; §4 → 1.1; §5 → 9.1; §6 → 4.3, 4.4; §7.1–7.9 → 3.4, 2.2, 2.3/4.2, 5.1, 2.4, 5.3, 6.1, 6.2, 7.5; §8 → 5.x; §9 → 6.3, 6.4, 8.4; §10 → Phase 8; §11 → 7.1–7.4; §12 → Phase 11, 7.6; §13 → 0.2, 0.5, 1.1, 7.4, 8.1; §14 → 0.1, 4.1, 12.1, 12.2; §15 nothing to build.
- **Type consistency:** `Fact`/`FactDraft` (Task 2.3) are what `needsFrom` (5.1), `selectProduct` (5.3), `allowedNumbers` (6.1), `checkQuoteText` (6.2), `quoteDocHTML` (6.3), `roaHTML` (6.5) consume; `Selection` (5.3) is what `runMatch` writes and `versions.ts` (8.4) re-creates; `approveQuote`/`transition` (7.3) are the only writers of `quotes.status` besides `checkQuote` via `advanceAfterCheck` (6.2 stub → 7.3 real).
- **Review Focus tests** are assigned: 1 → 2.1, 2 → 3.5, 3 → 2.3, 4 → 8.3, 5 → 7.3.
- **Chase Intelligence** is covered task by task by the Capture map; nothing is retrofitted at the end except the export and the end-to-end proof (12.5).
- **Proportion:** the plan names files, signatures, criteria ranges and commit messages, and leaves bodies to the executor; the criteria files carry the assertions so the plan does not repeat them.
