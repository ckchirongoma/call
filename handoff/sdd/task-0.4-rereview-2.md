# Task 0.4 re-review, fix round 2 (`9e0ad8c..0721dc1`)

I read the round-1 re-review, the fix report's "Fix round 2" and the fix diff (once), and checked HEAD `0721dc1` for line numbers. I ran:

- the focused files (queue + alerts + models + fakes): 168/168 pass
- `npm run typecheck`: clean
- `npm test`: 250/250 pass
- `npm run test:intel`: 250/250 pass
- `npm run grep-models`: clean

**Focused tests, both in the scratchpad.** Nothing in the repository was changed.
- I re-ran the round-1 reproduction (`/tmp/claude-0/-home-user/ad36b136-336a-55d6-81b9-100e21138cdd/scratchpad/deadline-window.test.ts`). It now gives `claimed 1`, the job `queued` with `attempts 2`, 0 model calls and no incidents.
- I wrote one new test for a specific doubt (New Breakage 1): `/tmp/claude-0/-home-user/ad36b136-336a-55d6-81b9-100e21138cdd/scratchpad/ask-deadline-loop.test.ts`.

**TDD evidence.** The fix report names the covering tests. Its red runs were against `9e0ad8c`, with the queue file run as a shimmed copy because `MODEL_REFUSAL_MS` was not yet exported:
- alerts: 1 failure ("under the same key")
- queue: 6 failures, each for its reason

It also mutation-checked four reverts after green, and each revert was caught:
- no claim cutoff
- the old "second in a row" rule
- overdue counting blocked jobs
- the heartbeat always `lock_lost`

The green output is recorded too (three consecutive focused runs). That evidence is acceptable.

**Task 0.6 capture.** Intact.
- `queue.ts` has 16 `capture`/`captureJob` calls, as at base.
- `models.ts` has 2, as at base.
- `track.ts` is untouched.
- No `capture` line was removed in the diff.

## Finding Verdicts

| Finding | Verdict | Where (HEAD) | Notes |
|---|---|---|---|
| **Important:** a no-hand-on worker claims until 240 s while model calls are refused from 225 s | **ADDRESSED** | `jobctx.ts:60` (`MODEL_REFUSAL_MS`, the one shared constant); `models.ts:361` (`left < MODEL_REFUSAL_MS`, the same test as before); `queue.ts:201` (`CLAIM_CUTOFF_MS` = 25 s + 20 s); `queue.ts:799` (`claimUntil = min(…, hardStopMs − CLAIM_CUTOFF_MS)`) | **Claim window:** 205 s with no hand-on, 150 s with one. The waiter's `left` derives from `claimUntil` (`queue.ts:855`), so a waited-for job is claimed by 200 s. Its first model call is then at least 20 s before the refusal point. **Counting rule:** `queue.ts:801,1070,1127`. A refusal in an attempt that started more than 60 s after its drain began is held, and never counted. One that had a whole worker counts. A refusal at the job's own deadline can only come after 225 s, which is past the 205 s cutoff, so the same drain cannot claim it again. **Tests:** `test/queue.test.ts:893` is the reviewer's reproduction at hop `MAX_WORKER_HOP`, with attempts at `MAX−1`. Reached at 230 s, the job is not claimed. Claimed at 200 s and refused at 230 s, it is held and not claimed again. There is no `job_failed` and no model call. `test/queue.test.ts:1206` pins the constants. **C-0493 is not weakened.** Its then-clause ("requeued without counting as a failure") is still asserted at `test/queue.test.ts:853` for a refusal inside a real `askJSON` call: `queued`, `attempts 0`, runnable at once, no `job_retry`. It is asserted in two successive drains, and in a late last attempt at `:893`. The only exception is a refusal in a fresh worker. It replaces the old "second in a row counts", and is the loop-breaker the finding's wording allows ("for lack of budget"). The old rule broke the clause on any second refusal; the new one never breaks it for a late attempt. See New Breakage 1 for one source where the "cannot claim again" premise fails. |
| **Minor:** `job_overdue` fired for jobs waiting behind their session | **ADDRESSED** | `queue.ts:533-565` | `overdueJobs` reads up to 200 late rows and drops a job when a lower-id queued or running job of its session exists. That is claim_job's rule, and `forget_client` is exempt. It returns `{count, oldest, behind}`. `noteOverdueJobs` (`:572`) raises only on `count`, so the summary "nothing woke the queue" is now true. Test: `test/queue.test.ts:1214`. The deferred `send_quote` gives `count 0, behind 1` and no incident. A truly stranded job gives `count 1` and one incident. |
| **Minor:** the heartbeat blamed another worker for a cascade delete | **ADDRESSED** | `queue.ts:621` (`whyLockLost`); `queue.ts:1046`; `traceBeat` (`job_orphaned`, a behaviour event, for `deleted_with_session` and `cancelled`) | A late resolve after the attempt ends is dropped (`!live`). Test: `test/queue.test.ts:685`. Both cases give `job_orphaned` with the right reason, `fenced 1`, and no `job_heartbeat_failed` incident. |
| **Minor:** the alert idempotency key never repeated; the `email.ts` comment was wrong | **ADDRESSED** | `alerts.ts:167` (`alertKey`: kind plus the sha256 of the sorted `fingerprint:count` pairs); `alerts.ts:224`; `email.ts` `sendEmail` doc comment and the `alerts.ts` header corrected | This is the review's suggested option (b). The body is a function of the same pairs, so a repeated key never carries a different payload; I checked `incidentLines` and `countLine`, and there are no timestamps beyond `first_at`. Test: `test/alerts.test.ts:267`. The first send throws after delivery. The next pass sends again under the same key, and the fake Resend delivers once. A new problem gets a new key. Residual: see Out-of-Scope 1. |

## New Breakage

1. **Minor (latent): a late refusal caused by an ask's own `deadlineMs` is claimed again by the same drain until `maxJobs` is used up.**
   - **Where:** `queue.ts:1127` holds every non-fresh `DeadlineError` with `run_after` = now. The comment at `:1118-1121` says the drain "cannot claim it again (it is past CLAIM_CUTOFF_MS by now)".
   - **Why the premise fails:** it holds only when the job's deadline was the limiting one. `callWindow` (`models.ts:356-361`) also refuses when the ask's own `deadlineMs` is near, and that can happen at any point in the drain.
   - **Reproduced** with the new focused test: the step is claimed at 70 s and calls `askJSON(…, { deadlineMs: 10_000 })`.
     - First drain: `claimed 10, done 1, held 9`. The handler ran 9 times, and the drain's whole `maxJobs` went on one job.
     - The next drain: the attempt is fresh and counts (`failed 1`, `attempts 1`).
     - So it is bounded. Under the old rule, it counted at its second claim.
   - **Why it matters:**
     - Other sessions' work in that drain is starved.
     - The step's work before the ask is repeated 9 times. That is data-safe only because steps are idempotent (C-0494).
   - **Latent:** no caller in `api/` passes `deadlineMs` today (grep).
   - **Fix, either of:**
     - Hold a late refusal until past this drain's claim window (`run_after ≥ started + claimUntil`).
     - Have `DeadlineError` say which deadline bound it, and treat an ask-deadline refusal as an ordinary failure.

No Critical or Important breakage.

## Out-of-Scope Observations

1. **Alert key residual.** The content key dedupes an exact repeat only.
   - A problem that grows between passes gets a new key.
   - `failed` rows still count toward neither the 5-minute gap nor the 60-a-day cap.
   - So under a persistently slow but delivering Resend, with a fault that keeps repeating, each pass can still deliver one email.
   - Counting a no-status (timeout) `failed` row toward the 5-minute gap would bound it. This is low; the ruled fix was taken as suggested.
2. **"However often" has no upper bound.**
   - Late refusals never count. A step needing more than about 165 s of work before its last model call, reached after 60 s in every worker, is put back each time while a backlog lasts.
   - Its session's later steps wait behind it.
   - It ends once the backlog clears and it is claimed fresh. Worth a `job_out_of_time` threshold in the digest (Task 11.3) if it ever shows up.
3. **`overdueJobs` limits:**
   - `count` is capped at 200, and silently.
   - If the oldest 200 late rows are all `behind`, a stranded job at row 201 is not seen.
   - A stale-locked `running` job (a killed worker) is never overdue, and it now also hides its session's later queued jobs, which used to raise the alarm.
   - Task 11.2 (health) could add the stale-running count.
4. **Stale earlier text in plan note (Task 0.4).** The pre-round-2 note still says:
   - "a second consecutive `DeadlineError` counts"
   - "a drain that cannot hand on … claims until its whole budget"
   - "`Idempotency-Key: alert:<id>`"

   The appended "Fix round 2 (decided)" line supersedes the first two, and states the new key. A reader must reach the end.
5. **C-0493's criterion row** (`criteria/04-ingest.md:100`) still reads unconditionally. It could carry the fresh-worker exception the way C-0485's row was reworded.

## Verdict

All four findings are ADDRESSED.
- The Important is fixed at its root:
  - one shared refusal constant
  - a claim cutoff 20 s ahead of it on every drain
  - a lack-of-budget refusal that never counts
- The reviewer's reproduction is now a passing test.
- C-0493's then-clause is asserted, not weakened.
- Task 0.6's capture calls are intact.

One new Minor, which is latent: an ask-deadline refusal is reclaimed within the same drain.

**Round verdict: Approved (all findings addressed; one new latent Minor, no Critical or Important).**
