# Pickup — Call build, stopped 2026-10-31 for the week

Nothing was lost. Everything built so far is in git on `claude/call-phone-agent-build-f50v1t`:
merged work in the branch itself, unmerged work in `handoff/held-branches.bundle`, and the
orchestrator's ledger, briefs, reports and reviews in `handoff/sdd/` (the ledger is
`handoff/sdd/progress.md` — every ruling, deferred minor and open finding is there).

## Where it stands

| Phase | State |
|---|---|
| 0 (Tasks 0.1–0.6) | All six tasks built, reviewed, fixed and approved. Phase review done; its fix wave is committed (`2483d4d`, 266/266 tests with capture off and on, every CI check green). **Open:** a scoped re-review of that fix wave, then the Phase 0 PR into `main`. |
| 1 (1.1–1.3) | 1.1 migrations and 1.2 seeds built and reviewed (held line). **Open:** the 1.1 SQL follow-up (`claim_job` 120 s lock + per-session order + forget-first; `jobs.session_id ON DELETE CASCADE`; incidents `alert_level` + five-argument `bump_incident`; `audit_log` UPDATE for the alert record), the 1.2 fix round (product `scope`, paged catalogue reads, mode-specific recording disclosure), a Postgres service in CI, then 1.3. The Phase 1 PR must not merge without the SQL follow-up. |
| 2 (2.1–2.4) | 2.1 figures: 4 fix rounds done, round 5 (last) open — apply `handoff/scratch/rr4/mut-M.diff`. 2.2 redaction: round 1 done, round 2 open (Critical: comma lists of space-thousand amounts cut and redacted). 2.4 distress: round 1 done, re-review open. 2.3 facts not started. |
| 4 | 4.1 fixtures (40 conversations) built and reviewed; fix round open (I1–I7 in the ledger). |
| 3, 5–12, excellence round | Not started. |

`main` holds only the planning commit so far. CI on the build branch is green at every push.

## Restore (first thing next session)

```bash
git fetch origin claude/call-phone-agent-build-f50v1t
git checkout claude/call-phone-agent-build-f50v1t
git bundle verify handoff/held-branches.bundle
git fetch handoff/held-branches.bundle 'refs/heads/*:refs/heads/held/*'
mkdir -p .superpowers/sdd/2026-10-31-call-build
cp handoff/sdd/*.md .superpowers/sdd/2026-10-31-call-build/
```

Held branches after the fetch (`held/…`):

| Branch | Holds | Based on |
|---|---|---|
| `held/worktree-agent-af717e642491c9efb` | Phase 1: 1.1 migrations `01309e9` + 1.2 seeds `ff1c1a7` | `dc8fbb4` |
| `held/worktree-agent-a1b7e2a99b6868e64` | Phase 2: 2.1 figures through round 4 `09e0348` (595-row corpus test) | `67fd21d` |
| `held/worktree-agent-a66f9e1068ad25456` | Phase 2: 2.2 redaction + round 1 `76a992e` | 2.1 round 1 `0ebc6b4` |
| `held/worktree-agent-ab827ef619f00fed9` | Phase 2: 2.4 distress + round 1 `f967be0` (242-row corpus) | 2.1 round 2 `250b8b2` |
| `held/worktree-agent-a33665a7581c0e1ee` | Phase 4: 4.1 fixtures `f823771` | 2.1 round 3 `ba50e90` |
| `held/worktree-agent-abc7d47294f0d4607` | 2.1 rounds 1–3 (an ancestor of `a1b7…`; kept for completeness) | |

Local Postgres for the migrations test: `pg_ctlcluster 16 main start`, then user `postgres`,
password `postgres` (set it with `ALTER USER`), database `call_test` on 127.0.0.1:5432, and
`TEST_DATABASE_URL` built from those.

Remove `handoff/` (`git rm -r handoff`) in the commit just before opening the Phase 0 PR, once the
held branches are restored locally; recreate it the same way at any later stop.

## The queue, in order

1. Scoped re-review of the Phase 0 fix wave (`phase-0-review.md` findings vs `phase-0-fix-report.md`, diff `5c8af24..2483d4d`). Then the Phase 0 PR into `main`, merge commit, on green CI; then `git checkout -B claude/call-phone-agent-build-f50v1t origin/main`.
2. Phase 1: merge the held Phase 1 line in; one executor does the 1.1 SQL follow-up + 1.2 fix round + the CI Postgres service (all rulings in the ledger); then 1.3; phase review; PR; merge.
3. Phase 2: 2.1 round 5 (the patch + Minor `figures.ts:770`); 2.2 round 2 (N1, N2, pin the reviewer's corpus); re-review 2.4 round 1; merge the three lines; then 2.3 facts (rulings R20, R21; carries in the ledger: `figure_scaled`, C-0525, C-0549's owes/informal half, `IDENTIFIER_WORDS`, `redactJsonStrings`). Phases 2 and 3 share one gate: a single PR after Task 3.5.
4. Phase 3, then Phase 4 (4.1 fix round first; add C-1431/C-1432 to Task 4.2's brief), and on through Task 12.4.
5. The excellence round (BEHAVIOR-MATRIX A23), the final whole-branch review, and the orchestrator's own end-to-end walk.

## Efficiency rules for the next run (decided at the stop, to save credits)

- Pin a reviewer's probe set as a table-driven test in the same fix round that fixes it. The regex-heavy parsers (figures, redact, distress) regressed until their probe sets were pinned.
- Reviewers write their full review to a file and reply in ≤ 10 lines. Minors go to the ledger unless the phase reviewer says fix now.
- A fix round whose findings are all Minor gets no separate re-review; the phase reviewer covers it.
- Two executors at once, never three. Phase-pure work runs in the main checkout. A second executor takes the next phase's independent task in a worktree.
- Briefs point at files and say only what a file cannot.

## The prompt to paste next week

> Continue building Call in `ckchirongoma/call` from where the last session stopped, all the way to
> the end. First read `handoff/PICKUP.md` on branch `claude/call-phone-agent-build-f50v1t` and
> follow it: restore the held branches and the ledger, then work the queue in order. Everything in
> `docs/BUILD-PROMPT.md` still binds, and so do the founder rules recorded since: every agent you
> spawn runs on Opus 5.5; two executors at a time; decide, don't ask (ask only before money,
> production numbers, Meta verification or real client data); never ask me to test. After Task
> 12.4, run the excellence round (BEHAVIOR-MATRIX A23). Then walk the whole end-to-end cycle
> yourself, and merge every phase into `main`. Use the efficiency rules in PICKUP.md. Reply only
> at the end, briefly.
