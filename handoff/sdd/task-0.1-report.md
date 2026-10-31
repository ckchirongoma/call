# Task 0.1 report: environment, database client, in-memory fakes

Status: DONE_WITH_CONCERNS (concerns are hand-offs to Task 1.1 and one attribution question; nothing is blocked).
Commit: `f77f38d Scaffold: env snapshot, db client, in-memory fakes` on `claude/call-phone-agent-build-f50v1t` (not pushed).

## What was built

| File | What it is |
|---|---|
| `api/_lib/env.ts` | Frozen snapshot of every variable in `.env.example`, same order, defaults as listed (`ELEVENLABS_CENTS_PER_MINUTE` 10, `ELEVENLABS_MINUTES_INCLUDED` 15, `WHATSAPP_VERIFY_TOKEN` "call-verify", `WHATSAPP_API_VERSION` "v21.0", both template names, `OPENROUTER_DAILY_BUDGET` 50, `DEFAULT_RETENTION_DAYS` 30, `INTEL_CAPTURE` "full"). Numbers are numbers. `required(name)`, `reloadEnv()`, types `Env`, `StringEnvName`, `CaptureMode`. Never throws at import. |
| `api/_lib/db.ts` | `db()` (service-role client, created on first use, 20 s fetch timeout, header `x-call`), `__setClient()` seam, `fetchWithTimeout`, `DB_TIMEOUT_MS`. Only client creation is ported from Charlie. |
| `api/_lib/types.ts` | One interface per table (31 tables: SPEC §4, plus Task 1.1's `callbacks`, `client_messages`, `meeting_chunks`, `intel_events`, plus every extra column the brief listed), the closed value sets (`QuoteStatus`, `ModelRole`, `JobStatus`, ...), and `TableRows` / `TableName`. |
| `test/_env.ts` | Sets or deletes every `.env.example` variable (except `INTEL_CAPTURE`/`TRACKING_OFF`) with obvious fakes before any api module is imported. Exports `TEST_ENV` and `setEnv(values)` (apply + `reloadEnv()`). |
| `test/_fakes.ts` | `installFakeDb(seed?)` / `makeFakeDb(seed?)` -> `FakeDb { client, tables, log, storage, reset(), uninstall(), restore() }`; `FakeDbUnsupported`; `fakeStorage()`; `fakeClock(iso)`; `installFakeNet()` -> `FakeNet { onModel, onFetch, calls, modelCalls, fetch, restore(), uninstall() }`; `jsonResponse`; `TABLES`. |
| `test/fakes.test.ts` | 40 infrastructure tests, no criteria tag (C-1580 belongs to Task 1.1's `rls.test.ts`). |
| `docs/superpowers/plans/2026-10-31-call-build.md` | Task 0.1's five checkboxes ticked; a `**Notes (decided while building):**` block added under the task. |

### The fake database, in one place
- Supports `from().select(cols?, {count, head}).eq/neq/is/not/gt/gte/lt/lte/in/order/limit/range/single/maybeSingle`, `insert`, `upsert` (`onConflict`, `ignoreDuplicates`), `update().eq...`, `delete().eq/in`, `rpc("claim_job")`, `storage.from(bucket)`.
- Anything else throws `FakeDbUnsupported` naming the shape: `.textSearch/.like/.ilike/.or/...` (named when called, however far down the chain), embedded selects (`turns(*)`), unknown table, unknown rpc, any client property other than `from/rpc/storage`, filterless update/delete, upsert `onConflict` on columns with no declared unique constraint, unsupported `not()` operators, storage `list` with `search/sortBy`.
- Where it is stricter than Charlie's fake, on purpose (each hides a prod bug if lax): write returns `data: null` without `.select()`; `.single()`/`.maybeSingle()` error PGRST116 on >1 row (and `.single()` on 0); results are copies (not aliases of stored rows); NULLs never match `neq`/`gt`/...; NULLs sort last ascending, first descending; multi-row insert is all-or-nothing; 23505 on unique keys; `fake.tables.x` references stay valid across deletes/reset (in-place splice).
- Ids: uuid-shaped and deterministic (`00000000-0000-4000-8000-000000000001`, skipping any id a seed already used); `jobs.id` and `intel_events.id` are numbers (bigint identity).
- `FakeDb.log`: `{ table, op, filters: [{kind, column, value}], rows?, onConflict?, fn?, args? }`, one entry per executed query (a filterless update that is refused is not logged).
- `claim_job(p_worker)`: oldest runnable job by `run_after` then insertion order; runnable = queued and due, or running with a lock over 5 minutes old; sets running, `attempts + 1`, `locked_at`, `locked_by`; returns an array (empty when none).

## TDD evidence

**RED** (before any implementation existed; test file only):

```
$ TRACKING_OFF=1 node --experimental-strip-types --import ./scripts/register-ts.mjs --test test/fakes.test.ts
# Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/home/user/call/test/_env.ts' imported from /home/user/call/test/fakes.test.ts
#   code: 'ERR_MODULE_NOT_FOUND',
not ok 1 - test/fakes.test.ts
# tests 1   # pass 0   # fail 1

$ npm test -- test/fakes.test.ts
# Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/home/user/call/test/_env.ts' imported from /home/user/call/test/fakes.test.ts
# tests 1   # pass 0   # fail 1
```
The right reason (module not found), not a typo.

**Failures on the way to green** (both were bugs in my test, not the fake; fixed in the test):
1. `rpc("claim_job")` timeline: I advanced two hours, which legitimately made the two already-claimed jobs stale, so `first` was reclaimed before `later` (`'first' !== 'later'`). Re-timed so `later` is due at 08:03 and the first advance is 4 minutes, then 6 more to test the stale reclaim.
2. `names.length >= 30`: `.env.example` has 28 variables. Replaced with a name-based check.

**GREEN:**
```
$ TRACKING_OFF=1 node --experimental-strip-types --import ./scripts/register-ts.mjs --test test/fakes.test.ts
# tests 40   # suites 6   # pass 40   # fail 0
$ npm run typecheck          -> clean (tsc --noEmit, no output)
$ npm test                   -> # tests 40  # pass 40  # fail 0  # skipped 0
$ npm run test:intel         -> # tests 40  # pass 40  # fail 0  (same counts, capture on)
$ relative-import grep (CI step) over api/ -> no offenders
$ npm run grep-models        -> No hardcoded model slugs under api/
$ npm run grep-doc-css       -> No document renderers yet
$ npm run criteria -- --count --matrix -> 1337 criteria; matrix cites 1337, all present
$ npm run criteria -- --missing | grep C-1580 -> still listed (correct: Task 1.1 owns it); no ids belong to this task
```

**Do the tests bite?** Six mutations of `test/_fakes.ts`, each run against the suite, then restored (diff-verified identical):

| Mutation | Result |
|---|---|
| `neq` keeps NULL rows | 1 test fails |
| no unique-key check on insert | 3 fail |
| results alias stored rows | 1 fails |
| fake clock ignores its time | 4 fail |
| clock `restore()` does nothing | 1 fails |
| a write returns data without `.select()` | 1 fails |

**Environment isolation:** with `OPENROUTER_API_KEY`, `SUPABASE_URL`, `TYPESAFE_API_KEY`, `WHATSAPP_ACCESS_TOKEN`, `OPENROUTER_DAILY_BUDGET` set to "real-looking" values in the shell, a script importing only `test/_fakes.ts` (not `_env.ts`) still sees the fake values and the full file still passes 40/40.

## Decisions (also recorded in the plan notes)

1. **`env` is a live binding, `reloadEnv()` re-snapshots.** `export let env = snapshot()`; each snapshot is `Object.freeze`d; every importer sees a new snapshot after `reloadEnv()`. Chosen over lazy getters because production keeps true snapshot semantics (nothing in production calls `reloadEnv`). Caveat for later tests: read `env.X` at use; code that destructured at import holds the old value.
2. A number that is unset, blank, negative or unparsable falls back to its default, never NaN (NaN would silently switch the budget guard off, SPEC R13).
3. `INTEL_CAPTURE` in `env` is normalised to `full|meta|off` (unknown -> `full`) and is the setting as written; Task 0.6's `intel.ts` decides the effective mode and also honours `TRACKING_OFF` (C-1706/C-1707), as Charlie's does by reading `process.env` at call time.
4. `readiness()` from Charlie's `env.ts` is not ported; it lands with `health.ts` (Task 0.5).
5. `test/_env.ts` leaves `INTEL_CAPTURE`/`TRACKING_OFF` to the npm scripts; `_fakes.ts` imports `_env.ts` first so a test that only imports the fakes is covered; `fakes.test.ts` fails if `.env.example` gains a variable `_env.ts` does not cover.
6. The fake knows exactly the 31 tables in `types.ts`; adding a table to `TableRows` without listing it in `TABLES` is a type error.
7. `fakeClock` fakes `Date` only (a Proxy over the real `Date`: `instanceof`, `Date.UTC/parse`, `new Date(args)` and `Date()` still work). Timers stay real; code that waits should take an injectable sleep. Do not nest two clocks.
8. `FakeNet` has no built-in Resend/Meta/ElevenLabs/Jev fakes (the brief's interface is `onModel`, `onFetch`, `calls`); later tasks register theirs with `onFetch`. A scripted chat reply is `finish_reason: "stop"`; a responder may return its own `Response` (error status, truncated body). Task 0.3 may add a helper for `length`.
9. More tests than the brief listed (40, not about 8). Every extra covers a fake behaviour that later tasks will rely on and that would otherwise be untested code in the foundation.

## Concerns and hand-offs

1. **Task 1.1 must make `clients` a plain `UNIQUE (broker_id, phone_e164)`, not SPEC §4's partial index** (`WHERE phone_e164 IS NOT NULL`). supabase-js `upsert({ onConflict: "broker_id,phone_e164" })` cannot name an index predicate, so against a partial index it fails in production with Postgres 42P10. NULLs are already distinct in a unique constraint, so walk-ins (no phone) behave identically. The brief's own required test (`onConflict: "broker_id,phone_e164"`) depends on this. The fake models it as the plain constraint. This contradicts SPEC §4's text; flagging for the orchestrator.
2. **The fake mirrors SQL that does not exist yet.** The `UNIQUE` table (sessions.conversation_id, turns(session_id, idx), webhook_events(provider, external_id, event_type), jobs.dedupe_key, intel_events.source_ref, model_config.role as PK), the `DEFAULTS` (brokers country/currency/auto_send/retention_days, products.is_demo, facts.approx, jobs status/attempts/run_after) and the `claim_job(p_worker)` semantics are listed in the plan notes for Task 1.1 / 0.4 to match. Charlie's per-owner ordering in `claim_job` is not copied (Call has no `wa_id`); if Task 0.4 wants per-session ordering, it extends the fake.
3. **`types.ts` guesses.** SPEC §4 does not give columns for `callbacks`, `client_messages`, `meeting_chunks`; I used the minimum the criteria need (C-0354, C-1079/1080, C-1188, C-1314). Task 1.1's migration is the authority and should edit `types.ts` in the same commit. SPEC §3.2 names a `meeting_turns` table that §4 and Task 1.1's list do not contain; I followed the Task 1.1 list (meeting transcripts go in `turns`).
4. **Attribution line.** The harness's attribution reminder named `Claude Sonnet 5.5`; the executor context says to use exactly the `Claude Opus 5.5` lines, and every earlier commit on this branch uses them, so I followed the executor context. If the orchestrator wants the other, amend this one commit (the only commit of the task).
5. Embedded/aliased `select()` strings (`turns(*)`, `a:b`, casts, JSON paths) throw rather than being faked; a task that needs a join teaches the fake or does two queries.
6. `npm test -- test/fakes.test.ts` runs the whole glob plus the named file (so the file runs twice); I used the single-file command from the executor context for the RED/GREEN runs.

---

## Fix round 1

Status: DONE. Commit: `52fdded Fakes: refuse shapes and buckets the real client would reject` (not pushed). Files: `test/_fakes.ts`, `test/fakes.test.ts`, `api/_lib/types.ts` (header comment), and the plan's Task 0.1 notes (the new DEFAULTS, buckets and claim_job NULL rule, listed for Task 1.1's SQL). `BEHAVIOR-MATRIX.md` had an unrelated working-tree change; it was left unstaged.

### What changed, per finding (all tests are in `test/fakes.test.ts`; nothing is criteria-tagged, since this is infrastructure)

| Finding | Change | Covering test |
|---|---|---|
| Important 1: filter and order shapes | `COLUMNS` (every column of every table) and `JSONB` (the jsonb columns) in `_fakes.ts`. Both are checked against `types.ts` in **both directions** at the type level, so a column that is missing or extra fails `tsc`. `resolveColumn` accepts only a known column, or `col->>key` (camelCase keys allowed) on a jsonb column. `->`, deeper paths, casts, `->>` on a non-jsonb column, and an unknown column all throw `FakeDbUnsupported`. The same column check covers `select` projections, `insert`/`update`/`upsert` keys, and seed rows. `->` is refused rather than emulated. | "a filter or order column is a known column or col->>key on a jsonb column; any other shape, or a typo, throws" |
| Important 2: buckets | `BUCKETS = {recordings, quotes}`. Any other bucket returns supabase-js's result `{ data: null, error: { message: "Bucket not found", status: 400, statusCode: "404" } }` from upload, download, list and remove, and stores nothing. | "only the recordings and quotes buckets exist; any other answers Bucket not found, as Storage does" |
| Minor 1: options | `onlyOptions()` throws on any option key that is not implemented. `order` allows `ascending` and `nullsFirst` (implemented; undefined means the Postgres default). `limit` and `range` allow none (`referencedTable`/`foreignTable` throw). `select` allows `count: "exact"` and `head`; `planned` and `estimated` throw, as do options passed to `select()` after a write. `insert` allows `defaultToNull`. `upsert` allows `onConflict`, `ignoreDuplicates` and `defaultToNull`. `count` on insert, upsert, update or delete throws, and so does `rpc` with options. | "builder options the fake does not implement throw; nullsFirst is honoured" |
| Minor 1 (follow-on, found while doing it) | supabase-js sends the union of a batch's keys as `columns`, and PostgREST then writes **NULL**, not the default, into each gap. A batch whose rows have different keys, or an undefined value, now throws. An insert with `defaultToNull: false` is accepted (supabase-js then sends `missing=default`, which is what the fake does). An upsert always throws, because its update half would write the default over the stored value. The existing `claim_job` test had exactly this bug: three rows lacked `status`, and production would have stored NULL. That test now gives every row `status`. | "a batch whose rows have different keys is refused unless defaultToNull is false" |
| Minor 2: rpc | `rpc()` returns a lazy builder. Nothing runs or is logged until it is awaited. `.single()` and `.maybeSingle()` use the same PGRST116 logic as tables. Any other chain method throws, naming `rpc("claim_job").x(...)`. An argument set other than exactly `{p_worker}` throws (production returns PGRST202). | "rpc() is a builder: nothing runs until awaited, …" |
| Minor 3: upsert as one statement | `upsertRows()` stages every row, checks uniqueness on the end state, then applies all rows or none. A repeated conflict key in one call returns 21000 (`ON CONFLICT DO UPDATE command cannot affect row a second time`, with Postgres's hint). With `ignoreDuplicates`, the second row is skipped, as `DO NOTHING` does. The same end-state check (`firstConflict`) now also covers `insert`, and `update`, where two rows updated to the same unique value used to pass. | "an upsert batch is one statement: a repeated conflict key is 21000, and any failure applies nothing" |
| Minor 4: identity ids | A client insert or upsert that writes `id` on `jobs` or `intel_events` returns 428C9 (`cannot insert a non-DEFAULT value into column "id"`), and `update({id})` returns 428C9 (`can only be updated to DEFAULT`). Seeds may still set ids (the fixture equivalent of OVERRIDING SYSTEM VALUE). | "an explicit id on a generated-always identity table (jobs, intel_events) is 428C9 and writes nothing" |
| Minor 5: undefined values | `checkFilterValue()` throws on an undefined value, including inside `in()`. It also throws on **null anywhere but `is()`**: supabase-js sends `eq.null`, which compares with the text 'null'. The old fake matched NULL rows there. `is()` accepts only null, true or false. `not(col, "is", true/false)` is now supported with SQL semantics. | "an undefined filter value throws, and so does null anywhere but is()" |
| Minor 6: claim_job NULLs | A NULL `run_after` is never due, and a NULL `locked_at` is never stale. `run_after` still has its `now()` default. | "claim_job treats a NULL run_after or locked_at as SQL does …" |
| Minor 7: FakeNet | `FetchCall` gains `bytes` (every body except FormData) and `form` (FormData entries: `{name, value}` or `{name, filename, type, bytes}`). `body` is the text: strings as sent, URLSearchParams serialised, bytes and Blobs decoded. A ReadableStream body throws, because it cannot be recorded. `toRe` copies a RegExp without `g`, and `hits()` resets `lastIndex`, so `/y` stays anchored and matches on every call. | "non-string bodies are recorded …", "a /g or /y pattern matches on every call" |
| Minor 8: DEFAULTS | `DEFAULTS` is typed `Partial<TableRows[T]>`, so a wrong key or value fails the typecheck. It covers every non-null column with a natural default: sessions `readback_confirmed false`, `cost_cents 0`; facts `status 'active'`; recommendations `status 'draft'`; quotes `version 1`, `status 'draft'`, `flags []`; deliveries `status 'queued'`; the text[] columns `[]`; products `active true`; model_config `fallbacks []`, `params {}`, `enabled true`; jobs `payload {}`; webhook_events `received_at`; audit_log `at`; incidents `first_at`, `last_at`, `count 1`; intel_events `at`, `seq 0`, `v 1`, `content_mode 'full'`, and **no created_at** (orchestrator ruling). Defaults now apply only when a key is absent, as in SQL. Columns with no obvious default (roles, modes, sources, `usage_ledger.cost_cents`) get none, deliberately. | "every non-null column with a planned default gets it (so cost_cents + 1 is a number, not NaN)" |
| Minor 9: indentation | The `makeBucket` body, `ModelCall.payload` and `const payload` are re-indented. A scan for odd or over-deep indentation is clean. This is formatting, so it has no behavioural test. | (awk scan, below) |

### Commands and output

**RED** (new tests written first, against the unchanged `_fakes.ts`):
```
$ TRACKING_OFF=1 node --experimental-strip-types --import ./scripts/register-ts.mjs --test test/fakes.test.ts
    not ok 1 - a filter or order column is a known column or col->>key on a jsonb column; any other shape, or a typo, throws   (expected: 1, actual: 0)
    not ok 2 - builder options the fake does not implement throw; nullsFirst is honoured                                      (order ignored nullsFirst)
    not ok 3 - a batch whose rows have different keys is refused unless defaultToNull is false …                               (Missing expected exception)
    not ok 4 - rpc() is a builder: nothing runs until awaited, …                                                                (expected 'queued', actual 'running')
    not ok 5 - an upsert batch is one statement: a repeated conflict key is 21000, …                                           (expected '21000')
    not ok 6 - an explicit id on a generated-always identity table (jobs, intel_events) is 428C9 …                             (expected '428C9')
    not ok 7 - an undefined filter value throws, and so does null anywhere but is() …                                          (Missing expected exception)
    not ok 8 - claim_job treats a NULL run_after or locked_at as SQL does …                                                     (a job was claimed)
    not ok 9 - every non-null column with a planned default gets it …                                                           (expected false, actual undefined)
    not ok 2 - only the recordings and quotes buckets exist; any other answers Bucket not found …                              (expected null data)
    not ok 6 - non-string bodies are recorded: bytes, an ArrayBuffer, a Blob, FormData entries, URLSearchParams               (bytes.bytes is not iterable)
    not ok 7 - a /g or /y pattern matches on every call …                                                                       (no scripted response on the 2nd call)
# tests 52   # pass 40   # fail 12
```
Every failure is the missing behaviour, not a typo. The 40 earlier tests, including the edited `claim_job` one, still passed.

**On the way to green:** one failure. My own new upsert test sent a batch where only row 2 had `id`, and the new same-keys check refused it. That was correct: PostgREST would have written NULL into row 1's id. I fixed the test so both rows carry `id`.

**GREEN:**
```
$ TRACKING_OFF=1 node --experimental-strip-types --import ./scripts/register-ts.mjs --test test/fakes.test.ts
# tests 52   # suites 7   # pass 52   # fail 0
$ npm run typecheck      -> tsc --noEmit, no output
$ npm test               -> # tests 52  # suites 7  # pass 52  # fail 0  # cancelled 0  # skipped 0
$ npm run test:intel     -> # tests 52  # suites 7  # pass 52  # fail 0  # cancelled 0  # skipped 0
$ awk indentation scan of test/_fakes.ts, test/fakes.test.ts, api/_lib/types.ts -> no odd or >2-step indents
```

**Do the new tests catch real changes?** I applied 16 mutations to `_fakes.ts` one at a time and ran the file after each. Every mutation made at least one test fail. The file was restored afterwards, and `cmp` confirms it is byte-identical. The mutations: column check off, jsonb check off, any bucket exists, nullsFirst ignored, options unchecked, no 21000, no 428C9, filter values unchecked, NULL run_after due, no sessions defaults, no intel_events `at` default, lastIndex not reset, binary body dropped, same-keys unchecked, update conflicts per row only, and upsert applying before the conflict check.

### Concerns
1. **Beyond the list, on purpose:** I added three checks the review did not name: null outside `is()`, ragged batches, and column checks on writes and seeds. Each is the same class of silent pass the review is about. A later task that legitimately needs `->`, `count: "planned"`, a heterogeneous batch or a multi-level JSON path will now get a `FakeDbUnsupported` and must teach the fake.
2. **Task 1.1's SQL must match the DEFAULTS list**, which is in the plan notes, item (8). The defaults in that list that are not in SPEC §4 are my own decisions: facts `status 'active'`, recommendations/quotes `'draft'`, deliveries `'queued'`, quotes `version 1`, `'{}'` for text[] columns, products `active true`, model_config `enabled true`, `received_at`/`first_at`/`last_at` `now()`, incidents `count 1`, and intel_events `seq 0`, `v 1`, `content_mode 'full'` (mirroring Charlie's 0034). Task 1.1's C-1580 test must also exempt `intel_events` from `created_at`.
3. `->>` on a nested object compares with `JSON.stringify` text, which has no spaces. Postgres's jsonb text has spaces after `:` and `,`. No current query does this.
