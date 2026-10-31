# Re-review: Task 0.3 and Task 0.5, fix round 1

I reviewed the fix diff `dc8fbb4..aee6200` (one commit, `aee6200`) against `task-0.3-review.md`, `task-0.5-review.md` and the "Fix round 1" sections of both reports. I also took one look at `api/_lib/track.ts` on HEAD `d8003a2`.

- **Probe.** One `extractJSON` probe was run from the scratchpad, for one specific doubt (New Breakage 1).
- **Suite.** Not re-run.

Both reports name the tests that cover each finding and show red and green runs:

- **Task 0.3:** 39 tests, 9 failing, each failure with its reason; then 39/39 and 138/138.
- **Task 0.5:** 20 tests, 3 failing, with reasons; then 20/20. The three tests that already passed on the old code (C-1527, C-1528, the C-1535 chain) get a table of five mutations, each shown to break the test.

## Finding Verdicts

### Task 0.3

| Finding | Verdict | Evidence |
|---|---|---|
| **Important 1:** a 402 on a paid first fallback stops the chain before the `:free` ones and raises a false critical `openrouter_credit` incident | **ADDRESSED** | `api/_lib/models.ts:135` (`isFree`), `:818` (paid models skipped once `creditRefused` is set), `:853-862` (a paid 402 records and moves on), `:864-868` (a 402 on a `:free` model, or a 401/403, is still fatal), `:926-931` (the incident is raised only when nothing answered). Tests at `test/models.test.ts:343` and `:370` check the chain `[A,B,C,HARD0,HARD1]`, the answer, zero credit incidents, and safety reason `credit`. When the row's own model gets the 402, the chain is `[A,HARD1]`. When nothing answers, there is one critical incident with count 1 and kind `credit`. A 402 on a `:free` model stops at that model. The fix differs from the review's proposal: it raises no incident at all when a free model answers. That fits the finding's title ("false critical"), but see New Breakage 2. |
| **Important 2:** `extractJSON` on a top-level array returns only its first object | **ADDRESSED** | `models.ts:640-652` (`listAround`), `:693-716` (`scanJSON`), `:720` (now returns `Record<string, unknown> \| null`). Test at `test/models.test.ts:489` covers a bare list, a fenced list and a list in prose (each gives null), keeps `See note [1]:` and an object holding lists, and checks that `askJSON` goes `[A, A]` with JSON_ONLY, then `bad_output`. |
| **Important 3:** `errorText` leaks `ModelBadRequest`'s provider body into incidents | **ADDRESSED** | `api/_lib/track.ts:131-137` on HEAD. `ModelBadRequest` has `role`, `model` and `status` fields (`models.ts:225-235`), so the short form fills in. Test at `test/models.test.ts:679` checks that the body stays in `err.message` (C-1512), that `errorText` gives exactly the short form, and that neither `trackFailure("job_failed")` nor a `tracked()` crash puts the words into `incidents`. The queue on HEAD builds `last_error` and the failed-job summary from `errorText(err)` (`api/_lib/queue.ts:761, 776-782`), so the fix reaches Task 0.4's code paths too. |
| **Minor 1:** a bug inside the request is relabelled `network` and its text is lost | **ADDRESSED** | `models.ts:435` (the body is built outside the fetch `try`), `:847-852` (any error that is not a `ModelError` is logged with `errorText`, thrown unchanged and sent to no other model), `:604` (the summary for kind `other` carries `errorText`), `:487` (a 200 whose JSON body is not an object counts as `upstream`). This differs from the review's proposal, which kept a `ModelUnavailable` and put the text in it; throwing the original error keeps the words just as well. Test at `test/models.test.ts:300`. |
| **Minor 2:** Charlie's JSON-mode fallback was dropped | **ADDRESSED** | `models.ts:138`, `:824`, `:870-876`. The retry is restored on the same model, and the switch is dropped for that model only. Test at `test/models.test.ts:539` covers `[A,A]` with `response_format` dropped, `[A,A,B]` with it restored for B, a second refusal raising `ModelBadRequest`, and an unrelated 400 giving `[A]`. |
| **Minor 3:** fence stripping alters a quote | **ADDRESSED** | `models.ts:655` (`stripOuterFence`). Test at `test/models.test.ts:506`. |
| **Minor 4:** a held promise that rejects becomes an unhandled rejection | **ADDRESSED** | `track.ts:160-171` on HEAD: `p.then(del, del)`, with a why-comment. The test at `test/models.test.ts:702` listens for `unhandledRejection`. It is untagged, and the comment says why. |
| **Minor 7:** a reply that never closes, under the wrong `finish_reason`, is not given more room | **ADDRESSED** | `models.ts:893-905`: `cutOff` comes from `scanJSON` and is treated like `finish_reason=length`. Test at `test/models.test.ts:201` covers an unclosed object and an unclosed list under `stop`: budgets `[1200, 2400]`, and no JSON_ONLY retry. The `listAround` check this fix depends on has a side effect; see New Breakage 1. |
| Minors 5 and 6 | Deferred, as instructed | — |

### Task 0.5

| Finding | Verdict | Evidence |
|---|---|---|
| **Important 1:** `BODY_LIKE` misses `bodyText` and `bodyJson`; it must match the criterion's grep | **ADDRESSED** | `test/security-static.test.ts:210`: `/body/i` over the call's code with string text removed. That is the criterion's `console.log(.*body` applied to identifiers. Test at `:585` adds `api/_lib/ingest.ts`, and its `bodyText` (log), `bodyJson` (warn) and `${eventBody…}` (error) lines are each asserted caught. The "message about the body" cases still pass. HEAD, with Task 0.4's `queue.ts`, `alerts.ts`, `email.ts` and `worker.ts`, is clean (183/183 per the merge). |
| **Minor 1:** C-1592 can be satisfied by a comment or by unrelated code | **ADDRESSED** | `security-static.test.ts:113-131`: reads must be made on `req`/`request`, the new `PARSES_BODY` check is added, and matching runs on `stripSource` output (`:281`) with comments and strings removed. Test at `:530` adds four bad cases (a comment, an unrelated `for await`, a string, and a raw read followed by `req.json()`) and two good ones (`getReader`, Node `for await … of req`). The real-repo title at `:473`, "never a parsed body", is now true. |
| **Minor 2:** the ping test does not pin "cheap" | **ADDRESSED** | `test/health.test.ts:46` (`recordingClient`) and `:128-135`: the chain is asserted to be exactly `from("model_config")`, `select("role")`, `limit(1)`. The mutation to `select("*")` was shown to fail the test. |
| **Minor 3:** C-1593 sees only direct calls | **ADDRESSED** | `security-static.test.ts:153` onward: a transitive walk over relative value imports, which stops at `queue.ts` and `models.ts`; type-only imports and comments are ignored. Test at `:562` adds a two-hop `wa.ts → inbound.ts → facts.ts` case, asserted as `reaches api/_lib/facts.ts`, and a good `meta-webhook.ts` that has a type import, a comment and a call through the queue. |
| **Minor 4:** the comment about Vercel was wrong | **ADDRESSED** | `security-static.test.ts:496-500` now says the deploy fails. |
| **Minor 5:** the plan note was one paragraph | **ADDRESSED** | `docs/superpowers/plans/2026-10-31-call-build.md:175-183`: one bullet per downstream obligation, now including Charlie `wa.ts:326` `bodyText` for Task 7.2. |
| **C-1527:** exits 1 when a slug literal is added to `api/_lib/extract.ts` | **ADDRESSED** (then-clause asserted) | `security-static.test.ts:610`. The test writes the temp file and runs the real `scripts/grep-models.sh` (`slugGrep`, `:416`). It plants three slug shapes; each gives exit 1, with the file and line named. The clean tree gives exit 0. |
| **C-1528:** with `models.ts` holding `HARD_FALLBACKS`, the script exits 0 | **ADDRESSED** (then-clause asserted, and more) | `:485` runs the script on the real tree (exit 0, with its message) and checks that the exemption is actually in use: at least two slugs, and no slug outside the array. `:621` checks that only `api/_lib/models.ts` is exempt, and that a stray slug next to the array is caught by the check with the array cut out. Mutations are shown to fail both tests. |

## New Breakage

1. **Minor. An unclosed `[` in prose before a valid object now gives null, and `askJSON` treats it as a cut-off reply.** `api/_lib/models.ts:640-652` (`listAround` returns `"cut"` when any `[` before the object never closes) and `:703`.
   - **Probe on HEAD.** Each of these returns `null`; each parsed before the fix:
     - `'Here is the answer [as JSON: {"a": 1}'`
     - `'He said "see [this" then {"a": 1}'`, where the prose quote hides the `]`
     - `'noise {not json [x} then {"ok": true}'`, where `listAround` runs again for the second candidate and finds the `[` inside the first, failed brace block
   - **Effect.** Through `askJSON` these count as `cutOff`: two size retries on the same model with no JSON_ONLY prompt, then the next model, instead of a parse.
   - **Likelihood.** The inputs are rare, and nothing is lost silently: the step still fails or recovers. It is not a correctness regression like Important 2 was.
   - **Fix.**
     - Only count a `[` that is the first non-space character of the cleaned reply, or that directly encloses the object (whitespace or `,` between them).
     - Leave out any `[` that falls inside an earlier failed candidate.
     - Add the three probes to `test/models.test.ts:489`.

2. **Minor. A 402 on the row's own paid model, answered by a `:free` last resort, raises no incident.** `models.ts:853-862`, `:926`.
   - **Before.** A 402 on the row's model raised a critical `openrouter_credit` incident.
   - **Now.** The step runs on HARD_FALLBACKS, and the only record is a `safety_events` `model_fallback` row with reason `credit`, per call. For the free stack this is right: there, HARD[0] is the only paid slug, so any credit incident it raised would be false. But once the founder moves a role to a paid model and the credit runs out, every call degrades to free models and nobody is paged.
   - **Fix (optional).** When the refused paid slug is one the row configured (its own model or its `fallbacks`), raise `openrouter_credit` at `warn`, once a day, as `role_disabled` already does. Keep it silent for HARD[0].

**Merge check (`api/_lib/track.ts` on HEAD `d8003a2`).** Both fix hunks are present: `errorText` with the `ModelBadRequest` branch (`:131-137`) and `holdForFlush` with `then(del, del)` (`:160-171`).

- Task 0.4 (`67fd21d`) made no change to `track.ts` (`git diff dc8fbb4 67fd21d -- api/_lib/track.ts` is empty, and `task-0.4-report.md:71` says "track.ts needed no change"). So there were no Task 0.4 changes in `track.ts` to lose, and HEAD's `track.ts` is byte-identical to `aee6200`'s.
- The `track.ts` exports Task 0.4 imports are all there: `cutSafe`, `since`, `withTrackContext`, `noteRequestFailure` and `tracked`.

No Critical or Important breakage.

## Out-of-Scope Observations

- `errorText` keeps a `SyntaxError`'s message in full. In Node ≥ 20, `JSON.parse` quotes the start of its input there (`Unexpected token 'h', "he typed…" is not valid JSON`), so a job handler that parses client text and throws would put that text into `last_error` and `incidents` through `queue.ts:761`. The model layer is not exposed: `res.json()` failures become `ModelError`, and the transcribe path already guards this (`models.ts:1106`). This is worth a branch in `errorText` before Task 2.x or 3.x handlers parse transcripts.
- Once a 402 has hit a paid model, a later `:free` failure overwrites `reason`, so the `safety_events` note shows that later reason and not `credit`. This affects the label only.
- The C-1592 rule now requires the request to be named `req` or `request` and read in the handler file. The report and the plan note (`:177`) both say so; Task 3.1's executor must follow it.

## Verdict

**APPROVED.** Every finding under verification is ADDRESSED, each with a tagged or justified test, and red and green output is shown for each. C-1527 and C-1528 assert their then-clauses against the real script. The merge kept the `track.ts` fixes, and Task 0.4 had no `track.ts` changes to keep. The two new Minor items can be taken in a later round.
