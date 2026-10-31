# Task 0.4 re-review, fix round 1 (`d8003a2..7222606`)

I read the brief, the review, the fix report's "Fix round 1" and the fix diff (once), and checked HEAD `7222606` for line numbers. I ran:

- the focused files (queue + alerts + fakes): 123/123 pass
- `npm run typecheck`: clean
- `npm test`: 205/205 pass

I ran one focused test for a specific doubt (New Breakage 1), saved at `/tmp/claude-0/-home-user/ad36b136-336a-55d6-81b9-100e21138cdd/scratchpad/deadline-window.test.ts`. Nothing in the repository was changed.

**TDD evidence.** The fix report records red runs against the unchanged code:
- 14 failures in alerts and fakes, each for its reason.
- 14 of 43 failures in queue, run as a shimmed copy.

The three wait tests went red only on the missing `__setSleep` seam, so each was also mutation-checked after green, and each revert was caught:
- `waitForDue` forced off
- `canHandOn` without `mayWakeWorker`
- immediate selected by severity
- `stillOwnJob` true on a missing row

The green output is recorded too. That evidence is acceptable.

## Finding Verdicts

| Finding | Verdict | Where (HEAD) | Notes |
|---|---|---|---|
| I1: `forget_client` never blocked by per-session order | **ADDRESSED** | `test/_fakes.ts:973` (`first`, exempt from `behindItsSession`, sorted first); `queue.ts:211` (`enqueue` stores `session_id` null and the session in `payload.session_id`); plan note (13) amended with the SQL `order by (kind = 'forget_client') desc …`; the cancel-before-delete rule for `forgetClient()` is in the Task 0.4 notes (C-1412 already binds Task 8.7 to it) | Tests: `test/fakes.test.ts:404`, `test/queue.test.ts:538`. The latter has a `send_quote` deferred to tomorrow, and the forget runs first. The moved `session_id` decision is sound: with CASCADE, a forget job tied to the session it deletes would delete itself. |
| I2: CASCADE in the fake; skip a job whose session is gone; fake and Postgres identical | **ADDRESSED** | `test/_fakes.ts:808` (session delete removes its jobs); `queue.ts:364` (`stillOwnJob` false on a missing row); `queue.ts:528` (`jobGone`); `queue.ts:891`; note (15) `ON DELETE CASCADE` | Tests: `test/fakes.test.ts:435`, `test/queue.test.ts:471` (queued step deleted; payload-only and orphan rows `skipped`), `test/queue.test.ts:511` (running step fenced, nothing written). |
| I3: `incidents.alert_level`, the caller's hint first; immediate at once, digest daily, none never; C-1550 corrected; `model_call_failed` a digest; `bump_incident` takes and keeps `p_alert_level` | **ADDRESSED** | `track.ts:182,191`; `alerts.ts:239` (`alert_level='immediate'`), `:278` (digest), `:272` (20 h gap, tick only via `worker.ts:82`); `types.ts` `alert_level`; `test/_fakes.ts:1042` (5 args, loudest kept, CHECK) | Tests: `test/alerts.test.ts:131` (C-1550 now `job_failed`/immediate, per C-1543), `:175`, `:220` (real `askJSON` failure gives `digest`, no email); `test/fakes.test.ts:465,506`. `models.ts:598` already passes `digest` (or `none` when retried). |
| I4: in-process wait within the budget; `job_overdue` after 10 min; `overdueJobs()` exported | **ADDRESSED** | `queue.ts:694` (`canHandOn` includes `mayWakeWorker`), `:764` (lane 0 waits even after claiming), `:458` (`overdueJobs`), `:479` (`noteOverdueJobs`), `worker.ts:79-81` | Tests: `test/queue.test.ts:843` (3 attempts in one run, ≥70 s), `:864` (deepest worker claims past 150 s, no self-call), `:1061`, `:1087`. The "plain sweep does not wait" decision is reasonable: it answers what it did now. See New Breakage 1 for what the longer claim window does at the hard stop. |
| I5: failed claim, unsettleable job and failed hand-on each `trackFailure`; worker 500 `{ok:false}` | **ADDRESSED** | `queue.ts:731` (`claim_job_failed`, critical/immediate), `:785` (`job_unsettled:<kind>`), `:817` (`hand_on_failed`); `worker.ts:100` (500 when `!report.ok`, plus `noteRequestFailure`); `test/_fakes.ts:1071` (an rpc answers its table's `failTable`) | Tests: `test/queue.test.ts:689,706,721`; `test/fakes.test.ts:424`. The async path answers 202 before working; its failures are incidents, which is the most it can do. |
| Minor 2: C-0485 text; backoff constant kept with a comment | **ADDRESSED** | `criteria/04-ingest.md:92`; `queue.ts:133` and the comment above it | |
| Minor 3: fenced settles detected | **ADDRESSED** | `holdJob` (worker required), `scheduleRetry` and `touchJob` are conditional on `locked_by` + `running` and return a bool; last-attempt `finishJob` is checked (`queue.ts` `settleFailure`) | Test: `test/queue.test.ts:583` (retry, last attempt, hold; no `job_failed`/`job_retry`). |
| Minor 4: failures leave a trace | **ADDRESSED** | `queue.ts:928` (`job_heartbeat_failed:<kind>`, once per attempt); `queue.ts:307` (`session_check_failed`; counts as busy) | Tests: `test/queue.test.ts:633,677`. |
| Minor 5: atomic gap check | **ADDRESSED** | `alerts.ts:151` (`slotId` from the record it follows), `:206` (23505 means another pass holds the slot) | Test: `test/alerts.test.ts:235`. I also checked clock-skew ordering (`tipOf` picks the unfollowed row, not just the newest) and a failed slot followed by a retry; both are sound. |
| Minor 6: a sent-but-unrecorded email is bounded | **ADDRESSED** (for the ruled case) | `alerts.ts:199-216`: the claim row is written as `sending` before the send and counts as sent | Test: `test/alerts.test.ts:245`. A residual of the original Minor 6 remains (a timed-out but delivered send); see New Breakage 4. |
| Minor 7: count since the last email, not lifetime | **ADDRESSED** | `alerts.ts:165` (`freshCount`); history per kind, newest 500, any age | Test: `test/alerts.test.ts:267`. |
| Minor 8: tail after the hard stop under 300 s | **ADDRESSED** | `queue.ts:173` (margin 10 s), `:175` (self-call 5 s); `alerts.ts:74` | Test: `test/queue.test.ts:1108`: 250 + 4 + 10 + 28 = 292 ≤ 295. The 10 s margin is half of New Breakage 1. |

Minor 1 was deferred and is not verified here.

## New Breakage

1. **Important: a worker that cannot hand on now claims into the window where model calls are refused, so a job nothing is wrong with spends an attempt. On its last attempt it is `job_failed` and an immediate email.**
   - **Where:**
     - `queue.ts:694-696`: `canHandOn` now includes `mayWakeWorker()`, so `claimUntil` is 240 s for the deepest hop.
     - `queue.ts:173`: the hard stop is now 250 s.
     - `queue.ts:764`: the waiter waits for a job due up to `claimUntil − 5 s`.
     - `queue.ts:999`: the second `DeadlineError` counts.
   - **The window:** `models.ts` `callWindow` refuses a call when the attempt has less than `MIN_CALL_MS + WRAP_UP_MS` (25 s) left, which is from 225 s on. A no-hand-on worker keeps claiming until 240 s. That covers hop 2 of every kick → hand-on chain, and any drain with `TRACKING_OFF=1` or no `PUBLIC_BASE_URL`.
   - **What happens:** A job claimed in 225–240 s fails its first model call with `DeadlineError`. It is held with `run_after` = now, and the same drain claims it again at once. The second `DeadlineError` then matches `/out of time/` on `last_error` and counts as a real failure.
     - The rule's premise was "twice in a row means it does not fit in a worker". Here both refusals happen in the same late worker.
     - The counted retry is due in 10 s, but this worker can neither wait (too little time left) nor hand on, so it is stranded until the next kick or tick. That is what I4 set out to remove.
   - **Before this round it could not happen:** hop 2 stopped claiming at 150 s, and a no-hand-on worker claimed until 240 s with refusals only from 245 s.
   - **Reproduced** with the focused test: hop `MAX_WORKER_HOP`, `TRACKING_OFF=0`, the first job advances the clock 230 s, then `extract_facts` (attempts 2 → 3) calls `askJSON`. Output:
     - `REPORT {"claimed":3,"done":1,"failed":1,"held":1,…}`
     - `JOB {"status":"failed","attempts":3,"last_error":"DeadlineError: out of time: … the 20s this attempt has left"}`
     - `MODEL CALLS 0`
     - incidents include `job_failed:extract_facts` (immediate)
   - **Why it matters:** this contradicts C-0493 ("requeued without counting as a failure") and pages a broker's operator for a job that never made a model request.
   - **Fix:**
     - Keep the claim window, and the waiter's `left`, at least `MIN_CALL_MS + WRAP_UP_MS` plus a few seconds before the hard stop. For example, `claimUntil = min(claimUntil, hardStop − 30 s)` when it cannot hand on.
     - Alternatively, do not let the drain that put a job back for lack of time claim it again: the lane stops, or `run_after` moves past this drain's claim window.
     - Add a test: the deepest worker reaches a job due at 230 s, and it ends held, with its attempt unspent.

2. **Minor: `job_overdue` fires for work that is waiting on purpose, every run, with a summary that is not true.**
   - **Where:** `queue.ts:458-488`.
   - **What:** `overdueJobs` counts every queued job more than 10 minutes past `run_after`, including one that `claim_job` will not hand out because an earlier job of its session is still queued. An example is a later step behind a `send_quote` deferred to the next UTC midnight (C-1067), which the ruling left in place for every kind except forget.
   - **Effect:** each worker run bumps the count and the immediate email repeats every 30 minutes until midnight. Its summary says "nothing woke the queue until this run", and the run cannot do the job either.
   - **Fix:** count only jobs `claim_job` could hand out (the same session condition), or word and level the incident for "blocked behind its session". Address this with C-1067's task at the latest.

3. **Minor: the heartbeat misreports the cascade case.**
   - **Where:** `queue.ts:928`.
   - **What:** when "forget me" deletes a session mid-step, the job row goes with it. The next beat touches nothing and raises `job_heartbeat_failed:<kind>`, "found its lock taken by another worker". No worker took it; the row is gone.
   - **Effect:** a misleading digest line on every forget that lands during a running step.
   - **Fix:** read the row and say "deleted with its session" when it is missing.

4. **Minor (residual of Minor 6): the alert idempotency key never repeats, so it dedupes nothing.**
   - **Where:** `alerts.ts:209,216`; `email.ts:141,146`.
   - **What:** a send that times out but was delivered is marked `failed`, and the next pass sends again under a new slot id. `failed` rows count toward neither the 5-minute gap nor the 60-a-day cap. Under a persistent slow Resend, every drain sends a duplicate out of the shared 100/day.
   - **Inaccurate comment:** `email.ts:146` says "alerts.ts passes the key of the record it wrote first, so a retried send cannot double it". No alert send is ever retried with the same key.
   - **Fix:** mark a send with no HTTP status (timeout or network: it may have gone) `sending` rather than `failed`, or derive the key from the content (`fingerprint:count` pairs), as the review suggested. Correct the comment either way.

## Out-of-Scope Observations

- **C-1412 vs CASCADE (Task 8.7).** The plan note has `forgetClient()` set `status='cancelled'` on queued jobs and then delete the sessions. The cascade then deletes those rows, so C-1412's `status=cancelled` can only be asserted on the write itself (the query log) or an audit row, not on the row afterwards. Tell Task 8.7's executor.
- **Task 1.1's SQL follow-up (note 15) carries more than before.** It needs CASCADE, `alert_level`, the five-argument `bump_incident`, the forget-first `claim_job` and an explicit `audit_log.id`. It also needs the service role to be able to UPDATE `audit_log`, because the alert record is now updated in place (`sending` → `sent`/`failed`). If `audit_log` were made append-only, a failed send would stay `sending` and never be retried. SPEC has no such rule today.
- **No cron sends the digest yet.** `vercel.json` has no crons, so the digest is sent only once a `?tick=1` cron is scheduled (Task 0.5/11.1).
- **Pre-existing, unchanged this round:** `sessionGone` (`queue.ts:891`) treats a `payload.session_id` that does not exist yet as gone. Task 3.x must not queue `ingest_transcript` with its session in the payload before the session row exists (SPEC §7.1).
- **C-0491's criterion text still says "finishes as `skipped`".** With CASCADE, a queued step of a forgotten session is deleted rather than skipped. The test name says so; the criterion row could be reworded the way C-0485's was.

## Verdict

All 12 ruled items are ADDRESSED: I1–I5 and Minors 2–8. The fix round is careful and well tested, and the implementer's extra decisions are sound:
- the forget session moved into `payload.session_id`
- the digest only on `?tick=1`, at most once per 20 h
- the plain sweep does not wait

There is one new Important. The longer claim window (I4) combined with the 10 s hard-stop margin (Minor 8) lets a no-hand-on worker claim jobs it cannot run. This was reproduced: a job ends `failed` with zero model calls and an immediate email.

**Round verdict: Needs fixes (one new Important; three new Minors).**
