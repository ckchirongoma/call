# Task 0.4 report: queue, tracking, alerts, email

**Status:** DONE_WITH_CONCERNS (all the brief's criteria are tagged and green; the concerns below are decisions for the orchestrator to confirm, not failures).
**Commit:** `67fd21d` Port the job queue, tracking, alerts and email sender (branch `claude/call-phone-agent-build-f50v1t`, not pushed).

## TDD

**RED** (tests written first, run before any implementation existed):

```
$ TRACKING_OFF=1 node --experimental-strip-types --import ./scripts/register-ts.mjs --test test/queue.test.ts test/alerts.test.ts
# Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/home/user/call/api/_lib/queue.ts' imported from /home/user/call/test/alerts.test.ts
# Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/home/user/call/api/_lib/email.ts' imported from /home/user/call/test/queue.test.ts
# tests 2
# pass 0
# fail 2
```

**GREEN** (focused, then the whole suite in both modes):

```
$ TRACKING_OFF=1 node ... --test test/queue.test.ts test/alerts.test.ts
# tests 44
# pass 44
# fail 0                      (5 consecutive runs: 44/44 each)

$ npm run typecheck           → clean
$ npm test                    → # tests 171  # pass 171  # fail 0
$ npm run test:intel          → # tests 171  # pass 171  # fail 0
$ npm run grep-models         → No hardcoded model slugs under api/
$ npm run criteria -- --check --matrix → 1337 criteria, 72 tagged, 0 unknown tags; matrix cites all present
$ npm run criteria -- --missing | grep <this task's ids>
  C-1607 (Task 11.1), C-0487 and C-1609 (Task 8.8): owned by those tasks in the plan
```

**Mutation check.** Each change below was applied, the two files were run, and the change was reverted. Every one was caught:

| Mutation | Failing tests |
|---|---|
| claim_job without the per-session order | C-1600, C-0499/C-1601, C-0491/C-1606 |
| no heartbeat | C-1599 |
| enqueueNext not buffered | C-1608 |
| first DeadlineError counted | C-0493/C-1505 |
| no 5-minute gap | C-1541 |
| self-calls ignore TRACKING_OFF | C-1552 |
| finishJob not fenced by worker | C-1598 |
| no session-gone skip | C-0491/C-1606 |
| fake lock timeout 300 s | C-1597/C-0489, C-1598 |
| no 30-minute same-problem cooldown | C-1550 |

The first round exposed two weak tests, and both were fixed before the commit. C-0499 had not stressed the order rule, so its jobs are now queued session by session. In C-1598 and C-1599, a failed assertion left the handler gate shut and the process hung, so the gates now open in `finally`.

## Files

Created:
- `api/_lib/queue.ts`: a port of Charlie's `queue.ts`, with Charlie's `db.ts` job helpers and `chain.ts` folded in.
- `api/_lib/alerts.ts`: the immediate email.
- `api/_lib/email.ts`: `sendEmailTo`, `sendEmail`, `alertsConfigured`, `alertRecipients`, `escHtml`, `SANDBOX_FROM`.
- `api/worker.ts`
- `test/queue.test.ts`: 28 tests.
- `test/alerts.test.ts`: 16 tests, covering alerts, the `email.ts` sender and `track.ts`.

Modified:
- `test/_fakes.ts`: `claim_job` now has a 120 s lock timeout and never hands out a job ahead of an earlier queued or running job of the same session.
- `test/fakes.test.ts`: timings adjusted to the 120 s timeout (exactly 120 s is not stale), plus one new test for the per-session shape.
- `vercel.json`: `"api/worker.ts": {"maxDuration": 300}`.
- `api/health.ts`: adds `alerts: "configured"|"unconfigured"` (C-1548).
- `docs/VERIFIED.md`: a row for the Resend send API, marked "from knowledge, not fetched".
- The plan: Task 0.4's boxes are ticked and a Notes paragraph is added, including "For Task 1.1" items (13) and (14).

`track.ts` needed no change. `db/` was not touched.

## Criteria tagged

- `test/queue.test.ts`: C-0485, C-0486, C-0488–C-0499, C-1597–C-1606, C-1608, C-1610, plus C-1505 and C-1511 (the queue side: requeued, and retried with backoff).
- `test/alerts.test.ts`: C-1541, C-1548, C-1550, C-1552.
- Not tagged, because the plan gives them to other tasks: C-0487 and C-1609 (Task 8.8, the admin retry) and C-1607 (Task 11.1, retention).

## Decisions

All of these are recorded in the plan notes.
- **`enqueue` and `enqueueNext`:**
  - `enqueue` returns the job id as a string.
  - A duplicate dedupe key is a no-op. The exception is a `failed` job, which is revived once (C-0488).
  - `enqueueNext` writes a step's successor only after the step returns and only while the attempt still owns its job (C-1608).
- **Handlers:** `registerHandler` returns an undo. `api/worker.ts` must import every handler module (from Task 3.4 on).
- **Other exports:** `fenceCheck` lives in `queue.ts`. `kickWorker` is for Task 3.3's kick.
- **`DrainReport`** also carries `skipped`.
- **Moves that do not spend an attempt:**
  - a busy session (held for 5 s)
  - a `JobHoldError`
  - the first `DeadlineError`
  - A second `DeadlineError` in a row counts, so a job that never fits cannot loop.
- **Failing for good:**
  - A job reclaimed with attempts > 3 is failed without running.
  - An unknown kind is failed at once: `unknown_kind` with an incident (error).
  - A job whose session is gone (in `session_id` or `payload.session_id`) is `skipped`; `forget_client` is exempt.
- **Lanes and self-calls:**
  - 3 lanes per drain, each with its own fencing token.
  - The hop cap is 2.
  - `TRACKING_OFF=1` turns off every self-call.
  - Charlie's watchdog, overrun guard and long-job deferral were not ported.
- **Worker:**
  - Bad auth answers 401 with `WWW-Authenticate` (Charlie answered 403).
  - `?tick=1` drains and answers the report plus `alerts`.
  - Every drain ends with `runAlerts()`, because the cron runs only once a day.
- **Alerts:**
  - There is no alert-level column and no `alert_state` table, so severity decides: error or critical goes out at once.
  - Each email sent is one `audit_log` row (`action=alert_email_sent`, `after={kind, subject, provider_id, incidents:{fingerprint: count}}`). That row drives the 5-minute gap, the 60-a-day cap and the 30-minute same-problem cooldown (after which a problem is re-sent only if it grew).
  - The digest and the daily summary are left to Task 11.3.

## Concerns

1. **The 300 s backoff step is never used.** C-0485 lists the 10/60/300 s backoffs, but C-0486 ("3 failures → failed"), the brief and B4 together fix 3 attempts, so a job fails on its third failure. 300 s is the ceiling in `retryDelaySeconds`. If 300 s was meant to be used, the job needs 4 attempts, and the criteria then disagree.
2. **Some digest-level incidents will be emailed immediately.** Because severity decides, a caller that passes `severity: "error", alert: "digest"` gets an immediate email. Today that is `models.ts` `role_missing` and a non-retried `model_call_failed`. The alternative is an `alert` column plus a `p_alert` argument on `bump_incident`, which I did not add because the brief fixed the incidents semantics. Task 11.3 may want to revisit this.
3. **Task 1.1, running in parallel, must write `claim_job` to note (13).** That means the 120 s timeout, the per-session order over queued and running jobs, and the `jobs (session_id, id)` index. The 4-argument `bump_incident` is unchanged. Please forward this to that worktree.
4. **Files outside my list were touched, small changes only.** `api/health.ts` (Task 11.2's file) gained `alerts` for C-1548. The `audit_log` table now carries system rows (`broker_user_id` null) that Tasks 8.x audit views will see.
5. **The Resend send fields and the `Idempotency-Key` header come from knowledge, not a fetched page.** The VERIFIED row says to confirm them on the first live send.

## Fix round 1

**Status:** DONE. **Commit:** `7222606` Queue: forget first, skip orphaned jobs, alert levels, in-run retries (not pushed). Every ruled finding is fixed. Minor 1 is deferred, as ruled.

### Per finding

| Finding | Change | Covering tests |
|---|---|---|
| I1: forget first | The fake's `claim_job` claims a runnable `forget_client` before anything else and never holds it behind its session. `enqueue("forget_client", s, p)` writes `session_id` null and moves `s` into `payload.session_id`. With CASCADE, a forget job tied to a session would delete itself, and once that session is gone its insert would break the FK. The plan notes say `forgetClient()` (Task 3.4/8.7) cancels every queued job of the client's sessions before it deletes them. | fakes: "a runnable forget_client job is claimed before anything else…"; queue: "forget_client is never held by per-session order… send_quote deferred to tomorrow…" |
| I2: CASCADE | The fake now deletes a session's jobs when the session is deleted. `stillOwnJob` returns false for a missing row, so a running job is fenced. A job that still names a gone session is `skipped`, including one whose row went with its session after the claim (`jobGone`), and carries the 0.6 lifecycle marker. The plan's SQL contract (15) has `ON DELETE CASCADE`. | fakes: "deleting a session deletes its jobs…"; queue: `[C-0491][C-1606]` rewritten, plus a new `[C-0491]` test where the running step is fenced and writes nothing |
| I3: alert levels | Adds `incidents.alert_level` (types.ts, fake columns, default `digest`). `bump_incident` takes `p_alert_level` and keeps the loudest level. `track()` passes the caller's hint, falling back to severity. The immediate email selects `alert_level='immediate'`. The new `runDigest` runs only on `?tick=1`, at most once per 20 h, and sends digest-level incidents that are new or grew. `none` never emails. The C-1550 test now uses an immediate-level fingerprint, per C-1543. `models.ts` already passed `alert:"digest"` for `model_call_failed`, so it is now a digest and needs no code change. The SQL contract is in (15). | fakes: "the alert level is the caller's…"; the five-argument signature test; the defaults test; alerts: `[C-1550]`, "the caller's alert level decides…", "a model call that fails on every model is a model_call_failed digest…" |
| I4: in-run retries, overdue | `DrainOptions.waitForDue` replaces `waitForDueMs`. Lane 0 waits in-process for the next job due before claimUntil, even after claiming, through the injectable `__setSleep`. The hand-on and the tick set it; the sweep does not. `canHandOn` now includes `mayWakeWorker()`, so the deepest worker uses its whole budget. `overdueJobs()` and `noteOverdueJobs()` raise `job_overdue` (error, immediate) first in every worker run. | queue: "waiting for due work, one run sees a job through its 10 s and 60 s retries…", "the deepest worker…", "the tick and the hand-on wait in-process…", "a queued job more than 10 minutes past its time raises job_overdue…" |
| I5: machinery failures | `DrainReport` gains `ok` and `errors`. A failed claim raises `claim_job_failed` (critical), an unsettleable job raises `job_unsettled:<kind>` (error), and a failed hand-on raises `hand_on_failed` (warn). The sweep and the tick answer 500 with the report. In the fake, an rpc now answers its table's `failTable()` error. | queue: "a claim_job that fails… 500 {ok: false}", "job_unsettled…", "hand_on_failed…"; fakes: "claim_job reads jobs…" |
| Minor 2 | C-0485 now reads "(10 s, then 60 s; a third failure is final per C-0486)". `BACKOFF_SECONDS` stays `[10, 60, 300]`, with a comment that the third step serves kinds allowed more attempts. | existing `[C-0485][C-1511]` (text change only, so no new red) |
| Minor 3: fenced settles | `holdJob` (worker now required), `scheduleRetry` and `touchJob` are conditional on `locked_by` and `status='running'`, and return whether they wrote. A zero-row settle is counted `fenced`, with no `job_retry` or `job_failed`. This includes the last attempt's `finishJob`. | queue: "a settle fenced between the ownership check and its write…" (retry, last attempt, hold) |
| Minor 4: traces | A heartbeat that errors or finds its lock taken raises `job_heartbeat_failed:<kind>` (warn), once per attempt. An unreadable `otherJobRunningFor` raises `session_check_failed` and counts as busy. | queue: "a heartbeat that fails, or finds its lock taken…", "an unreadable session check counts as busy…" |
| Minor 5: one email | The alert record is the claim. Its id is `slotId(kind, prev)`, derived from the record it follows, so concurrent passes collide on the PK and exactly one sends. | alerts: "two alert passes at once send one email…" |
| Minor 6: bounded resend | The record is written before the send as `sending`, then marked `sent` or `failed`. A `sending` row counts as sent. The send carries `Idempotency-Key: alert:<id>`, and `sendEmail` now takes `idempotencyKey`. | alerts: "an alert email is on the record before it is sent…"; the "failed send" test was updated |
| Minor 7: new, not lifetime | History is read per kind: the newest 500 rows, whatever their age. "N new" counts from the last email that carried the incident. When that email is older than the rows read, the line says "seen again". | alerts: "an incident last emailed days ago reports what is new…" |
| Minor 8: tail | `HARD_STOP_MARGIN_MS` is 10 s (hard stop 250 s) and `SELF_CALL_TIMEOUT_MS` is 5 s. The new exports are `VERCEL_KILL_MS`, `FLUSH_TIMEOUT_MS` (track.ts), `SEND_TIMEOUT_MS` (email.ts) and `ALERT_PASS_MAX_MS` (alerts.ts). The worst case is 250 + 4 + 10 + 28 = 292 s, under the 295 s limit (kill minus 5 s). | queue: "the tail after the hard stop fits inside Vercel's 300 s kill…"; the self-call timeout assertion in the hop test |

### Commands and output

RED. Tests were written first and run against the unchanged code.
- alerts and fakes: 14 failures, each for the right reason:
  - `alert_level` was undefined
  - concurrent passes sent 2 emails, not 1
  - there was no Idempotency-Key
  - "4 new" appeared where "3 new" was expected
  - `bump_incident` refused `p_alert_level`
  - the forget job was not claimed first
  - jobs did not cascade
- queue: run as a shimmed copy, because the new imports did not exist yet. 14 of 43 failed, each for its reason:
  - the cascade did not delete the queued step
  - the running job survived its session
  - the claim order put `extract` first
  - the fenced settles were counted as failed or held
  - there was no heartbeat incident and no session-check incident
  - `ok` was undefined in three tests
  - three tests failed on `__setSleep is not a function`
  - one failed on `overdueJobs is not a function`
  - the tail test failed: `SELF_CALL_TIMEOUT_MS` was undefined
- The three wait tests failed on the missing seam. Each fix that went red only that way was mutation-checked after green: it was reverted, the tests were run, and the revert was undone. Each revert was caught:
  - `waitForDue` forced off: 3 tests failed
  - `canHandOn` without `mayWakeWorker`: the deepest-worker test failed
  - immediate selected by severity: 2 tests failed
  - `stillOwnJob` true on a missing row: the fenced-mid-step test failed

GREEN:
```
focused (queue + alerts + fakes)  # tests 123  # pass 123  # fail 0   (queue+alerts 5 consecutive runs: 62/62)
npm run typecheck                 clean
npm test                          # tests 205  # pass 205  # fail 0
npm run test:intel                # tests 205  # pass 205  # fail 0
npm run criteria -- --missing     of this task's ids only C-0487, C-1609 (Task 8.8) and C-1607 (Task 11.1), as before
npm run grep-models / grep-doc-css / preview-quote --smoke   all exit 0
```
`npm run verify` exits 1 only at `criteria --check`, because 1,263 criteria are still untested. It exits 1 the same way at HEAD d8003a2, so this change did not cause it.

### For the orchestrator
- **The Task 1.1 follow-up must write the SQL that plan note (15) and the amended (13) describe:**
  - `jobs.session_id ON DELETE CASCADE`
  - `incidents.alert_level` with its CHECK and default `'digest'`
  - the five-argument `bump_incident`, which keeps the loudest level; drop the four-argument signature and change its grants
  - `claim_job`: forget first, and forget exempt from the session condition
  - `audit_log.id` accepts an explicit uuid
- **Merging with 1.1's branch:** this commit changes `test/_fakes.ts` (columns, defaults, RPCS gains `reads`, the cascade) and `types.ts`. 1.1's `SCHEMA` export and `rls.test`/`migrations.test` comparisons need the new column and signature.
- **New behaviour for later tasks:**
  - The digest goes only on `?tick=1`.
  - The sweep (`POST /api/worker`) does not wait for due work.
  - A `forget_client` job never carries `session_id`; the session is in `payload.session_id`.

## Fix round 2

**Status:** DONE. **Commit:** `0721dc1` Queue: stop claiming before the model cutoff (on top of 9e0ad8c; not pushed). Task 0.6's capture calls in `queue.ts` and `models.ts` are intact. The only change to `models.ts` is that its refusal constants now come from `jobctx.ts`.

### Per finding

| Finding | Change | Covering tests |
|---|---|---|
| Important: claims into the refusal window | `jobctx.ts` now holds `MIN_CALL_MS`, `WRAP_UP_MS` and `MODEL_REFUSAL_MS`, which is their sum and is where `models.ts` refuses a call. `queue.ts` adds `STEP_LEAD_MS` (20 s) and `CLAIM_CUTOFF_MS` = `MODEL_REFUSAL_MS + STEP_LEAD_MS`. Every drain's `claimUntil` is now `min(…, hardStop − CLAIM_CUTOFF_MS)`, which is 205 s by default, and the waiter's `left` uses the same cutoff. A `DeadlineError` counts as an attempt only when the attempt started within `FRESH_ATTEMPT_MS` (60 s) of its drain, because then the job had a whole worker and does not fit. In a later attempt it is lack of budget, and it never counts. That replaces the old rule that the second refusal in a row counts. | queue: the reviewer's reproduction, "[C-0493] a worker that cannot hand on stops claiming before model calls are refused…". A job reached at 230 s stays queued with its attempts unspent. A job claimed at 200 s and refused at 230 s is held and not claimed again. Neither raises `job_failed` or makes a model call. The C-0493/C-1505 test was rewritten from `hardStopMs: 1`, which no longer claims. It now covers a late refusal held twice and a fresh-worker refusal that counts. A constants test pins `CLAIM_CUTOFF_MS − MODEL_REFUSAL_MS ≥ STEP_LEAD_MS`. |
| Minor: overdue counts blocked work | `overdueJobs()` reads up to 200 late queued jobs and applies claim_job's session rule: a job behind an earlier queued or running job of its session is excluded (forget_client never is). It now returns `{count, oldest, behind}`. | queue: "job_overdue counts only work claim_job could hand out…" (a step behind a send deferred to tomorrow gives count 0 and no incident; a truly stranded job gives count 1). The two existing overdue assertions gained `behind: 0`. |
| Minor: heartbeat blames another worker | A beat that touches no row reads the row (`whyLockLost`). A missing row raises `job_orphaned` with reason `deleted_with_session`. Status `cancelled` raises `job_orphaned` with reason `cancelled`. Both are behaviour events, not incidents. Anything else is `job_heartbeat_failed` as before. | queue: "a heartbeat whose job was deleted with its session, or cancelled, reports it so…" |
| Minor: alert key never repeats | The key is now `alert:<kind>:<sha256 of the sorted fingerprint:count pairs>`. The same alert sent again, after a timeout on a send that went, gets the same key. New content gets a new key. The comments in `email.ts` (`sendEmail`) and the `alerts.ts` header are corrected. | alerts: "an alert email's idempotency key is the alert's own…" (the first send throws after delivery, the second pass uses the same key, and Resend delivers once; a new problem gets a new key). The round-1 test's key regex was updated to the new shape. |

### Commands and output

RED. Tests were written first and run against `9e0ad8c`'s code. The queue file was run as a shimmed copy, because `MODEL_REFUSAL_MS` was not yet exported.
- alerts, 1 failure: "under the same key" (`alert:64034c52…` !== `alert:d7105c15…`).
- queue, 6 failures:
  - the reproduction: `only the first job: 3 !== 1`, so the late job was claimed
  - C-0493 rewrite: `failed: 1, held: 0`, so the second late refusal counted
  - heartbeat: timed out waiting for `job_orphaned`
  - overdue: `count: 1`, `behind` undefined
  - constants: `CLAIM_CUTOFF_MS` undefined
  - existing overdue: `behind` missing

Mutation check after green: each fix was undone, the tests were run, and the fix restored. Each undo was caught:
- no claim cutoff: the reproduction failed
- the old "second in a row" rule: the C-0493 test failed
- overdue counting blocked jobs: the overdue test failed
- heartbeat always `lock_lost`: the orphaned test failed

GREEN:
```
focused (queue + alerts + models + fakes)  # pass 168  # fail 0   (3 consecutive runs)
npm run typecheck                          clean
npm test                                   # tests 250  # pass 250  # fail 0
npm run test:intel                         # tests 250  # pass 250  # fail 0
npm run criteria -- --missing              of this task's ids only C-0487, C-1609 (Task 8.8) and C-1607 (Task 11.1), as before
npm run grep-models                        No hardcoded model slugs under api/
```

### Notes
- The re-review's out-of-scope observations go to the orchestrator; none were acted on here:
  - C-1412 and CASCADE (Task 8.7): assert on the cancel write or an audit row.
  - The Task 1.1 follow-up needs UPDATE on `audit_log` for the alert record.
  - No cron sends the digest yet.
  - Rewording the text of C-0491.
- The plan notes have a "Fix round 2 (decided)" line for the constants, the freshness rule, `behind`, `job_orphaned` and the alert key.
