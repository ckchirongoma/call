# Phase 0 fix wave — report

**Status:** DONE. Commit `2483d4d` (`2483d4dd12cc8e74dc3c30517bd661137d59d6cb`), "Phase 0 review: money survives redaction, no credential-shaped fixtures, strict trace ids". It sits on `claude/call-phone-agent-build-f50v1t` on top of `5c8af24` and has not been pushed.

**Files:** `api/_lib/intelredact.ts`, `api/_lib/intel.ts`, `test/intel-redact.test.ts`, `test/intel.test.ts`, `test/security-static.test.ts`, `docs/INTEL-PHASE0.md`, `docs/superpowers/plans/2026-10-31-call-build.md`. `docs/INTEL-CONTRACT.md` is untouched, and the C-1753 hash test passes.

## I-1: money survives `redactText` and `redactContacts`

**Change** (`intelredact.ts`):

- **Money is held aside**, like uuids and dates, while the identifier rules run. Holding happens in two places:
  - `MONEY_SURE` runs before the PIN rules. It holds a currency-marked amount of any size (`R`, `ZAR`, `$`, `€`, `£`, …; spaced, comma or ungrouped), and an unmarked grouped amount of 7–8 digits.
  - `MONEY_SHORT` runs after the PIN rules. It holds an unmarked grouped amount of 4–6 digits. It has to come after them because a code can be written "482 913".
- **What counts as an amount:**
  - It never starts with 0.
  - Its groups are exactly three digits.
  - It does not start or end inside a longer run of digit groups.
  - Unmarked, it has at most 8 digits. Nine or more is an identifier under contract rule 4, so "621 234 567" stays an account number.
- **Separators.** `SEP` (inside one number) is now 1–2 spaces, an unspaced dash or en dash, or a dot between 3/4-digit groups. A spaced dash, slash, bracket or comma is a break.
  - `PSEP` (phone numbers only) adds the spaced dash.
  - `WSEP` adds spaced dashes and slashes, used only for identifier shapes: a number led by 0, a card's groups of four, an ID's 6-4-3.
  - Brackets are kept only as a leading `(0XX)`, or `(0)` after +27.
- **New rules.** A phone number must not go on across one of its own separators (`PHONE_END`). A new card/ID-shape rule keeps "4111 - 1111 - 1111 - 1111" and "800101 - 5009 - 087" caught.
- **Rule runner.** The rules now run as `Step[]` (a rule, or `{ hold }`) through `withHeld`. `CONTACT_STEPS` is used by `redactContacts`, `IDENTIFIER_STEPS` by `redactText`.

**Tests:**

- New `[C-1740][C-1743] money ranges and lists survive redactText and redactContacts…`. It covers:
  - all eight review strings;
  - unspaced dash and en dash, "to", "and", comma lists, formatRand's `R 1 500 000 – R 2 000 000` and `R 150 000 / R 200 000`, `25 000 000 - 30 000 000`, `R 100 000 000`, and ungrouped `20000 - 25000`, `1000000 - 2000000`, `R150000/200000`.

  Each is asserted unchanged by both functions.
- Phone numbers still become `[contact]` in both functions, in twelve shapes:
  - `0799930001`, `079 993 0001`, `079  993  0001`, `079-993-0001`, `079 - 993 - 0001`
  - `079.993.0001`, `(079) 993 0001`
  - `+27 79 993 0001`, `+27799930001`, `27799930001`, `+27 (0)79 993 0001`, `0027 79 993 0001`
- A mixed money-and-phones line comes out exactly.
- Identifiers beside or shaped like money still go: account, card, 9-digit `621 234 567`, an ID with spaced dashes or slashes, `0123/456/789`.

**Red** (HEAD `5c8af24` code, new test):
```
not ok 9 - [C-1740][C-1743] money ranges and lists survive redactText and redactContacts: …
  redactText: cover R1 000 000 - 2 000 000
  + 'cover R1 000 [contact]'
  - 'cover R1 000 000 - 2 000 000'
```

**Green:** `test/intel-redact.test.ts`: 18 tests, 18 pass, 0 fail.

**Regression probe.** About 140 strings, comparing old against new: IDs, cards, accounts, phones in every format, intl numbers, read-outs, codes, money, dates. Old was taken from `git show HEAD:…`; the script is in the scratchpad.
- No identifier that the old code removed survives now.
- Every difference is money that the old code ate: `R1 000 000 000`, `12 000 / 15 000 / 9 000`, `25 000 - 30 000 - 35 000`, `PIN 4471 and income 20 000 - 25 000` (the income now stays), and the review's strings.
- Two first drafts regressed on the probe, and both were fixed before the commit:
  - `ID 800101 - 5009 - 087`, and an ID led by 0 written with slashes;
  - `my account is 621 234 567`, read as money.

  Guards for both are in the test.

## I-2: no credential-shaped literals; test phone numbers in range

**Change:**

- `test/intel-redact.test.ts` now builds these at runtime from parts: the JWT (from `Buffer…toString("base64url")` of `{alg}` and `{sub}`), `sk-or-v1-…`, `sk_…`, `xi-…`, the PEM block (marker parts joined, with a `TESTONLY` body) and the `postgres URL with an embedded user and password…` string.
- `test/security-static.test.ts` builds `FAKE_PUBLISHABLE` (used at three sites, including `:511`, which the review did not list) and `FAKE_JWT_HEADED`. The files the temp trees write are byte-identical to before.
- Phone numbers: `(079) 993 0000`, `079.993.0000` and `+27 (0)82 123 4567` became `(079) 993 0001`, `079.993.0001` and `+27 (0)79 993 0001`.
- The digit-by-digit and spoken read-outs of 079 9930000 are now 079 993 0001.
- The comment in `intelredact.ts` now uses `079.993.0001`.

**Tests:** C-1737, C-1739, C-1743, C-1572 and C-1573 are unchanged in meaning and green.

**Scan:** `git grep` for JWT, sk-/sk_/xi-, PEM, sb_secret_/sb_publishable_ with a value, whsec_, AKIA, ghp_, xox and `scheme://user:pass@` finds nothing outside markdown. The phone scan finds nothing outside `+2779993xxxx`; its only two hits are false positives on `0123456789`.

## m-A (Task 0.6 N-2): the PIN/OTP/code rule

**Change:**
- Between the word and the code the rule now allows only whitespace, line breaks, tags, the punctuation `:;,.#=*"'()[]-–—`, and the words `is`/`was`. It used to accept any 60 characters.
- A run that goes on past 8 digits is not a code. So "area code 079 993 0001" now becomes `[contact]`; before, it left "0001" behind.
- Currency-marked and 7–8 digit amounts are held before this rule runs, so money is never a code.
- The "4471 is my pin" rule got the same run-boundary checks.

**Tests:** new `[C-1740][C-1742] a PIN, OTP or code is the digits right after the word…`. It covers the promo-code string, "the code is R1 500", and three more cases where money stays. "my PIN is 4471, for the R1 500 debit order" becomes `[redacted]` with the money kept. The area-code case is in it too. The existing C-1741 and C-1742 cases are all still green: a code on its own line, in a `<p>` or a `<b>`, read out with spaces, "PIN: 4 4 7 1", "4471 is my pin".

**Red:**
```
not ok 10 - [C-1740][C-1742] a PIN, OTP or code is the digits right after the word …
  + 'the promo code applies to premiums of R[redacted] per month'
  - 'the promo code applies to premiums of R1 500 per month'
```

**Green:** in the 18/18 above.

## m-B (0.6 m-5): strict `TRACE_ID`

**Change** (`intel.ts`): `TRACE_ID` accepts only `s_<uuid>`, `job_<n>`, `r_` + 16 hex and `t_` + 16 hex. In `job_<n>`, n is 1–8 digits, so no trace id can hold a run of nine or more digits. A job traced by its `jobId` is unaffected. Anything else falls back to the process `p_` trace. The why is in a comment.

**Test:** new `[C-1711] a trace id is used only as this code makes one…`.
- These are kept: `s_<uuid>`, `job_42`, `r_…`, `t_…`.
- These become `p_…`: `wa_27799930001`, `job_27799930001`, `s_27799930001`, `r_27799930001`, `t_0799930001`, a 17-hex `r_`, `s_not-a-uuid`, `x_…`, `job_`, `job_4x`.
- No row contains `799930001`.

**Red:**
```
not ok 8 - [C-1711] a trace id is used only as this code makes one: …
  error: 'wa_27799930001 → wa_27799930001'
```

**Green:** `test/intel.test.ts`: 37 tests, 37 pass.

## m-C: by-reference hold documented

This change is docs only, so it has no test.
- `CaptureOptions.content` (`intel.ts`): content over the inline bound (2,000 values or 256 K characters) is read at the flush. Pass a finished value and never change it after `capture()`. This departs from INTEL-CONTRACT §4 rule 1.
- `docs/INTEL-PHASE0.md` §3 has a new row, "§4 rule 1 … (a departure, not an addition)". The heading is now "(additive, with one departure: the last row)".
- Task 0.6 in the plan has a new "Notes (carried from the Phase 0 review)" line. It covers the hold (Tasks 8.5 and 10.x pass finished values) and records the fix wave's decisions.

## m-D: plan-note carries

No code. Each of these tasks now has a "**Notes (carried from the Phase 0 review):**" line in the plan:
- **Task 1.1:** the `loadModelConfig` `role_missing` summary should name `db/0008`, not `db/0002`.
- **Task 3.4:** C-1744. `runAttempt` captures its `worker_died`, `unknown_kind` and `session_busy` rows before `sessionOf()`. They must be meta-only in a declined trace, the test must include one, and reading the session first is the likely fix.
- **Task 6.2:** route `noteFallback` through `recordSafetyEvent`, so its `check` row exists (C-1723, R22).
- **Task 10.2:** `transcription_failed` should get `alert: "digest"` (Ruling I3).

## Commands (all on the commit's tree, Node 22)

| Command | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm test` | 266 tests, 41 suites, 266 pass, 0 fail (was 263; +3 new) |
| `npm run test:intel` | 266 tests, 41 suites, 266 pass, 0 fail (same count) |
| `npm run criteria -- --count --matrix` | 1337 total; "BEHAVIOR-MATRIX.md cites 1337 criteria, all present."; exit 0 |
| `npm run criteria -- --check` | 0 unknown tags |
| `npm run grep-models` | "No hardcoded model slugs under api/" |
| `npm run grep-doc-css` | "No document renderers yet" |
| `npm run preview-quote -- --smoke` | "no renderer yet (Task 6.4 adds it)", exit 0 |
| CI relative-import grep | no offenders |

## Concerns

1. **Still open, by design: an unspaced-dash range of ungrouped amounts totalling 9+ digits is still `[number]`.** For example, `income 20000-25000`; the old code did the same. It cannot be told apart from an ID written `800101-5009087`, so it errs to privacy. Grouped (`20 000-25 000`), spaced, slashed and worded ranges all survive. This is recorded in the Task 0.6 notes.
2. **Unmarked grouped amounts of 9+ digits are still `[number]`.** For example, `cover 100 000 000`; the old code did the same, per contract rule 4. With a currency (`R 100 000 000`) they survive. Digit soup with no range word (`1 000 000 2 000 000`) still comes out as `1 000 [contact]`, as before.
3. **Slow on long runs of letters (it was like this before; not touched).** The wrapped-base64 rule and the two email rules slow down sharply with very long runs of letters and no spaces: about 19 s for 50,000 letters, about 2.8 s for 20,000, the same in old and new code. This only happens in the flush, never on the request path. It belongs with N-3 (Task 8.5/10.2) or 11.x.
4. **Other worktrees.** Any Phase 2/4 code there that passes a hand-built `traceId` must use exactly these shapes, or its rows land in the process trace. On this branch, everything in `api/` already does: track.ts makes `r_`+16 hex, queue makes `s_`/`job_`.
5. **Redaction cost.** A 100 KB money-and-phone-heavy text now takes about 35 ms to redact, against about 16 ms before. This is flush-side only.
