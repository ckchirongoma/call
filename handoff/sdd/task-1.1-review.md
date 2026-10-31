# Task 1.1 review: Migrations (dc8fbb4..01309e9)

Worktree: `/home/user/call/.claude/worktrees/agent-a6388f5a8ec7632e4`, branch `worktree-agent-a6388f5a8ec7632e4`, one commit `01309e9`.

**What I ran myself (read-only):**
- `test/rls.test.ts` + `test/migrations.test.ts` with no database: 23 pass. The visible `migrations.test.ts: skipped: no TEST_DATABASE_URL …` line and `# SKIP skipped: no TEST_DATABASE_URL` both print.
- `test/migrations.test.ts` with `TEST_DATABASE_URL=…/call_test`, on Postgres 16: 12/12 pass in about 11 s. No `call_mig_*` database was left behind.
- `npm test`: 149/149.
- `tsc --noEmit`: clean.
- `npm run criteria -- --missing` lists none of C-1567–1571, C-1575–1580, C-1089, C-1751 or C-1752.
- `docs/INTEL-CONTRACT.md` sha256 is still `5060897a…` (C-1753), unchanged by the commit.

### Spec Compliance

**SPEC §4 tables and columns.** Every listed column is present, plus every extra the brief names:
- ✅ brokers: `voice_id`, `agent_llm`.
- ✅ clients: `whatsapp_e164`, `last_inbound_at`.
- ✅ sessions: `provider_analysis`, `provider_summary`, `provider_cost`, `turn_count`, `continues_session_id`.
- ✅ facts: `approx` (default false), `value_min`, `value_max`.
- ✅ recommendations: `replaces_fact_id`.
- ✅ quotes: `flags text[]`.
- ✅ webhook_events: `processed_at`.
- ✅ jobs: `dedupe_key text UNIQUE`, and the `status` CHECK lists exactly the six values. See `db/0001_core.sql`, `db/0003_facts.sql:37`, `db/0005_quotes.sql`, `db/0006_platform.sql:44-60`.
- ✅ The extra tables are there: callbacks, client_messages and meeting_chunks (`db/0001_core.sql:224-267`).
- ✅ The SQL, the fake's `SCHEMA` and `types.ts` agree column by column. This is checked by `agreesWithFakeAndTypes` (`test/rls.test.ts:334`) and again in the real engine.

**Constraints and keys**
- ✅ Every closed set in SPEC §4 is a column CHECK, and each matches its union type in `types.ts`.
- ✅ Money columns are integer `_cents`.
- ✅ `jobs.id` and `intel_events.id` are `bigint GENERATED ALWAYS AS IDENTITY`. Every other id is a uuid with `gen_random_uuid()`.
- ✅ `clients_broker_phone_key UNIQUE (broker_id, phone_e164)` is a plain constraint, as the orchestrator ruled (`db/0001_core.sql:120`). It carries a why-comment, and a test shows a partial index would not be counted as an upsert arbiter.

**Indexes in SPEC §4**
- ✅ `sessions (broker_id, started_at DESC)`, `facts (session_id, status)`, `jobs (status, run_after)` and `quotes (broker_id, status)` are created.
- ✅ `turns (session_id, idx)` is served by the `turns_session_idx_key` unique constraint.

**Foreign keys and forgetClient**
- ✅ Every `client_id` references `clients(id) ON DELETE CASCADE`. The children of a session cascade from `sessions`.
- ✅ `jobs.session_id` and `usage_ledger.session_id` are `SET NULL`. This fits C-1412 (cancel, not delete) and keeps costs (`db/0006_platform.sql:49,132`).
- ✅ `facts.turn_id` has no ON DELETE action, which enforces R2 (`db/0003_facts.sql:37`).
- ✅ The real-Postgres test proves these: deleting a session takes its turns, facts, consents, quotes, deliveries and safety_events. The job and the cost rows keep their row with `session_id` null. A turn that a fact points at cannot be deleted.

**RLS**
- ✅ RLS is enabled in the same file that creates each table (C-1569), and again for all 31 tables in `db/0007_rls.sql`.
- ✅ There are exactly three policies, each `FOR SELECT TO anon, authenticated USING (true)`, on products, product_categories and disclosures (`db/0007_rls.sql:85-91`). There are no others.
- ✅ The private tables are REVOKEd from anon and authenticated. The reference tables are reduced to SELECT only.
- ✅ The DO guard refuses to finish while any `public` table has RLS off (`db/0007_rls.sql:95`).

**intel_events (INTEL-CONTRACT §1)**
- ✅ It has the contract's 20 columns, in order, with the contract's types. `source_ref` is UNIQUE.
- ✅ The kind, actor and content_mode CHECKs match the contract. The four indexes are Charlie db/0034's.
- ✅ RLS is on, there is no policy, and `REVOKE ALL … FROM anon, authenticated` is there (`db/0006_platform.sql:210-237`).
- ✅ It has no `created_at`, as ruled.

**Re-runnability (C-1575)**
- ✅ Every file uses `IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, `DROP POLICY IF EXISTS` before each `CREATE POLICY`, and a DO-guarded `ADD CONSTRAINT`.
- ✅ The bucket insert uses `ON CONFLICT (id) DO UPDATE SET public = false`.
- ✅ This is proved statically, with a bite test, and in the real engine: each file twice, then the whole set a third time.

**claim_job**
- ✅ It is `claim_job(p_worker text) RETURNS SETOF public.jobs`, `LANGUAGE sql SECURITY DEFINER SET search_path = public`.
- ✅ It uses a CTE with `ORDER BY run_after, id FOR UPDATE SKIP LOCKED LIMIT 1`, so a lock another worker holds is skipped.
- ✅ It claims a queued job that is due, or a running job whose lock is more than 5 minutes old (stale-lock reclaim).
- ✅ It sets `attempts + 1`, `locked_by` and `locked_at = now()`.
- ✅ It is REVOKEd from PUBLIC, anon and authenticated, and granted to service_role (`db/0006_platform.sql:68-93`).
- ✅ Its behaviour matches the fake in the same scenario.

**bump_incident**
- ✅ It is a port of Charlie db/0024 on Call's columns: an atomic upsert on `fingerprint`, `count + 1`, `last_at = now()`, the worst severity kept, the latest summary cut to 500, and `first_at` and `kind` kept from the first row.
- ✅ It is a definer with search_path pinned, and the same revoke and grant apply (`db/0006_platform.sql:184-203`).
- ✅ It matches the fake, including the 23514 on a bad severity.

**Storage and defaults**
- ✅ The `recordings` and `quotes` buckets are private, and a re-run makes them private again (`db/0006_platform.sql:242-244`).
- ✅ `brokers.auto_send boolean NOT NULL DEFAULT false` (`db/0001_core.sql:47`), proved statically and on a real row (C-1089).
- ✅ Every table but intel_events has `created_at timestamptz NOT NULL DEFAULT now()`. intel_events is exempt by name only (`test/rls.test.ts:36,130`).

**Tests**
- ✅ `rls.test.ts` parses every `CREATE TABLE`, the policy set, created_at, auto_send, the definer and search_path rules, the client_id cascade and the intel contract. Every check is shown to bite on a temporary tree.
- ✅ `migrations.test.ts` runs for real against `TEST_DATABASE_URL` with a Supabase shim: the roles, the grant-everything default privileges, and `storage.buckets`. Without the variable it prints "skipped: no TEST_DATABASE_URL" (`test/migrations.test.ts:132,183`).
- ✅ All 14 ids are tagged in test names.

**Global constraints**
- ✅ There are no secrets. The phone number is `+27799930001`, in the allowed range, and the email is `@example.test`.
- ✅ Only the task's files were committed, and the commit message has the right subject and both trailers.
- ✅ The plan checkboxes are ticked and the Notes line is added.

**Criteria rewordings**
- ✅ **C-1567:** "Given `db/0001`" becomes "Given the migrations (`db/0007`)". This corrects a stale file reference: the brief itself puts the policies in 0007. The then-clause is unchanged, so the criterion is not weakened.
- ✅ **C-1580:** adds "every table but `intel_events` (whose timestamp is `at` …)". This is exactly the ruling and no more. The test exempts the table by name, and also asserts that intel_events has no created_at.
- ✅ **C-1752:** "plus `created_at`" becomes "and no others — no `created_at`, its timestamp is `at`". This is faithful to the ruling and in fact stricter: the test asserts the exact column list, in order.

### Strengths

- **The fake is held to the SQL.** `test/_fakes.ts` now exports `SCHEMA`, and the SQL is checked against it and against `types.ts` both ways: tables, columns, jsonb, PK and identity, unique sets, defaults, nullability, and CHECK sets against the TS unions. The same checks run in the real engine. This closes the 42P10/23505 class of production-only failure that the brief warns about.
- **claim_job and bump_incident are differential-tested.** Each is run against the fake on the same scenario, so every later journey test on the fake rests on proven parity.
- **The lock is proved in the engine, not only parsed.** anon and authenticated get "permission denied" on every private table and on both functions, can read the catalogue, and cannot write it. The shim reproduces Supabase's grant-everything default, so the test proves the REVOKEs rather than a quieter default.
- **Every static check is shown to bite** on a temporary tree. A check over nothing cannot pass silently, and the "reader really reads" guard checks the file list and table count.
- **The SQL headers help the founder.** Each file says in plain terms what it does, how to apply it, its security posture and why, and the why-comments are kept (Charlie's SKIP LOCKED story, R2 on `turn_id`, R12 on `auto_send`).
- **Decisions are recorded.** Choices beyond SPEC (`agent_name DEFAULT 'Ava'` from the SPEC header, `meeting_chunks` and `disclosures` unique keys, the extra CHECKs) were made in the SQL, the fake and types.ts together and recorded in the plan notes. Forward hazards are flagged honestly (facts.turn_id and placeholder turns, the queue's lock age, seed ids).

### Issues

#### Critical
None.

#### Important
None.

#### Minor

1. **The static RLS check misses a later `DISABLE ROW LEVEL SECURITY`.** `test/rls.test.ts:58` (`rlsInSameFile`) only checks that an `ENABLE` exists in the file that creates the table. Suppose a later migration says `ALTER TABLE public.clients DISABLE ROW LEVEL SECURITY;`:
   - every static check still passes;
   - 0007's DO guard runs before 0008+, so it does not catch it;
   - only the real-Postgres half would, and CI never runs that half (see 2).
   This is the very regression Charlie suffered.
   **Fix:** add a check that flags any `ALTER TABLE … DISABLE ROW LEVEL SECURITY` (and `NO FORCE ROW LEVEL SECURITY`) anywhere in `db/*.sql`, with a bite case. It is a few lines.
2. **CI never runs the real-engine half.** `.github/workflows/ci.yml:17` runs `npm test` with no Postgres service and no `TEST_DATABASE_URL`. So these proofs only ever run locally: claim_job and bump_incident parity with the fake, the cascades, the permission-denied sweep, and the run-twice check.
   **Fix (orchestrator's call, since it is a CI or plan change):** add a `services: postgres:16` block and `TEST_DATABASE_URL` to the verify job. `psql` is already on ubuntu-latest.
3. **0007's REVOKE is a hard-coded list of 31 tables** (`db/0007_rls.sql:70`). A table added in 0008+ keeps Supabase's default ALL grants to anon and authenticated. RLS with no policy still blocks row access through PostgREST, so nothing leaks today, but the "and no grant" half of the lock silently stops covering new tables. Only the real-Postgres sweep would notice.
   **Fix:** use `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;`, then the SELECT grant on the three, or add a static check that every non-catalogue table is named in a REVOKE.
4. **bump_incident parity has a gap for a null or missing summary.** In SQL, `left(NULL, 500)` is NULL, which violates `incidents.summary NOT NULL`. A call that omits `p_summary` fails PostgREST's signature match, because all four arguments are required. The fake (`test/_fakes.ts:983`, `String(args.p_summary)`) instead stores `"undefined"` or `"null"` and succeeds. If Task 0.4's `trackFailure` ever omits the summary, it passes on the fake and fails in production.
   **Fix:** either `coalesce(p_summary, '')` in the SQL plus the same in the fake, or have the fake refuse a missing or null `p_summary`. Add one row to the parity scenario either way.

### Notes for later tasks (not defects in this task)

- **Task 0.4:** claim_job reclaims a lock after 5 minutes, as the orchestrator ruled to match the fake. C-1597 and C-1598 need B to claim at t+120 s. Charlie splits this the same way: a 5-minute backstop in claim_job, and `requeueStaleRunning` in queue.ts. So queue.ts must carry its own 120 s requeue, or the SQL and the fake must change together. The implementer flagged this.
- **Task 3.4 (C-0315):** a fact must be re-pointed to the real turn before its placeholder turn is deleted, because `facts.turn_id` has no ON DELETE action.
- **Task 1.2:** if `products.external_id` is added, do it with `ALTER TABLE … ADD COLUMN IF NOT EXISTS` in the new file. Editing 0004's `CREATE TABLE IF NOT EXISTS` would not change a database where 0004 has already run.
- **Task 8.7 (R15):** `webhook_events.raw` holds the full transcript, and `jobs.payload` may hold client data, with no foreign-key path to the client. forgetClient must clear them explicitly, for example by conversation id, rather than wait for the 30-day retention in C-1408.

### Assessment

The spec is met in full, and the three criteria rewordings are faithful and do not weaken their criteria. The engineering goes beyond what was asked: real-engine proofs, differential parity with the fake, and bite tests for every check. The four Minor items harden the guard against future regressions; none is a defect in the SQL as shipped.

**Task quality: Approved**
