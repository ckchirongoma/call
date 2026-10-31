# Task 2.1 re-review, fix round 1 (ec24411..0ebc6b4)

**What I did.** I read the brief, the previous review, the implementer's "Fix round 1" section and the diff, once each. I ran `test/figures.test.ts` in the worktree: 46/46 pass, `tsc --noEmit` is clean and `grep-models` is OK. I then ran the head test file against the base `figures.ts`: 36 pass and 10 fail, which is exactly the RED the report claims, so the covering tests are real. Finally I ran about 400 focused probes against head, the base (ec24411) and two scratch mutants. The scratch copies are under `/tmp/claude-0/-home-user/ad36b136-336a-55d6-81b9-100e21138cdd/scratchpad/`.

In this report, "M" means `{moneyContext:true}`, and all file:line references are to `api/_lib/figures.ts` in the worktree.

## Finding Verdicts

### Important 1: ageFrom read any "N years" as the age — ADDRESSED

**The fix:** `unitAfter` at :1007–1016, `notNow` at :1019–1021, and the duration guard at :1153–1154. The test is test/figures.test.ts "[C-0582][C-0586] a duration is never an age…".

**Probes that are now right:**
- All 7 original probes give 42 or null.
- Also right: "I'm 42 and the bond is 20 years", "42. Married 20 years.", "I'm forty two, twenty two years in the job", "I'm 42, I have 23 years until I retire", "I'm 42 and I'll retire at 65", "I've been married 20 years and I'm 42" and "I am 42 years old and I've been working for 20 years".
- Corrections still win: "I'm 42, no 43" → 43, and "forty two, sorry forty three" → 43.

**Residual (Minor, pre-existing, not a duration):** something else's "N years old" still overrides a stated age, because the guard at :1153 exempts `OLD`.
- "I'm 42, the policy is 20 years old" → `{age:20}`
- "I'm 42 and my house is 30 years old" → 30
- "I'm 42 and the car is twenty years old" → 20

**Residual fix (mutation-tested, 46/46 still pass, all three cases give 42):** at :1154 use `if (found && (duration || !first) && !corrected) continue;`. A clause with no first-person word then overrides a stated age only after a correction word.

**Also left over, pre-existing:** "I'm 42 and in 10 years I'll be 52" → 51. `notNow` does not look at "in N years" before "I'll be".

### Important 2: countsFrom counted the dead — ADDRESSED

**The fix:**
- the cue sets at :1186–1215;
- `DEAD_BEFORE` and the `lost`/`buried` verbs in the mention loop;
- the after-cue scoping and list walk at :1312–1365;
- the `living` filter and the `named` zero for a departed spouse or parent.

**Original probes:** all 5 are right, including "my husband died last year, so it's me and the two kids" → `{dependants:2, children:2}`.

**More probes that are right:**
- "my wife passed away, I look after my mom and my three kids" → 4/3/1
- "my brother died and I look after his two kids" → 2
- "my mother in law passed away, I support my wife" → 1
- "my husband passed away 2 years ago and I have 3 children under 18" → 3/3/3
- "my son is running late" → still counted
- "my mom and dad are late for the call" → still counted
- "my son passed matric" → still counted

**Residuals.** All are Minor, but they over-count, which is the R2 direction:
- A departed child said as "one" is still counted, because the cue has no mention to attach to:
  - "my wife and three kids, one passed away last year" → `{dependants:4, children:3}`
  - "my wife and three children, one died" → the same
  - "my wife and my three kids, one of them passed away" → the same
  - **Fix:** when a cue's piece of the sentence starts with "one" or "N of them" and names no person, take N off the last child mention that has a number.
- "is no more" is not a cue: "my father is no more, I support my mom" → `parents:2`.
- A relative named twice is counted twice: "my mom and dad, but my dad passed away last year" → `parents:2`.

### Minor 2: dates and times — ADDRESSED

**The fix:** `withoutDates` at :255–276, and the day/time skips at :619–645.

**Probes that give []:**
- all 17 test inputs;
- "1 March", "15 Mar", "15-03-2026", "the 1st of March", "on Friday the 13th", "8am to 5pm" and "at 3pm".

"15 may be too much" still gives 15.

**Leftovers (Minor, generous direction):**
- "at ten fifteen" → [10,15]
- "at three fifteen" → [3,15]
- "by three thirty" → 330
- "at 10.15" → 10.15
- "Oct '26" → 26

The `onDay` part of this fix broke something (New Breakage 2).

### Minor 1: ×1000 only when the answer is essentially the number, with `scaled` flagging every scaled value — ADDRESSED as specified

**The fix:** `scalable` at :788–797, `alone` at :761, `roughAt` at :775 and `LABEL_BEFORE` at :726. "I'm 42", "number 1 is rent", "the funeral one and 200 for the other", "debit order on 15 March" and "at 15:30" now get no twins. Every scaled value is still in `scaled`.

This is the round's main problem: the narrowing also refuses real answers (New Breakage 1).

### Minor 3: compound spoken numbers — ADDRESSED

The compound pass is at :655–670.
- "three fifty" → 350
- "about one fifty" → 150
- "twelve fifty" → 1250
- "two forty-nine" → 249
- "four ninety-nine" → 499
- "I pay three fifty and she pays two forty" → 350 and 240
- "at two thirty" → [], so it is not read as 230

### Minor 4: Afrikaans hundreds — ADDRESSED

The changes are at :207–225, :411–419 and :477–490.
- "honderd en vyftig" → 150
- "vyfhonderd en vyftig" → 550
- "twee honderd en vyftig" → 250
- "tweehonderd-en-vyftig" → 250
- "tweehonderdvyftig" → 250
- "driehonderd vyf en twintig" → 325
- "twee duisend en vyftig" → 2050
- "honderde mense" → []

### Minor 7: formatRand of negatives and zero — ADDRESSED

The fix is at :1419–1425. Rounding is now symmetric:
- -150 → "-R 2" and 150 → "R 2"
- -50 → "-R 1" and 50 → "R 1"
- -49, -0 and 0 → "R 0"
- ±1e15 is formatted correctly.

### Minor 8: invalid Date never yields NaN — ADDRESSED

The fix is `validDay` at :960 plus the guards in `sast` and `aroundThisYear`. I tried 7 bad `today` values (Invalid Date, undefined, null, a string, 0, {}, an out-of-range Date) against 13 age texts:
- nothing came back NaN and nothing threw;
- readings that need the date give null;
- "I'm 42" still gives 42.

### The Minors the fixer chose to fix

- **Minor 5 — ADDRESSED** (:357–370).
  - "1 million 200 thousand" → 1200000.
  - "five thousand 2 kids" stays [5000,2].
  - "1 million 200 people" → [1e6,200].
- **Minor 6 — ADDRESSED.** "ten-ish" and "fifteen-ish" now scale.
- **Minor 9 — ADDRESSED** (:890).
  - "uh about, like, twelve" → true.
  - "about. Twelve" → false, so a sentence break is still respected.
- **Minor 12 — ADDRESSED.** There is now a doc comment on `figuresFrom` saying it is the wrong tool for R5.

### The two Minors left open

- **Minor 10 — reason ACCEPTED.**
  - The count comes out under, and the agent asks.
  - Telling ", one is at varsity" (one of the three, C-0589) from "and one at varsity" (an extra child) does need anaphora.
  - Its mirror case does over-count, though. That is the dead child said as "one", above.
- **Minor 11 — reason ACCEPTED.**
  - It is the orchestrator's process note.
  - The orchestrator still owes two things: the C-1163 re-tag in the app task, and the C-0525/0526/0531/0532 then-clauses in Task 2.3.

## New Breakage

### 1. Important: the narrowed ×1000 gate refuses common real answers that ec24411 accepted

**Where:** `scalable` at :795 requires `u.range || alone(r, u) || roughAt(...)`. `alone` (:761–773) is a closed allow-list (`ANSWER_FILLER`, :715–724), so any word outside the list removes the twin.

**Cases.** Each is M, head vs base. Base had the flagged twin in every case. In Task 2.3 each one becomes `figure_not_said`, which is a lost fact on the core income and expense questions.
- The orchestrator's example: "I take home fifteen, sometimes sixteen" → {15,16}, with no 15000 and no 16000. ("sometimes" is not in the list.)
- These all give {15} alone:
  - "my salary is fifteen", "my salary's fifteen"
  - "I get paid fifteen", "I clear fifteen", "I bring home fifteen"
  - "I'm earning fifteen", "I'm a teacher, I get fifteen"
  - "fifteen after deductions", "fifteen, it depends on overtime"
  - "usually fifteen", "basic is fifteen", "on a good month sixteen"
- Answers about two earners get no twins: "fifteen, and my wife earns ten", "I earn fifteen, my husband earns twenty", "twelve, and my wife gets eight" and "my husband earns twenty".
  - The test's "I earn 15 and my wife 10" passes only because "earn" is in the list; "earns" and "gets" are not.
- "my wife earns about 8 and I earn 12" → 8000 is scaled, but the client's own 12000 is not.
- Expenses get no twin: "the rent is seven", "I pay seven for rent", "the bond is nine", "school fees are two" and "I still owe 40 on the card".

**Trade-off.** What this replaced was a flagged over-acceptance (Minor 1). Per the brief's own weighting, refusing true figures is the worse direction.

**Fix (mutation-tested on a scratch copy):** at :795 use `(u.range || u.values.every((v) => v < 100) || alone(r, u) || roughAt(r, u.start, u.end))`.
- A monthly income, rent or balance of R2–R99 is not a real answer, so the flagged twin is the likelier reading.
- The alone/rough test is kept for 100–999, where R200 premiums are real.
- Result:
  - all 46 tests pass;
  - every case above gets its flagged twin;
  - the Minor 1 probes stay twin-free, because labels, the pronoun "one", dates and times are still blocked, and 200 still needs the alone/rough test.
- It brings back flagged twins for a few non-money numbers: "my son is 12", "my kids are 5 and 7", "I have 3 kids under 18" and "I turn 50 next month".
  - If wanted, add "turn", "turned", "turning" and "under" to `LABEL_BEFORE`.
- Add the refused cases above as `has(…, MONEY)` plus `scaled` assertions.

### 2. Important (narrower): the new "on N" day rule deletes a money answer in both contexts

**Where:** `onDay` at :624 treats "on N" at the end of a clause as a day of the month.

**Cases (head vs base):**
- "I'm on fifteen" → {} in both contexts. Base gave {15} and, with M, {15, 15000}.
- "I'm on 15", "we live on twelve", "I survive on ten" and "I get by on fifteen" → {}.
- "I'm on twelve and my wife is on ten" → {12}, so the 10 is lost.

"I'm on fifteen" is ordinary South African English for a salary.

**Fix:** treat "on N" at the end of a clause as a day only in these cases:
- after a payment verb: "goes off", "comes off", "comes in", "paid", "due", "debited", "deducted";
- or when the turn mentions debit, order or payday.

Never treat it as a day after "I'm", "we're", "she's", "he's", "live", "living", "survive" or "by". "it goes off on 25" stays a day under this rule.

### 3. Minor: a bare "hundred" at the start of a phrase now reads as 100

**Where:** :411–419.

**Cases:** "a couple of hundred" and "a few hundred" → {100}; base gave nothing. This is the generous direction. **Fix:** do not start a phrase at "hundred" after "of", "few", "couple" or "several".

## Out-of-Scope Observations

- **"twelve five" (R12 500) is refused at base and at head alike**, so it is not a regression:
  - M gives {12, 5, 12000, 5000}. 12500 never appears, and 5000 is a wrong twin (flagged).
  - "fifteen five" and "twenty two five" have the same problem.
  - **Fix:** in money context, a 10–99 phrase followed directly by one unit word (1–9) adds (a + b/10)×1000 to `scaled`.
- **"I'm 30 next month" → 30** (pre-existing). Read as "I turn 30 next month", it should be 29.
- **"I'm a 42-year-old teacher" → null** (pre-existing; refusing direction).
- **The fixer's documented leftovers are acceptable:**
  - "2 thousand 500" → [2000, 500], which is strict on purpose;
  - "it's 10.15" is scaled under M, but flagged;
  - "2019 to 2021" with no year cue is still a range;
  - "at 3 pm" is still a figure.
- **For Task 2.3, unchanged from the previous review:** write `figure_scaled` for every kept value found in `scaled`. Consider refusing a scaled value for labels that are never in thousands (premiums, `monthly_budget`).

## Verdict

**Needs one more fix round.** Every finding under verification is ADDRESSED, and both Minor reasons are accepted. The TDD evidence checks out: RED was 36/10 on the base code, GREEN is 46/46.

The narrowing introduced two Important refusals:
1. The allow-list gate at :795 drops the ×1000 twin for ordinary income and expense answers: "my salary is fifteen", "I take home fifteen, sometimes sixteen", "I get paid fifteen", "the rent is seven". A one-line fix is mutation-tested above and keeps all 46 tests green.
2. `onDay` at :624 deletes "I'm on fifteen" entirely.

Both are small and local. The residual Minors are worth folding into the same round because each is cheap:
- an object's "N years old" overriding a stated age (one-line fix at :1154, mutation-tested);
- a departed child said as "one";
- "is no more";
- a bare "hundred" after "couple of".
