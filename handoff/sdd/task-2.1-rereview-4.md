# Task 2.1 re-review, fix round 4 (ba50e90..09e0348)

**What I did.** I read the brief, rereview-3, the report's "Fix round 4" section and the diff, once each. I also read every row of `test/figures-corpus.test.ts`.

**Checks at head (09e0348, worktree `agent-a1b7e2a99b6868e64`):**
- `test/figures-corpus.test.ts` and `test/figures.test.ts` together pass 51/51.
- `npm test` passes 222/222.
- `tsc --noEmit` is clean.
- `grep-models` is OK.
- `criteria --check` reports 0 unknown tags.
- Only the two figures tests import `figures.ts`.

**The TDD evidence holds.**
- RED: I ran the head test files against the ba50e90 `figures.ts`. They give 47 pass and 4 fail, with 57/198, 8/61, 11/74 and 36/261 rows wrong. That matches the report's "(57, 8, 11, 36)" exactly.
- The report's RED output files exist (`scratchpad/r4/red-head.txt`, `red-final.txt`), and they list the rereview-3 cases.

**Corpus coverage.** A script (`scratchpad/rr4/cov.ts`) matched every probe line from earlier rounds against the corpus tables:
- the 494 lines of round 3's `r2all`, `c1`–`c5`, `m1`, `t1`, `f2` and `x`;
- the 289 lines of round 2's `r2/probes`.

0 lines are missing.

**Probes.** About 420 focused probes. Each was run against head, ba50e90 and 250b8b2, and later against a scratch mutant.
- Harness: `scratchpad/rr4/p.ts` (three versions) and `pm.ts` (head against the mutant).
- Case files: `f1`–`f6` and `g1`–`g6`.
- Mutant: `scratchpad/rr4/M/api/_lib/figures.ts`, with its diff in `scratchpad/rr4/mut-M.diff`.
- (`scratchpad` = `/tmp/claude-0/-home-user/ad36b136-336a-55d6-81b9-100e21138cdd/scratchpad`.)

**Notation.** "M" means `{moneyContext:true}`. "said / scaled" are the corpus's split of `readFigures`. All file:line references are to `api/_lib/figures.ts` at head unless they say otherwise.

## Finding Verdicts

### Important (counts): the dead re-counted, every child dropped, "no more with us" — ADDRESSED

**The fixes:**
- `ageCue` replaces `pieceStart` (:1518), with the subset guard (:1537–1541).
- `CUE_FILLER` gains "since" and "already" (:1365).
- "no more" accepts "with us/me/them/you" and refuses "in" (:1501, `WITH_US` :1351).

**Probes, head (ba50e90 in brackets):**
- "my wife and three kids, sadly / unfortunately / recently / last year / just last year / a year ago / in 2020 / but sadly one passed away" → 3/2 (4/3).
- "I support my wife and our 3 kids, our youngest one passed away" → 3/2 (4/3).
- "I have three kids, the eldest one passed away" → 2 (3).
- "I have four children, two have since passed away" → `{children:2}` (`{}`).
- "…two have already passed away" → 2 (4).
- "three kids, two have since died" → 1 (`{}`).
- "my son is no more with us" → `{}` (`{children:1}`).
- "my father is no more with us" → `{}`.
- "my mother is no more with us, I support my dad" → 1/1.
- "my son is no more in school" keeps the son.

**Residuals, pre-existing (the same at ba50e90 and 250b8b2):**
- A superlative with no "one" still re-counts the child:
  - "my wife and three kids, our youngest passed away" → 4/3;
  - the same with "the youngest" and "our youngest son";
  - "I have three kids, my eldest passed away" → 3.
- "one tragically passed away" → 4/3. "tragically" is not a `CUE_FILLER`, though "tragically one passed away" works.

### Important (money): the "at"/"by" twins and figures — ADDRESSED

**The fixes:**
- `NOT_CLOCK_BEFORE` (:620), used by `hourWordBefore` (:877–883) and by the by/till/until compound (:770);
- `byIsAmount` and `wordsBefore` (:625–634);
- the "%" lookahead on `AT_DOT_TIME_RE` (:268) and the change-word check in its replacer (:284–288).

**Probes under M, head (ba50e90 in brackets).** Every named case has its value back:
- "I'm at nine" → 9 + 9000 (9 with no twin).
- "it's sitting at about ten" → 10 + 10000.
- "the overdraft is at five" → 5 + 5000.
- Each of these also has its twin: "we're at eight", "I'm at twelve now", "I'm at around twelve", "currently at twelve", "i'm sitting at around 12", "I'm sitting at around eleven a month", "the balance is at twelve", "the bond is at nine", "my rent is at seven" and "it's at around 7 now".
- "the loan is at 10 and I pay 1 a month" → 10000 is back.
- "the premium went up by three fifty" → 3, 50, 350 (`[]`).
- "it went up by twelve fifty" → 1250 (`[]`).
- "the interest rate is at 10.25%", "the rate is at 9.25%", "my bond is at 11.50 percent" and "the premium went up by 2.50" keep their figure (`[]`).
- "my debit order for the car is on 15" → `[]` ([15]).

**The time readings still hold:** "at 5", "I finish at five", "at ten fifteen", "by three thirty", "till ten thirty", "at 10.15", "Oct '26", "I'll be home by five", "we close at five" and "I start at eight".

**Residual:** "is at" or "sitting at" followed by an hour and its minutes is still a time. This is pre-existing: the word form since round 2, the dot form since round 3. See judgement call 2.

### Orchestrator requirement: the probe corpora pinned as a table-driven test — ADDRESSED

**What is there.** `test/figures-corpus.test.ts` has 595 rows in five tables. Each test lists every row that reads wrong (`pinned`, test file :690–700), so one failure shows all the damage.
- Every earlier probe line is present (0 missing, above).
- The 124 rows of the round's own neighbour probes are a useful addition.

**How I checked the expected values.** I read all 595 rows and checked about 150 of them by hand: about 85 counts, 30 ages, 20 figures and 25 money answers. Almost all pin the right reading.

**Minor: these rows pin a questionable reading without saying so.** The file header says each row carries "the reading the reviews agreed is right", and these do not:
- AGES "42, my wife is 40" → `null` (:277). The client's own bare answer is 42, so this pins a refusal as right.
- AGES "forty-two, forty-three" → `{42, approx:false}` (:256). Rereview-2 called this ambiguous and said `approx:true` may be the honest reading.
- AGES "born Dec '39" → `null` (:309). As a birth year '39 is 1939, so 86 years old. `fullYear` (:273) reads it as 2039 for every context.
- AGES "born on 15 March 1984" → `approx:true` (:291). A full date gives an exact 42.
- MONEY "twelve five thousand" → [12, 5000] with 12000 scaled (:524). There is no 12 500 reading.
- Two "accepted" rows do not say what the right reading is: "five past" (:498, right is a time, `[]`) and "nineteen eighty four" (:387, :529).

Each of these should be marked "accepted for now", with the right reading written beside it.

### The implementer's judgement calls

1. **"I pay until twelve fifty" stays a time (:376) — ACCEPTED.**
   - "until" with an hour and its minutes is a time.
   - The money phrasing still reads right: "I pay up to twelve fifty" → 1250.
   - Reading "pay" as an amount word would have made "I'll pay by 10.30" a figure.
2. **"the car is at three fifty" stays a time (:577) — NOT ACCEPTED (Minor, pre-existing).**
   - The only reason given is that rereview-3's patch kept "at" + compound a time, but that patch was never probed on this case.
   - It leaves an inconsistent pair. "the overdraft is at five" is now a figure, while all of these are refused (`[]` in both contexts) on ordinary money answers:
     - "the overdraft is at five fifty"
     - "the premium is sitting at three fifty a month"
     - "my rent is at four fifty", "the bond is at six fifty"
     - "I'm at twelve five", "my salary is at twelve five", "I'm sitting at twelve five", "it's sitting at twelve fifty"
   - Refusing is the direction the brief weights as worse.
   - **Tested one-line fix (:770):** `(clockWord === "at" ? !NOT_CLOCK_BEFORE.has(wordAt(toks, a.start - 2)) : !byIsAmount(...))`.
     - It moves only this corpus row.
     - It fixes the 12 cases above.
     - It adds one generous reading: "it is at ten thirty tomorrow" → 10, 30, 1030.
   - The dot form has the same gap: "it's sitting at 10.50", "the car is at 3.50" and "I'm at 12.50" → `[]` since round 3. The same `NOT_CLOCK_BEFORE` test in the `AT_DOT_TIME_RE` replacer would cover it.
3. **"I have 3 kids and 3 passed away" left unpinned — ACCEPTED.**
   - It is genuinely ambiguous.
   - Head gives `{children:0}`, the subset reading, which is consistent with the pinned "I have 3 kids and 2 passed away" → 1.
   - Pinning 0 with a note would guard against drift.

### The cases left unfixed (report "Not fixed")

All five are the same at ba50e90 and 250b8b2. All are ACCEPTED as pre-existing.
- **"my wife and my dad, 70 passed away"** → 2/1, counting the dead dad.
  - Related: "my wife and my dad, 70, passed away" → `{}` drops the wife. That has been so since round 3; 250b8b2 gave 2/1.
- **"nine five hundred"** → no 9500, and a flagged 500 000 twin.
- **"twelve five hundred and fifty"** → no 12 550.
- **"at the end of the year I turn 50"** → `null`, which is the refusing direction.
- **"it is 20 years old"** → 20, which is the generous direction.

## New Breakage

### 1. Important: the new "not a death" exceptions are allow-lists, so any unlisted word counts the dead again

**(a) The "dead" guard (:1491, `DEAD_ENDS` :1349).**

What goes wrong: "dead" followed by any word outside `DEAD_ENDS` now reads as the living. ba50e90 and 250b8b2 are right in every case below.
- "my dad is dead because of covid, I support my mom" → 2/2 (base 1/1).
- "my dad is dead sadly / though, I support my mom" → 2/2.
- "my husband is dead unfortunately, I have two kids" → 3/2 (base 2/2).
- No punctuation, as a transcript can be:
  - "my husband is dead we have two kids" → 3/2;
  - "my dad is dead I look after my mom" → 2/2.
- "my dad is dead years ago, I support my mom" → 2/2.
- "my husband is dead which is why I need cover, I have 2 kids" → 3/2.
- "my wife is dead nearly two years" → `{dependants:1}` (base `{}`).
- "my husband is dead on the 5th of May 2019" → `{dependants:1}`.

**(b) The "passed on" + determiner guard (:1341, :1490).**

What goes wrong: it catches the death followed by a time or an occasion.
- "my dad passed on this year / a Sunday / my birthday, I support my mom" → 2/2 (base 1/1).
- "my mom passed on that day, I support my dad" → 2/2.
- "my wife passed on the way to hospital, I have two kids" → 3/2.
- "my mom passed on her way to work, I support my dad" → 2/2.
- "my husband passed on the same day as his brother, I have two kids" → 4/2.

"Passed on" is ordinary South African English for a death.

**Why this is Important.** It is the same class as round-2 Important 1(a) and round-3 New Breakage 1: counting the dead, on ordinary phrasing. It was introduced while fixing round-3's Minor 4 ("dead broke").

**Fix (mutation-tested, `scratchpad/rr4/M`, diff in `scratchpad/rr4/mut-M.diff`):**
- List the idioms instead of the endings: `!(w === "dead" && DEAD_IDIOM.has(next))`, with `DEAD_IDIOM` = broke, tired, set, serious, sure, keen, certain, right, wrong, against, beat, bored, … `DEAD_ENDS` is then unused.
- Read "passed on X" as handing something on only when a recipient follows in the clause: "to" + me/us/him/her/them/my/our/his/the/you, and not "way to".

**Mutant results:**
- 51/51 pass, so every corpus row keeps its pinned reading, including "dead broke", "dead tired", "dead set", "dead serious", "passed on the house to us" and "passed on his business to me".
- It equals head on all 380 earlier probe lines and on my roughly 260 ordinary-answer probes.
- It fixes every case above.

### 2. Important: "at that point I'll be 65" is now read as the client's current age, and it overrides a stated age

**The cause (:1088, :1159).** `NOT_NOW_BEFORE_TURN` drops "at" from the whole three-word window. The aim was "after 20 years at work I turn 50", but it also lets the future-time phrase through.

**Cases, head (base in brackets):**
- "at that point I'll be 65" → 64 (`null`).
- "at that stage I'll be 60" → 59 (`null`); "at which point I'll be 60" → 59 (`null`).
- "I'm 42. The bond ends in 2049, at that point I'll be 65." → 64 (42).
- "I'm 42 and I want to retire in 2049, at that point I'll be 65" → 64 (42).
- "I'm 42, at that stage I'll be 65" → 64 (42); "I'm 42 and at that age I'll be 65" → 64 (42).
- "42. At that point I'll be 65" → 64 (42).

**Why this is Important.** A retirement-date answer is core to an investment fact-find. Round 1 made "a duration overrides a stated age" Important for the same reason.

**Fix (in the same mutant):** inside the window, add `|| (w(x) === "at" && ["that", "this", "which", "what", "the"].includes(w(x + 1)))`.
- Every case above goes back to null or 42.
- These keep 49: "after 20 years at work I turn 50 next month", "at work I turn 50", "at Sasol I turn 50 soon" and "I'm at Sasol and turn 50 next month".

### 3. Minor: "up" and "over" in `NOT_CLOCK_BEFORE` turn some clock times into unflagged figures (:620, :627)

**Cases under M:**
- "I need to be up by six thirty" → 6, 30, 630 said.
- "it's over by ten thirty" → 1030 said.
- "I get up by 5.30" → 5.3 + 5300.
- "I wake up by five" → 5 + 5000.

**Background.** This is 250b8b2's reading again, and it is the generous direction. "I'm short/over by three" needed these words.

**Fix:** only accept "up" or "over" when a change verb or an amount noun (premium, rent, salary, it) is in `wordsBefore`, or simply accept it as is.

## Out-of-Scope Observations
These are pre-existing and unchanged from base to head unless they say otherwise.

**Counts:**
- "I'm a single mom with two kids" → `{dependants:3, children:2, parents:1}`: the client is counted as her own parent. This is common phrasing, in the counts-too-many direction, and worth a later round.
- "I have a son and a daughter, my son is at school" → `{children:3}`: a child named twice is counted twice. The new named-twice rule deliberately excludes children.
- "my wife and three kids, our youngest passed away" and the related cases are under Finding (counts) above.

**Ages:**
- "I'm 61 and I'll retire when I'm 65" → 65. The "I'm N" rule ignores a preceding "when".
- "at the end of the bond I'll be 60" → 59 and "when the kids finish school I'll be 55" → 54: the three-word window is too short.
- "born in '84" and "I was born in '84" → `null`. Only the "Oct '84" form was added.

**Figures:**
- `AT_DOT_TIME_RE`'s `(?![\d.,])` refuses a time followed by a sentence comma or full stop. So "I knock off at 4.30, the salary is…" and "I start at 7.30." keep 4.3 and 7.3 with flagged twins. This has been so since round 3. `(?!\d|[.,]\d)` would fix it.

**For Task 2.3 (unchanged):**
- write `figure_scaled` for every kept value found in `scaled`;
- refuse a scaled value for labels that are never in thousands.

## Verdict

**Needs one more small fix round (round 5 of 5).**

**Verified:**
- Both findings under verification are ADDRESSED for every named case.
- The corpus requirement is ADDRESSED: 595 rows, every earlier probe present, failures listed together.
- RED (57/8/11/36 on ba50e90) and GREEN (51/51; 222/222 suite) are confirmed.
- Judgement calls 1 and 3 and the five unfixed cases are accepted.

**What needs fixing:**
- **New Breakage 1 (Important).** The "dead" and "passed on" exceptions are allow-lists that count the dead again on ordinary phrasing.
- **New Breakage 2 (Important).** The "at" change in the turn window reads "at that point I'll be 65" as 64, which overrides a stated 42.

Both have a tested fix in `scratchpad/rr4/M`. It keeps 51/51, equals head on all 380 earlier probe lines and my ordinary-answer probes, and fixes every case listed.

**Also fold in:**
- the one-line "is/sitting at" + compound change (judgement call 2, Minor);
- the corpus honesty notes (Minor).

**Rows to add to the corpus:**
- every New Breakage 1 and 2 case;
- "the premium is sitting at three fifty a month" with 350;
- "the overdraft is at five fifty".
