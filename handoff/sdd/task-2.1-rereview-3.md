# Task 2.1 re-review, fix round 3 (250b8b2..ba50e90)

**What I did.** I read the brief, the round-2 re-review, the report's "Fix round 3" section and the diff, once each.

**Checks at head (ba50e90):**
- `test/figures.test.ts` passes 46/46.
- `npm test` passes 217/217.
- `tsc --noEmit` is clean.
- `grep-models` is OK.
- `criteria --check` reports 0 unknown tags.
- Only `test/figures.test.ts` imports `figures.ts`.

**The TDD evidence holds.**
- I ran the head test file against the 250b8b2 `figures.ts` and got 43 pass and 3 fail, exactly the RED the report claims. The three failing tests are the covering tests:
  - `[C-0525][C-0526] an age, a label, a date or a time in a money answer is never scaled`
  - `[C-0587][C-0588] someone who has died is never counted as supported`
  - `[C-0577][C-0578] a date or a clock time is never a figure`
- The second RED also checks out. Head with `|| v === c` removed at :1456 gives 45/1, and the failing test is `[C-0587][C-0588]`.

**One claim in the report is wrong.** It says the regression diff against 250b8b2 found only "at 5" and "I finish at five". My probes find more: New Breakage 1–4 below are regressions against 250b8b2 on ordinary answers.

**Probes.**
- About 330 focused probes, head against base and head against scratch mutants.
- They include the round-2 reviewer's 210-probe set from `scratchpad/r2/probes`. Base against head there gives 44 differences, all improvements.
- Scratch files are in `/tmp/claude-0/-home-user/ad36b136-336a-55d6-81b9-100e21138cdd/scratchpad/r3/`:
  - the probe harness, `probe2.ts`;
  - the case files `c1`–`c5`, `m1`, `t1`, `f2` and `r2all`;
  - the mutants, `mut2/` and `mut3/`.

**Notation.** "M" means `{moneyContext:true}`. All file:line references are to `api/_lib/figures.ts` at head unless they say otherwise.

## Finding Verdicts

### Important (a): an age before "passed away" re-counted the dead or zeroed the children — ADDRESSED

**The fix:** `pieceStart` at :1439–1440. The tests are at test/figures.test.ts :558–565.

**Probes:**
- "my husband who was 45 passed away, it's me and the two kids" → `{dependants:2, children:2}`
- "…who was only 45 passed away and I have two kids" → 2/2
- "my father aged 70 passed away, I support my wife and 2 kids" → 3/2
- "my wife and 2 kids, my mom who was 80 died in June" → 3/2
- "I support my wife and three kids, my dad who was 70 died last year" → 4/3
- "my wife and three kids one passed away", with no comma → 3/2
- "one of them" and "I have 3 kids and 2 passed away" are unchanged.

**Fixer's addition (d), the subject-less death rule (:1452–1456):** ADDRESSED for its cases.
- "my husband, who was only 45, passed away" → `{}`
- "my wife and two kids, my dad, who was 70, passed away" → 3/2. Base gave 4/2/1.

Both rules over-reach. See New Breakage 1 and 4.

### Important (b): "is no more" fired mid-clause — ADDRESSED for the named cases

**The fix:** :1427–1429.

**Probes:**
- "…and there is no more money left" → 3/2
- "my son is no more at school" → `{children:1}`
- "my mother is no more working" → 1/1
- "my father is no more, I support my mom" → 1/1
- "it is no more than R500" is still not a death.

**Residual:** "my son is no more in school" still reads as a death, because `LATE_ENDS` (:1292) contains "in". The tightened end test also drops "my son is no more with us", which is a real death (New Breakage 1).

### Important (c): someone else's relative dropped the client's own — ADDRESSED

**The fix:** `plain` at :1407–1410 and the kind check at :1484.

**These now keep the client's own relative:**
- "my brother's wife", "my mother in law"
- "my wife's dad", "her mom"
- "my husband's father", "my sister's husband"

**Also right:**
- "my wife's mother passed away last year, I support my mother and my wife" is now 2/1. Base gave 1, which was wrong.
- "my mom and dad, but my dad passed away last year" still gives 1/1.

### Minor: the debit cue for "on N" was turn-wide, and "order" alone counted — ADDRESSED

**The fix:** `debitBefore` at :613–622 and `clauseEnds` at :681–685.

**Probes:**
- "my debit order is R500 and my wife is on ten" keeps 10.
- "in order to pay rent my wife is on ten" keeps 10.
- "my payday is on 25 and my husband is on twenty" → [20], with the 25 read as a day.
- "the debit order is on 15 and I'm on twelve" → [12].

**Residual:** the four-token window misses longer clauses (New Breakage 3).

### Minor: unrecognised times got flagged ×1000 twins — ADDRESSED

**The fix:** :267–281 (the dot time and the short year), :734–736 (the clock compound), and :838–842 with :878 (the hour word).

**These now give `[]` in both contexts:**
- "at ten fifteen", "at three fifteen", "by three thirty"
- "till ten thirty", "until five fifteen"
- "at 10.15", "Oct '26"

**These keep the figure without a twin:** "at 5" and "I finish at five".

**The over-reach:** the hour-word block and the widened clock rules refuse or delete money answers. See New Breakage 2.

### "Not fixed" list — reasons ACCEPTED
- **"it's 10.15" keeps 10.15 and a flagged twin.** ACCEPTED. Blanking it would delete a real R10.15, and the twin is flagged.
- **"ten five to twelve five".** ACCEPTED. It is pre-existing and unchanged: the 10500 and 12500 compounds are in the set, and only the 5–12 range is spurious.
- **The two children over-counts.** ACCEPTED as pre-existing and unchanged:
  - "one of my kids passed away" → 3;
  - "my son and daughter, one passed away" → 2.

  They are in the counts-the-dead direction, so they are worth a later round, but no worse than base.
- **"nineteen eighty four" → 1984.** ACCEPTED.

## New Breakage

### 1. Important: `pieceStart` is too strict, and "two have since passed away" now drops every child

Every case below is head against base. Base is right in each one unless the line says otherwise.

**(i) A number after a filler or a determiner is no longer "N of them" (:1439–1440).**

What goes wrong:
- `pieceStart` accepts only punctuation, "and", a segment word or a person straight before the number.
- So any adverb, time phrase or determiner sends the cue to the normal path.
- The normal path finds no target across the comma, so the departed child is counted again.

Cases:
- "my wife and three kids, sadly one passed away" → `{dependants:4, children:3}`. Base gave 3/2.
- "…, unfortunately one passed away", "…, recently one passed away", "…, last year one passed away" and "…, the one passed away" → 4/3. Base gave 3/2.
- "I support my wife and our 3 kids, our youngest one passed away" → 4/3. Base gave 3/2.
- "I have four children, sadly two of them passed away" → `{children:4}`. Base gave 2.

This is the same class as the round-2 Important 1(a), counting the dead, on ordinary phrasing.

**(ii) "I have four children, two have since passed away" → `{}`.**

What goes wrong:
- "since" is a `SEGMENT_WORD` but not a `CUE_FILLER`.
- So the cue's piece is "passed away" with no subject, and the new rule (d) at :1456 marks all four children dead.
- Base gave 4, which was also wrong. Head is now wrong the other way and loses the two living children.

**(iii) "my son is no more with us" → `{children:1}`.**

What goes wrong:
- The tightened end test at :1429 does not accept "with".
- So the euphemism, which is the same as "no longer with us" (already a cue), no longer counts as a death.
- Base gave `{}`, which is right.

**Fix (mutation-tested; this is `scratchpad/r3/mut2`, together with New Breakage 2 and 3):**

```ts
// :1304 — "two have since passed away", "my dad has already passed".
const CUE_FILLER = new Set([..., "just", "since", "already"]);
// :1429 — "no more with us" is a death; "no more in school" is "no longer".
(!toks[c + 2] || toks[c + 2].k === "p" || (LATE_ENDS.has(wordAt(toks, c + 2)) && wordAt(toks, c + 2) !== "in") || wordAt(toks, c + 2) === "with")) ||
// :1439–1443 — exclude the age reading instead of requiring the number to start the piece,
// and a "subset" larger than the group is no subset.
const ageCue = (q: number) => { while (q >= 0 && ["only", "just", "about", "around", "nearly", "almost"].includes(wordAt(toks, q))) q--; return ["was", "is", "aged", "age", "turned"].includes(wordAt(toks, q)); };
const group = some ? [...mentions].reverse().find((m) => m.at < some.start && !m.dead && typeof m.qty === "number" && m.qty > 1) : undefined;
if (some && Number.isInteger(some.value) && some.value > 0 && !ageCue(some.start - 1) && (!group || some.value <= (group.qty as number))) {
  if (group) group.qty = (group.qty as number) - some.value;
  continue;
}
```

**Mutant results:**
- all 46 tests pass;
- every case above gives the right reading, and "my son is no more in school" keeps the son;
- the mutant equals head on all 26 listed count cases, all 210 round-2 probes, and every Finding (a), (b) and (c) probe above.

### 2. Important (narrower): the time fixes refuse or delete money answers that base read right

**(i) Twins lost (:838–842, :878).**

What goes wrong: an hour of 1–12 after "at" or "by" is blocked even after a copula, "sitting" or "up". Under M, base had the flagged twin in each case:
- "I'm at nine", "we're at eight", "I'm at twelve now", "I'm at around twelve", "currently at twelve"
- "it's sitting at about ten", "i'm sitting at around 12", "I'm sitting at around eleven a month"
- "the overdraft is at five", "the balance is at twelve", "the bond is at nine", "my rent is at seven", "it's at around 7 now"
- "the loan is at 10 and I pay 1 a month" → no 10000

In Task 2.3 each of these becomes `figure_not_said` on the income, rent and debt questions. "Sitting at" is common South African phrasing for a balance or a salary.

**(ii) Figures deleted in both contexts (:734–736).**

What goes wrong: widening the clock compound from "at" to "by", "till" and "until" turns "up by" + hundreds into a time:
- "the premium went up by three fifty" → `[]`. Base gave 3, 50 and 350.
- "it went up by twelve fifty" → `[]`. Base gave 1250.
- "I pay until twelve fifty" → `[]`.

**(iii) Interest rates deleted in both contexts (:267).**

What goes wrong: `AT_DOT_TIME_RE` takes no notice of a following "%" or "percent":
- "the interest rate is at 10.25%" → `[]`
- "the rate is at 9.25%" → `[]`
- "my bond is at 11.50 percent" → `[]`
- "the premium went up by 2.50" → `[]`

No fact slot holds a rate, so this part on its own is Minor.

**Why this is Important.** Round 2's Minor 3 was a flagged, generous twin, and Task 2.3's `figure_scaled` row covers that. Its fix has moved into the refusing direction, which the brief weights as worse, on ordinary answers. That is the same reasoning that made round-1 Important 1 and 2 Important.

**Fix (mutation-tested, in `mut2`):**

```ts
// :267
const AT_DOT_TIME_RE = /\b(at|by|till|until)(\s+)([01]?\d|2[0-3])\.([0-5]\d)(?![\d.,]|\s*(?:%|per\s?cent))/gi;
// beside :605
const NOT_CLOCK_BEFORE = new Set(["is", "are", "was", "were", "i'm", "im", "we're", "it's", "its", "he's", "she's", "they're", "sitting", "standing", "stand", "stands", "currently", "now", "still", "up", "down", "increased", "decreased", "short", "over", "went"]);
// :841 hourWordBefore
return CLOCK_BEFORE.has(wordAt(toks, k)) && !NOT_CLOCK_BEFORE.has(wordAt(toks, k - 1));
// :734 — "at" stays a time as in round 2; by/till/until not after "up/down/increased…"
const clock = CLOCK_BEFORE.has(wordAt(toks, a.start - 1)) && (wordAt(toks, a.start - 1) === "at" || !NOT_CLOCK_BEFORE.has(wordAt(toks, a.start - 2))) && a.value >= 1 && ...
```

**Mutant results:**
- all 46 tests pass;
- every case above gets its twin or figure back;
- these all still give `[]`: "at 5", "I finish at five", "at ten fifteen", "by three thirty", "till ten thirty", "at 10.15" and "Oct '26";
- "went up by five" gets a flagged 5000 twin again, as base did.

### 3. Minor: `debitBefore`'s four-token window misses a longer debit clause (:614)

**Cases (both contexts):** "my debit order for the car is on 15" and "my debit order for the funeral policy is on 15" now keep 15 as a figure, and under M give a flagged 15000. Base gave `[]`. This is the generous direction.

**Fix (in `mut2`):** walk to the start of the clause, `for (let j = on - 1; j >= 0; j--)`. The clause-word and punctuation stop already keeps "my debit order is R500 and my wife is on ten" right.

### 4. Minor: the subject-less death rule (d) fires on non-death uses of "dead" and on verb-first order (:1456)

**Cases:**
- These now drop the whole household (`{}`). Base gave 3/2.
  - "I support my wife and two kids, dead broke at the moment"
  - "it's me, my wife and two kids, dead broke"
  - "my wife and two kids, dead tired every day"
  - "my wife and two kids, dead set on getting cover"
  - "my wife and two kids, died laughing"
  - "my wife and two kids, passed on the house to us"
- "my husband and two kids, recently passed away my mother" → `{dependants:1, parents:1}`. The husband and children are dropped and the dead mother is counted.

**Background.** The "dead" adjective was already wrong at base after a plural verb: "my wife and two kids are dead tired" gives `{}` in both. Rule (d) widens it to the subject-less piece.

**Cheap guard (in `mut3`):** `(v === c && (w !== "dead" || v > s0))`.
- 46/46 pass.
- The four "dead …" cases are fixed.
- Nothing else changes across 308 probes.

## Out-of-Scope Observations
These are pre-existing and unchanged from base to head.

**Counts:**
- "my wife and two kids are dead tired" → `{}`, and "my wife and I are dead broke, we have two kids" drops the wife. "dead" is read as a death anywhere. Requiring "is/was/are/were dead" at the end of a clause would fix it.
- "my mother in law lives with us, and my wife and kids" → `{parents:1}`. The wife and kids are not counted.

**Figures:**
- "ten five to twelve five" → range 5–12, mid 8.5.
- "nineteen eighty four" → 1984.

**Note on the `plain` check:** its `wordAt(toks, j + 1) !== "in"` also excludes "my dad in Durban" from the same-person rule. It is harmless now: "my mom in Durban and my dad, but my dad passed away" still gives 1/1.

**For Task 2.3 (unchanged):**
- write `figure_scaled` for every kept value found in `scaled`;
- refuse a scaled value for labels that are never in thousands.

## Verdict

**Needs one more small fix round (round 4 of 5).**

**Verified:**
- Every finding under verification is ADDRESSED for its named cases: Important (a), (b) and (c), the debit-turn Minor and the unrecognised-times Minor.
- The fixer's rule (d) is ADDRESSED for its cases.
- The TDD evidence checks out: RED was 43/3 on the base code, the second RED was 45/1, GREEN is 46/46, and the suite passes 217/217.
- The not-fixed reasons are accepted.

**What needs fixing:** both fixes over-corrected.
- **New Breakage 1 (Important).** "sadly / unfortunately / recently / last year / our youngest one passed away" counts the departed child again. "two have since passed away" drops every child. "is no more with us" no longer counts as a death.
- **New Breakage 2 (Important, narrower).** "I'm at nine", "it's sitting at about ten" and "the overdraft is at five" lose their twin. "went up by three fifty" and "at 10.25%" are deleted.

**The proposed fix.** The `mut2` edits are mutation-tested:
- `CUE_FILLER` gains "since" and "already";
- the "no more" end test accepts "with" and refuses "in";
- an `ageCue` exclusion replaces `pieceStart`, with a subset-size guard;
- an "at 10.15" lookahead for "%";
- a `NOT_CLOCK_BEFORE` set for the hour word and the by/till/until compound;
- a clause-wide debit window.

They keep 46/46, equal head on all 210 round-2 probes and all 26 listed count cases, and fix every case above. Fold in the `mut3` "dead" guard (Minor 4).

**Tests to add** (as `countsFrom`, `has(…, MONEY)` and `figuresFrom` assertions in the same covering tests):
- every New Breakage 1 case;
- "I'm at nine", "it's sitting at about ten" and "the overdraft is at five" under M, with the twin;
- "the premium went up by three fifty" → 350;
- "the interest rate is at 10.25%" → 10.25;
- "my debit order for the car is on 15" → `[]`;
- "my wife and two kids, dead broke" → 3/2.
