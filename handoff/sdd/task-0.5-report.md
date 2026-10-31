# Task 0.5 report: `vercel.json`, health skeleton, static security tests

(Written in the worktree, at the same relative path as the shared one. The worktree isolation refused a write to `/home/user/call/.superpowers/...`. The file is untracked and not committed.)

- **Status:** DONE
- **Worktree:** `/home/user/call/.claude/worktrees/agent-ab80937f28ca04cee`
- **Branch:** `worktree-agent-ab80937f28ca04cee`. It began at `fcd4384`, the planning commit, without Tasks 0.1 and 0.2. I fast-forwarded it to `claude/call-phone-agent-build-f50v1t` @ `01b43c6` before starting (`git merge --ff-only`, inside the worktree).
- **Commit:** `369b7b8 Vercel config, health skeleton, static security tests`, with the two attribution lines. Not pushed.

## Files changed
- `vercel.json` (new). It has `$schema` and `cleanUrls`. `functions` has only `api/health.ts` `{maxDuration: 15}`. Two headers are ported from Charlie: `X-Content-Type-Options: nosniff` and `Referrer-Policy`. Charlie's `Permissions-Policy: microphone=()` is left out on purpose because `/demo` (the widget) and `/meeting` need the microphone. There is no `crons` key yet.
- `api/health.ts` (new). A Web handler, `export async function GET(req: Request)`, with a Charlie attribution header and the why-comments kept.
- `test/health.test.ts` (new). Tagged C-1529, C-1535, C-1537, C-1539.
- `test/security-static.test.ts` (new). Tagged C-1572, C-1573, C-1592, C-1593, C-1439, plus the `vercel.json` ↔ `api/` agreement test, which has no criterion.
- `scripts/preview-quote.mjs` (new). A stub that prints "no renderer yet (Task 6.4 adds it)" and exits 0, with or without `--smoke`.
- `docs/VERIFIED.md`. I filled the Vercel Hobby, Supabase free, OpenRouter free and Resend free rows, and corrected their Unblocks columns:
  - Vercel: Tasks 0.5, 0.4, 3.3 and 11.1 (it said Task 0.3).
  - Supabase: Tasks 7.6 and 11.1 (it said 12.2).
  - OpenRouter: Tasks 7.6 and 0.3 (it said 12.4).
  - Resend: Tasks 7.1 and 7.6 (it said 8.2).
  
  Every row says "from docs search, not fetched (2026-10-31)". vendor-notes.md marks the Supabase, OpenRouter and Resend values "(from knowledge)", so those three rows also say "the search notes give these from knowledge". The row would be untrue without that.
- `docs/superpowers/plans/2026-10-31-call-build.md`. I ticked Task 0.5's three boxes and added a **Notes (decided while building)** line under it.

## TDD evidence
**RED, run 1.** Both test files were written first, with the scanner functions stubbed to `return []`.
```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../api/health.ts' imported from .../test/health.test.ts
✖ the scans really read api/ (a wrong root would make every check pass)
✖ [C-1572] SUPABASE_ANON_KEY or a publishable key in api/ is caught; the service role is not
✖ [C-1573] a Supabase URL, a key or the client library in public/ is caught; ...
✖ [C-1592] a webhook handler that parses the body is caught; ...
✖ [C-1593] a model call in a webhook handler is caught; the worker may call models
✖ [C-1439] console.log(body), a raw body in a template or across lines, ... are caught; ...
✖ vercel.json: a key for a missing file, an entry point with no key and a cron with no handler are caught
ℹ tests 14  ℹ pass 6  ℹ fail 8
```
The six passes were the checks over the real repository, which pass trivially with stubs.

**RED, run 2.** The real scanners were in place, but `api/health.ts` and `vercel.json` did not exist yet.
```
✖ the scans really read api/ ...   AssertionError: scanned: api/_lib/crypto.ts, api/_lib/db.ts, api/_lib/env.ts, api/_lib/types.ts
✖ vercel.json names only entry points that exist ...   "vercel.json:1: unreadable (ENOENT ...)"
ℹ tests 13  ℹ pass 11  ℹ fail 2
```
**GREEN.**
- The two focused files: 17 tests, 17 pass.
- `npm run typecheck`: clean.
- `npm test`: 92 tests, 92 pass, 0 fail.
- `npm run test:intel`: 92 tests, 92 pass, 0 fail.
- `npm run criteria -- --missing` lists none of my nine ids.
- `--count --matrix` passes: 1337 criteria, matrix citations all present.
- `grep-models`, `grep-doc-css`, the CI `.js` import grep and `npm run preview-quote -- --smoke` (exit 0) all pass.

## Criteria tagged
C-1529, C-1535, C-1537, C-1539, C-1572, C-1573, C-1592, C-1593, C-1439.

## What each test asserts
- **C-1529:** there are exactly seven services, and each one is `configured` or `unconfigured`. Unsetting any one setting a service needs flips only that service. `ok` is false with a 503 for each of the six required settings. The full form runs no DB query. `guardrails_live` is false. The response sends `Cache-Control: no-store`.
- **C-1535:** `?ping=1` gives exactly one select on `model_config`, with no filters, and returns `{ok:true}` in under 100 ms. A failed query gives `{ok:false}` with a 503, and the reason is logged. When `db()` throws because Supabase is not configured, the ping also gives `{ok:false}` with a 503.
- **C-1537:** no `TEST_ENV` value appears in either response form. The settings set to 1 character and to 300 characters give byte-identical bodies, so nothing in the body depends on a value or its length.
- **C-1539:** `version` is the SHA from `VERCEL_GIT_COMMIT_SHA`. When the variable is unset or blank, it is `"dev"`.
- **Static checks.** Each one runs over the repository, where it must find nothing, and over a temporary tree in `os.tmpdir()` holding the bad file next to the right way of writing it. The bad file must be caught, and the right way must pass.
  - A test asserts that the scan really reads `api/`, so a wrong root cannot make every check pass.
  - As a sanity run, I pointed the scanners at Charlie's tree. They caught `api/whatsapp-webhook.ts`, which reads `req.text()` and so does not verify raw bytes, and `api/_lib/transcribe.ts:231`, which logs a variable named `body`. Nothing else was flagged.

## Decisions
These are recorded in the plan notes.
- **Services and the settings each needs.** A service is `configured` only when every setting it needs is set:
  - supabase: URL and service role key
  - whatsapp: access token, phone number id and app secret
  - resend: API key
  - elevenlabs_webhook: webhook secret
  - voice_tools: tool secret
  - openrouter: API key
  - jev: `TYPESAFE_API_KEY`
- **`ok`** means the six settings in the first block of `.env.example` are all set. `required_missing` is how many are not. The status is 503 when `ok` is false.
- **The ping** is `db().from("model_config").select("role").limit(1)`.
- **`version`** is read from `process.env` at request time. It is set by the platform, so it is not an `.env.example` variable, and Charlie reads it the same way.
- **Webhook handlers** for the static checks are `api/voice.ts`, `api/wa.ts` and `api/resend-webhook.ts` by name, plus any `*webhook*` entry point and any entry point that calls a verifier.
  - Each must read the raw stream (`arrayBuffer()`, `bytes()`, `getReader()`, `for await`) or set `bodyParser: false`.
  - None may import `_lib/models`, call `askJSON`, `askText` or `transcribeAudio`, or name `openrouter.ai`.
- **The C-1439 check** strips string-literal text from the arguments of every `console.*` call. It then fails on identifiers named `*body`, `raw*`, or a direct read of the request (`req.text()` / `request.json()` and similar). Logging an upstream response's text is allowed.
- **Durations for later entry points** are in the plan notes, with the task that creates each file:
  - worker: 300 s (Task 0.4)
  - voice: 60 s and 1024 MB (Task 3.1)
  - app: 30 s (Task 8.1)
  - meeting: 60 s (Task 10.1)
  - render-pdf: 120 s and 2048 MB, with Charlie's `includeFiles` (Task 6.4)
  - cron/*.ts: 120 s (Task 11.1)
  - anything the plan does not list: 30 s
- **Cron schedules for Task 11.1**, in UTC. These follow the Hobby limit of once a day.
  - retention: `0 1 * * *`
  - freshness: `0 2 * * 1` (weekly)
  - `worker?tick=1`: `0 3 * * *`
  - keepalive: `0 4 * * *`

## Concerns
1. **Merge with Task 0.4.** Task 0.4 creates `api/worker.ts`. The test in `test/security-static.test.ts` will fail unless `vercel.json` gains `"api/worker.ts": {"maxDuration": 300}`. Whoever merges 0.4 with this branch needs to add that line.
2. **Merge with Task 0.3.** If the `models.ts` port keeps Charlie's `transcribe.ts` line `console.warn(...${body})`, where `body` holds an upstream error's text, the C-1439 check fails. Renaming the variable (for example to `detail`) fixes it.
3. **Task 3.1.** Its first `api/voice.ts` must already read the body once as raw bytes, with every route parsing from those bytes. Otherwise C-1592 fails before Task 3.3. This is noted in the plan.
4. **Naming clash for Task 11.2.** C-0411 says health reports `post_call: unconfigured`, but C-1529 calls the same thing `services.elevenlabs_webhook`. Task 11.2 should reconcile them. It should also fold DB reachability into `ok` (C-1536) and decide whether `guardrails_live` joins `ok`, as it did in Charlie.
5. **No capture yet.** Health has no `capture()` and no `tracked()` wrapper, because `intel.ts` (Task 0.6) and `track.ts` (Task 0.4) do not exist on this branch.
6. **Orphaned criteria.** C-1527 and C-1528 (proving `grep-models` bites) are owned by `test/security-static.test.ts`, but no task in the plan lists them, so they are still untagged.
7. **Hobby limits not confirmed.** The request body limit, whether `memory` can be set on Hobby, and `maxDuration` itself are all "confirm on deploy" in VERIFIED.md. The body limit matters for C-1594.

## Fix round 1

**Status:** DONE.

- **Commit:** `aee6200` "Fix model fallbacks, JSON extraction and the static checks", one commit for Tasks 0.3 and 0.5, with the two attribution lines. Not pushed.
- **Worktree:** `/home/user/call/.claude/worktrees/agent-af84a156902d48ef5`.
- **Branch:** `worktree-agent-af84a156902d48ef5`, fast-forwarded first to `dc8fbb4`.
- **This report:** the worktree isolation refused a write to `/home/user/call/.superpowers/...`. So this file is the worktree copy at the same relative path: the shared report, with this section added. It is untracked and not committed.
- **Files for Task 0.5:** `test/security-static.test.ts`, `test/health.test.ts` and the plan's Task 0.5 note. No product file changed for this task.

### Each finding

**Important 1: C-1439's `BODY_LIKE` misses `bodyText`, `bodyJson` and `bodyStr`.**
- **What changed.** `BODY_LIKE` is now `/body|\braw\w*\b|\b(req|request)\s*\.\s*(text|json|formData|arrayBuffer|bytes)\s*\(/i`. That is the criterion's own grep (`console.log(.*body`, case-insensitive), run on the call's code with string text removed.
- **Test:** `[C-1439] console.log(body)…`. The bad tree gains `api/_lib/ingest.ts`, containing:
  - `console.log("post-call", bodyText)`;
  - `console.warn(bodyJson)`;
  - `` console.error(`event ${eventBody…}`) ``.

  All three lines must be caught, and they are. The "message about the body" cases still pass.

**Minor 1: the C-1592 check can be satisfied by a comment, or by an unrelated `for await`.**
- **What changed.**
  - A new `stripSource(src, keepStrings)` tokenizer removes comments and, by default, string text. Template `${…}` expressions are kept, regex literals are kept whole, and newlines are kept.
  - `READS_RAW` must now be on the request (`req`/`request`, optionally `.clone()`):
    - `.arrayBuffer()` or `.bytes()`;
    - `.body.getReader()`;
    - `for await (const x of req)`;
    - or `bodyParser: false`.
  - A new `PARSES_BODY` fails any webhook handler that calls `req.json()`, `req.text()` or `req.formData()`, even after a raw read. The test title's "never a parsed body" is now true.
- **Test:** `[C-1592] a webhook handler that parses the body is caught, even beside a comment or a string about raw bytes…`
  - New bad cases, all caught:
    - `voice.ts` with a header comment naming `arrayBuffer()` and a `req.json()`;
    - `sms-webhook.ts`, which has an unrelated `for await` and no raw read;
    - `meta-webhook.ts`, which names `req.arrayBuffer()` only in a string and calls `req.text()`;
    - `twilio-webhook.ts`, which reads the raw bytes and then calls `req.json()`.
  - New good cases, all passing:
    - `stream-webhook.ts` with `request.body!.getReader()`;
    - `node-webhook.ts` with `for await (const chunk of req)`.

**Minor 2: the ping test does not pin "cheap".**
- **What changed.** `_fakes.ts` is untouched, to keep the merge with Task 0.4 trivial. Instead, `test/health.test.ts` gains `recordingClient()`, a Proxy client that records every call in the chain with its arguments. The ping test asserts that the whole chain is exactly `['from("model_config")', 'select("role")', "limit(1)"]`: one column, one row, no filter, no order.
- **Test:** `[C-1535] …`, extended.

**Minor 3: C-1593 sees only direct calls.**
- **What changed.** The check now walks each webhook handler's relative value imports, transitively. Every file reached must not import `api/_lib/models.ts`, call `askJSON`/`askText`/`transcribeAudio`, or name `openrouter.ai`.
  - The models import is found by resolving the import path, not by its spelling. A `_lib` file's `./models.js` therefore counts.
  - The walk stops at `api/_lib/queue.ts`: `enqueue` is the door into job work, and whatever the queue's handlers import runs in a job. It also stops at `models.ts` itself.
  - Type-only imports and comments are ignored.
  - The comment states exactly what the check proves. It cannot see a model reached other than by an import; Task 3.3's behavioural test covers that.
- **Test:** `[C-1593] a model call in a webhook handler, or in a _lib helper it calls on the request path, is caught…`
  - New bad case, caught: `wa.ts` → `_lib/inbound.ts` → `_lib/facts.ts` → `askJSON`. It is reported as `api/wa.ts:1: reaches api/_lib/facts.ts:N: …`.
  - New good case, passing: `meta-webhook.ts`, which has `import type … from "./_lib/models.js"`, a comment mentioning `askJSON(`, and `enqueue` from `_lib/queue.ts`. That `queue.ts` itself imports `facts.ts`.

**Minor 4: the comment about Vercel is wrong.**
- **What changed.** It now says that a `functions` key matching no function fails the deploy, so the check catches a broken deploy before one happens. It also says that an entry point with no key runs on the platform's default limits.

**Minor 5: the plan note is one long paragraph.**
- **What changed.** It is now a bulleted list, one bullet per downstream obligation:
  - every new entry point's `functions` entry, with its value;
  - Task 11.1's cron schedules;
  - C-1592 for Tasks 3.1, 7.1 and 7.2 and every webhook;
  - C-1593 for the same handlers, including where to register job handlers;
  - C-1439 for every port, naming Charlie `transcribe.ts:231` and, newly found, `wa.ts:326`'s `bodyText` for Task 7.2;
  - Task 11.2's health decisions;
  - health as built;
  - the preview-quote stub;
  - C-1527 and C-1528.

  The Task 0.3 note's 402 clause was corrected in the same commit.

**C-1527 and C-1528, added to `test/security-static.test.ts`.** `slugGrep(root)` runs the real `scripts/grep-models.sh`, copied into a temp tree; the script `cd`s to its own parent and greps `api/`.
- `[C-1527] grep-models exits 1 when a slug literal is added to api/_lib/extract.ts…`
  - The clean tree exits 0.
  - Each of three slug shapes (`:free`, digits, and `:free` again with another vendor) planted in `api/_lib/extract.ts` exits 1, and the output names `api/_lib/extract.ts:1:` and the slug.
- `[C-1528] grep-models passes on this tree…` (in the "this repository" block)
  - The real script exits 0 on the real tree, with its message.
  - The real `HARD_FALLBACKS` block holds at least two slugs, so the exemption is in use.
  - The real `models.ts` with that array cut out, copied to a path the script does not exempt, exits 0. So no slug sits in `models.ts` outside `HARD_FALLBACKS`.
- `[C-1528] the exemption is HARD_FALLBACKS in api/_lib/models.ts only…`
  - `HARD_FALLBACKS` in `api/_lib/models.ts` passes.
  - The same array in `api/_lib/old/models.ts` and `api/models.ts` exits 1, naming both.
  - A slug next to the array in `models.ts` passes the script alone, which exempts the whole file, but is caught by the cut-out check.

### Red and green

**RED** for the changed checks: the new bad cases were added first and run against the old checks.

```
TRACKING_OFF=1 node --experimental-strip-types --import ./scripts/register-ts.mjs --test --test-reporter=spec test/security-static.test.ts test/health.test.ts
ℹ tests 20  ℹ pass 17  ℹ fail 3
```

| Test | Failure on the old checks |
|---|---|
| C-1592 | offenders were `[voice, wa, whatsapp-webhook]`; `meta-webhook`, `sms-webhook` and `twilio-webhook` were missed |
| C-1593 | `api/wa.ts`, the two-hop helper, was missed; `meta-webhook.ts` was wrongly flagged for its type import, comment and queue path |
| C-1439 | `api/_lib/ingest.ts:2: console.log` (`bodyText`) and `:3: console.warn` (`bodyJson`) were not caught |

**Bite proof** for the tests that pass on the code as it stands (C-1527, C-1528, and C-1535's chain). Each mutation was applied, run and reverted from a scratch backup; `git diff` was clean afterwards.

| Mutation | Tests failing |
|---|---|
| The script's `exit 1` changed to `exit 0` | C-1527 and C-1528 |
| The script's exemption changed to `'^NO-EXEMPTION:'` | both C-1528 tests |
| The script's exemption changed to any `models\.ts:` | the C-1528 "only" test |
| `const STRAY = "openai/whisper-1";` appended to the real `api/_lib/models.ts` | the C-1528 real-tree test |
| `api/health.ts` ping changed to `select("*")` with no limit | C-1535, actual `['from("model_config")', 'select("*")']` |

**Sanity run over Charlie's tree** (scratch copy of the check functions):

- raw: `api/whatsapp-webhook.ts` is flagged for both the missing raw read and `req.text()`, as expected;
- model: none;
- body: `transcribe.ts:231`, already known, and `wa.ts:326` (`bodyText`), which the criterion's grep also flags. It is now in the plan note for Task 7.2.

The tokenizer kept the line count of all 76 files. The one brace-count oddity is Charlie `track.ts:500`, a regex literal containing `[{`, which is kept whole as it should be. Over this tree all three checks are `[]`.

**GREEN:**

```
test/security-static.test.ts + test/health.test.ts    ℹ tests 20  ℹ pass 20  ℹ fail 0
npm run typecheck                                     clean
npm test                                              # tests 138  # pass 138  # fail 0
npm run test:intel                                    # tests 138  # pass 138  # fail 0
npm run grep-models                                   No hardcoded model slugs under api/
npm run criteria -- --missing | grep -cE "C-1527|C-1528"   0
npm run criteria -- --count --matrix                  1337 total; BEHAVIOR-MATRIX.md cites 1337 criteria, all present.
```

### Concerns

1. **C-1593's walk stops at `api/_lib/queue.ts` by name.** If Task 0.4 or Task 3.1 has the webhook import the job handler modules directly, for the kick to run them in the same process, the check will flag it. Register handlers from `queue.ts` or the worker instead; this is in the plan note.
2. **The webhook raw-read rule now requires the request to be named `req` or `request` and read in the handler file.** It is stricter than before, and it is documented in the check's comment and in the plan note for Tasks 3.1, 7.1 and 7.2.
