# Task 0.6 report: Chase Intelligence core

Status: DONE. Commit `9e0ad8c` "Chase Intelligence: one id per session, every task recorded whole" on `claude/call-phone-agent-build-f50v1t` (not pushed).

## TDD

### RED (tests written first, before any implementation)

```
$ TRACKING_OFF=1 node --experimental-strip-types --import ./scripts/register-ts.mjs --test test/intel.test.ts
# Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/home/user/call/api/_lib/intel.ts' imported from /home/user/call/test/intel.test.ts
not ok 1 - test/intel.test.ts
# tests 1  # pass 0  # fail 1

$ TRACKING_OFF=1 node ... --test test/intel-redact.test.ts
# Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/home/user/call/api/_lib/intelredact.ts' imported from /home/user/call/test/intel-redact.test.ts
not ok 1 - test/intel-redact.test.ts
# tests 1  # pass 0  # fail 1

$ TRACKING_OFF=1 node ... --test test/fakes.test.ts
    not ok 25 - missingTable(name) answers every query as PostgREST does for a table no migration has created (PGRST205, 404) until failTable(name, null)
      error: 'fake.missingTable is not a function'
# tests 62  # pass 61  # fail 1
```

During GREEN the first run had three failures that were real bugs, not test typos:
`[C-1715]` and `[C-1732]` failed because the 9+ digit rule turned uuids inside content
into `5e550001-[number]` (a uuid's digit groups read across its dashes); the
`[C-1739]` test tripped on the same thing. Fixed in `redactText` (uuids held aside
while the rules run) and pinned by a new assertion in `[C-1739]`. `[C-1737]` then
failed once (the held uuid let the `/q/<id>` link's id survive); fixed in the link rule.

C-1710 was added after the implementation (it is in the brief's C-1700–C-1716 range
though owned by the later e2e file); RED shown by mutation (`traceOf` preferring the
request id over the session):

```
    not ok 1 - [C-1710] everything tied to a session carries s_<session_id>: ...
        + 'r_b959cbac60964804'
        - 's_5e550001-0000-4000-8000-000000000001'
# pass 0  # fail 1
(restored)  # pass 1  # fail 0
```

### GREEN

```
$ npm run typecheck           -> clean
$ npm test                    -> # tests 245  # suites 41  # pass 245  # fail 0
$ npm run test:intel          -> # tests 245  # suites 41  # pass 245  # fail 0
$ npm run criteria -- --count --matrix   -> 1337 total; BEHAVIOR-MATRIX.md cites 1337 criteria, all present.
$ npm run criteria -- --missing | grep <Task 0.6 ids>   -> none
$ bash scripts/grep-models.sh -> No hardcoded model slugs under api/
$ bash scripts/grep-doc-css.sh -> No document renderers yet
docs/INTEL-CONTRACT.md identical to Charlie's (sha256 5060897a…af8, C-1753)
```
Baseline before the task: 205 tests in both modes. The capture-on run has no stray
`intel:` warning and no request to a real client.

## Files

Created: `api/_lib/intel.ts`, `api/_lib/intelredact.ts`, `test/intel.test.ts` (29 tests), `test/intel-redact.test.ts` (10 tests).
Modified: `api/_lib/track.ts` (context `turnId`/`contentMode`; listeners get `failure`; side-effect import of intel.ts), `api/_lib/models.ts` (a `model` row per attempt and per transcription request; `CallResult.servedBy`, `CallOptions.label`), `api/_lib/queue.ts` (exported `captureJob`; enqueued/started/finished/failed/held/skipped/fenced rows), `test/_fakes.ts` (`missingTable()` = PGRST205/404; 404 for 42P01 and PGRST205), `test/fakes.test.ts` (one test for it and the intel_events shapes), `test/queue.test.ts` (one filter, below), the plan (ticks + Notes).

## Criteria tagged

C-1700–C-1716 (C-1710 unit form), C-1713, C-1721, C-1722, C-1732, C-1733, C-1734, C-1736–C-1743, C-1745, C-1746, C-1753, C-1754 (unit form), C-1758, C-1765, C-1766, C-1767.

## Decisions (all in the plan's Notes under Task 0.6)

- Trace: session wins over the request's `r_` id; then `job_<id>`; then `r_`; a per-process `p_` for no context. `withTrace` = `withTrackContext`.
- No timer or size trigger: rows are written only by `flushIntel()` (a track.ts flusher), after the response / after the drain. Batches ≤ 500 rows and ≤ 1 MB measured as sent; 3 attempts (100 ms, 400 ms); then dropped, counted, `intel_flush_failed` filed once per outage.
- Missing table (42P01 or PGRST205): one console line per process naming `db/0006_platform.sql`, no incident, 10-minute pause; rows in that window dropped and counted.
- Content cap is 1 MB less 32 KB so the largest row still fits one insert; cut by the longest strings first (shape kept), `meta.truncated_bytes` = bytes removed.
- JSON is redacted structurally (`redactDeep`), not as text: Charlie's text pass would turn a 9-digit JSON number into invalid JSON. Long numbers survive only under money/time/size/count keys.
- `forgetIntel` tombstones the client in-process, waits for in-flight writes, deletes, returns the count; throws on DB errors other than a missing table (so the forget job retries).
- `captureJob("cancelled", …)` is exported for `forgetClient()` (Tasks 3.4/8.7): the queue itself has no cancel path.
- `CaptureOptions` gained `stage?` (track() carries one): a compatible widening of the Interfaces block.

## Concerns

- `test/queue.test.ts` (outside the file list) needed one change for `test:intel` to pass: its "nothing written but the jobs' own status" count now excludes `intel_events`.
- Redaction is about 20 MB/s (2.5 ms per 50 KB of text). That runs after the response, but a very large flush (tens of MB) would not finish inside `flushTracking`'s 2.5 s bound in `tracked()`.
- Task 1.1's migration must match the fake: `intel_events` columns exactly the contract's (the fake has no `created_at`, but C-1752 says "plus created_at"; the brief says none). This needs reconciling in 1.1.

## Fix round 1

Commit `f3d5566` "Chase Intelligence: redact every shape, forget every trace, never on the request path" (on top of 0721dc1; Task 0.4's queue/jobctx/models changes kept). Not pushed.

### RED (tests first, each from the reviewer's probe)

`test/intel-redact.test.ts`: first run, the file failed to load (`does not provide an export named 'redactContacts'`). With a temporary identity stub, 6 of 16 failed for the reason the review gives:
```
not ok [C-1738] secret-named keys in camelCase…           accessToken kept
not ok [C-1737] signed-URL parameters with a prefix…      ...&conversation_signature=cvtkn_… kept
not ok [C-1741] a sign-in code is never written…          kind in content: content written
not ok [C-1739] phone, ID and card numbers written with…  'phone (079) 993 0000 please' unchanged
not ok [C-1740] dates and times stay whole…               '2026-10-31 14:30' → '[number]:30'
not ok [C-1734] base64url and line-wrapped base64…        4,000-char base64url run kept
# tests 16  # pass 10  # fail 6
```
`test/intel.test.ts`: 8 of 36 failed:
```
not ok [C-1700] capture never throws, even on the first failure…   error: 'name getter'
not ok [C-1701] … big structured content …                          catalogue_upload: p95 987.29 ms
not ok [C-1714] … (raw turn id refused)                             hashed, not refused
not ok [C-1715] a job's rows carry its own session's client…        business_id '…c9' (the outer context's)
not ok a bad call site cannot put free text in the trace…           'an id that is not an id is not used'
not ok [C-1745] a flush that runs while forgetIntel is reading…     ['s_…0001:delivery:delivered'] left
not ok [C-1745] forgetting follows the jobs the client's task queued… 2 !== 6
not ok [C-1754] readTrace that stops following queued jobs says so…  0 !== 1 warning
# tests 36  # pass 28  # fail 8
```
Three extra rules were added after the first green round, red first: `session token <value>` in prose, a magic-link token in a path, and a bare `code` holding a six-digit string. Red was 2 failures (C-1737, C-1741); then green.

### GREEN
```
npm run typecheck            -> clean
npm test                     -> # tests 263  # pass 263  # fail 0
npm run test:intel           -> # tests 263  # pass 263  # fail 0   (same count; was 245 + 18 new tests)
criteria --count --matrix    -> 1337; BEHAVIOR-MATRIX cites 1337, all present
criteria --missing           -> none of Task 0.6's ids
grep-models / grep-doc-css   -> clean; INTEL-CONTRACT.md identical to Charlie's
```
I re-ran the reviewer's probes against the new code:
- every case in redact.ts and redact2.ts is redacted, except `{code: "482913"}`, which is now handled too;
- dates are kept;
- the race leaves `[]`;
- the job forget removes all 6 rows;
- capture costs about 3 ms for the catalogue and 0.3 ms for 20 MB, against 0.9 s before.

### What changed
- **I-1** `isSecretKey` works on the key's words. Query parameters are redacted when their name contains sig/token/secret/key/code/auth/credential/passw, after `?` or `&` only (so `;codecs=opus` stays). Signature headers, a scheme-less `Authorization:` value and `rawHeaders`-style lists are covered.
- **I-2** The separators people actually write are accepted. SA phone forms become `[contact]`. Digit-by-digit and spoken read-outs, glued 13–19 digit runs and URL-encoded emails are caught. Uuids and dates are held aside while the number rules run. `redactContacts()` is exported for SPEC 7.2.
- **I-3** A row is kind-only when `meta.kind`, `content.kind` or its name says so, and its content is never held. The code rule crosses line breaks and HTML tags, and also catches "4471 is my pin". The key rule now covers `login_code`, `signInCode`, `pin_code` and similar, plus a bare `code` holding a six-digit string.
- **I-4** `capture()` takes a bounded look (2,000 values / 256 K characters). Small content is serialised then. Anything bigger is held by reference, and serialising, cutting (longest strings, then list heads) and redaction happen in `toRow()` during the flush.
- **I-5** The forget tombstones the client, its traces and its jobs before any wait. It waits for writes in flight before reading and again before deleting. `write()` drops tombstoned rows before every insert, and a forgotten client's row tombstones its whole trace.
- **I-6** `forgetIntel` follows `job_enqueued` links through the table and through buffered rows, as readTrace does (cap 10,000). It deletes by `business_id`, by `trace_id` (including `job_<id>`) and by `job_id`.
- **Minors**
  - **m-1** dates are kept.
  - **m-2** base64url and wrapped base64 count as bytes; a long string is treated as a file only if it has digits and both cases.
  - **m-3** capture never throws.
  - **m-4** a good model answer is captured after the try, and `captureJob` is guarded.
  - **m-5** the trace uses `sessionId` only when it is a uuid and `traceId` only when it is id-shaped; `stage` is redacted.
  - **m-6** a raw turn id is refused, not hashed (the C-1714 test was updated).
  - **m-7** `sb_` keys, short `Bearer`/`Token` values and `%40` emails are covered.
  - **m-8** the job context clears client, broker, turn, stage and content mode. `sessionOf()` (the same single read, with more columns) sets client and broker from the session, and `contentMode: "meta"` for `declined_consent`.
  - **m-9** secrets are read once per `redactDeep` (once per row).
  - **m-10** meta is cut by its values.
  - **m-11** readTrace says in one line when it is cut.

### Concerns
- Some prose is over-redacted, and I accept it: "postal code 2196" loses its digits, text right after "authorization:" or "signature:" is removed, and a list of nine or more single digits ("ages 4, 2, 3, …") becomes `[number]`. A list of amounts separated by ", " is safe because the comma is not a separator.
- Big content held by reference is serialised at the flush. If the caller mutates such an object after capture, the row shows the later state. Small content is still frozen at capture. In-repo callers build fresh objects.
- Redaction now runs at about 12 MB/s (4 ms per 50 KB), about 45 µs per small row, all in the flush.
- For Task 3.4: ingest must set `sessions.outcome = 'declined_consent'` before queuing the next step and call `setTrackContext({contentMode: "meta"})` for its own rows, so that C-1744 covers every pipeline job. Task 2.x's turn redaction should call `redactContacts()`.
