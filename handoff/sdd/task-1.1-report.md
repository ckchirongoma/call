# Task 1.1 report: Migrations

**Status:** DONE
**Worktree:** `/home/user/call/.claude/worktrees/agent-a6388f5a8ec7632e4`
**Branch:** `worktree-agent-a6388f5a8ec7632e4` (fast-forwarded to `claude/call-phone-agent-build-f50v1t` @ dc8fbb4 first)
**Commit:** `01309e9` Migrations 0001–0007: schema, model_config, catalogue, quotes, platform, RLS (not pushed)
**Report path:** this file (the shared `/home/user/call/.superpowers/...` path was refused by worktree isolation; not committed)

## TDD

**RED** (tests written first; `db/` absent; the only pre-implementation change was exporting `SCHEMA` from the fake):

```
static: rls.test.ts + migrations.test.ts + fakes.test.ts
# tests 79  # pass 61  # fail 18
  not ok - a brokers row is inserted with its defaults (agent_name "Ava" expected, fake had none)
  not ok - [C-1575] every statement in db/*.sql is written to be a no-op ... ('the migrations are there to read')
  not ok - the reader really reads the migrations / [C-1567][C-1568] / [C-1576][C-1577] ('model_config') /
           [C-1089] ('brokers.auto_send exists') / [C-1570][C-1571] / [C-1578] x2 ('claim_job exists') /
           bump_incident ('bump_incident exists') / [C-1579] / [C-1751][C-1752] / agreement
  not ok - bite tests: ENOENT ... lstat '<worktree>/db'
real Postgres (TEST_DATABASE_URL set):
  not ok - [C-1575] every db/*.sql runs twice ... expected: 7 actual: 0
  not ok - RLS is on for every table ... / policies ... (empty catalogs)
```

After the SQL, the agreement test failed for exactly the fake/types changes this task makes
(`brokers.agent_name: DEFAULT "Ava" in the SQL, none in the fake's DEFAULTS`; `NOT NULL in the SQL, | null in types.ts`;
`meeting_chunks` / `disclosures` unique keys), then went green once the fake and types.ts were changed.

**GREEN:**

- `npm run typecheck` clean.
- `npm test`: 149 pass, 0 fail (prints `migrations.test.ts: skipped: no TEST_DATABASE_URL ...` and `ok - db/*.sql on a real Postgres # SKIP skipped: no TEST_DATABASE_URL`).
- `npm run test:intel`: 149 pass, 0 fail.
- `TEST_DATABASE_URL=local Postgres 16 (user postgres, password postgres, host 127.0.0.1:5432, db call_test) npm test`: 159 pass, 0 fail.
- `npm run grep-models`, `grep-doc-css`, `criteria -- --matrix`: green. `criteria -- --missing` lists none of this task's ids (`--check` still fails overall on the 1,281 other untested criteria, as expected at this phase).

Real-Postgres run (PostgreSQL 16.15, spec reporter):

```
▶ db/*.sql on a real Postgres
  ✔ [C-1575] every db/*.sql runs twice in order on a fresh database, each as one transaction, and the whole set once more (2014ms)
  ✔ [C-1568][C-1576][C-1577][C-1751] RLS is on for every table, and the tables are exactly the fake's (87ms)
  ✔ [C-1567][C-1568] the only policies are SELECT for anon and authenticated on the three reference tables (93ms)
  ✔ [C-1751] anon and authenticated can read the catalogue and nothing else: every other table is permission denied, and nothing is writable (5450ms)
  ✔ [C-1570][C-1571] the recordings and quotes buckets exist and are private (53ms)
  ✔ [C-1089] a new broker row has auto_send false, and the other defaults the fake applies (78ms)
  ✔ every column, jsonb column, identity, unique key and default is the fake's (166ms)
  ✔ [C-1578] claim_job claims as the fake does: a stale lock first by run_after, then the oldest due job, never a fresh lock or a future job (714ms)
  ✔ bump_incident counts as the fake does: one row per fingerprint, the worst severity kept, the latest summary cut to 500, a bad severity refused (446ms)
  ✔ [C-1579] deleting a client's sessions takes their turns, facts, consents, quotes and deliveries; jobs and costs keep their row with session_id null; a fact's turn cannot be deleted from under it (2130ms)
✔ db/*.sql on a real Postgres (11635ms)
```

Manual checks on a scratch database (script in the session scratchpad, not committed): no `call_mig_*` database left behind;
a second run of 0001 prints only `NOTICE: relation "brokers" already exists, skipping` lines; anon on `clients` →
`ERROR: permission denied for table clients`; with SELECT granted back, RLS alone still returns `0` rows; a stray
`public.stray` table with RLS off makes 0007 stop with `RLS is off on: stray. Enable it ... before going on.`

## Files

Created: `db/0001_core.sql` … `db/0007_rls.sql`, `test/rls.test.ts`, `test/migrations.test.ts`, `test/_sql.ts` (shared SQL reader).
Modified: `test/_fakes.ts` (exports `SCHEMA`; `UNIQUE` gains `meeting_chunks (session_id, idx)`, `disclosures (country, key)`;
`DEFAULTS.brokers` gains `agent_name: "Ava"`; comments now point at db/0006 and the tests), `test/fakes.test.ts` (asserts
`agent_name` "Ava"), `api/_lib/types.ts` (`agent_name: string`; header says rls.test compares), `criteria/12-ops-security.md`
(C-1567 names `db/0007`; C-1580 exempts `intel_events`), `criteria/13-intel.md` (C-1752: no `created_at`, per the ruling),
`docs/superpowers/plans/2026-10-31-call-build.md` (Task 1.1 ticked + Notes).

## Criteria tagged

C-1567, C-1568, C-1569, C-1570, C-1571, C-1576, C-1577, C-1578, C-1579, C-1580, C-1089, C-1751, C-1752 (`test/rls.test.ts`),
C-1575 (`test/migrations.test.ts`, static and real-Postgres halves). C-1567/1568/1570/1571/1576/1577/1578/1579/1089/1751 are
also re-proved in the real engine.

## Decisions (all in the plan's Task 1.1 Notes)

- RLS enabled in each table's own file (C-1569) **and** again in 0007, which also does `REVOKE ALL … FROM anon, authenticated` on
  every private table (Supabase grants the API roles everything by default; TRUNCATE ignores RLS), gives the three reference
  tables back SELECT only with one `FOR SELECT TO anon, authenticated USING (true)` policy each, and ends with a DO guard that
  raises if any `public` table has RLS off.
- `clients_broker_phone_key UNIQUE (broker_id, phone_e164)` (plain, not partial), as ruled. The agreement test also proves
  a partial unique index is never counted as an upsert arbiter.
- `intel_events`: contract §1 exactly, in order; Charlie db/0034's four indexes; `meta` nullable, no default (matches types/fake);
  no `created_at` (ruling).
- Beyond SPEC §4, in SQL + fake + types together: `brokers.agent_name NOT NULL DEFAULT 'Ava'` (SPEC header says default "Ava";
  the fake had none, so I followed SPEC and fixed the fake + its test), `meeting_chunks UNIQUE (session_id, idx)` (types.ts already
  said so), `disclosures UNIQUE (country, key)`.
- Foreign keys: every `client_id` → clients CASCADE; session children cascade; `jobs.session_id` and `usage_ledger.session_id`
  SET NULL (forget job / cancelled jobs outlive deleted sessions; costs stay); `facts.turn_id` NO ACTION (R2: a referenced turn
  cannot be deleted); `sessions.consent_turn_id` → turns SET NULL, added in a DO guard.
- `claim_job(p_worker text)`: the fake's semantics, stale lock 5 min (`STALE_LOCK_MS`), `LANGUAGE sql SECURITY DEFINER SET
  search_path = public`, `FOR UPDATE SKIP LOCKED`; `bump_incident(p_fingerprint, p_kind, p_severity, p_summary)` per Charlie
  db/0024 on Call's columns. Both are REVOKEd from PUBLIC/anon/authenticated and GRANTed to service_role.
- Buckets: `INSERT … ON CONFLICT (id) DO UPDATE SET public = false` (a re-run makes them private again).
- Agreement test (`rls.test.ts`): SQL vs fake `SCHEMA` (tables, columns, jsonb, PK, identity, unique sets, defaults both ways)
  and vs types.ts (nullability, kind, CHECK sets vs union types). Each check is also shown to bite on a temp tree.

## Concerns / for later tasks

1. **The fake does not emulate foreign keys**, so an FK violation (e.g. enqueuing a job, or writing `usage_ledger` /
   `safety_events`, for a session id that does not exist) passes every fake-backed test and fails only in Postgres.
2. **Task 3.4 (C-0315 placeholder turns):** `facts.turn_id` has no ON DELETE action, so ingest must re-point facts to the real
   turn *before* deleting a placeholder turn (deleting first errors, by design).
3. **Task 1.2:** every INSERT must have ON CONFLICT (the re-runnable check enforces it); products have uuid ids, so re-runnable
   seeds need deterministic ids or a unique `external_id` column (which must go into types.ts, the fake's COLUMNS/UNIQUE and a
   migration together; the agreement test will insist). `disclosures (country, key)` is available as an arbiter.
4. **Task 0.4:** `claim_job` has no per-session ordering (as instructed, matching the fake). Charlie's db/0013 moved per-owner
   ordering *into* the claim after a real race; if Call's queue serialises per session after claiming, it inherits Charlie's
   TOCTOU. Also the queue's lock timeout (plan: 120 s) differs from the claim's 5-minute stale age; reconcile there.
5. Criteria wording edited to match the ruling (C-1752, C-1580) and the file layout (C-1567). Flagging in case the orchestrator
   prefers the criteria untouched.
6. `migrations.test.ts`'s real-Postgres half takes ~11 s (about 120 psql processes for the anon/authenticated sweep); it only
   runs when `TEST_DATABASE_URL` is set. The URL is not in `.env.example` or committed anywhere except as an example in the
   test's header comment.
