# Task 0.5 review: `vercel.json`, health skeleton, static security tests

Diff `01b43c6..369b7b8`, reviewed against the brief, the nine criteria rows, the orchestrator's decisions, executor-context.md, vendor-notes.md and SPEC §12–§13. I did not re-run the suite. I ran one focused test for one doubt: the report names two merge risks (the Task 0.3 `models.ts` port and Task 0.4's `api/worker.ts`), so I ran `test/security-static.test.ts` and `test/health.test.ts` on the merged head `dc8fbb4`, which now holds `models.ts`. Result: 17/17 pass. `api/worker.ts` has not landed yet, so the vercel.json risk is still open for whoever merges Task 0.4.

### Spec Compliance

| Item | Verdict | Where |
|---|---|---|
| C-1529: `ok` and `services.{supabase,openrouter,elevenlabs_webhook,voice_tools,resend,whatsapp,jev}`, each `configured`/`unconfigured` | ✅ The test checks exactly seven keys. It unsets each setting in turn and checks that only its own service flips. The needs-mapping is written out in the test rather than imported, so the handler cannot agree with itself. | api/health.ts:31-42, 88-107; test/health.test.ts:51-92 |
| C-1535: `?ping=1` runs one cheap query and returns `{ok:true}` in < 100 ms | ✅ One select on `model_config`, no filters, under 100 ms (against the fake). A failure gives 503 `{ok:false}` with a logged reason, and an unconfigured client does too. "Cheap" is only partly pinned (Minor 2). | api/health.ts:76-86; test/health.test.ts:94-131 |
| C-1537: no secrets or their lengths | ✅ No `TEST_ENV` value appears in either form. Settings of 1 character and of 300 characters give byte-identical bodies. | test/health.test.ts:133-153 |
| C-1539: `version` is `VERCEL_GIT_COMMIT_SHA` or "dev" | ✅ Covers set, unset and blank. | api/health.ts:61; test/health.test.ts:155-163 |
| C-1572: no anon/publishable key in `api/` | ✅ The check is stronger than `SUPABASE_ANON` alone, and it bites on a temp tree. | test/security-static.test.ts:74, 275, 305 |
| C-1573: no Supabase URL or key in `public/` | ✅ It covers all file types, including html. Bites, and lets prose through. | test/security-static.test.ts:82, 279, 316 |
| C-1592: every webhook handler sets bodyParser:false or reads the stream | ✅ It matches the criterion's grep-level then-clause and bites. It can be satisfied by a comment (Minor 1). | test/security-static.test.ts:107-111, 283 |
| C-1593: no model call in `api/voice.ts` | ✅ It checks direct calls and imports only, not transitive ones (Minor 3). | test/security-static.test.ts:119-123, 287, 343 |
| C-1439: no handler logs a request body (`console.log(.*body`) | ⚠️ It is broader than the criterion's grep: every `console.*` method, calls across lines, `raw*`, and `req.json()` read in place. But it misses identifiers the criterion's own grep catches (Important 1). | test/security-static.test.ts:136-147, 355 |
| vercel.json lists only existing functions; the static test checks that functions keys and cron paths match files and that every entry point has an entry; it is proved to bite | ✅ | vercel.json:3-7; test/security-static.test.ts:224-245, 299-301, 375-412 |
| No crons yet; the schedules are in the plan notes for 11.1; the Hobby once-a-day minimum is in VERIFIED.md | ✅ | docs/superpowers/plans/…:172; docs/VERIFIED.md (Vercel row) |
| Health reports services from env as two-state values, never the values themselves | ✅ It returns `configured`/`unconfigured` strings, as C-1529 asks. | api/health.ts:54 |
| preview-quote stub: `--smoke` exits 0 and prints "no renderer yet" | ✅ | scripts/preview-quote.mjs:10-12 |
| VERIFIED.md: the four rows say "from docs search, not fetched (2026-10-31)" | ✅ The rows that rest on knowledge, not search, also say so. The figures match vendor-notes.md, `.env.example` (`OPENROUTER_DAILY_BUDGET=50`) and C-1559/C-1560 (800/950 MB). | docs/VERIFIED.md:12-15 |
| Port attribution and why-comments kept; Charlie idiom (Web `GET`, 503 when not ok) | ✅ | api/health.ts:1-22 |
| Capture | ✅ Not required yet: executor-context says capture applies from Task 0.6, and `intel.ts` did not exist on the base. The report flags this. | n/a |

### Strengths
- **Each static check is proved to bite.** Each check runs twice: over the repository, and over a temporary tree that holds the mistake next to the correct pattern. The repository run would otherwise pass trivially in Phase 0. The bad case must be caught and the correct pattern must pass.
- **A sanity test checks that the scan really reads `api/`** (security-static.test.ts:269-273). Without it, a wrong root would turn every check green.
- **The health test's mapping is independent of the handler.** The needs-mapping is written out in the test. Unsetting one setting at a time catches a mis-wired service.
- **C-1537 is tested by comparing bodies, not by searching for strings.** The 1-character and 300-character settings give byte-identical bodies. That is the right way to test "or their lengths".
- **The ping fails closed.** A failed query and an unconfigured client both return 503 with a logged reason, never a quiet 200, so the keep-alive cron can tell.
- **The vercel.json agreement check is good engineering.** It fails on a key with no file, an entry point with no key, or a cron with no handler. It stops `vercel.json` drifting from `api/`, and the plan notes tell later tasks what to add.
- **The VERIFIED.md rows are honest about where each fact came from.**
- **The merge risks are documented accurately and are still current.** For example, Charlie's `transcribe.ts` logs a variable named `body`. That port has now landed and does not trip the check.

### Issues

#### Critical
None.

#### Important
1. **The C-1439 check misses identifiers that only contain "body", so it is weaker than the criterion's own grep.** At test/security-static.test.ts:136, `BODY_LIKE` uses `\b\w*body\b`, which requires a word boundary right after "body". So `bodyText`, `bodyJson` and `bodyStr` all pass. I checked this: `/\b\w*body\b|…/i.test("bodyText") === false`. The criterion's grep, `console.log(.*body`, catches `console.log("post-call", bodyText)`; this check does not. The code's own comment (lines 126-135) says any body-named identifier is taken to be a body.
   - **Why it matters:** the rule is that a tagged test must assert the then-clause, not a weaker one. `bodyText` is a common name for exactly the decoded webhook payload this criterion protects.
   - **Fix:** match "body" anywhere in an identifier in the string-stripped code, for example `/\w*body\w*/i` or simply `/body/i`, since string text is already removed. Add `console.log("post-call", bodyText)` to the bad temp tree at :355.

#### Minor
1. **The C-1592 check can be satisfied by a comment or by unrelated code** (security-static.test.ts:107-111). `READS_RAW` is tested against the whole file, comments included. Any `for await (` or `.bytes()` call also counts. So a webhook header comment saying "reads the body once with arrayBuffer()", next to code that calls `req.json()`, passes. Comments like that are likely given how heavily this codebase comments. The test title at :283 also claims "never a parsed body", which the check does not test.
   - **Fix:** strip comments and string literals before matching (`scanCode` already strips strings). Also fail when a webhook handler calls `(req|request).(json|text|formData)()`. Add a temp-tree case: the comment plus `req.json()`, which must be caught.
2. **The ping test does not pin "cheap"** (health.test.ts:103-106). It asserts one select with no filters, but the fake's `QueryLog` does not record the columns or the limit. So `select("*")` with no `.limit(1)` still passes.
   - **Fix:** in the success case, use an `__setClient` stub (as the failure case already does) that records `select(cols)` and `limit(n)`, then assert `"role"` and `1`. Alternatively, have the fake log `limit`.
3. **The C-1593 check only sees direct calls** (security-static.test.ts:119-123). Suppose `api/voice.ts` calls a `_lib` helper inline, such as `extractFacts()`, which calls `askJSON`. That is a model call made inside the webhook, and it passes.
   - **Fix (optional, when Task 3.1 lands):** follow each webhook handler's relative imports under `api/_lib` and fail when `_lib/models` can be reached. Or add a behavioural test in Task 3.3 that `askJSON` is never called during the handler.
4. **A comment gives the wrong reason for the vercel.json check** (security-static.test.ts:296-298). It says a `functions` key that names a missing file "is ignored by the platform". As far as I know, Vercel instead fails the build with "The pattern … defined in `functions` doesn't match any Serverless Functions". The check is still right, and it is more valuable than the comment says.
   - **Fix:** reword the comment to say a broken deploy, caught before deploy.
5. **The plan note is one paragraph of about 700 words** (docs/superpowers/plans/2026-10-31-call-build.md:172). It holds obligations for Tasks 0.4, 3.1, 6.4, 7.x, 8.x, 9.2, 11.1 and 11.2. The executor reading each of those tasks gets only its own brief, so obligations buried in one paragraph are easy to miss. Examples: "Task 3.1's voice.ts reads raw bytes once", and "add your `functions` entry in the same commit".
   - **Fix:** split it into one bullet per downstream task. Better still, have the orchestrator copy each bullet into that task's brief.

Not issues, for the orchestrator:
- **C-1527 and C-1528 are orphaned.** Their test file is `test/security-static.test.ts`, but no task lists them. Assign them, perhaps to the fix round.
- **Task 0.4's merge** must add `"api/worker.ts": {"maxDuration": 300}` to vercel.json, or the agreement test fails.
- **Task 11.2 has two open questions:** the `post_call` (C-0411) versus `elevenlabs_webhook` (C-1529) naming, and how `ok` and `guardrails_live` relate.
- **The VERIFIED.md "Unblocks" column was re-pointed** for all four rows. That goes beyond the brief, but it is harmless and documented.

### Assessment
The task matches its brief and the orchestrator's decisions, and the tests are well built: independent mappings, a body comparison for C-1537, a check that the scan reads `api/`, and each static check proved to bite on a temp tree. One fix is needed before approval. C-1439's regex lets `bodyText`-style identifiers through, which the criterion's own grep would catch. It is a one-character-class fix plus one bad-tree line. The Minor items are hardening suggestions.

**Task quality: Needs fixes** (Important 1; the Minor items are recommended alongside).
