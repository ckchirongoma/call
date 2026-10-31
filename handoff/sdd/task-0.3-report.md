# Task 0.3 report: model layer (port) and `model_config` loading

**Status:** DONE_WITH_CONCERNS. Commit `254a118`, "Port the model layer: roles from model_config, fallbacks, truncation retries". Not pushed.

## What was built

- **`api/_lib/models.ts`**, ported from Charlie `api/_lib/models.ts` with the why-comments kept. It exports:
  - `askJSON` / `askText`, which return `{ value, model, usage }`;
  - `transcribeAudio`, `loadModelConfig` (cached 60 s), `candidatesFor`, `callOpenRouter`, `extractJSON`, `costCents`;
  - `HARD_FALLBACKS`, Charlie's current five slugs copied exactly;
  - the constants `MIN_MAX_TOKENS = 1200`, `MAX_MAX_TOKENS = 8000`, `DEFAULT_TEMPERATURE = 0.2`, `CONFIG_CACHE_MS`, `MIN_CALL_MS`, `JSON_ONLY`;
  - the errors `ModelUnavailable` (role, kind, tries, models), `ModelBadRequest` (role, model, status, body) and `DeadlineError` (re-exported);
  - the test seam `__clearModelCache()`.
- **`api/_lib/jobctx.ts`**, ported. It has `JobCtx`, `jobCtx`, `JobFencedError`, `jobMsLeft`, `onLastAttempt`, `jobKind`, `JobHoldError`, `DeadlineError` and `rethrowIfRetryable`.
- **`api/_lib/track.ts`**, ported and trimmed (decision 1). It has:
  - the AsyncLocalStorage context (`sessionId`, `clientId`, `brokerId`, `channel`, `stage`, `jobId`, `traceId`);
  - `track` and `trackFailure` (severity, alert, fingerprint, summary);
  - the listener and flusher registry that intel.ts will use;
  - `holdForFlush`, `flushTracking`, `tracked()` with `waitUntil`, and `trackingOff()`;
  - `errorText`, `normaliseForFingerprint` and `cutSafe`.

  Call has no `events` table, so `track()` only reaches listeners. A problem counts in `incidents` through `rpc("bump_incident")`, even under `TRACKING_OFF=1` (C-1552). Summaries are masked for emails and phone numbers (C-1437).
- **`test/_fakes.ts`** gains:
  - `modelReply(content, { finishReason, usage, model, id })`, and the default chat reply now uses the same body builder;
  - the `bump_incident` rpc (exact four text args, one row per fingerprint, count + 1, worst severity, 500-character summary, 23514 on a bad severity);
  - `failTable(table, error?)`, cleared by `reset()`;
  - `UNIQUE incidents(fingerprint)`.

  No existing refusal was loosened.
- **`env.ts`, `.env.example` and `test/_env.ts`** gain `GROQ_API_KEY` and `OPENAI_API_KEY`, both optional, for the direct transcription routes. This follows the pattern Task 0.2 set out for 3.3.
- The plan's Task 0.3 boxes are ticked and a Notes line records every decision. It includes two items for Task 1.1: `incidents.fingerprint` must be UNIQUE, and the `bump_incident(p_fingerprint, p_kind, p_severity, p_summary)` SQL semantics.

## TDD

**RED.** The test files were written first:

```
$ TRACKING_OFF=1 node --experimental-strip-types --import ./scripts/register-ts.mjs --test test/models.test.ts
# Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/home/user/call/api/_lib/models.ts' imported from /home/user/call/test/models.test.ts
# tests 1  # pass 0  # fail 1
$ ... --test test/fakes.test.ts
# SyntaxError: The requested module './_fakes.ts' does not provide an export named 'modelReply'
# tests 1  # pass 0  # fail 1
```

**GREEN.**

```
$ ... --test test/fakes.test.ts        # tests 56  pass 56  fail 0   (after the fake extension)
$ ... --test test/models.test.ts       # tests 30  pass 30  fail 0
$ npm run typecheck                    # clean
$ npm test                             # tests 109 pass 109 fail 0   (baseline was 75)
$ npm run test:intel                   # tests 109 pass 109 fail 0
$ npm run grep-models                  # No hardcoded model slugs under api/
$ npm run criteria -- --missing | grep -cE "C-15(0[0-9]|1[0-9]|2[0-5])"   # 0
$ npm run criteria -- --count --matrix # BEHAVIOR-MATRIX.md cites 1337 criteria, all present.
CI's ".js relative imports" grep over api/: no offenders. grep-doc-css: green.
```

**Mutation check.** Each mutation was applied to `models.ts`, run, then reverted:

| Mutation | Tests failing |
|---|---|
| Room grows 1.6x instead of doubling | 3 |
| A 400 is routed to a fallback | 1 |
| No `model_fallback` note | 2 |
| The cache never expires | 2 |
| No JSON-only retry | 2 |

## Files changed

New: `api/_lib/models.ts`, `api/_lib/jobctx.ts`, `api/_lib/track.ts`, `test/models.test.ts`.

Modified: `test/_fakes.ts`, `test/fakes.test.ts`, `api/_lib/env.ts`, `.env.example`, `test/_env.ts`, `docs/superpowers/plans/2026-10-31-call-build.md`.

No Task 0.5 file (`vercel.json`, `api/health.ts`) was touched.

## Criteria tagged

C-1500 through C-1525, each in a test name in `test/models.test.ts`. C-1500 is tagged twice, once for askJSON and once for askText.

The transcription routing tests carry no tag. C-1327 is owned by `test/transcribe.test.ts` (meeting phase), so it is mentioned only in plain text.

## Decisions

**1. A disabled row skips its own model.** It runs on its `fallbacks`, then on `HARD_FALLBACKS`.

**2. When incidents are raised.**

| Incident | Severity | When |
|---|---|---|
| `role_disabled` | warn | once a day per role per instance |
| `role_missing` | error | once a day per role per instance |
| `model_config_unreadable` | critical | every time; the failed read is not cached |

**3. Truncation and empty answers.** A cut-off or empty answer doubles the room (cap 8000) and gets two attempts per model. The larger room carries on to the next model, so the sequence is A@1200, A@2400, B@4800.

**4. How each failure is handled.**

| Failure | What happens |
|---|---|
| 429, 5xx, network error, HTTP 200 with an error object | Next model, no sleep |
| 404 | Next model. A 404 means the catalogue retired the model, which is what fallbacks are for. |
| 400, 422 and other 4xx | `ModelBadRequest`, no fallback. The body excerpt is in the error message, not in the incident. |
| 401 / 403 | `ModelUnavailable` (kind `auth`) and the critical incident `openrouter_credential`, no fallback |
| 402 | `ModelUnavailable` (kind `credit`) and the critical incident `openrouter_credit`, no fallback |
| Bad JSON, or a schema rejection | One retry on the same model with `JSON_ONLY` appended, then `ModelUnavailable` (kind `bad_output`) with no fallback ("fail the step") |

**5. `usage_ledger` rows.**

| Column | Value |
|---|---|
| (when) | One row for every attempt that spent tokens |
| `item` | `llm_tokens` |
| `qty` | Input + output tokens |
| `unit` | `tokens` |
| `provider_ref` | The slug that was called |
| `cost_cents` | Rounded up from the role's `cost_per_mtok_in` / `cost_per_mtok_out` (cents per million tokens). 0 for a `:free` slug or when no rates are set. |

**6. The `model_fallback` row in `safety_events`.** It uses `engine` `rules` and `outcome` `flag`. Its detail is `{role, from (the row's model, or null), to, reason, tries}`.

**7. `deadlineMs`.** It is a budget measured from the start of the ask. The nearer of it and the job's deadline applies. A call needs 20 s plus 5 s of wrap-up time left, or a `DeadlineError` is thrown before anything is sent.

**8. Not ported from Charlie:**
- streaming and stall detection;
- `require_parameters` and the ignored-provider list;
- embeddings;
- the per-request model trace;
- `LAST_RESORT_VOICE`, because slugs may live only in `HARD_FALLBACKS`;
- the `openrouter_chat` voice route.

The plan notes give the reason for each.

**9. Transcription.** A disabled, missing or unreadable voice row throws and sends nothing, because `HARD_FALLBACKS` are chat models and cannot transcribe. An empty transcript is returned as-is for the job to judge (C-1335). The transcription ledger row (C-1333) belongs to the job, which can compute minutes from the returned `duration`.

**10. Capture marker.** The single `// Task 0.6: capture every attempt here` marker is at the top of `callOpenRouter`. No `intel.ts` and no `capture()` were added.

## Concerns

1. **Two then-clauses are only half provable in this task.**
   - C-1505 says "the job requeued" and C-1511 says "the job retries with backoff". Both belong to the queue.
   - My tests assert the model layer's half: the error class is thrown, nothing more is sent, and the error comes out of `jobCtx.run` unchanged.
   - Task 0.4's queue tests should also assert the requeue and the backoff. The reviewer may want those ids tagged there too.
2. **`bump_incident` is defined here before the migration exists.**
   - The fake's rpc and `UNIQUE incidents(fingerprint)` set the SQL that Task 1.1 must write. That is recorded in the plan notes as items (11) and (12).
   - Task 0.4 will need to extend the rpc's arguments, and probably the `incidents` columns, for alert levels. The table currently has no `alert` or `since_email` column.
3. **Model costs are estimates.** `cost_cents` uses the role's rates even when a paid fallback slug answers. Without per-slug rates a paid `HARD_FALLBACK` is costed at the role's rates, or at 0 if the role has none. The limitation is documented in `costCents`.
4. **Env change outside the file list.** `env.ts`, `.env.example` and `test/_env.ts` were changed to add the two optional keys that the groq and openai routes need.

## Fix round 1

**Status:** DONE.

- **Commit:** `aee6200` "Fix model fallbacks, JSON extraction and the static checks", one commit for Tasks 0.3 and 0.5, with the two attribution lines. Not pushed.
- **Worktree:** `/home/user/call/.claude/worktrees/agent-af84a156902d48ef5`.
- **Branch:** `worktree-agent-af84a156902d48ef5`, fast-forwarded first to `dc8fbb4`.
- **This report:** the worktree isolation refused a write to `/home/user/call/.superpowers/...`. So this file is the worktree copy at the same relative path: the shared report, with this section added. It is untracked and not committed.
- **Files for Task 0.3:** `api/_lib/models.ts`, `api/_lib/track.ts` (two hunks), `test/models.test.ts` and the plan's Task 0.3 note. The Task 0.5 files are in that task's report.

### Each finding

**Important 1: a 402 on the paid first HARD_FALLBACK ends the chain and raises a false critical incident.**
- **What changed.**
  - A 402 on a slug without `:free` records `creditRefused`, sets the reason to `credit` and moves on.
  - Every paid slug after it is skipped: it is not sent and not added to `tried`. The `:free` ones are tried.
  - `openrouter_credit` is raised only at the end of the chain, when no model answered. The error is then `ModelUnavailable(kind credit)`.
  - A 402 on a `:free` slug means the balance is below zero. It still stops the chain at once and raises the incident.
  - The `kindFor` and `askJSON` comments were updated to match.
- **Tests:**
  - `[C-1510] a 402 from a paid model skips the paid models left…`
    - A, B and C answer 429, `HARD[0]` answers 402 and `HARD[1]` answers.
    - It asserts models `[A, B, C, HARD0, HARD1]`, the answer, no `openrouter_credit` incident, and safety-note reason `credit`.
    - A second case: the row's own model A answers 402. The models are `[A, HARD1]`; B, C and `HARD[0]` are never sent.
  - `[C-1510] after a 402, when no free model answers either…`
    - It asserts one critical `openrouter_credit` incident (count 1), kind `credit`, and models `[A, ...the :free ones]`.
    - A 402 on `test/model-a:free` stops at that one model, with the incident.

**Important 2: `extractJSON` returns a fragment of a top-level array.**
- **What changed.** This follows Charlie and rejects the list.
  - A new `scanJSON` returns null (`cutOff: false`) when the first object sits inside a `[` that is still open at that point.
  - A bracket in the prose that closes before the object (`see note [1]`) is still treated as prose.
  - `extractJSON` now returns `Record<string, unknown> | null`.
  - In `askJSON`, a list gets the JSON-only retry ("one JSON object"), then `bad_output`.
- **Test:** `[C-1517] a top-level list is rejected…`
  - A bare, a fenced and an in-prose list each give null.
  - `[1]` in prose before an object, and an object that holds lists, both still parse.
  - Through `askJSON`, the calls are `[A, A]` with the JSON_ONLY suffix, then `bad_output`.

**Important 3: `errorText` keeps a `ModelBadRequest`'s provider body.**
- **What changed.**
  - When `err.name === "ModelBadRequest"`, `errorText` returns `ModelBadRequest: <status> (<model>) for <role>`.
  - The body is dropped, so it reaches no incident, no failed-job record and no `request_crashed`.
  - The error's own message still carries the body for the caller (C-1512).
- **Test:** `[C-1512] a provider's 400 body is surfaced in the error and nowhere else…`
  - A 400 answers with a body that echoes client words. `err.message` holds them, and `errorText` gives exactly the short form.
  - It then runs `trackFailure("job_failed", err)` and a `tracked()` handler that rethrows the error. Neither incident contains the words.

**Minor 1: a bug inside the request is relabelled `network` and sent to the next model.**
- **What changed.**
  - The request body is now built **before** the fetch `try`, so a value that cannot be serialised is no longer caught as "unreachable".
  - In `ask`, an error that is not a `ModelError` is logged as `model bug [label] model: <errorText>`. It is then thrown unchanged through `giveUp`, and no other model is tried.
  - For kind `other`, the `model_call_failed` summary carries `errorText(err)`.
  - **Found on the way:** an HTTP 200 whose body was the JSON `null` crashed on `json.error`, which was a bug. A JSON body that is not an object is now a `ModelError` of kind `upstream`, so the chain moves to the next model.
- **Test:** `[C-1509] a bug in our own request code keeps its words…`
  - It sets `params.reasoning = {budget: 10n}` on the cached config, so the body cannot be serialised.
  - It asserts that the `TypeError` (/BigInt/) is thrown, nothing is sent, the log line names it, and the incident summary contains "BigInt".
  - A 200 `null` body from A moves on to B.

**Minor 2: Charlie's JSON-mode fallback was dropped.**
- **What changed.** It is restored, and narrowed.
  - With JSON mode on, a 400 whose body matches `response_format`, `response format`, `json_object` or `json mode` retries the **same** model once without `response_format`.
  - The setting is dropped per model; Charlie dropped it for the whole ask. The next model gets JSON mode again.
  - Any other 400, or a second refusal, is a `ModelBadRequest`.
- **Test:** `[C-1519][C-1512] a 400 that names response_format is retried once…`
  - The calls are `[A, A]`, with `response_format` on the first payload and not on the second.
  - With a fallback, the calls are `[A, A, B]`, and B's payload carries `response_format` again.
  - A second refusal raises `ModelBadRequest`. An unrelated 400 with JSON mode on gives `[A]`.

**Minor 3: fence stripping alters a quote.**
- **What changed.** `stripOuterFence` removes only a fence line that opens the reply and a fence that closes it. Fences anywhere else are left alone; an object in prose is found by its brackets anyway.
- **Test:** `[C-1515] only a fence that opens or closes the reply is removed…`
  - ```` "he typed ```js here" ```` survives, bare and inside fences.
  - Plain fences and fences inside prose still parse.

**Minor 4: a held promise that rejects becomes an unhandled rejection.**
- **What changed.** `holdForFlush` uses `p.then(del, del)` instead of `p.finally(...)`, with a why-comment.
- **Test:** `a held write that rejects is never an unhandled rejection…`
  - It is untagged because no criterion covers it; the test's comment says so.
  - It listens for `unhandledRejection` around `holdForFlush(Promise.reject(...))` and `flushTracking()`.

**Minor 7: an unclosed object with the wrong `finish_reason` is not given more room.**
- **What changed.**
  - `scanJSON` reports `cutOff: true` when the first object never closes, or when the list around it never closes.
  - `ask` treats that like `finish_reason=length`: double the room and retry the same model, twice, then move to the next model. There is no JSON_ONLY retry.
- **Test:** `[C-1500] an object that opens and never closes is cut off whatever finish_reason says…`
  - An unclosed object under `stop` gives calls `[A, A]`, budgets `[1200, 2400]`, and no JSON_ONLY suffix.
  - An unclosed top-level list behaves the same.

**Minors 5 and 6:** deferred, as instructed.

### Red and green

**RED.** The nine new tests were written first and run against the old code:

```
TRACKING_OFF=1 node --experimental-strip-types --import ./scripts/register-ts.mjs --test --test-reporter=spec test/models.test.ts
ℹ tests 39  ℹ pass 30  ℹ fail 9
```

Each failed for the intended reason:

| Test | Failure on the old code |
|---|---|
| unclosed object | budgets `[1200, 1200]`, expected `[1200, 2400]` |
| bug | `ModelUnavailable … (network) after 8 tries` |
| 402, paid | `ModelUnavailable … (credit) after 4 tries` |
| 402, none answers | models `['test/model-a']` |
| list | `{ fact: 'age 42' }`, expected null |
| fence | `{ quote: 'he typed  here' }` |
| JSON mode | `ModelBadRequest … response_format…` |
| errorText | the long message, with the body |
| held write | `Error: held write failed`, an unhandled rejection |

**GREEN.**

```
test/models.test.ts                        ℹ tests 39  ℹ pass 39  ℹ fail 0
npm run typecheck                          clean
npm test                                   # tests 138  # pass 138  # fail 0   (126 before)
npm run test:intel                         # tests 138  # pass 138  # fail 0
npm run grep-models                        No hardcoded model slugs under api/
```

### For the merge with Task 0.4

`track.ts` changes in two small hunks, in `errorText` and `holdForFlush`. Both are needed:

- `errorText` is the fix for Important 3;
- `holdForFlush` is the fix for Minor 4, which also lives in `track.ts`.

If Task 0.4 rewrites either function, it must keep the `ModelBadRequest` branch and `then(del, del)`.
