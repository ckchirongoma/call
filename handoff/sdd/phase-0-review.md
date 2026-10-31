# Phase 0 review (fcd4384..5c8af24, Tasks 0.1–0.6)

Scope: I read the whole phase against SPEC §0 (R1–R16), BEHAVIOR-MATRIX Part A (A1–A23), Part B rows B4 (last row), B12 and B13, the Capture map rows for 0.3, 0.4 and 0.6, and the plan notes for Tasks 0.1–0.6. I read every file under `api/`, plus `.env.example`, `test/_env.ts`, the contract-bearing parts of `test/_fakes.ts`, and the redaction and timing tests. Probes were run from a scratchpad and touched nothing in the repo. HEAD is `5c8af24`; the tree is clean.

### Verdict

**Needs a fix wave.** It is small:
- 2 Important findings: one redaction defect that would reach `turns.text`, and test fixtures that break the repo's literal rules.
- 4 deferred Minors to fix now. They are cheap, and three are in files the wave touches anyway.
- Plan-note carries, so later tasks do not lose what this phase knows.

No Critical findings. CI on a clean checkout would be green today. Every check is listed at the end.

Everything else holds:
- The contract file is byte-identical to Charlie's.
- No model slug outside `HARD_FALLBACKS`, which matches Charlie's list exactly. No model identifier appears in code or tests.
- Every relative import ends in `.js`, and every ported file is attributed.
- Every Phase 0 criterion is tagged, except the three that are knowingly carried: C-0487 and C-1609 to 8.8, C-1607 to 11.1.
- `npm test` and `npm run test:intel` both pass 263 of 263.

### Drift

| Rule | Where | What drifted | Put back by |
|---|---|---|---|
| INTEL-CONTRACT §4 rule 4 ("money and dates stay"), R16, SPEC 7.2 via C-1743 | `api/_lib/intelredact.ts:161`, `:163`, `:170`, `:190` | Money ranges are read as phone numbers or long numbers (Important I-1). | the fix wave |
| Global Constraints, A11/A12, executor-context "Secret-shaped test values" | `test/intel-redact.test.ts:125–130`, `:357–359`, `:376`, `:378`; `test/security-static.test.ts:522`, `:525`; `api/_lib/intelredact.ts:159` | Credential-shaped literals, and phone numbers outside `+2779993xxxx` (Important I-2). | the fix wave |
| INTEL-CONTRACT §4 rule 1 ("rows are serialised at capture"), SPEC §16 ("Call's adaptations are INTEL-PHASE0 §3") | `api/_lib/intel.ts:88`, `:320–326`; `docs/INTEL-PHASE0.md` §3 | Content over the inline bound is held by reference and serialised at the flush. This is accepted, but undocumented at the call-site doc and in §3, which still says "additive only". | the fix wave (doc only) |
| R13/R16, C-1723 ("every safety_events write → a check row"), Ruling R22 ("one writer of safety_events") | `api/_lib/models.ts:612` `noteFallback` | A second `safety_events` writer, with no `check` capture. Task 6.2's text does not mention it. | plan note now; code in Task 6.2 |
| C-1744 (declined consent → every row meta) | `api/_lib/queue.ts:991`, `:1010`, `:1026` (before `sessionOf` at `:1036`) | `worker_died`, `unknown_kind` and `session_busy` rows are captured before the session's `contentMode` is known, so they are full rows in a declined trace. The re-reviewer flagged this out of scope. | plan note now; test and fix in Task 3.4 |
| A14/R5 ("no model identifiers in anything pushed") | `BEHAVIOR-MATRIX.md:18` (A1), commit `de2f40f` subject | Both name "Opus 5.5". This is the founder's own instruction text, a product name rather than an identifier, and "(Opus 5.5)" was already in the planning commit. | Accepted. Do not rewrite history; keep the PR description free of it. |
| A17, CLAUDE.md, plan reviewer template | `BEHAVIOR-MATRIX.md:34`, plan line ~84 | These cite "R1–R15", but SPEC §0 now has R16. This was there before the phase. | any doc pass (Minor) |

No drift in:
- R9 (no in-call sleeps; the backoff belongs to the job).
- R10.
- R13 (`guardrails_live: false` said plainly).
- R15 (`forgetIntel` tombstones before it waits, follows `job_enqueued` links, and drops buffered rows).
- B4's last row (three attempts, 10 s/60 s, `failed` with `job_failed`; recorded in the C-0485 edit).
- B12 model, fencing and verification rows.
- B13 core rows.

### Issues

#### Critical

None.

#### Important

**I-1. Contact and number redaction eats money ranges, including in `redactContacts()`, the rule `turns.text` is meant to use (C-1743).**

Where:
- `api/_lib/intelredact.ts:163` (`PSEP` admits ` - `, ` – `, `)`) and the SA phone rule at `:170`.
- `:161` (`SEP` admits ` - `, ` – `, `/`, `(`, `)`) and the 9+ digit rule at `:190`.

What a probe on HEAD gives:

| Input | Function | Result |
|---|---|---|
| `cover R1 000 000 - 2 000 000` | `redactContacts` | `cover R1 000 [contact]` |
| `family cover 1 000 000 - 3 000 000 rand` | `redactContacts` | `family cover 1 000 [contact] rand` |
| `options 1 500 000 – 2 000 000` | `redactContacts` | `options 1 500 [contact]` |
| `R100 000 - 200 000` | `redactText` | `R100 [number]` |
| `R150 000/200 000` | `redactText` | `R150 [number]` |
| `R150 000 (200 000 with spouse)` | `redactText` | `R150 [number] with spouse)` |
| `income 20 000 - 25 000` | `redactText` | `income [number]` |
| `I earn 25 000 - 30 000` | `redactText` | `I earn [number]` |

Why it is Important:
- Task 0.6's re-reviewer graded N-1 a training-data regression. It is more than that: `redactContacts` is exported as the one rule for SPEC 7.2's turn redaction.
- The plan carry says Tasks 2.2 and 3.4 must call it. Once they do, a client's stated cover range disappears from `turns.text`.
- `turns.text` is what `extract_facts` reads and what every fact's backing turn is (R2).
- Phases 2 and 3 would be built on a rule that destroys fact-find data.

Fix:
- Treat a spaced dash, en-dash, slash or bracket as a break between groups. Join across it only when both sides are phone-shaped or card-shaped: a leading `0`/`+27`/`(0`, or 4-digit groups.
- Keep `(079) 993 0000`-style brackets only when they lead the number.
- Add every string above to `[C-1740]`. Assert `redactContacts` on the three cover ranges.
- Keep the I-2 cases from the 0.6 fix round green: `(079) …`, dots, `+27 (0)…`, double spaces.

**I-2. Test fixtures break the repo's own literal rules.**

The executor context says: "Never write a literal that looks like a real credential in any file — not even a fake one in a test." It names JWTs (`eyJ…` three-part), `sk-…`, PEM blocks and `sb_publishable_…`. The Global Constraints and A11/A12 also say test phone numbers come only from `+2779993xxxx`.

What is in the tree:
- `test/intel-redact.test.ts:125`: a three-part JWT. It decodes to `{"alg":"HS256"}.{"sub":"demo-client"}`.
- `:126`: `sk-or-v1-…`, OpenRouter's key shape.
- `:127`: `sk_…`, 40 characters.
- `:128`: `xi-…`.
- `:129`: a `[PEM private-key header]` block.
- `:130`: a `postgres URL with an embedded user and password…` with a password.
- `test/security-static.test.ts:522`: a JWT-headed literal (`eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.x`).
- `test/security-static.test.ts:525`: `sb_publishable_…`.
- Phone numbers outside the test range: `(079) 993 0000`, `079.993.0000` and `+27 (0)82 123 4567` at `test/intel-redact.test.ts:357–359`, `:376` and `:378`, plus `079.993.0000` in the comment at `api/_lib/intelredact.ts:159`.

Why it is Important:
- Task 0.6's amend fixed only the two `sb_secret_` literals, because push protection blocked them.
- The rest passed push protection, but they are exactly the shapes secret scanning and gitleaks flag. They would sit on `main` once this merges.
- `079 993 0000` is a plausible live Vodacom number.

Fix:
- Build every credential-shaped value from parts at runtime, e.g. `["eyJhbGciOiJIUzI1NiJ9", "eyJzdWIiOiJkZW1vIn0", "sig".repeat(12)].join(".")`, `["sk", "or", "v1", hex].join("-")`, and the PEM markers joined from `"-----BEGIN "` + `"PRIVATE KEY-----"`.
- Use `(079) 993 0001`, `079.993.0001` and `+27 (0)79 993 0001` for the phone variants.
- Change the comment example to `079.993.0001`.
- Re-run C-1737, C-1739, C-1743 and C-1573.

#### Minor

**Fix now** (they also appear in the triage below):

- **m-A (0.6 N-2).** `api/_lib/intelredact.ts:182`. The PIN/OTP/code rule crosses up to 60 characters and accepts spaced digits, so `the promo code applies to premiums of R1 500 per month` becomes `R[redacted]`. Fix: allow only whitespace, line breaks, tags, `is` or `:` between the word and the digits, and stop at `R` or a currency sign. Pin it in `[C-1740]`.
- **m-B (0.6 m-5).** `api/_lib/intel.ts:223`. `TRACE_ID` accepts `wa_27799930001`. `trace_id` is never redacted (`toRow` passes it through), so a later entry point that builds a trace from a number would store it raw. Fix: accept only `s_<uuid>`, `job_<n>`, `r_`/`p_` + 16 hex and `t_` + 16 hex, or refuse any trace id with a run of 9 or more digits. Make it a one-line test under `[C-1714]` or `[C-1711]`.
- **m-C (0.6 re-review condition a/b).** `api/_lib/intel.ts:88` `CaptureOptions.content` should say that content over the inline bound (2,000 values or 256 K characters) is read at the flush, so a caller must not change it after `capture()`. Record it as a deviation from INTEL-CONTRACT §4 rule 1 in two places:
  - a row in `docs/INTEL-PHASE0.md` §3, so §3 is no longer "additive only" without saying so;
  - the Task 0.6 plan notes.

  The meeting segments (10.x) and catalogue (8.5) tasks must pass finished values.
- **m-D (plan-note carries; no code).** Add these to the plan notes in the fix-wave commit:
  - Task 6.2: route `models.ts:612` `noteFallback` through `recordSafetyEvent`, so its `check` row exists (C-1723, R22).
  - Task 3.4: C-1744's test must include a held, worker-died or unknown-kind row of a declined session. `queue.ts:1026` captures before `sessionOf`, `:1036`. The likely fix is to read the session first.
  - Task 10.2: `models.ts:1219` `trackFailure("transcription_failed")` has no `alert`, so it defaults to `immediate`. Every transient transcription outage pages at once, the noise Ruling I3 removed for `model_call_failed`. Pass `alert: "digest"`; the job's own `job_failed` is the immediate one.
  - Phase 1 follow-up: the summary at `models.ts:303` says "is db/0002 applied?", but the rows come from `db/0008_seed.sql` on the Phase 1 line.

**Can wait** (each named for its task):

- **m-E.** The capture mode is defined twice, and the two disagree:
  - `env.INTEL_CAPTURE` (`api/_lib/env.ts:112`) reads unset as `full` and ignores `TRACKING_OFF`.
  - `captureMode()` (`intel.ts:213`) reads unset with `TRACKING_OFF=1` as `off`.
  - `env.INTEL_CAPTURE` is unused in `api/`, but it is a trap for Tasks 8.8 and 11.2, which must report `intelStats().mode`.

  `CaptureMode` is declared in both files (`env.ts:37`, `intel.ts:76`). The `r_` trace id is minted twice: `track.ts:360` uses a sliced `randomUUID`, and `intel.ts:228` has `requestTraceId()`. `looksLikeBytes` is duplicated in `intel.ts:272` and `intelredact.ts:79`. Fold these together in Task 11.2.
- **m-F.** There are three contact maskers: `track.ts:136` `maskContacts`, `email.ts:78` `maskAddresses` and `intelredact.ts` `redactContacts`. The weakest, `maskContacts`, misses `(079) 993 0001` and `079.993.0001`. It guards `incidents.summary`, which outlives "forget me" (R15). Have `maskContacts` call `redactContacts` in Task 11.3. Reachability is low: summaries are built by code from errors.
- **m-G.** `npm test` is not capture-off everywhere. Tests that set `TRACKING_OFF=0` (`test/alerts.test.ts:88–361`, `test/queue.test.ts:771–1141`) make `captureMode()` return `full` even under `npm test`, so those tests run with capture on in both passes. C-1757 still holds, but the off/on contrast is narrower than the scripts suggest. In Task 12.5 (C-1756), have those tests pin the effective mode they found.
- **m-H.** C-1752 on this branch still reads "plus `created_at`", against Ruling R12 and the fake. The reword is already on the Phase 1 line and lands with the Phase 1 PR.

**Phase 1 PR gate** (not a Phase 0 fix): the held Phase 1 SQL, `worktree-agent-af717e642491c9efb:db/0006_platform.sql`, still has:
- `claim_job` with a 5-minute lock, no session order and no forget-first (lines 77–78);
- `jobs.session_id … ON DELETE SET NULL` (line 49);
- a four-argument `bump_incident` with no `alert_level` (lines 184 and 202).

Phase 0's `track.ts` calls the five-argument form. Against that SQL every incident would fail with PGRST202 and be lost behind one console line. The ledger already schedules the 1.1 follow-up. The Phase 1 PR must not merge without it, and the migrations test must run in CI (R19).

### Deferred-minor triage

| Task | Deferred minor | Decision |
|---|---|---|
| 0.1 | Minor 10: 4-line commit body (`f77f38d`; also `7222606`); `reloadEnv` naming | Won't fix. It is history, and the naming is fine. |
| 0.1 | Fake `rpc("claim_job", {p_worker: undefined})` accepted (prod: PGRST202); `->>` on nested JSON compares JSON text; digit keys read as object keys | Later: Task 1.1 follow-up, the fake/SQL alignment pass. No caller hits them today. |
| 0.2 | `crypto.ts:4` header omits `shortHash` from the not-ported list | Later: Task 3.3, or any doc touch. |
| 0.3 | `models.ts` `listAround`: an unclosed `[` in prose before a valid object is retried as truncated | Later: Task 4.2, when the first real JSON prompts' fixtures show whether models write such prose. |
| 0.3 | The role's own paid model gets a 402, then a `:free` model answers: no incident, only `safety_events` | Later: Task 11.3. Add a digest-level "running on free fallbacks: credit refused" threshold. |
| 0.3 | Review-1 Minor 5 (cost rounding per attempt), Minor 6 (loose no-sleep bound) | Later: Task 7.6 for costs. Minor 6 won't fix. |
| 0.4 | Minor 1: C-0494 idempotence shown only for stand-ins | Later: each step's own task (3.4, 4.2, 5.x, 6.x, 7.3) proves its own. |
| 0.4 | `queue.ts:1166`: a refusal from an ask's own `deadlineMs` in a late attempt is held with delay 0 and can be reclaimed by the same drain until `maxJobs` | Later: the first task whose job passes `deadlineMs` to `askJSON`. Tell an ask-budget `DeadlineError` from a job-budget one. Put a note under 4.2. |
| 0.6 | **N-1** money ranges redacted | **Fix now** (I-1). |
| 0.6 | **N-2** money after "code" removed | **Fix now** (m-A). |
| 0.6 | **m-5** trace id like `wa_<phone>` accepted | **Fix now** (m-B). One line, and it guards an unredacted column. |
| 0.6 | **Document the by-reference hold** of big content (`CaptureOptions.content`, plan notes) | **Fix now** (m-C), with an INTEL-PHASE0 §3 row. |
| 0.6 | m-7: `session_token=…` at the very start of a text is kept | Later: Task 8.1, which brings dashboard session tokens. Extend the key=value rule to start of text. |
| 0.6 | N-3: the flush blocks the event loop 0.4–0.7 s per big row | Later, before the first big-content producer in a shared process: Task 8.5 (catalogue upload) or 10.2 (meeting segments). Yield between rows in `write()`. |
| 0.6 | N-4: capture is O(n) for a Node `Buffer` (1 MB is about 15 ms p95, measured here) and for objects with very many keys | Later: Task 7.1, the first `send` row carrying a PDF Buffer. Flag bytes in `sizeUp` and hold by reference. |
| 0.6 | N-5: `MAX_BUFFER_BYTES` does not bound content held by reference | Later: with N-3 (8.5 or 10.2). |
| 0.6 | N-6 (re-review): a code after another number (`Your code (valid 10 minutes): 482913`) is kept by the text backstop | Later: Task 8.1. The login-code email must set `meta.kind`/name, and its test must assert kind-only (C-1741). |

### CI commands run and their results

Each was run once, on HEAD `5c8af24`, with Node v22.23.4. CI uses `setup-node` '22'.

| Command | Result |
|---|---|
| `npm run typecheck` | exit 0, clean |
| `npm test` | 263 tests, 41 suites, 263 pass, 0 fail, exit 0 |
| `npm run test:intel` | 263 tests, 41 suites, 263 pass, 0 fail, exit 0 (same counts: C-1757) |
| `npm run criteria -- --count --matrix` | 1337 total; "BEHAVIOR-MATRIX.md cites 1337 criteria, all present."; exit 0 |
| `npm run grep-models` | "No hardcoded model slugs under api/", exit 0 |
| `npm run grep-doc-css` | "No document renderers yet", exit 0 |
| `npm run preview-quote -- --smoke` | "no renderer yet (Task 6.4 adds it)", exit 0 |
| CI's relative-import grep (copied from `.github/workflows`) | no offenders |
| `cmp docs/INTEL-CONTRACT.md ../charlie/docs/INTEL-CONTRACT.md` | identical; sha256 `5060897a…baaf8` (C-1753) |
| Commit messages `fcd4384..5c8af24` | All 15 end with the two attribution lines. No other model name except `de2f40f`'s subject (see Drift). |
| Scan of the phase diff for secret shapes, emails and phone numbers | Findings in I-2. Every email is `@example.test` or Resend's `onboarding@resend.dev`. |
| `criteria --missing` intersected with Phase 0's ids | Nothing missing except the carried C-0487, C-1607 and C-1609. |

Capture timing headroom (probe, not CI): 1,000 captures with 50 KB prompts give p95 0.24 ms against the 5 ms bound, so the C-1701 tests are not a CI flake risk.
