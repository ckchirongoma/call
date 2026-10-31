# Task 0.3 review: model layer (port) and `model_config` loading

Reviewed: diff `01b43c6..254a118` (one commit, `254a118`), the brief, executor-context, report, criteria rows C-1500–C-1525, and Charlie's `models.ts` / `track.ts` / `intel.ts` where a named risk needed the comparison. The suite was not re-run. Three focused probes were run from the scratchpad: `extractJSON` on arrays, on stray braces and on fences inside strings, plus `holdForFlush` with a promise that rejects. Commit message, `grep-models` and the `.js` import rule were also checked.

### Spec Compliance

| Item | Verdict | Evidence |
|---|---|---|
| C-1500 the same model is retried with `max_tokens` doubled, capped at 8000 | ✅ | `api/_lib/models.ts:789-798`; test `test/models.test.ts:114` (1200→2400, 5000→8000). Also covered for askText. |
| C-1501 JSON that parses but has `finish_reason=length` is still retried | ✅ | Truncation is checked before `parse()` (`models.ts:789`); test asserts `[A, A]`. |
| C-1502 after two truncations, the next fallback gets the larger budget | ✅ | `[1200, 2400, 4800]`, models `[A, A, B]`. |
| C-1503 no request below 1200 | ✅ | The floor is applied in `ask` and again in `requestOnce` (`models.ts:434`). The test covers the row's 300 and 40 and the caller's 64, 10 and 0. |
| C-1504 one ledger row per attempt | ✅ | Two rows, the cut-off one included, with qty, unit, session and slug. `:free` costs 0. |
| C-1505 DeadlineError … **and the job requeued** | ⚠️ | `test/models.test.ts:201`. The test proves the error is thrown before the retry is sent and reaches `jobCtx.run` unchanged. "Requeued" is the queue's job (Task 0.4) and is asserted nowhere yet. See Important 4. |
| C-1506 the slug that answered is on the result and the ledger row | ✅ | |
| C-1507 / C-1508 / C-1509 429, 5xx and network errors go to the next model with no sleep | ✅ | `break` to the next model with no timer. The fake clock is unchanged and wall time is under 250 ms. The 200-with-error case is covered too. |
| C-1510 HARD_FALLBACKS in order, de-duplicated | ✅ | |
| C-1511 ModelUnavailable … **and the job retries with backoff** | ⚠️ | `test/models.test.ts:302` asserts ModelUnavailable (role, tries, models) out of a job. Backoff is Task 0.4's. See Important 4. |
| C-1512 a 400 gets no fallback and carries the body excerpt | ✅ | `models.ts:775-778`. ModelBadRequest message, status and model are asserted, plus `[A]`. |
| C-1513 a 401 raises the critical `openrouter_credential` incident with no fallback | ✅ | The summary holds only the status (it asserts the body is absent). A missing key raises the same incident. |
| C-1514 `safety_events` `model_fallback` with from and to | ✅ | engine `rules`, outcome `flag`, reason. Nothing is written when the own model answers. |
| C-1515 / C-1516 / C-1517 fences, trailing commas, prose | ✅ | A comma or brace inside a string is left alone. The first balanced object is taken. An unclosed object gives null. But see Important 2 for top-level arrays. |
| C-1518 one retry with JSON_ONLY appended, then failure | ✅ | The prompt prefix and suffix are asserted. `bad_output`, no fallback. |
| C-1519 `response_format` only when `json_mode` | ✅ | |
| C-1520 schema rejection gets one retry, then failure | ✅ | |
| C-1521 disabled row goes to fallbacks, `role_disabled` once a day | ✅ | The own model is never called. Count 1, then 2 after 24 h on the fake clock. With no fallbacks it goes to HARD. |
| C-1522 missing row goes to HARD_FALLBACKS with `role_missing` | ✅ | |
| C-1523 unreadable table goes to HARD_FALLBACKS with a critical incident | ✅ | Not cached; it recovers on the next call. |
| C-1524 temperature passed through, default 0.2 | ✅ | |
| C-1525 config cached for at most 60 s | ✅ | Still cached at 59 999 ms, re-read at 60 000 ms, with the select count asserted. |
| Orchestrator: port track.ts | ✅ | `api/_lib/track.ts`, trimmed, why-comments kept. |
| Orchestrator: no capture, marker only | ✅ | `models.ts:396`. No `intel.ts`, no `capture()`. |
| Orchestrator: usage_ledger written in models.ts, db.ts untouched | ✅ | `llm_tokens`, rates from `params.cost_per_mtok_in/out`, 0 for free. db.ts is not in the diff. |
| Orchestrator: `loadModelConfig` cached 60 s | ✅ | |
| Orchestrator: disabled or missing row → fallback chain plus incident through `trackFailure` | ✅ | |
| Orchestrator: `transcribeAudio` routes on the voice row's provider | ✅ | openrouter, groq and openai are each tested: URL, key, bare or namespaced id, verbose_json then a plain retry. |
| Orchestrator: HARD_FALLBACKS copied exactly | ✅ | Identical to Charlie `models.ts:49-55`. See Important 1 for a consequence. |
| Slugs nowhere else in `api/` | ✅ | `npm run grep-models`: "No hardcoded model slugs under api/". |
| Relative imports end in `.js` | ✅ | Checked in all three new files. |
| Commit message | ✅ | Ends with the two attribution lines. No model is named elsewhere. |
| Plan boxes ticked and Notes line added | ✅ | |

### Strengths

- Rule 6 is honoured in the right order. Truncation and empty replies are handled before any parse (`models.ts:789`), so a cut-off reply that happens to parse is never accepted.
- The budget doubles with a cap and carries over to the next model. askText now gets the same retry, which closes the gap Charlie documented.
- The `MIN_MAX_TOKENS` floor is enforced twice, once in `ask` and once in `requestOnce`, so no future caller can get under it.
- Charlie's whole-request timer fix (round 21) is kept with its why-comment. A stalled error body is read under the timer.
- DeadlineError is raised before a request that cannot finish, and the same object is rethrown. The jobctx round-6 and round-10 comments are kept.
- `loadModelConfig` never throws:
  - a failed read is not cached, so recovery is immediate;
  - standing conditions raise one incident a day per role, not one per call;
  - an unreadable table raises a critical incident every time.
- Within models.ts the privacy posture is careful:
  - credential incidents carry only the status;
  - the ModelBadRequest incident is passed a string, not the error;
  - the console lines print only the kind and status;
  - `errorText` treats `ModelError` as status and kind only.
- The tests are precise. Replies are scripted per slug, every payload is read back, and teardown fails on any unscripted model call. The report's mutation table shows the tests bite.
- The fake extensions keep the "refuse what Supabase would refuse" stance. `bump_incident` takes exactly four text arguments, rejects a bad severity with 23514 and has a UNIQUE fingerprint. `failTable` is cleared by `reset()`. Both are tested in `fakes.test.ts`.
- Every deviation from Charlie is written down in the file header and the plan notes, and every Task 1.1 dependency (UNIQUE fingerprint, `bump_incident` semantics) is listed.

### Issues

#### Critical

None.

#### Important

1. **On the free stack, a 402 from the paid first HARD_FALLBACK ends the chain before the four `:free` last resorts.** `api/_lib/models.ts:770-774`, with `:363` and `:69`.
   - **What happens.** `HARD_FALLBACKS[0]` is `xiaomi/mimo-v2.5-pro`, which has no `:free` suffix. A 402 is mapped to `credit` and the ask stops ("every model is on the same account"). On OpenRouter a 402 for lack of credit refuses paid models only; `:free` models still answer unless the balance is negative.
   - **Why it matters.** Call runs on free models by default, and buying credit is an "ask first" step (`docs/RESEARCH.md:48`). The moment a role's model and its fallbacks are congested, which is exactly when HARD_FALLBACKS exist, the chain reaches the paid slug, gets a 402, raises a false critical `openrouter_credit` and throws. The free last resorts are never tried.
   - **Fix.** On a 402 for a slug that does not end in `:free`:
     - raise the credit incident (its fingerprint already de-duplicates);
     - drop the remaining non-`:free` candidates;
     - continue down the chain.

     Stop only on a 402 from a `:free` slug (negative balance) or on 401/403. Add a test: A, B and C answer 429, `HARD[0]` answers 402, `HARD[1]` answers. Assert models `[A, B, C, HARD[0], HARD[1]]`, the answer, and one `openrouter_credit` incident.

2. **`extractJSON` returns a fragment of a top-level array.** `api/_lib/models.ts:649-660`.
   - **What happens.** Probed: `extractJSON('[{"fact":"age 42"},{"fact":"smoker"}]')` returns `{"fact":"age 42"}`, and a fenced array does the same. The function's own comment rules this out: "an inner object … would read as a whole answer with half the facts missing".
   - **Why it matters.** It is a regression from Charlie. Charlie's first-`{`-to-last-`}` slice fails to parse here, so the reply is rejected. When the caller passes no schema, an extract call whose model answers with a list silently loses every fact after the first.
   - **Fix.** When the first JSON-opening character outside fences and prose is `[`, or the first `{` sits inside a `[` that is still open, return null. That leads to the JSON_ONLY retry, then failure. Add a test case under C-1517.

3. **`errorText` keeps the provider body when the error is a `ModelBadRequest`.** `api/_lib/track.ts:132`, with `api/_lib/models.ts:219`.
   - **What happens.** `errorText` special-cases `ModelError`, keeping only status and kind, but not `ModelBadRequest`. That error's message deliberately carries the body: `OpenRouter ${status} (${model}) for ${role}: ${body}` (C-1512).
   - **Why it matters.** models.ts's own `trackUnavailable` sidesteps this by passing a string, but every other route writes the body into `incidents`. The routes are `tracked()`'s `request_crashed` (`track.ts:326`), the Task 0.4 queue's failed-job incident and `last_error`, and any future `trackFailure(name, err)`. The file header says incidents outlive "forget me" and must hold no client words, and the code's own comments say the body can echo the request. In Call that request is a client's health and financial facts.
   - **Fix.** In `errorText`, map `err.name === "ModelBadRequest"` to `ModelBadRequest: <status> (<model>) for <role>` and drop the body. Add a test.

4. **C-1505 and C-1511 are tagged here with only the model-layer half of each then-clause asserted.** `test/models.test.ts:201`, `test/models.test.ts:302`.
   - **What is missing.** "The job requeued" (C-1505) and "the job retries with backoff" (C-1511) are not asserted anywhere. `criteria --check` will still count both as done.
   - **Why this task cannot fix it.** The queue does not exist until Task 0.4. The implementer flagged this.
   - **Fix (orchestrator).** Add `[C-1505][C-1511]` to Task 0.4's brief so `test/queue.test.ts` asserts both:
     - a DeadlineError thrown from a handler is requeued for a fresh worker;
     - a ModelUnavailable is retried on the 10/60/300 s backoff.

#### Minor

1. **A bug thrown inside the request loses its text.** `api/_lib/models.ts:769, 780`. A non-`ModelError` thrown inside `callOpenRouter` is a bug in our code, yet it is relabelled `network` and sent to the next model. The warning line prints only `kind status`, and the final ModelUnavailable has no detail, so the original error text is lost. Fix: for a non-`ModelError`, log `errorText(err)` and carry it in the ModelUnavailable detail.
2. **Charlie's JSON-mode fallback was dropped without a word.** `api/_lib/models.ts:775-778`, against Charlie `models.ts:893-897`. Charlie's comment "jsonMode … dropped automatically if it 400s" (retry the same model once without `response_format`) is gone, with no why-comment and no line under "Not ported". The impact is low, because json_mode is opt-in and RESEARCH says most models ignore it. But with `json_mode=true`, a fallback that rejects `response_format` ends the step. Fix: either port that one retry, which is not a fallback so C-1512 still holds, or list it under "Not ported" with the reason.
3. **Fence stripping can alter a quote.** `api/_lib/models.ts:650`. The regex strips fences everywhere, inside JSON strings too. Probed: `"he typed ```js here"` became `"he typed  here"`, so a quoted word changes silently. Fix: strip only a leading fence line and a trailing fence.
4. **A rejected held promise becomes an unhandled rejection.** `api/_lib/track.ts:155-158`. With `void p.finally(...)`, a held promise that rejects leaves an unhandled rejection on the derived promise. Probed: `unhandledRejection` fires, and Node's default crashes the process. Every holder in this diff catches its own errors, and the code is inherited from Charlie. But `flushTracking` (`track.ts:272`) holds any flusher's promise, and intel.ts registers one in Task 0.6. Fix: `void p.then(del, del)`.
5. **Recorded costs can run high.** `api/_lib/models.ts:498-502`. Rounding each attempt up to whole cents overstates cheap paid calls: 3 000 tokens at 10 c/Mtok is 0.03 c, recorded as 1 c. On top of that, a paid fallback slug is costed at the role's rates (the report's concern 3). Integer `cost_cents` and one row per attempt force some of this, so say so on `/app/costs` when it is built.
6. **The "no sleep" test bound is loose.** `test/models.test.ts:245-277`. The check rests on a 250 ms wall-clock bound, because `fakeClock` fakes only `Date` (`test/_fakes.ts:1213-1229`). A sleep under 250 ms would pass. Optional: spy on `setTimeout` during the ask and allow only the request timer.
7. **A cut-off reply with the wrong `finish_reason` is not given more room.** `api/_lib/models.ts:789`. Truncation is detected only by `finish_reason === "length"`, as in Charlie's non-streamed path. An object that opens and never closes, under a misreported `stop`, gets the JSON_ONLY retry at the same room and then `bad_output`. A cheap improvement in the spirit of rule 6: treat `balancedEnd === -1` (an object that never closes) as a size problem.

### Assessment

The port is faithful and careful, and every orchestrator decision is honoured. The criteria tests assert their then-clauses at the right strength, except the two queue halves in Important 4. Three in-task fixes are needed:

- the 402 and free-stack interaction, which defeats HARD_FALLBACKS on the stack Call actually runs on;
- the array fragment from `extractJSON`, which can silently drop facts;
- `ModelBadRequest` bodies reaching incidents through `errorText`.

Each is small and needs a test.

A spec tension to raise, not to fix here: C-1512's "400 → no fallback" also ends the chain on a context-length 400 from a smaller fallback model. The job's retry usually recovers.

**Task quality: Needs fixes**
