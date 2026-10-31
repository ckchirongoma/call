# Task 0.4 review: queue, tracking, alerts, email, `/api/worker`

Reviewed: `dc8fbb4..67fd21d` (one commit, `67fd21d Port the job queue, tracking, alerts and email sender`), from the review diff. I also read the brief, the executor context, the implementer's report, criteria rows C-0485–C-0499 and C-1505/C-1511/C-1541–C-1552/C-1597–C-1610, SPEC §4/§7/§12/§13, BEHAVIOR-MATRIX B4, and the Charlie sources (`queue.ts`, `alerts.ts`, `chain.ts`, `db/0013_claim_job_owner_order.sql`). For integration I read Task 1.1's parallel diff (`review-dc8fbb4..01309e9.diff`: the jobs, audit_log and incidents DDL). I re-ran nothing. I used git only to read the commit message, which is not in the diff.

## Spec Compliance

**Verdict: ⚠️ Mostly compliant.** Every id in the brief is tagged, and every tag asserts its then-clause or something stronger. There are three caveats: two then-clauses hold only against the fake's semantics (C-0491/C-1606, and per-session order for `forget_client`), and one brief instruction was reinterpreted ("incidents semantics as Charlie").

### Interfaces

| Item | Verdict | Where |
|---|---|---|
| `enqueue(kind, sessionId, payload, opts) → Promise<string>`. Refuses unknown kinds; dedupe revives a `failed` job once | ✅ | `api/_lib/queue.ts` (enqueue, sameWork) |
| `JobKind`: exactly the brief's 12 kinds | ✅ | `api/_lib/queue.ts:52-66` |
| `drain(opts) → DrainReport`, `registerHandler(kind, fn)` (returns an undo, a superset of the interface) | ✅ | `queue.ts` |
| Lock timeout 120 s, `touchJob` every 30 s, `stillOwnJob`, every status write conditional on `locked_by` | ✅ | `queue.ts:127`, `:286`, `:707`; finishJob, holdJob, scheduleRetry |
| Per-session serialisation (claim order plus the `otherJobRunningFor` hold), 3 lanes | ⚠️ | Correct for pipeline steps. It also blocks `forget_client` behind the session's earlier queued jobs (Important 1). |
| Backoff 10/60/300 s; 3 attempts, then `failed` plus incident | ✅ | `queue.ts:120`, `:771-790`. See the 300 s judgement below. |
| `track`, `trackFailure`, `runAlerts`; "incidents semantics as Charlie" | ⚠️ | Charlie's incidents carry an `alert` level, and its immediate email selects on it. Here severity decides and the caller's `alert` hint is dropped (Important 3). |
| `/api/worker` POST/GET, `WORKER_SECRET` or `CRON_SECRET`, fails closed, `?tick=1`, 240 s budget, hand-on | ✅ | `api/worker.ts:34-41`, `:63`, `:79`, `:86`; `queue.ts:542` |
| vercel.json: worker at 300 s, no crons (orchestrator decision) | ✅ | `vercel.json:8` |
| No Chase capture, only a marker comment (orchestrator decision) | ✅ | `queue.ts` runAttempt: `// Task 0.6: capture job lifecycle` |
| `sendEmailTo` through the Resend REST API; no address in any log or error | ✅ | `api/_lib/email.ts`: no console call, errors masked |
| Ported why-comments kept; Charlie attribution in each header | ✅ | all five files |
| Commit: brief's subject, short body, ends with the two attribution lines, no other model name | ✅ | `git log -1 67fd21d` |

### Criteria

| Id(s) | Verdict | Notes |
|---|---|---|
| C-0485 + C-1511 (queue half) | ✅ | Real failures run through `askJSON`. They assert attempts 1→2 and `run_after` +10 s, then +60 s; 300 s is pinned through `retryDelaySeconds(3)`. |
| C-0486 | ✅ | After 3 failures: `failed`, `last_error` set, incident `job_failed:extract_facts` whose summary names the kind and the session prefix |
| C-0488 | ✅ | No duplicate turns; the same extract job is revived exactly once (counted in the update log) |
| C-0489, C-1597 | ✅ | No claim at 119 s; reclaimed at 121 s with attempts 2 |
| C-0490 | ✅ | One winner out of three claims, through the RPC. Real atomicity is the SQL's job (Task 1.1). |
| C-0491, C-1606 | ⚠️ | Pass against the fake. With Task 1.1's `jobs.session_id ON DELETE SET NULL` they do not hold in Postgres (Important 2). |
| C-0492 | ✅ | Stops claiming once past `claimUntil`; one hand-on with `hop=1` and the Bearer header |
| C-0493 + C-1505 (queue half) | ✅ | First DeadlineError: requeued, attempt returned, no `job_retry` incident. A second in a row counts. |
| C-0494 | ⚠️ weak | Proves order, `session_id` on every job, and dedupe. Idempotence is shown only for the stand-in upserts (Minor 1). |
| C-0495 | ✅ | Resend 503: retried after 10 s, quote status untouched (only the queue's half is provable here) |
| C-0496, C-0497, C-0498 | ✅ | 401 with WWW-Authenticate, closed when no secret is set; tick drains with `CRON_SECRET`; `{claimed:0}` in under 200 ms |
| C-0499, C-1601 | ✅ | 20 jobs over 5 sessions, enqueued session by session so only the claim order keeps them apart: no overlap, peak exactly 3, every session in order |
| C-1598 | ✅ | A's `finishJob` refused, `stillOwnJob` false, A's write fenced, B's row stands |
| C-1599 | ✅ | Heartbeat proven on real timers across 600 s of fake time; never reclaimed |
| C-1600 | ✅ | Both mechanisms: the claim order, and the `otherJobRunningFor` hold that spends no attempt |
| C-1602, C-1603, C-1604, C-1605, C-1608, C-1610 | ✅ | Each asserts its then-clause directly. C-1608 checks log order (write before the next insert) and the failing-write path. |
| C-1541, C-1548, C-1550, C-1552 | ✅ | Real 3-attempt failure, then email, 5-minute gap, only new items in the next email; unconfigured means incidents only, health says `alerts: unconfigured`; count and `last_at` move, cooldown 30 min; with TRACKING_OFF no email and no self-call, but the incident row exists |

**Deferred ids.** C-0487 and C-1609 are listed under Task 8.8 (plan line 521). C-1607 is listed under Task 11.1 (plan line 579). Both were confirmed in the plan.

**The 300 s step: I agree it is unreachable.** C-0486 ("Given 3 failures, then `status=failed`"), C-1541 and SPEC §12 ("failed job after 3 attempts") all fix three attempts. That leaves two retry gaps, 10 s and 60 s. The only reading that reaches 300 s is BEHAVIOR-MATRIX B4's "retried ×3" (four attempts), and it contradicts all three of those sources. The implementer kept 300 s as the table's ceiling and pinned it as a value; that is the most faithful option available. The criteria text itself is still contradictory (Minor 2).

**Alert state in `audit_log`: sound, with caveats.** `audit_log` is not purely a broker trail. Other criteria already write system-actor rows there: C-0370 for the voice agent's `set_channel`, C-1210 for the forget job, C-1086 for auto-send. SPEC §10 also says "every state change writes audit_log". Task 1.1's DDL makes `broker_user_id` nullable (`ON DELETE SET NULL`) and `entity_id` text, so the insert fits. The rows also give C-1554 (`limits.emailsToday()`, "deliveries + alert emails") its alert count for free. A broker's audit view scopes by its own users, so it never sees the null-user rows; `/admin` sees them, which is correct. The caveats are the race between concurrent passes and the unbounded resend when the record fails (Minors 5 and 6). The real problem in this area is not where the state is kept but what selects the immediate email (Important 3).

## Strengths

- **Fencing is complete on the queue's own side.**
  - Every status write is conditional on `locked_by`: finish, hold and retry; the heartbeat additionally requires `status='running'`.
  - `enqueueNext` is buffered until the step returns and re-checked with `stillOwnJob`.
  - Each lane has its own token, so two lanes never share one.
  - A job reclaimed after its worker died on the last attempt is failed, not run a fourth time.
- **Strong tests, and they are mutation-checked.** The report lists 10 mutations, each caught.
  - Real-path tests go through `askJSON` for C-0485, C-1511 and C-0493.
  - Handler gates are opened in `finally`, so a failed assertion cannot hang the process.
  - The C-0499 queue order is built so that only the claim rule can pass it.
- **`email.ts` is careful.**
  - Validates every address and refuses a CR/LF.
  - Masks addresses in every error and has no console call.
  - Sends an `Idempotency-Key` header.
  - Uses the sandbox sender with a flag in the result.
  - Classifies 4xx as final and 429/5xx/network failures as retryable.
  - Records the Resend API shape in VERIFIED as "from knowledge, not fetched".
- **The alert HTML is now tables with inline hex (R8)**, where Charlie used divs.
- **The worker's auth** fails closed, compares with `timingSafeEqual`, and answers 401 with `WWW-Authenticate` as C-0496 says.
- **The plan notes are thorough.** Note (13) gives Task 1.1 the exact `claim_job` SQL the fake now implements.

## Issues

### Critical

None.

### Important

1. **Per-session claim order blocks `forget_client` behind the session's earlier queued jobs.**
   - **Where:** `test/_fakes.ts:955-957` (`behindItsSession`), the plan's note (13) at plan line 162 (the SQL for Task 1.1), `queue.ts:81` (`RUNS_WITHOUT_SESSION`), and the test at `test/queue.test.ts:462`, which enqueues `forget_client` with the session's id.
   - **What:** The order rule is "no earlier job (lower id) of the same session is queued or running". It ignores both `run_after` and kind. A forget job for session S therefore waits behind any earlier queued job of S: a retry in backoff, a `JobHoldError` hold, or C-1067's `send_quote` deferred to "next UTC midnight" when 100 emails have gone today.
   - **Why it matters:** C-1412 says the forget job cancels a queued `send_quote`. Under this rule the forget cannot run until that `send_quote` has run. The quotation can then go to a client who asked to be forgotten, which is a POPIA problem. A deferred `send_quote` also blocks every later job of its session (a broker's re-quote, for example) for hours. Charlie's owner-order rule (db/0013) applied only to inbound messages, which carry `wa_id`; Call applies it to every kind.
   - **Fix:**
     - In the fake and in note (13)'s SQL, exempt `forget_client` from the "earlier queued" condition. It should still wait for a running job of its session, so it never runs beside a send in flight; that is the `otherJobRunningFor` hold.
     - Alternatively, fix in the notes that forget jobs carry `session_id` null and identify the client by `client_id` in the payload.
     - Add a test: a forget queued behind a `send_quote` whose `run_after` is tomorrow is claimed now.

2. **C-0491 and C-1606 hold only in the fake. Postgres nulls the job's `session_id`, and the step runs.**
   - **Where:** `queue.ts:382-390` (`sessionGone`): `if (!sessionId) return false`.
   - **What:** Task 1.1's migration has `jobs.session_id uuid REFERENCES sessions(id) ON DELETE SET NULL`, deliberately, so the forget job survives the sessions it deletes. When "forget me" deletes a session mid-pipeline, every queued job of that session ends up with `session_id` NULL. The fake does not emulate foreign keys, so the test keeps `session_id = S1` and passes. In Postgres, `sessionGone` falls back to `payload.session_id`. That is normally absent, because the pipeline passes the session as the column. The function then returns false, so the step runs with a null session: outside per-session order, and failing on its own foreign keys. The result is three attempts and a `job_failed` alert instead of `skipped`.
   - **Fix:** Make `enqueue` stamp `payload.session_id` whenever `sessionId` is given, so the reference survives `SET NULL`. Alternatively, treat a null session as gone for kinds that always carry one; this excludes `ingest_transcript`, which may be queued before its session exists (SPEC §7.1), and `forget_client`. Add a test that nulls the job's `session_id` the way Postgres would.

3. **Severity alone decides the immediate email, and the caller's `alert` hint is dropped.**
   - **Where:** `alerts.ts:53` and `:132` (`.in("severity", ["error","critical"])`). The C-1550 test at `test/alerts.test.ts:134`.
   - **What:** The brief says "incidents table semantics as Charlie". Charlie's incidents store `alert` (immediate/digest/none), and its immediate email selects `alert = 'immediate'`. Here every error becomes an immediate email, whatever `alert` the caller passed.
   - **Consequences:**
     - `models.ts:576` raises `model_call_failed` with `severity: "error", alert: "digest"` on every non-deadline model failure, including attempt 1 of a job the queue will retry 10 s later. Each transient free-model outage is therefore emailed at once.
     - The C-1550 test pins `delivery_failed` (error) as an immediate email. C-1543 (Task 11.3) says "Given a delivery failed, then digest alert".
     - Task 11.3's file list is `alerts.ts` and `test/alerts.test.ts` only, with no migration. It cannot add the column it will need.
   - **Fix:** Through Task 1.1's notes, add `alert text NOT NULL DEFAULT 'digest' CHECK (alert IN ('none','digest','immediate'))` to `incidents`. Give `bump_incident` a fifth argument, `p_alert`; on a repeat keep the most urgent level, as Charlie db/0024 did. Have `track()` pass the alert level it already computes, and select `alert = 'immediate'` in `runImmediate`. Change the C-1550 test to an immediate-level fingerprint. The concern was raised in the report (concern 2) and is cheap to fix now.

4. **Liveness: the hop cap of 2, no watchdog and a daily cron leave work stranded for up to a day, without any record.**
   - **Where:** `queue.ts:402` (`MAX_WORKER_HOP` 2), `:432` (`self_call_capped` is a performance event, so no incident), `:542` (`canHandOn` ignores `mayWakeWorker()`), `:588` (a worker waits for due work only if it has claimed nothing).
   - **Scenario:** A kick yields at most two workers, hop 1 and hop 2.
     - A step fails in hop 1 and goes into its 10 s backoff. Hop 1 hands on.
     - Hop 2 waits, runs attempt 2, and it fails again (a free-model 429 easily lasts a minute). Its 60 s backoff begins.
     - Hop 2 cannot hand on, and it does not wait, because it has already claimed a job.
   - **Why it matters:** The third attempt waits for the next call's kick or the daily tick. The broker gets neither the quote nor an alert, because the job has not failed. Charlie had the same cap, but it also had the watchdog chain and much more frequent traffic (an inbound message per turn). Call dropped the watchdog, and calls are rare. Separately, the deepest worker still stops claiming at 150 s to keep time for a hand-on it cannot make.
   - **Fix:**
     - Set `canHandOn = !opts.noHandOn && selfCallsAllowed() && mayWakeWorker()`, so the deepest worker uses its whole budget.
     - When it cannot hand on, let it wait for due work within that budget even after claiming.
     - Make `self_call_capped` with work still due a warn incident.
     - Test the scenario: two failures in a two-hop chain end with the third attempt run.

5. **The queue can be dead with nothing on the record.**
   - **Where:** `queue.ts:572` (claim_job failed: `console.error`, then `broken`), `:621` (job could not be settled: console only), `:476` (hand-on failed: console only).
   - **What:** If `claim_job` errors (migration not applied, permission revoked, function signature drift), every drain logs one console line and returns a normal report. The worker answers 200 `{claimed:0}`, so there is no incident, no email and no `request_failed`. The focus says errors are never swallowed silently, and this is the most important one.
   - **Fix:** Record each as an incident:
     - `trackFailure("claim_job_failed", err, {severity: "critical", fingerprint: "claim_job_failed"})`, plus a flag in the report so the worker answers 500.
     - `job_unsettled` as an error.
     - `hand_on_failed` as a warning.

### Minor

1. **C-0494's idempotence is shown only for the stand-ins.** `test/queue.test.ts:111`. The queue's part (dedupe means a re-run queues nothing new) is proven. "Running twice yields the same rows" is a property of each real step, so Tasks 3.4–7.x must re-assert it per handler. Add a sentence to the test's header or the plan notes so the tag is not taken as covering them.
2. **The criteria text contradicts itself on the backoff.** `queue.ts:120`; `criteria/04-ingest.md:92` (C-0485 lists 300 s); `BEHAVIOR-MATRIX.md:110` ("retried ×3"). Ask the orchestrator to reword C-0485 ("10 s, then 60 s; 300 s ceiling") or B4 ("3 attempts"), so the record does not imply a fourth attempt.
3. **Some fenced settles are not detected.**
   - On the final attempt, `finishJob`'s result is ignored (`queue.ts:771-772`), so a fence between `stillOwnJob` and the write still raises `job_failed` and counts `failed`.
   - `holdJob` and `scheduleRetry` do not detect a zero-row (fenced) update, so the report counts held or failed for writes that did not happen.
   - `holdJob`'s `worker` argument is optional, which leaves room for an unfenced hold later (Task 8.8).
4. **Several failures leave no trace.**
   - Heartbeat failures are ignored entirely (`queue.ts:286`, `:707`): there is no console line or event, so a reclaim under a live attempt has no trace. Track it once per attempt.
   - `otherJobRunningFor` turns a read error into "not running" silently (`:263`).
5. **Two drains finishing together can both send the immediate email.** `alerts.ts:122-171`. The gap check reads the record before the send and writes it after, with no atomic claim. Charlie's daily pass used an insert-claim; here `runAlerts` runs after every drain, and drains run concurrently.
6. **An email that went out but is not on the record is resent on every drain.** `alerts.ts:171`. The gap and the daily cap are both read from the record, so nothing bounds the resends; they come out of the Resend 100/day the quotations share. A send that timed out but was delivered is also resent. `email.ts:140`'s comment ("a retry with the same key cannot double it") holds only when a key is passed, and the alert email passes none. Fix: pass `idempotencyKey: "alert:" + hash(fingerprint:count pairs)` from `runImmediate`.
7. **An old incident's whole count is reported as new.** `alerts.ts:140`. When the incident was last emailed outside the 24-hour lookback, `fresh` is its lifetime count ("N new"). Cosmetic.
8. **The tail after the hard stop can pass Vercel's 300 s kill.** A job may finish near 270 s; then come the flush (≤4 s), the hand-on (2 × 15 s timeout, `queue.ts:436`) and the alert send (10 s). The hand-on is then killed. The woken worker answers 202 at once, so a self-call timeout of about 5 s is enough.

### Cross-task note for the orchestrator (not a defect of this task)

Task 1.1, in parallel, wrote `claim_job` with a 5-minute lock and no session order. Its tests (`rls.test.ts`, `migrations.test.ts` C-1578) hold that SQL to the fake's stale-lock age and `SCHEMA`. Merging this task's `_fakes.ts` (120 s, `behindItsSession`) therefore needs Task 1.1's SQL rewritten to note (13), with Important 1's exemption. Important 2 (`SET NULL`) and Important 3 (an `alert` column and `p_alert`) also land in Task 1.1's files. Reconcile all three in one pass.

## Assessment

The port is careful and well tested. The queue's own fencing, its heartbeat and its retry bookkeeping are right, and the worker is shut and fails closed. The implementer's 300 s judgement is correct. Keeping alert-email state in `audit_log` is defensible, and it also serves C-1554.

Five things need to change before this is the queue the product runs on:

- `forget_client` must not wait behind the session's earlier queued jobs.
- `sessionGone` must survive `jobs.session_id ON DELETE SET NULL`.
- The immediate email must follow the caller's alert level, not severity alone.
- Work must not be stranded silently at the hop cap.
- A broken `claim_job` must be an incident.

Three of these are integration issues with Task 1.1, which is in flight now, so this is the cheapest time to fix them.

**Task quality: Needs fixes**
