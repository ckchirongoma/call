# Task 2.2 re-review, fix round 1: Redaction (`api/_lib/redact.ts`)

Fix base 9c98cf0, head 76a992e (worktree `.claude/worktrees/agent-a66f9e1068ad25456`). File:line refers to the worktree copy at head.

**How I checked.** I ran focused `node --experimental-strip-types` probes against the head file, and against a scratch copy of the 9c98cf0 file so the two could be compared:
- about 450 hand-written inputs;
- a 20 000-case fuzz of valid SA IDs and Luhn-valid cards in many groupings, separators and spoken forms;
- a 30 000-case fuzz of household money lists, plus a 12 000-case sweep by number format;
- 43 pathological inputs, with scaling runs.

I also did three other checks:
- `test/redact.test.ts` at head: 55/55. `tsc --noEmit`: exit 0.
- The head test file against the 9c98cf0 redactor, with stub exports for `IDENTIFIER_WORDS` and `redactJsonStrings`: 23 fail and 32 pass. That reproduces the red.
- Every line of AGENT-PROMPT.md, SPEC.md and criteria/*.md through the old and the new `medicalTermsIn`: the new list adds no hits.

**TDD evidence in the report.** The "## Fix round 1" section names the covering tests by finding: C1 ×5, I1 ×3, I2 ×4, I3+m5 ×2, m1, IDENTIFIER_WORDS ×2, redactJsonStrings ×2, I4 ×2, and the year pair. It gives the red as 21 of 55 failing, all on behaviour (with stubs for the two new exports), and the green as 55/55, with the suite at 272/272 in both modes. It gives counts only, not verbatim output. My own red run matches it closely enough (23 failing; the stubs differ).

## Finding Verdicts

| Finding | Verdict | Where / evidence |
|---|---|---|
| **C1** IDs and cards split by commas, full stops or ellipses survive; no card rule | **ADDRESSED** | `SPOKEN_SEP` redact.ts:114; `GROUP_RE`/`WEAK_GAP` :345–347; `runsIn`/`classify`/`piecesOf` :371–470; card rules :570–575; "my ID is" with no label :597; `RUN` crosses ellipses :530. All 14 forms from the review are now redacted whole, including "800101... 5009... 087" after "ID number", which no longer leaves 7 digits behind. So are 34 variants: "800101,5009,087", "800101 , 5009 , 087", "8001 0150 0908 7", 2-digit pairs, "ID: 800101-5009-087", spoken digits with "." / "…" / "dash", "forty-one eleven, …", Amex 4-6-5 with commas. The 20 000-case fuzz over 10 spaced separators, written and spoken: **0 leaks, 0 non-idempotent**. Residual (Minor): a bare comma with no space, when the groups happen to look like thousands ("061,010,313,9180", "87,09,12,0631,088"), is read as money and kept. So are semicolons ("800101; 5009; 087"). A transcript rarely writes either. |
| **I1** two phone numbers back to back become a card; "0027 …" becomes an ID | **ADDRESSED** | `PHONE` :290, `phonesTile` :293, `classify` phone branch :404. 45 phone forms are kept. These include every form in the review, the +2779993… channel number read out in groups (written, spoken, "plus two seven …", with commas or full stops between the groups), three numbers in a row, 0800/0860 numbers, and a number followed by a time. A phone number beside an ID loses only the ID, filed as `id_number`. |
| **I2** ordinary phrasings between the cue and the number | **ADDRESSED** | `QUALIFIER` :524, `GAP` :528, password lookbehind is "your" only :559, PIN/OTP rule :566, medical aid/scheme words and lowercase policy letters. All 14 review examples are now redacted, and so are about 40 variants. Residual gaps outside the review's list are under Out-of-Scope. |
| **I3** money after "account" is redacted | **ADDRESSED** for "account" | Account rules :577–586. With no label, only an unbroken run is taken, never one written as money. All 5 review sentences and about 35 store-account, bond and credit-card balance variants are kept. **The new card rule brings the same harm back after "card"** (N2 below). |
| **I4** MEDICAL_TERMS precision and recall | **ADDRESSED** | :812–836. The false positives are gone: Arvind, hive, operations manager, co-operation, the bank's seizure of my car, stroke of luck, depressed/anxious, medical aids. The recall items now match: have sugar, high blood, TB, meds, pregnant, AIDS (capitals only), covid. No new hit anywhere in the prompt, spec or criteria. Residual Minor (Out-of-Scope). |
| Orchestrator: `IDENTIFIER_WORDS` (R21) | **ADDRESSED** | :739, built from the rules' word lists. The six R21 phrases match, and so do about 30 variants (no./nr/#/nommer, PIN, OTP, CVV, IBAN, bank details). The kinds a fact-find records do not: store account, credit card, store card, funeral policy, medical aid, passport, member, contract. One Minor false positive ("… no longer", Out-of-Scope). |
| Orchestrator: `redactJsonStrings(value)` | **ADDRESSED** | :754. It redacts strings. Identifier-shaped numbers and bigints become "[redacted]" (8001015009087, 4111111111111111), while 1200000 and 799930001 are kept. The input is not changed. Cycles stop at depth 64, and a throwing getter gives "[redacted]". It never threw. 2 000 rows take 352 ms. Keys are not redacted (Minor). |
| m1 failure path silent; coercion outside the `try` | ADDRESSED | :683 `trackFailure("redact_failed")`; the coercion is inside the `try`. There is a test (incident row). |
| m3 PIN span eats the age | ADDRESSED | "my PIN is 1234, I'm 46" now becomes "my PIN is [redacted], I'm 46". |
| m4 12-digit ID with one digit dropped | ADDRESSED | :422. But this reading is one of the two sources of N1. |
| m5 lists of amounts and years | ADDRESSED for the review's examples | But see N1: a comma-joined list of space-thousands amounts is now cut and redacted. |
| m6 IBAN letters in groups | ADDRESSED (capitals) | "FR14 … 3M02 606" is now removed whole as `account`. |
| m7 `string[]` | ADDRESSED | :812, with a type test. |
| m9 plan line said 4.4 | ADDRESSED | The plan now says Task 4.1. |
| m2 `check:redaction` capture (left) | Reason accepted | `api/_lib/intel.ts` is not on this line (checked), and the check reaches intel through `track("identifier_redacted")`. Carry it to the merge with 0.6 or to 4.3's `recordSafetyEvent`. |
| m6 lowercase IBAN (left) | Reason accepted | "gb82 west 1234 5698 7654 32" becomes "gb82 west [redacted]": the digits go, and only the country and bank code stay, which identify nobody. SA does not use IBAN. |
| m8 a bare value-shaped id passes `IDENTIFIER` (left) | Reason accepted | This matches the first review's own advice: a check shaped for values belongs in Task 2.3, beside `IDENTIFIER_WORDS`. Carry it to 2.3. |

## New Breakage

**N1 — Critical — redact.ts:398–470 (`classify`, `piecesOf`), :422, :427. A comma- or full-stop-joined list of amounts written with space thousands is now cut inside an amount and partly redacted as an ID or a card.** Each of these was kept at 9c98cf0:

- "we earn 31 000, 21 500, 8 300 in total" → "we earn 31 [redacted] in total" `["id_number"]`
- "4 500, 3 200, 2 800, 1 500 a month" → "4 [redacted] 500 a month" `["id_number"]`
- "R4 500, 3 200, 2 800, 1 500" → "R4 [redacted] 500"
- "the kids are 12, 9 and 4, and we pay 4 500, 3 200, 2 800, 1 500 for school" → "… we pay 4 [redacted] 500 for school"
- "it's 8 200, 5 160, 98 966." → "it's 8 [redacted]."
- "the cover is 1 000 000, 500 000, 250 000, 30 000" → "the cover is [redacted] 000, 30 000" `["card"]`
- With four 4-digit amounts (not all round), whatever the format: "the premiums are 1250, 3475, 2150, 1890" → `["card"]`; also "1030, 1115, 1445, 1600", "rooms 101, 102, 103, 104, 105".

How often: in the house style (space thousands, the form the suite and figures.ts use), a 4-amount list joined by ", " or ". " is hit in **23–42%** of random household amounts (2 000 per cell, rounded to 100, 500 or 1 000). A 3-amount list is hit in about 1%. Plain and comma-thousands formats are hit in 0%, apart from the 4×4-digit case. Across 30 000 mixed household lists, 4 445 are newly redacted. Of those, 1 986 have no "card" keyword near them; the rest are N2.

Cause: `piecesOf` may start or end a piece at any group, including the space inside "4 500". The piece "500, 3 200, 2 800, 1" is then not a list of amounts to `listOfAmounts`. Its 12 digits start with a valid YYMMDD (500320), so the "lost digit" ID reading scores 0.5 (:422). Separately, a weakly joined piece grouped 4-4-4-4 counts as a card without Luhn (:427). The money vetoes apply only to a piece that touches the run's edge (`currencyBefore` :411, `moneyAfter` :412). So the search routes around them: the piece stops one group short of "a month" or starts one group after "R".

Harm: the orchestrator ruled that money is never redacted, and the turn is the record. Income and debit-order lists are the central fact-find answer. The stored turn keeps wrong figures ("4", "500") for facts.ts to read. The compliance record also gets a false `id_number`/`card` safety row.

Fix:
- (a) Before the search, merge each space-thousands amount into one group marked as money, the way `GROUP_RE` already treats "4,500". A piece can then never begin or end inside an amount.
- (b) Test `currencyBefore`, `moneyAfter` and `listOfAmounts` on the whole run.
- (c) Across weak joins, drop the 12-digit dated reading and the grouping-only card reading: an ID needs 13 digits and a date, and a card needs Luhn.
- Add the sentences above as `keeps()` tests, and pin a table of the fuzz cells.

**N2 — Important — redact.ts:571–575 (the new card rule with no "number").** After "card", `RUN(12)` crosses ", " and ". ". The `ok` check splits on `/[ -]/` only, so "125 000, 130 000" splits into "000," and `spaceThousands` never sees thousands groups. The rule never consults `listOfAmounts`, and it accepts weak joins without Luhn. This is I3 again, now after "card": store-card and credit-card balances, which are `owes credit_card` / `store_account` facts. Each was kept at 9c98cf0:

- "my credit card is 125 000, 130 000" → `[redacted]` `["card"]`
- "my credit card is 25 000, 30 000, 35 000"
- "the store card is 3 500, 4 000, 4 500"
- "my store card is 3500, 4000, 4500"
- "my Edgars card is 1 200, 1 500, 1 800, 2 000"
- "credit card 45000. 50000. 60000"
- "card 125000, 150000"
- "my card, 1500, 2000, 2500, 3000"

Fix: limit the unlabelled card rule to `RUN_STRONG`. The digit-run detector already handles comma-split PANs (with Luhn), so nothing is lost. Alternatively, run the same veto as `classify` (split on `[ ,.…-]+`, apply `listOfAmounts` with the join flags, and require Luhn when any join is weak). Add these sentences as `keeps()` tests.

**Minor (new or widened):**
- **m-a** (redact.ts:114, keyword `RUN`s). Since "." joins spoken digits, a sentence that starts with a digit word right after a written identifier is eaten by the keyword span:
  - "My ID is 8001015009087. One more thing" → "My ID is [redacted] more thing"
  - "my PIN is 1234. Two cards." → "[redacted] cards."
  - "policy number is LP4471823. One of them" and "card number 4111 1111 1111 1111. Two cards." go the same way.

  For "ID number"/"account number" followed by a comma this already happened at 9c98cf0; this round extends it to full stops and to every keyword rule. A count such as "Two kids" can be lost. Fix: join across "." only when both sides are spoken digits.
- **m-b** (redact.ts:513, :739). In `IDENTIFIER_WORDS`, the marker "no" matches "no longer". So "account no longer used", "the policy no longer pays out", "family member no longer lives with us", "contract no longer renewed" and "medical aid no" are all refused under R21. Fix: require "no" to be followed by ".", "#", a digit or the end, or exclude "no longer"/"no more".
- **m-c** (redact.ts:704). `IDENTIFIER` is a RegExp subclass whose `exec` ignores `lastIndex`. So `"a 8001015009087 b".split(IDENTIFIER)` returns one piece per character, and `new RegExp(IDENTIFIER)` silently becomes a plain keyword pattern. The doc comment warns about `source` only. Add `split` and copying to the warning, or override `[Symbol.split]`.
- **m-d** (redact.ts:762). `redactJsonStrings` keeps object keys as they are (`{"8001015009087": …}` survives). The contract says "every string". Redact keys too, or document the exception.

## Out-of-Scope Observations

- **Residual I2 gaps (Minor; leaks of the same class, not the review's examples).** Each keeps the secret:
  - "the OTP they sent is 482913" (`QUALIFIER` needs a preposition);
  - "the security code on the back is 123" (the CVV rule has no `QUALIFIER`);
  - "the account number I think is 62001234567" ("I" is a stop word);
  - "my account number at the Demo Bank in town is 62001234567" (5 words; `QUALIFIER` allows 4);
  - "it's my password, Summer2024";
  - "card ending 1111" is kept, which is fine (4 digits).
- **MEDICAL_TERMS, new entries with non-medical senses (Minor).**
  - "chronic" alone: "chronic debt", "the chronic problem is money". "chronic meds" / "chronic medication" would still match on "meds" and "medication".
  - "an operation": "we run an operation in Durban", which self-employed clients may say.
  - "the sugar": "the sugar cane farm".
  - "tb": "a 2 TB drive".
  - Not new: "prescri" matches "prescribed minimum benefits", a medical aid term a broker may say, and "retail therapy" and "tax treatment" still match. Worth a look when Task 4.3 wires `medical_detail_requested`.
- `"hives"` matches "hiv" through the plural rule. Hives is itself medical, so this is acceptable.
- Passwords keep the sentence rule (C-0178): "my password is Summer2024 and I'm 46" loses the age. This is by design, as before.
- **Performance: no cliff.**
  - Realistic 150 kB transcript: 76 ms as one string, 151 ms turn by turn.
  - "account number, " ×5 000 (the bounded `GAP` case): 103 ms.
  - The worst of 43 pathological inputs up to 140 kB: 495 ms, for 80 kB of "1 ".
  - Scaling at 10k/20k/40k repeats is linear (for example 134/219/406 ms).
  - `IDENTIFIER.test` costs the same as `redact`.

## Verdict

**Needs fixes: fix round 1 is not clean.** C1, I1, I2, I3 (for "account") and I4 are addressed, as are both of the orchestrator's additions and m1, m3, m4, m6, m7 and m9. The reasons given for leaving m2, m6 (lowercase) and m8 are sound. C1 is now robust: zero leaks across the identifier fuzz.

The round introduces two money regressions that 9c98cf0 did not have:
- **N1 (Critical):** the digit-run detector cuts comma-joined space-thousands amount lists and redacts 23–42% of four-amount lists in the house style.
- **N2 (Important):** the new card rule redacts card balances given as amounts joined by commas.

Both destroy true facts the orchestrator ruled are never redacted, and both write false `id_number`/`card` safety rows. Fix both, with tests shown failing first, then re-review. Fold in m-a and m-b if cheap.
