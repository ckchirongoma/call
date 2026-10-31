# Task 0.1 review: env snapshot, db client, in-memory fakes

Range `fcd4384..f77f38d` (one commit, `f77f38d Scaffold: env snapshot, db client, in-memory fakes`). The task files are unchanged between `f77f38d` and the current HEAD (`de2f40f`), so the line numbers below are the same in both.

### Spec Compliance

- ✅ Files: `api/_lib/env.ts`, `api/_lib/db.ts`, `api/_lib/types.ts`, `test/_fakes.ts`, `test/_env.ts`, `test/fakes.test.ts` created. The plan checkboxes are ticked and a Notes block is added under Task 0.1 only (`docs/superpowers/plans/2026-10-31-call-build.md:111`). No dependency added (`package.json` untouched).
- ✅ `env` is a frozen snapshot of all 28 `.env.example` variables, in the same order and with the listed defaults (`api/_lib/env.ts:42-107`). Numbers are numbers, and an unparsable value falls back to the default rather than NaN (`:29-34`). `required(name)` names the variable (`:132-136`), and nothing throws at import. A live binding plus `reloadEnv()` as the test seam (`:113-123`) is consistent with the orchestrator's "frozen snapshot" decision.
- ✅ `db()` is a lazy service-role client with a 20 s timeout, and the `__setClient` seam is kept (`api/_lib/db.ts:36-56`). The fake DB is returned while installed (`test/fakes.test.ts:48`).
- ✅ `types.ts` has an interface for each of the 27 SPEC §4 tables plus `callbacks`, `client_messages`, `meeting_chunks` and `intel_events`, with every extra column Task 1.1 lists (facts.approx/value_min/value_max, sessions.provider_*/turn_count/continues_session_id, clients.whatsapp_e164/last_inbound_at, recommendations.replaces_fact_id, quotes.flags, brokers.voice_id/agent_llm, webhook_events.processed_at, jobs.dedupe_key, JobStatus). `IntelEvent` matches INTEL-CONTRACT §1 column for column.
- ✅ `installFakeDb(seed?)` returns `FakeDb { client, tables, log, reset() }` (plus storage/uninstall/restore), with tables for all 31 tables. A table missing from `TABLES` is a type error (`test/_fakes.ts:83-85`).
- ✅ Query semantics are PostgREST-like: `single()` errors PGRST116/406 on 0 or more than 1 row, and `maybeSingle()` gives null on 0 and PGRST116 on more than 1 (`:466-478`, tested `test/fakes.test.ts:141`). A write returns `data: null` without `.select()` (`:70`). Errors come back as `{ data: null, error }` (23505/409), and only unsupported shapes throw. `upsert` checks that `onConflict` names a declared unique set (`:510-523`). `ignoreDuplicates`, all-or-nothing multi-row insert, copies rather than aliases, and NULL semantics for neq/gt/order are all present.
- ✅ `rpc("claim_job")` claims the oldest due queued job or a stale running one, sets attempts+1, locked_at and locked_by, and returns an array (`:592-614`, tested `test/fakes.test.ts:323`). An unknown rpc, unknown table, unknown client property, non-plain select or unknown chain method throws `FakeDbUnsupported` naming the shape (`:503-514`, `:552-557`, tested `:116`).
- ✅ `fakeStorage()` gives upload/download/remove/list with `files: Map<string, Uint8Array>`, reachable via `client.storage.from(bucket)` (`:661-761`). `fakeClock(iso)` controls `Date.now()` and `new Date()` and restores (`:782-821`). `installFakeNet()` gives `onModel`, `onFetch` and `calls`, replaces global fetch, fails on unscripted calls and restores (`:869-961`).
- ✅ `test/_env.ts` pins or deletes every `.env.example` variable except `INTEL_CAPTURE` before any import. A test fails if `.env.example` gains an uncovered variable (`test/fakes.test.ts:573`).
- ✅ The brief's required smoke cases are present: insert and select a broker (`:54`), upsert `broker_id,phone_e164` twice giving one row (`:76`), and `.textSearch` throwing (`:116`). There is no criteria tag, as the orchestrator directed.
- ✅ Relative imports in `api/` end in `.js` (`db.ts:16`); tests import `.ts`. There are no secrets: every value is a `test-…` fake, numbers are in `+2779993xxxx`, and emails use `@example.test`. No model slug appears in `api/`.
- ✅ The Charlie port is attributed in each ported header (`db.ts:3-5`, `env.ts:4-6`, `_fakes.ts:4-6`). The why-comments are kept: Charlie round 13 on the DB timeout, "never throws at import", and the fake-accepts-a-query-it-cannot-run rationale.
- ✅ The commit message ends with exactly the two executor-context attribution lines. It has no other model identifier.
- ⚠️ Cannot verify from the diff: the RED run (module not found) and the 40/40 GREEN under `npm test` and `test:intel`. The report shows plausible output, and I did not re-run the suite.

### Strengths

- The fake is deliberately stricter than Charlie's in the places that hide production bugs. Examples: `data: null` without `.select()`, PGRST116 on multi-row `maybeSingle`, 42P10 on an undeclared `onConflict`, all-or-nothing batch insert, results as copies, and a refused unfiltered update/delete. Each one is tested.
- The finding about SPEC §4's partial unique index on `clients` is correct and important: an upsert cannot use a partial index as its arbiter. It is handed to Task 1.1 in the plan notes rather than being silently "fixed".
- The Proxy-based "name the shape however deep in the chain" guard is solid. The PASSTHROUGH list keeps `await`, `util.inspect` and async returns of the client working (`test/fakes.test.ts:219`).
- The test env pins every variable, and a test catches drift from `.env.example`. A real shell key cannot leak into a test.
- The mutation testing in the report (six mutations, each caught) is good evidence that the tests catch real changes.

### Issues

#### Critical
None.

#### Important

1. **The fake does not validate filter or order column strings. Unsupported JSON-path shapes fall through as "absent column" and give silently wrong results.** `test/_fakes.ts:160-165` (`columnValue`), `:480-483` (`filter`), `:541-544` (`order`).
   - **What:** Only `col` and `col->>key` (lowercase key) are understood. Every other string is treated as a plain column that does not exist. I confirmed this with a focused probe:
     - `.is("payload->quote_id", null)` returns every row. PostgREST returns none when the key is present.
     - `.eq("payload->>quoteId", "q1")` returns 0 rows. PostgREST matches, because JSON keys are case-sensitive and camelCase is legal.
   - **Why:** This is the failure the brief ranks first: "a fake that silently accepts a query it does not really support would make a broken test pass". An `is(..., null)` that matches everything can turn a should-fail test green. `select()` already validates its column list (`:487-493`), but filters and `order` do not.
   - **Fix:** In `filter()` and `order()`, accept only `^[a-z_][a-z0-9_]*$` or `^[a-z_][a-z0-9_]*->>[A-Za-z0-9_]+$`, and throw `FakeDbUnsupported` naming the shape otherwise. Widen the JSON-key class in `columnValue` to match. Add one test line per refused shape.
   - **Not covered by this fix:** a plain column typo (`is("lockd_at", null)` also matches every row; PostgREST gives 42703) cannot be caught without a column list. Add it to the header's "Not emulated" list so later tasks know.

2. **`storage.from(bucket)` accepts any bucket name.** `test/_fakes.ts:692`, `:760`.
   - **What:** I confirmed that `storage.from("recordingz").upload(...)` succeeds. Real Supabase Storage returns "Bucket not found". Plan Task 1.1 creates exactly two private buckets, `recordings` and `quotes`.
   - **Why:** This is the storage version of the unknown-table check the fake already enforces (`:550`). A typo'd bucket in recording upload (3.5) or the PDF store (6.4) would pass every test and lose data in production.
   - **Fix:** Add `const BUCKETS = new Set(["recordings", "quotes"])` with a pointer to Task 1.1's migration. In `from(bucket)`, throw `FakeDbUnsupported` for any other bucket (or return the not-found error). Add one test.

#### Minor

1. **Builder options are silently ignored.** `order(col, { nullsFirst, referencedTable })` is ignored (`:541`); I confirmed `nullsFirst: true` is accepted and does nothing. `limit(n, { foreignTable })` (`:545`), `insert(rows, { count, defaultToNull })` (`:500`) and `upsert(..., { count, defaultToNull })` (`:510`) are also ignored. Throw `FakeDbUnsupported` on any option key the fake does not implement.
2. **`rpc()` returns a bare Promise, not a builder.** `:610-613`. `rpc("claim_job", …).single()` / `.maybeSingle()` / `.select()` is legal supabase-js, but here it fails with `TypeError … is not a function` (confirmed) rather than `FakeDbUnsupported`. It is loud, and it matches Charlie's usage (`await db().rpc("claim_job", …)`). Wrap the result in the same naming Proxy so the error says what to teach.
3. **Upsert batches do not behave like one statement.** `:427-445`. A failure on row 2 leaves row 1 applied, unlike a single statement. Two rows with the same conflict key in one call succeed, returning 2 rows and storing 1 (confirmed); Postgres raises 21000 ("cannot affect row a second time"). Stage the changes the way `insertRows` does, and reject a duplicate key within the batch.
4. **An explicit `id` on `jobs` or `intel_events` is accepted.** `:301`. Confirmed with `insert({ id: 999 })`. Postgres raises 428C9 on a `generated always as identity` column. Refuse an explicit id for `BIGINT_ID` tables.
5. **An `undefined` filter value silently matches nothing.** `:480`. supabase-js sends the literal `undefined`, which gives 22P02 on a uuid column in production. This hides the common call-site bug `eq("id", maybeUndefined)`. Throw `FakeDbUnsupported` on an `undefined` value.
6. **`claim_job` treats NULL timestamps as due.** `:597-599`. A queued job with NULL `run_after`, or a running job with NULL `locked_at`, counts as runnable; SQL comparisons with NULL are false. This is low risk given the defaults, but the mirror should match the SQL Task 0.4/1.1 will write. Charlie's per-owner ordering lesson is dropped; the report says so and hands it to 0.4, which is fine.
7. **`FakeNet` records only string bodies.** `:889-892`. A `Uint8Array`, `FormData` or `URLSearchParams` body (transcription upload, multipart) is recorded as `body: null`. A later task can extend this. Separately, a `/g` or `/y` RegExp passed to `onModel`/`onFetch` is stateful under `.test()` (`:801`); reset `lastIndex` or strip those flags in `toRe`.
8. **Defaults and `created_at` gaps for Task 1.1.** `types.ts` marks `sessions.readback_confirmed` (`:170`), `sessions.cost_cents` (`:173`) and `quotes.flags` as non-null, but `DEFAULTS` gives them nothing, so fake rows lack the keys (`cost_cents` arithmetic gives NaN). Separately, `intel_events` has no `created_at` (`types.ts:17`), which contradicts C-1580 and the executor-context rule "every table has created_at". Neither point is in the plan-notes list for Task 1.1. Add both so the migration and `DEFAULTS` agree.
9. **Formatting drift.** The `makeBucket` body is indented 4 spaces (`:692-756`), as are `ModelCall.payload` (`:837`) and `const payload` (`:913`). These look like leftovers from a refactor.
10. **The commit body is 4 lines.** Executor-context step 4 says 1–3. This is trivial. Also, `reloadEnv` is a test seam in a production module without Charlie's `__` marker (`__setClient`); renaming it is optional.

### Assessment

Task quality: **Needs fixes**

The work meets the spec and is well built. The fake is markedly more faithful than Charlie's and well tested. Two cheap fixes should land before later tasks lean on it, because both let a wrong query or bucket pass silently, which is the one thing the brief says the fake must never do: validate filter/order column shapes (Important 1) and restrict storage to the two declared buckets (Important 2). The Minor items can be batched or handed to the tasks that first need them.
