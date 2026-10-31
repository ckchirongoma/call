# Task 2.2 report — Redaction

**Status:** DONE
**Worktree:** `/home/user/call/.claude/worktrees/agent-a66f9e1068ad25456`, branch `worktree-agent-a66f9e1068ad25456` (fast-forwarded to `0ebc6b4` first)
**Commit:** `9c98cf0` Redact identifiers before anything is stored
**Report location:** the worktree copy of `.superpowers/sdd/2026-10-31-call-build/task-2.2-report.md`. Writing to the shared-checkout path was refused because this agent is isolated in its worktree. The report is not committed: `.superpowers/` is not tracked.

## TDD
- **RED:** `test/redact.test.ts` written first; the run failed with `ERR_MODULE_NOT_FOUND: … api/_lib/redact.ts` (the module did not exist yet).
- **GREEN:** 32/32 on the first implementation run. While probing edge cases afterwards I found three gaps: "my account number, hold on, is 62001234567" (an aside), "my pin? it's 1234", and a password value running past a newline. The probe output showed each one failing. I fixed them and added tests for them. Those three tests were written after the fix, not before it. Final: 34/34 in the file.
- Full suite `npm test` 251/251; `npm run test:intel` 251/251 (same count); `npm run typecheck` clean; `grep-models` clean; `criteria --matrix` clean, 0 unknown tags.
- `npm run criteria -- --missing` no longer lists C-0175–C-0182, C-1429 or C-1430. The only grep hit is C-0447, which belongs to ingest and only mentions C-0175 in its text.

## Files
- `api/_lib/redact.ts` (new)
- `test/redact.test.ts` (new)
- `docs/superpowers/plans/2026-10-31-call-build.md`: Task 2.2 boxes ticked, plus a **Notes (decided while building)** line.

## Criteria tagged
C-0175, C-0176, C-0177, C-0178, C-0179, C-0180, C-0181, C-0182, C-1429, C-1430. C-1429 and C-1430 are covered by unit cases over ID and card turns written every way a client says them; the fixture sweep comes in Task 4.1. The `MEDICAL_TERMS` tests carry no tag: C-1431, C-0225 and C-0227 are proved where they are asserted.

## Decisions
- **Exports beyond the brief:** `REDACTED`, `REDACTION_KINDS`, `spokenDigits(text)`, `hasIdentifier(text)`, `recordRedaction(sessionId, found, turnIdx?)` and `medicalTermsIn(text)`. The plan note has the details.
- **Spoken numbers:** the rules run on a normalised copy. That copy turns digit words, "oh"/"o", "double"/"triple", teens, tens ("forty-one" becomes 41, "eighty oh" becomes 80 0) and Afrikaans digits into numerals. Each match is mapped back to the original words, so nothing outside a match ever changes. Gaps between written numbers are joined only when they are whitespace or a dash. ", " is joined only when one side is a spoken digit, so "12000, 3000, 5000" stays a list of amounts.
- **Run lengths:** 13 digits is `id_number`; 14 or more is `card`. 12 is left alone, because "+27 0 79 …" is a phone number. Phone numbers (10 or 11 digits) and emails are never touched. A comment says that replacing them with `[contact]` is the ingest task's job.
- **Keyword rules:** account (8+ digits, or an IBAN shape), ID number (6+ digits) and passport, policy or membership number, password/PIN/OTP (the rest of the sentence, stopping at a line end), and CVV. Where a keyword rule overlaps the run-length rule, the keyword's kind wins, except inside a password's span. After "… number", up to three asides set off by commas or dashes are allowed ("account number, hold on, is …"). An open clause is not an aside, so "my ID number, but I earn about 1200000" is kept.
- **Case:** written into each pattern instead of using an `i` flag, because policy-number capitals have to be real capitals. With `i`, "a policy for 50000" would match.
- **`IDENTIFIER`:** built from the same rule sources and not global. It works on written digits; facts.ts should call `hasIdentifier()` for anything spoken. A parity test pins `IDENTIFIER` and `redact()` to the same positives and negatives.
- **C-0181:** `recordRedaction` writes `safety_events` `{check: "redaction", engine: "rules", outcome: "flag", detail: {kinds, turn_idx?}}`. It never stores digits, writes nothing when nothing was found, and never throws (one console line on a database error). It also calls `track("identifier_redacted", {category: "security"})`, so the check gets captured once intel's listener exists.
- **`MEDICAL_TERMS`:** lowercase stems matched at the start of a word (so "archive" does not match "hiv"). It deliberately leaves out words the fact-find and the catalogue need: medical, doctor, condition, treating, health, hospital, illness, disease, disability.
- **Speed:** a 144 kB transcript is redacted in about 100 ms. Pathological inputs (40 kB of digits, repeated keywords, long space runs) each take under 35 ms.

## Concerns
1. **Task 0.6 (`intel.ts`) is not on this line,** so there is no direct `capture()` call. The redaction check reaches intel only through `track()` listeners. Task 4.3 could route `recordRedaction` through `recordSafetyEvent` to cover C-1723.
2. **Spec tension for Tasks 2.3, 4.1 and 5.1:** C-1431 says no `facts.value_text` may contain "cancer". But SPEC §8.1 derives `critical_illness` from a `concern` that mentions illness, cancer or heart.
3. **C-0328** ("value_text matches 'policy number'" is refused) may mean the bare phrase. `IDENTIFIER` needs an actual number after it, so Task 3.2 may need its own phrase check. Email labels (C-0556) are left to facts.ts.
4. **Known gaps I chose not to cover:**
   - an ID read out in written groups separated by ", " ("800101, 5009, 087") with no keyword in front. Joining ", " between written numbers would merge lists of amounts. With "ID number" in front, it is caught.
   - two phone numbers said back to back with only a space between them; they join into one long run and get redacted as `card`.
5. **Not built:** a helper that redacts every string inside a JSON value, for `fact_refusals.raw` (C-0330, C-0558, C-1435). Tasks 2.3 and 3.2 will need one. Running `redact()` over JSON text is unsafe, because a password span can run across quotes.

## Fix round 1

**Status:** DONE. Commit `76a992e` "Redact split, spoken and run-together identifiers; never money or phones", on top of 9c98cf0, same worktree and branch. Not pushed. This report is still in the worktree copy, because the shared path refuses writes from this agent.

### TDD
- **RED first.** I added every example from the review as a test, plus temporary stub exports for `IDENTIFIER_WORDS` and `redactJsonStrings` so the file would load. The run gave 55 tests: 34 passing and 21 failing. Every failure was a behaviour failure, never an import error. They covered:
  - C1 (5 tests), I1 (3), I2 (4), I3 and m5 (2), m1 (1)
  - `IDENTIFIER_WORDS`, `redactJsonStrings` and I4 (2 each)
  - the year-pair grouping in `spokenDigits` (1)
- **GREEN.** The first rework left 3 failing. A 12-digit "ID with a lost digit" piece beat a whole 13-digit run, and "4111 1111 1111 1111" read as an ID plus "111". I fixed both in the scoring and the tie-break. Now 55/55 in the file.
- Full suite `npm test` 272/272; `npm run test:intel` 272/272; typecheck clean; `grep-models` clean; criteria `--matrix` clean with 0 unknown tags. My ids are still absent from `--missing`.
- **Probes outside the suite:**
  - Speed: a 144 kB transcript takes 116 ms. "account number, " repeated 5 000 times took 7.9 s before I bounded `GAP`; it now takes 50 ms. Every other pathological input runs under 350 ms.
  - A 20 000-case fuzz of concatenated fragments: 14 non-idempotent results and 21 with 13 digits left. All of them come from tokens glued together with no separator (for example "R12 0004111 1111…" or "1111password"), which a transcript does not produce.

### What changed (`api/_lib/redact.ts`)
- **C1, split IDs and cards.**
  - Spoken digits now join across `.`, `…`, `...` and the word "dash".
  - A new detector handles digit runs that have no keyword. It joins groups across spaces and dashes (strong) and across `,` `.` `...` `…` (weak), then cuts the run at group boundaries into the likeliest pieces.
  - A weakly joined piece must look like what it claims: an ID needs a valid YYMMDD, and a card must pass Luhn or be grouped 4-4-4-4 / 4-6-5 / 4-6-4.
  - The ID keyword rule no longer needs "number". Without it, the digits must start with a valid date.
  - New rule: card / credit card / debit card (+ number). The keyword `RUN` now crosses ellipses.
  - "800101... 5009... 087" after "ID number" is now redacted whole, so the "7 digits stay, ID reported removed" case is gone.
- **I1, phones.** Phone shapes are pieces that are kept: `0[1-8]`, `27`, `270`, `0027`, `00270`, and several written together. So two numbers back to back, "0027 79 993 0001", "00 27 …" and spoken "double oh two seven …" are kept. "079 993 0001 8001015009087" loses only the ID, filed as `id_number`. `card` is used only for 14–19 digits.
- **I2, phrasings now caught:**
  - a preposition phrase before the verb ("number at Demo Bank is", "the pin for my card is")
  - `?`, ellipses and "it's" between the cue and the number
  - "I have a PIN, it's …": the lookbehind is now "your" only
  - PIN/OTP take the next 4–8 digits, with no verb needed
  - "medical aid number" and "scheme number"
  - lowercase policy letters after "number"
- **I3, money after "account".**
  - With no label, the account rule takes only an unbroken run. That run must not be written as money (thousands separators, cents), must not be followed by money words, and must not be space thousands.
  - The no-keyword detector never lets money groups, a run after R/ZAR, or a run followed by "a month" become an identifier.
- **m5, lists.** Lists of round amounts (…00), lists of years, and space-thousands lists are kept. Spoken year pairs ("twenty ten") become one group of four so this rule can see them.
- **I4, MEDICAL_TERMS.**
  - Matching is now whole word or phrase, with a plural allowed, except an explicit set of stems. "AIDS" is matched only in capitals, so "medical aids" does not match.
  - Medical senses are written as phrases ("had a stroke", "an operation", "seizures", "depression"), so "Arvind", "hive", "operations manager", "seizure of my car" and "a stroke of luck" no longer match.
  - Added: "have sugar" and similar, "high blood", "tb", "meds", "pregnan", "chronic", "covid".
- **New exports.**
  - `IDENTIFIER_WORDS` (R21): built from the rules' own word lists. It matches an identifier name followed by number/no/#/nommer, or a standalone label (PIN, password, OTP, CVV, IBAN, polisnommer, rekeningnommer, bank details). It does not match "store account", "credit card", "funeral policy" or "medical aid".
  - `redactJsonStrings(value)`: strings are redacted and an identifier-shaped number becomes "[redacted]". Keys are kept and the input is not changed. Anything deeper than 64 levels becomes "[redacted]". It never throws.
- **`IDENTIFIER`** is now a `RegExp` subclass whose `exec()` runs the redactor's own detector. Parity with `redact()` therefore holds by construction, on written and spoken text, through `test`, `exec`, `match`, `search` and `replace`.

### Minors
- **Fixed:** m1 (`trackFailure("redact_failed")`; the type coercion is now inside the `try`), m3, m4 (12 digits with a valid YYMMDD → `id_number`), m6 (letters inside IBAN groups), m7 (`string[]`), m9 (the plan line now says Task 4.1).
- **Left, with reasons:**
  - **m2:** intel.ts is still not on this line. The redaction check reaches intel only through `track("identifier_redacted")`. `check:redaction` capture is for the merge with Task 0.6 or for Task 4.3's `recordSafetyEvent`.
  - **m6, lowercase part:** "gb82 west …" is still only partly redacted. Matching lowercase IBANs would mean case-insensitive letter groups that could match prose; SA does not use IBAN, and ASR writes it in capitals.
  - **m8:** a bare value such as "LP4471823" or "62001234567" still passes `IDENTIFIER`. With no cue, those shapes could be an amount or a code. Value-shaped refusal is Task 2.3's job, now alongside `IDENTIFIER_WORDS`.

### Remaining concerns
- **Glued tokens:** the only remaining non-idempotent and leak cases are fragments glued with no separator (fuzz only).
- **Kind can be wrong when a 15-digit run happens to pass Luhn:** "I'm 35 8001015009087" would then be redacted whole as `card`. Nothing leaks.
- **Weakly joined card false positive:** four 4-digit amounts said with commas that are not all round and happen to pass Luhn or the 4-4-4-4 grouping would be redacted as a card. This is rare.
- **Carried from the first report:** the C-1431 versus §8.1 `critical_illness` tension, and the bare "policy number" reading of C-0328 (now covered by `IDENTIFIER_WORDS` if facts.ts uses it).
