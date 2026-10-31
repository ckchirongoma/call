# Task 2.1 re-review, fix round 2 (0ebc6b4..250b8b2)

**What I did.** I read the brief, the round-1 re-review, the report's "Fix round 2" section and the diff, once each.

**Checks at head (250b8b2):**
- `test/figures.test.ts` passes 46/46.
- `npm test` passes 217/217.
- `tsc --noEmit` is clean.
- `grep-models` is OK.
- `criteria --check` reports 0 unknown tags.

**The TDD evidence holds.** I ran the head test file against the 0ebc6b4 `figures.ts` and got 41 pass and 5 fail, exactly the RED the report claims. The five failing tests are the covering tests:
- `[C-0573]`
- `[C-0525][C-0526]`
- `[C-0582][C-0586]`
- `[C-0587][C-0588]`
- `[C-0577][C-0578]`

**Probes.** I then ran about 230 focused probes, head against base, plus two scratch mutants. The scratch files are under `/tmp/claude-0/-home-user/ad36b136-336a-55d6-81b9-100e21138cdd/scratchpad/r2/`.

**Notation.** "M" means `{moneyContext:true}`. All file:line references are to `api/_lib/figures.ts` at head unless they say otherwise.

## Finding Verdicts

### Important 1: the narrowed ×1000 gate refused true money answers — ADDRESSED

**The fix:**
- the `v < 100` arm of the gate at :848;
- `LABEL_BEFORE` at :772–775, which now also has turn, turned, turning, under and past.

The covering assertions are in test/figures.test.ts at :293–311 and :265–266.

**Probes that are now right.** Each of these, under M, now has its flagged twin in `scaled` (base had none):
- "I take home fifteen, sometimes sixteen" → 15000 and 16000
- "my salary is fifteen" and "my salary's fifteen"
- "I get paid fifteen", "I clear fifteen", "I bring home fifteen"
- "I'm earning fifteen", "I'm a teacher, I get fifteen"
- "fifteen after deductions", "usually fifteen", "basic is fifteen", "on a good month sixteen"
- "fifteen, and my wife earns ten" and "I earn fifteen, my husband earns twenty"
- "twelve, and my wife gets eight" and "my husband earns twenty"
- "my wife earns about 8 and I earn 12" → both 8000 and 12000
- "the rent is seven", "I pay seven for rent", "the bond is nine", "school fees are two"
- "I still owe 40 on the card" and "I'm on fifteen"

**Still unscaled, as required.**
- Ages: "I'm 42", "I am 42", "I'm forty-two", "im 42", "I'm about 42", "aged 42", "age 42", "my age is 42", "I turn 50 next month", "I'm past 50", "3 kids under 18".
- In a mixed answer only the money scales: "I'm 42 and I earn fifteen" gives 15000 but no 42000.
- Dates and times that are blanked give `[]` or have no twin:
  - "15 March", "on the 25th", "15/03/2026", "at 15:30", "15h30"
  - "half past three", "ten past nine", "7 am", "at two thirty"
  - "it goes off on 25", "my debit order is on 15"
- From 100 to 999 the alone/rough test still applies. "the premium is 350" and "R1 200 … 450 for insurance" get no twin.

The widening gives flagged twins to the clock and date forms that are still not blanked. See New Breakage 3.

### Important 2: the "on N" rule dropped "I'm on fifteen" and "we live on twelve" — ADDRESSED

**The fix:** :595–598 and :656–659. The covering assertions are in test/figures.test.ts at :654–667.

**Kept in both contexts, base gave `[]`:**
- "I'm on fifteen", "I'm on 15", "I'm on fifteen."
- "we live on twelve", "I survive on ten", "I get by on fifteen"
- "she's on ten", "he is on twelve", "my wife is on ten", "we're on twenty"
- "I am on fifteen" and "my husband and I are on thirty"
- "I'm on twelve and my wife is on ten" → 12 and 10. Base had only 12.

**Still days:**
- "it goes off on 25", "it comes off on 1", "I get paid on 25"
- "it's due on 7", "the salary goes in on 25"
- "my debit order is on 15", "on 25 of every month", "on 15 every month"

The debit-turn branch reaches too far. See New Breakage 2.

**The fixer's choice to keep "it goes off on 25" as a day by debit verb, instead of requiring a month or "the": ACCEPTED.**
- It is the rule the round-1 re-review proposed.
- Round 1's test pins it.
- Reading that 25 as a figure would be the generous direction: it would let an invented R25, or R25 000 under M, pass the figure check.

### "twelve five" → 12500 in a money context — ADDRESSED

**The fix:** the compound loop at :701–712 and the hundreds-only `said` at :870. The test is at :313–319.

**Probes under M:**
- "twelve five" → 12500 (flagged), with no 5000 and no 12000
- "twenty two five" → 22500 and "fifteen five" → 15500
- "about twelve five a month" → 12500
- "I earn twelve five and my wife earns eight" → 12500 and 8000
- "twelve five, sometimes thirteen" → 12500 and 13000

**Outside a money context and after "at":**
- With no money context nothing is added.
- "at twelve five" → `[]`, because it is a time.

### Leftover: another thing's "N years old" overrode a stated age — ADDRESSED

**The fix:** :1209, with the `notNow` change at :1073. The tests are at :481–484.

**Probes:**
- These now keep 42:
  - "I'm 42, the policy is 20 years old"
  - "I'm 42 and my house is 30 years old"
  - "I'm 42 and the car is twenty years old"
  - "I'm 42 and in 10 years I'll be 52"
- "in two years I'll be 50" → null. Base gave 49.
- Corrections still win:
  - "I'm 42, no 43" → 43
  - "forty two, sorry forty three" → 43
  - "42. Actually I'm 43" → 43
- Durations next to a "turn" age give the right age:
  - "I've been working for 20 years, I turn 50 next month" → 49
  - "married 20 years and I turn 50 next month" → 49
  - "I've worked 30 years and I'll be 55 in March" → 54

### Leftover: a departed child said as "one" — ADDRESSED for the asked cases, but the rule over-reaches

**The fix:** :1389–1396. The tests are at :550–552.

**Right:**
- "my wife and three kids, one passed away last year" → `{dependants:3, children:2}`
- "… three children, one died" → the same
- "… one of them passed away" → the same
- "… one has sadly passed on" → the same
- "I have twins, one died at birth" → `{children:1}`
- "I have 3 kids and 2 passed away" → `{children:1}`

**The over-reach:** any number standing right before a death cue is read as "N of them". See New Breakage 1(a).

### Leftover: "is no more" — ADDRESSED for the asked case, but the rule over-reaches

**The fix:** :1384. The test is at :554.

**Right:**
- "my father is no more, I support my mom" → `{dependants:1, parents:1}`
- "it is no more than R500" is not read as a death.

**The over-reach:** the cue does not require the clause to end. See New Breakage 1(b).

### Leftover (fixer's addition): the same person named twice — ADDRESSED for the asked case, but the rule over-reaches

**The fix:** :1368 and :1428–1432. The test is at :555.

**Right:** "my mom and dad, but my dad passed away last year" → `{dependants:1, parents:1}`.

**The over-reach:** a possessive owner is not excluded. See New Breakage 1(c).

### Leftover: "a couple of hundred" → 200 — ADDRESSED

**The fix:** :86, :416 and :442–456. The tests are at :124–130.

**Probes:**
- "a couple of hundred", "a couple hundred" and "couple of hundred" → 200, approximate
- "a couple of thousand" and "a couple of grand" → 2000
- "a couple of hundred thousand" → 200000
- These give `[]`, where base gave 100:
  - "a few hundred"
  - "several hundred"
  - "many hundred"
  - "out of hundred"
- "a couple of kids" is unaffected.

### "Not fixed" list — reasons ACCEPTED, with one claim wrong

**Accepted as Minor leftovers:**
- the clock and date forms that are not yet blanked;
- "I'm 30 next month";
- "I'm a 42-year-old teacher";
- the round-1 leftovers.

**The wrong claim:** the report says those clock and date forms get "no ×1000 twins, because they are not alone and not rough". After the `v < 100` arm at :848 they do get twins (New Breakage 3).

## New Breakage

### 1. Important: the round's three new count rules over-reach and regress cases 0ebc6b4 read right

Every case below is head against base. Base is correct in every one.

**(a) A number before the death cue is read as "N of them" (:1389–1396).**

What goes wrong:
- The rule takes the token straight before the cue, after `CUE_FILLER`, as a subset count.
- It then `continue`s past the normal path even when no group is found.
- So an age said before "passed away" stops the person being marked dead, and can take that number off the children.

Cases:
- "my husband who was 45 passed away, it's me and the two kids" → `{dependants:3, children:2}`. Base gave 2/2.
  - This is the round-1 Important 2 probe shape, so it counts the dead again.
  - "…who was only 45 passed away and I have two kids" → the same.
- "my father aged 70 passed away, I support my wife and 2 kids" → `{dependants:4, children:2, parents:1}`. Base gave 3/2.
- "my wife and 2 kids, my mom who was 80 died in June" → `{dependants:2, children:0, parents:1}`. Base gave 3/2. The dead are counted and the living children are zeroed.
- "I support my wife and three kids, my dad who was 70 died last year" → `children:0, parents:1`.

Commas save the case ("my husband, who was only 45, passed away"), but speech-to-text often drops them.

**(b) "is no more" fires mid-clause (:1384).**

Cases:
- "I support my wife and two kids and there is no more money left" → `{dependants:1}`. Base gave 3/2. Both children are dropped.
- "my son is no more at school" → `{}`. Base gave `{children:1}`.
- "my mother is no more working" → `{}`. Base gave 1/1.

In South African English "no more" often means "no longer".

**(c) The same-person rule matches across possessives and in-laws (:1368, :1428–1432).**

What goes wrong: `plain` checks only that no adjective stands between the owner and the person word. The owner itself ("brother's", "wife's", "her") is never checked, and neither is a following "in law".

Cases:
- "my wife and two kids, but my brother's wife passed away" → `{dependants:2, children:2}`. Base gave 3/2. The client's own wife is dropped.
- "my mother in law passed away, I support my mother" → `{}`. Base gave 1/1.
- "my wife's dad died, I look after my dad" → `{}`
- "her mom passed away, I support my mom" → `{}`
- "my husband's father died, my father lives with us" → `{}`
- "my sister's husband died, I support my husband and two kids" → the client's husband is dropped.

**Fix (mutation-tested on a scratch copy).** Four small edits:

```ts
// (a) :1389 — the number must start its piece of the sentence; otherwise fall through to the normal path.
const pieceStart = (q: number) => q < 0 || toks[q].k === "p" || wordAt(toks, q) === "and" || SEGMENT_WORD.has(wordAt(toks, q)) || mentions.some((m) => m.at === q);
if (some && Number.isInteger(some.value) && some.value > 0 && pieceStart(some.start - 1)) {
// (b) :1384 — only at the end of a clause, and never after "there/it/that/this".
(w === "no" && next === "more" && ["is", "was", "are", "were"].includes(wordAt(toks, c - 1)) && !["there", "it", "that", "this"].includes(wordAt(toks, c - 2)) && (!toks[c + 2] || toks[c + 2].k === "p" || LATE_ENDS.has(wordAt(toks, c + 2)))) ||
// (c) :1368 — not after a possessive, and not "mother in law".
const ownerWord = wordAt(toks, k);
const plain = k === j - 1 && !["other", "another", "second", "first", "his", "her", "their", "your"].includes(ownerWord) && !ownerWord.endsWith("'s") && wordAt(toks, j + 1) !== "in";
// (c) :1431 — and the same kind.
... && m.word === d.word && m.kind === d.kind) m.dead = true;
```

**Mutant results:**
- all 46 tests pass;
- every case above gives the base reading;
- every round-2 count assertion is unchanged;
- "my wife and three kids one passed away", with no comma, still gives 3/2.

**Tests to add:** each case above, as `countsFrom` assertions in the `[C-0587][C-0588]` test.

### 2. Minor: the debit-turn branch of "on N" is turn-wide and matches a bare "order" (:598, :604, :659)

**Cases (both contexts):**
- "my debit order is R500 and my wife is on ten" → [500]. The wife's 10 is gone.
- "in order to pay rent my wife is on ten" → []
- "my payday is on 25 and my husband is on twenty" → [25]. The 20 is gone.

**Fix (mutation-tested; 46/46 pass; these three keep their figure and every other "on N" probe is unchanged).** Make the cue local to the clause:

```ts
(DAY_VERB_BEFORE_ON.has(before2) || [2, 3, 4].some((d) => ["debit", "order", "payday"].includes(wordAt(toks, p.start - d))))
```

This drops `DEBIT_TURN_RE`.

### 3. Minor: the under-100 arm now gives flagged twins to clock and date forms that are still not blanked (:848)

**Cases under M, head against base:**
- "at ten fifteen" → 10000 and 15000
- "at three fifteen" → 3000 and 15000
- "at 10.15" → 10150
- "Oct '26" → 26000
- "at 5" → 5000

Base gave none of these. All are in `scaled` (the generous direction), and Task 2.3's `figure_scaled` row covers them.

The report's "Not fixed" text should not say they carry no twin.

The cheapest fix is to blank them:
- "at/by + hour + 15/30/45" as a time;
- "'NN" after a month as a year.

The fixer's own regression list ("I was 20 when I started", "my son is 12", "at 5", "five past") is the accepted trade-off of the re-review's change.

## Out-of-Scope Observations

All of these are pre-existing or follow from accepted choices. None blocks the round.

- **"ten five to twelve five" (M):** the range is found on "five to twelve" (5–12, mid 8.5) beside the 10500 and 12500 compounds. There is no 10500–12500 range, because a compound and a range do not compose.
- **"a couple of hundred" (M) gets a flagged 200000 twin.** This is consistent with the existing "hundred does not block scaling" decision: "a hundred" under M was already 100000 at base. Task 2.3's label-based refusal of scaled premiums is the place to stop it.
- **"forty-two, forty-three" now gives 42 (was 43).** With no correction word, the first age wins. This is ambiguous either way; `approx:true` may be the honest reading.
- **"the premium went up on 15" now gives [15], and 15000 flagged under M (base gave []).** This follows from the accepted debit-verb day rule, in the generous direction.
- **Children over-counts, both pre-existing:**
  - "I have three kids, one of my kids passed away" → `children:3`;
  - "my son and daughter, one passed away" → `children:2`, because no single group larger than one was named.
- **Two other pre-existing readings:**
  - "the debit order is on 15 and I'm on twelve" does not read the 15 as a day, because a word follows it, so under M it now gets a flagged twin;
  - "nineteen eighty four" with no year cue gives 1984.
- **For Task 2.3 (unchanged):**
  - write `figure_scaled` for every kept value found in `scaled`;
  - refuse a scaled value for labels that are never in thousands.

## Verdict

**Needs one more small fix round.**

**Verified:**
- Both Importants are ADDRESSED.
- "twelve five", "a couple of hundred" and both age leftovers are ADDRESSED.
- The asked count cases are ADDRESSED.
- The TDD evidence checks out: RED was 41/5 on the base code, GREEN is 46/46, and the suite passes 217/217.
- The "goes off on 25" choice is accepted.
- The not-fixed reasons are accepted.

**What needs fixing:** the three new count rules over-reach (New Breakage 1, Important).
- An age before "passed away" counts the dead again and can zero the children.
- "there is no more money" or "is no more working" removes a living dependant.
- "my brother's wife" or "mother in law passed away" removes the client's own wife or mother.

A four-edit fix is mutation-tested above and keeps all 46 tests green. Fold in Minor 2, the clause-local debit cue (one line, mutation-tested), and, if cheap, Minor 3.
