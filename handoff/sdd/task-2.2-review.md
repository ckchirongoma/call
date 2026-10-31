# Task 2.2 review: Redaction (`api/_lib/redact.ts`)

Base 0ebc6b4, head 9c98cf0 (worktree `.claude/worktrees/agent-a66f9e1068ad25456`). File:line refers to the worktree copy.
I ran focused `node --experimental-strip-types` probes (about 260 inputs, a 30 000-case fuzz, and a 150 kB transcript) against the worktree file. I did not re-run the suite.

### Spec Compliance

| Item | Verdict | Where / note |
|---|---|---|
| Interface `redact(text) → {text, found}`, `RedactionKind` | ✅ | redact.ts:51, :344 |
| `IDENTIFIER: RegExp` for facts.ts, matching what redact removes on normalised text | ✅ | redact.ts:310. Built from the same rule sources, so `IDENTIFIER.test(spokenDigits(x))` is true exactly when `redact(x)` finds something (parity holds by construction; parity test at test:351). Not global. |
| `MEDICAL_TERMS` exported | ✅ (⚠️ type) | redact.ts:416. Typed `readonly string[]`, but the brief says `string[]` (Minor m7) |
| C-0175: 13-digit run → `[redacted]` | ✅ | Plain, grouped, dashed and spoken forms (oh, double, triple, tens, Afrikaans) all pass, but see Critical C1 for the forms that leak |
| C-0176: 16 digits, a space every 4 | ✅ | Passes as written. A card with commas or full stops between the groups leaks, even after "card number" (C1) |
| C-0177: "my account number is 62001234567" | ✅ | Also IBAN. There are filler gaps (I2) and false positives on money (I3) |
| C-0178: everything after "password is" in the sentence | ✅ | Some phrasings slip past (I2) |
| C-0179: "policy number LP-4471823" | ✅ | |
| C-0180: a phone number is NOT redacted | ⚠️ | One number is fine in every form I tried (+27, 0…, spoken, +27 (0)). These break: "0027 79 993 0001" and "double oh two seven…" → `id_number`; two numbers back to back → `card` (I1) |
| C-0181: `safety_events(check=redaction)` lists the kinds | ✅ | redact.ts:388. engine `rules`, outcome `flag`, no digits, no row when nothing was found, never throws. There is no intel `check:` capture: intel.ts is not on this branch, so this is a carry item (m2) |
| C-0182: "I earn 1200000 a year" kept | ✅ | Some money still gets redacted after the word "account" and in long lists (I3, m5) |
| C-1429 / C-1430: no stored text matches the ID or card pattern | ⚠️ | The unit cases pass. The forms that ASR writes when a speaker pauses (commas, full stops, ellipses) still store the full ID or card (C1) |
| SPEC §7.2: 13/16-digit runs, IBAN-like, "account number is …" 8+, "my password is …" | ✅ | |
| R11: never keeps an ID, card, account or password | ❌ | C1, and I2 for the keyword forms |
| Orchestrator: never redact money, ages or channel numbers | ⚠️ | Ages and dates are fine. Money after "account" (I3), amount and year lists (m5), and phone forms (I1) are not |
| R20 / R21 compatibility | ✅ | Nothing blocks `IDENTIFIER_WORDS` (it is additive). The R20 phrase "serious illness" holds no MEDICAL_TERMS stem (checked). The precision of the list matters for both (I4). Build `IDENTIFIER_WORDS` from this file's keyword lists so the two cannot drift. Note that the file has no "card number" vocabulary yet (C1) |

### Strengths

- The approach is sound. Rules run over a copy where spoken digits are normalised, with a per-character map back to the original, so only the matched words are replaced and everything else in the turn is kept byte for byte. Digit words, oh/o, double/triple, tens ("forty-one eleven"), teens and Afrikaans all work.
- Keyword kinds win over the run-length kind. A password span still lists an ID said inside it. `found` comes back in a fixed order with each kind once.
- Idempotent: 0 failures in a 30 000-case fuzz. No throw on any input I tried, apart from the edge in m1.
- Fast: a 150 kB transcript (about a two-hour meeting) runs in 106 ms as one string and 51 ms turn by turn. Sixteen pathological inputs, up to 200 kB each, all stay under 110 ms. I found no catastrophic backtracking.
- The tests are strong. `scrubs()` asserts the exact output text and the exact kinds, not just that something changed. The negative cases cover amounts, ages, dates and the channel. `IDENTIFIER` parity is pinned. The three tests written after their fix (aside, "my pin? it's", newline) pin real behaviour. That is a process note only.
- The why-comments are good. Keeping money and the channel is deliberate and explained, and the reason case is written into the patterns (policy capitals) is stated.

### Issues

#### Critical

**C1. A full SA ID or full card number is stored when its groups are separated by commas, full stops or ellipses. This is wider than the gap the report admits to.** The forms below come back unchanged. The meeting pipeline transcribes with a Whisper-class model, and the phone pipeline uses ElevenLabs ASR. Both commonly write a pause inside a dictated number as ", " or ". ".

- "800101, 5009, 087" (the admitted gap). Also "my ID is 800101, 5009, 087" and "my ID? It's 800101, 5009, 087." The ID keyword rule needs "number/no/#" after "ID" (redact.ts:282), so "my ID is …", the most common SA phrasing, does not trigger it. The same applies to "My ID is 800101 5009 08" (one digit dropped by ASR) and "Do you need my ID? 800101 5009".
- "4111, 1111, 1111, 1111", "4111. 1111. 1111. 1111.", "card number 4111, 1111, 1111, 1111", and "my credit card number is, hold on, 4111, 1111, …". The file has no keyword rule for cards at all, only one for the CVV (redact.ts:272), so even the explicit cue does not rescue a comma-grouped PAN.
- Spoken digits with full stops between them: "Eight. Zero. Zero. One. …" and "eight zero zero one zero one. five zero zero nine. zero eight seven". `SPOKEN_SEP` (redact.ts:94) has no "." or "…". Also "… one zero one... five zero zero nine...".
- A partial leak that reports success: "My ID number is 800101... 5009... 087" becomes "My ID number is [redacted]... 5009... 087" with `found: ["id_number"]`. Seven of the 13 digits stay, and the safety row says the ID was removed. `RUN` allows at most two separator characters (redact.ts:245).
- Why it matters: this is exactly what R11, C-1429 and C-1430 forbid. The unit corpus (test:303–318) only uses forms the code handles, so the Task 4.1 sweep will pass while production stores these.
- Fix:
  - (a) In `copyOf` (redact.ts:196), join written groups across `,` / `.` / `...` / `…` only when the joined run is ID-shaped or card-shaped. ID-shaped: 13 digits whose first six are a valid YYMMDD, in groupings such as 6-4-3, 6-7 or 6-4-2-1. Card-shaped: 15–16 digits grouped 4-4-4-4 or 4-6-5. "12000, 3000, 5000" fails both shapes (month 00), so lists of amounts stay.
  - (b) Add `.` and `…` to `SPOKEN_SEP`.
  - (c) Make `LABEL` optional on `id` / `identity`, as it already is for `account` and `passport`.
  - (d) Add a `card` / `credit card` / `debit card` (+ number) keyword rule with `RUN(12)`.
  - (e) Let `RUN` cross an ellipsis.
  - Add every form above as a test, and put them in the Task 4.1 `offers-id-number` fixture.

#### Important

**I1. Phone numbers: two back to back are redacted as a card, and "00 27" is redacted as an ID** (redact.ts:296, :331). These all come back wrong:
- "079 993 0001 079 993 0002" → `card`
- "oh seven nine nine nine three oh oh oh one, oh seven nine …" → `card`
- "079 993 0001 011 555 0100" → `card`
- "0027 79 993 0001", "00 27 79 993 0001", and spoken "double oh two seven…" → `id_number`, which breaks C-0180 for that form
- "079 993 0001 8001015009087" → `card` only, so the ID is filed under the wrong kind

Weighed against R11: the number is not secret, so this is not a leak. The harms are two. First, a false `card` or `id_number` flag goes into the compliance record the broker sees. Second, the turn loses the channel. On a phone call, `set_channel` keeps it on `clients`. But the ingest `[contact]` swap, the extractor's `channel` fact and the in-person path all read the turn text.

Fix: before the run-length rule, peel SA phone shapes off the start and end of a run (`0[1-8]\d{8}`, `(?:\+|00)?27[1-8]\d{8}`, `27 0[1-8]\d{8}`). Leave a run that tiles fully into phone numbers. Use `card` only for 14–19 digits, since a card number (PAN) is never 20 or more. What remains of a 13-digit run is `id_number`.

**I2. The keyword rules only accept a closed list of filler words, so ordinary phrasings keep the number** (FILLER redact.ts:232; password :266–269; account :277; policy :285). Each of these comes back unchanged:
- "my bank account number at Demo Bank is 62001234567"
- "account number? it's 62001234567"
- "the pin for my card is 1234"
- "my PIN number? one two three four"
- "pin 1234" and "pin code 1234"
- "Password is... Summer2024" (the value cannot start with ".")
- "my password for the app is Summer2024"
- "the password? Summer2024"
- "I have a PIN, it's 1234" and "I use a password, it's Summer2024". The `(?<!your|a)` lookbehind at :266 is meant for the agent, but `redact()` cannot see the speaker, so it blocks these client turns too.
- "my medical aid number is 12345678", the usual SA phrase for a membership number
- "the policy number? LP4471823"
- "policy number lp4471823" (ASR lowercase)

Fix:
- Allow `?` and an ellipsis in `FILLER` and before the password value.
- Allow up to about five words of a prepositional phrase ("at/with/for/on …") between the label and "is", stopping at but/and/so so that an open clause still ends the rule.
- Drop "a" from the lookbehind. Over-redacting an agent turn costs little. Alternatively, add a `role` option.
- For PIN/OTP, take the next 4–8-digit run in the sentence even without a verb.
- Add "medical aid number" and "scheme number".
- When an explicit "number" label is present, accept lowercase letters on the policy token.

**I3. Money after the word "account" is redacted as an account number** (RUN :245, account rule :277). Store-account and credit-card figures are core fact-find data (`owes store_account`, `credit_card`), and the orchestrator ruled that money is never redacted. Each of these becomes `account`:
- "my clothing account is 3,500, 4,000 sometimes"
- "my credit card account is 15 000, 20 000"
- "account is 1,500,000.00" (the cents count as digits)
- "account: 12 000 000"
- "my store account is 2500. 3000 in December" (`RUN` crosses a sentence boundary)

Fix: with no "number/no/nr/#" label, refuse a money-shaped run. Money-shaped means thousands groups (`\d{1,3}(?:[ ,]\d{3})+`), a trailing `[.,]\d{2}`, or two amounts joined by ", " or ". ". Separately, never let `RUN` cross ". " followed by a space. Add these sentences as `keeps()` tests.

**I4. MEDICAL_TERMS precision and recall** (redact.ts:416–431). R20 now refuses any fact value holding a term, and the Task 4.3 checker turns a term into `medical_detail_requested = block`, so false hits cost real work. These are wrongly matched:
- "arv" matches "Arvind" and "Arvinda", a common SA name. "Thanks, Arvind. Do you smoke?" contains a medical term.
- "hiv" matches "hive".
- "operation" matches "operations manager" and "co-operation".
- "seizure" matches "the bank's seizure of my car".
- "depress", "anxiety" and "stroke" match in plain speech.

These are missed: SA colloquial "I have sugar", "high blood" (without "pressure"), "TB", "chronic meds" / "meds", "pregnant", "AIDS" and "covid".

Fix: match short stems as whole words (`\barvs?\b`, `\bhiv\b`, `\btb\b`, `\baids\b`). Move generic English words to multi-word phrases, or drop them ("on medication" stays). Add the SA terms.

#### Minor

- **m1** (redact.ts:345, :375): the catch path returns `"[redacted]"` with `found: []`, so a failure inside redaction writes no safety row, which goes against R13 ("a guardrail that is off is a row"). Call `trackFailure("redact_failed")` in the catch. Separately, `String(text ?? "")` sits outside the `try`, so `Object.create(null)` throws, against the "never throws" doc.
- **m2** (redact.ts:393): once this branch merges with Task 0.6, the tracked event lands as a `track` row. C-1723 wants `check` / `check:redaction` with meta {check, engine, outcome}. Carry it to the merge or Task 4.3 (`recordSafetyEvent`). The implementer flagged this.
- **m3** (redact.ts:269): a PIN or OTP span runs to the end of the sentence, so "my PIN is 1234, I'm 46" loses the age. For PIN/OTP/CVV, stop at the digit run. Passwords keep the sentence rule, per C-0178.
- **m4** (redact.ts:296): every bare 12-digit run is kept, so an ID with one digit dropped by ASR is stored. Keep 12 digits only when the run starts with `27 0` or `+27 0`.
- **m5** (redact.ts:296): space-separated lists of amounts or years that reach 13+ digits are redacted. "12 000 3 500 1 200" → `id_number`; "I pay 1200 2500 3500 4000 every month", "it was 2019 2020 2021 2022" and "born twenty ten, twenty twelve, twenty fifteen, twenty eighteen" → `card`. These are rare. Skip a bare run whose groups are all thousands groups or all 19xx/20xx.
- **m6** (redact.ts:280): a lowercase or letter-bearing IBAN is only partly redacted and filed as `card`. "gb82 west 1234 …" becomes "gb82 west [redacted]"; "FR14…13M02606" becomes "FR[redacted]M02606". SA does not use IBAN, so this is low priority.
- **m7** (redact.ts:416): `readonly string[]`, where the brief specifies `string[]`. A consumer that declares `string[]` will not compile.
- **m8** (redact.ts:310): `IDENTIFIER` is tuned for prose. A bare fact value such as "LP4471823" or "62001234567" passes it. Task 2.3 needs a check shaped for values, next to R21's `IDENTIFIER_WORDS`. This is advisory and does not conflict with R20 or R21.
- **m9** (plan:251): the plan line says the sweep is wired in Task 4.4. Task 4.1 owns it, and the test and report correctly say 4.1.

### Assessment

**Task quality: Needs fixes.**

The design is right: normalise, match, map back, keyword kinds over length. The listed criteria pass as written, and the code is fast, idempotent and well tested for the forms it chose. It does not yet meet R11 for how numbers actually appear in ASR output.

The implementer's first gap (an ID in comma groups with no "ID number") is not acceptable, and it is wider than reported. It also covers "my ID is", full stops and ellipses, and cards even after "card number". One ellipsis case redacts part of the ID while reporting the whole ID as removed. That is C1.

The second gap (two phone numbers back to back read as a card) is not a leak, but it puts a false flag in the compliance record and loses the channel from the turn text. That is I1, and the fix is cheap.

Also fix before merge: I2 (keyword rules too narrow), I3 (money after "account") and I4 (MEDICAL_TERMS precision, which R20 and the checker now depend on). Each fix in C1 and I1–I3 should come with a test that was shown failing first.
