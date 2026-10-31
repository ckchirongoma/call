# Task 2.1 report: Figures

**Status:** DONE
**Worktree:** `/home/user/call/.claude/worktrees/agent-aa49fa03c26f061e5`
**Branch:** `worktree-agent-aa49fa03c26f061e5` (fast-forwarded to `claude/call-phone-agent-build-f50v1t` @ 67fd21d first)
**Commit:** `ec24411` Parse money, ages and counts the way South Africans say them (not pushed)

(The worktree isolation refused the shared-checkout path, so this report is written inside the worktree at the same relative path. It is untracked and not committed.)

## Files
- `api/_lib/figures.ts` (new). Pure code. Ports the digit grammar and scale suffixes from Charlie's `api/_lib/grounding.ts` and phone blanking from `api/_lib/phones.ts`, with attribution and the why-comments kept. The number words, Afrikaans and isiZulu words, ages and counts are new.
- `test/figures.test.ts` (new): 40 tests.
- `docs/superpowers/plans/2026-10-31-call-build.md`: Task 2.1 boxes ticked, and a **Notes (decided while building)** line added.

## TDD evidence
- RED: `test/figures.test.ts` was written first. Running it failed with `ERR_MODULE_NOT_FOUND: Cannot find module '…/api/_lib/figures.ts'`, which is the right reason (the module was missing).
- GREEN: focused run passes 40/40. `npm run typecheck` is clean. `npm test` passes 211/211 and `npm run test:intel` passes 211/211.
- One test was added after the first green run: "an ISO date is not three figures or a range". Its RED is the probe output before the fix, where `figuresFrom("2026-10-31")` gave `[2026,10,31,20.5]`. It is green after the fix.
- Mutation check on Review Focus 1: I made bare scaling unconditional (dropped `ctx.moneyContext &&`). That failed C-0526, C-0576 and C-0579. The file was then restored and is green again.
- `npm run criteria -- --missing` lists none of my ids. `--matrix` is OK and `grep-models` is OK.

## Criteria tagged (33)
- C-0563 to C-0590 (28 ids)
- C-0525, C-0526, C-0531, C-0532
- C-1163: tagged because `parseMoneyInput("12 000") === 12000` asserts its then-clause.

Each of C-0525, C-0526, C-0531 and C-0532 asserts the figures-level part of its then-clause:
- **C-0525:** `scaled` holds 10000 and `isApprox` is true.
- **C-0526:** a count stays 10, and only a money context adds 10000.
- **C-0531:** the range is 10000–15000 with mid 12500, approx is true, and 12500 is in the figures.
- **C-0532:** the result is `{band:"25-34", approx:true}` with no age.

The fact-row half of these four (the `safety_events(figure_scaled)` row and `is/age_band`) belongs to `factUpdates()` in Task 2.3, which owns `test/facts.test.ts`.

formatRand is tested with the C-0808 and C-0809 values ("R 850", "R 1 235", "R 1 500 000") but not tagged with those ids, because `test/price.test.ts` owns them.

## Interface additions (beyond the brief, all optional or additive)
- `readFigures(text, ctx) → { figures, scaled }`. `figuresFrom` is its `.figures`. facts.ts needs `scaled` to write `figure_scaled`.
- `rangeFrom(text, ctx?)` takes the same optional money context, so `rangeFrom("ten to fifteen", {moneyContext:true})` gives 10000–15000.
- These types are exported: `AgeBand`, `FigureContext`, `Range`, `AgeReading`, `Counts`.

## Decisions (also in the plan notes)
- **Money-context scaling:**
  - A bare number under 1000 also gets ×1000. "Bare" means no currency, no thousand/million/k/grand/bar, and no count noun after it ("years", "kids", "%").
  - The unscaled value stays in the set too.
  - "Hundred" does not block scaling, so "about 180 on the car" gives 180000 (C-0505).
- **Ranges:**
  - A scale on the far end carries back to a near end that has none ("ten to fifteen thousand", "10 to 15k", "two to three hundred").
  - The midpoint counts as a figure.
  - A descending pair is not a range ("R500 to R450", "R5 000 to 10 people").
- **Things that are never figures:** years after in/since/born/a month name, including spoken years like "twenty nineteen"; days of the month ("25th", "on the 25", "twenty-fifth"); phone numbers or ID-length digit runs; ISO dates; "one" used as a pronoun.
- **Decimal comma:** "10,15" with no currency and no scale is a list, not 10.15.
- **"Bar" and "k"** count only after a numeral, since "a bar" is a place.
- **Ages:**
  - A band is returned only when every age the words could mean falls inside it. So "mid forties", "in my forties", "30 to 40" and a birth year that straddles two bands all give no band.
  - An exact age has no band attached.
  - "Born in Y" gives the likelier of the two possible ages by SAST month (after June, the later one), with approx set.
  - "Turn N" gives N-1, and "turn N next year" gives the likelier of N-2 and N-1.
  - Valid ages are 18 to 110; anything else is null.
  - Someone else's clause is skipped. When anyone else is mentioned in the turn, a bare number does not count.
  - When the turn corrects itself, the last age wins.
- **Counts:**
  - `dependants` is set only when the household is described: a spouse, parent or relative named, "just me", "nobody", or a stated number of dependants.
  - Children on their own give `{children}` only (C-0590 is literally `{children:2}`).
  - `children_under_18` comes only from a cue ("under 18", "at/in school", "minor", "school-going"). "One is at varsity" is not a cue, so the C-0589 text as given has no `children_under_18`, and the cued variants give 2.
  - Possessives ("my mom's society") are ignored, and "her two kids" counts as relatives, not the client's children.
- **Display and input:**
  - `formatRand` rounds to whole rand, uses ASCII spaces, writes negatives as "-R 1 235", and throws RangeError on non-finite input.
  - `parseMoneyInput` returns rand (not cents) rounded to 2 decimals, accepts one amount only, and returns null otherwise.

## Concerns
- In money context the figure set is deliberately permissive ("350" also yields 350000). The guard is that `scaled` is reported so facts.ts can flag it (`figure_scaled`). Task 2.3 must actually write that event for kept values found in `scaled`.
- Whether C-0589's own text should yield `children_under_18: 2` is ambiguous. I read "only when under-18 or at-school cues exist" literally: no cue means the field is absent. If the orchestrator reads it the other way, change one assertion and the "at varsity" handling.
- `bandFor(<18)` returns "18-24" because AgeBand has no lower band. `ageFrom` never returns an age under 18.

## Fix round 1

**Status:** DONE
**Worktree:** `/home/user/call/.claude/worktrees/agent-abc7d47294f0d4607` (fast-forwarded to `worktree-agent-aa49fa03c26f061e5` @ ec24411 first)
**Branch:** `worktree-agent-abc7d47294f0d4607`
**Commit:** `0ebc6b4` Figures: ages and dependants as people say them, not durations or the departed (not pushed)
**Files:** `api/_lib/figures.ts`, `test/figures.test.ts` (40 → 46 tests), `docs/superpowers/plans/2026-10-31-call-build.md` (a "fix round 1" notes line under Task 2.1).

### TDD evidence
- RED: the new tests were written first. The focused run gave 36 pass, 10 fail, each for a behaviour reason:
  - `"I'm 42 and I've been married 20 years"` → `{age:20}`; `"I need cover for 20 years"` → `{age:20}`; `"it's a 20 year bond"` → `{age:20}`.
  - `"my dad passed away so it's just my mom"` → `{dependants:2, parents:2}`; `"my late husband and my two kids"` → `{dependants:3, children:2}`.
  - With MONEY: `"I'm 42"` scaled [42000]; `"number 1 is rent"` [1000]; `"debit order on 15 March"` [15000]; `"at 15:30"` [15000, 30000]; `"ten-ish"` gave no 10000.
  - `"15/03"` → [15, 3]; `"half past three"` → [3]; `"on 15 March"` → [15]; `"from 2019 to 2021"` → [2021].
  - `"three fifty"` → [3, 50] with no 350; `"honderd en vyftig"` → [50].
  - `formatRand(-150)` → "-R 1"; `ageFrom("born in 1984", new Date("x"))` → `{age: NaN, band: "18-24"}`.
  - `isApprox("uh about, like, twelve")` → false.
- A second batch was found by probing after the first green run. Each was confirmed wrong on the old code, then a test was added:
  - `"12/2025"` → [12, 2025].
  - `"2 thousand 500"` with MONEY scaled the 500 to 500000.
  - `"I'll be 65 when the bond ends"`, `"I'll be 50 in ten years"` and `"by the time I turn 65 the bond is paid"` → 64, 49 and 64.
- GREEN:
  - The focused run passes 46/46.
  - `npm run typecheck` is clean.
  - `npm test` passes 217/217, and `npm run test:intel` passes 217/217.
  - `npm run criteria -- --missing` lists none of Task 2.1's ids. `criteria --check` reports 0 unknown tags.
  - `grep-models` is OK. Comments in figures.ts had quoted single-slash dates that the slug grep flagged, so they were reworded.
- Regression diff: I ran the old and new figures.ts over about 220 probes. Every difference was one of the intended changes. Nothing changed in counts or ages outside the fixed cases.

### Fixed
- **Important 1 (ages):**
  - "N years" is an age only in these cases:
    - with "old" or "of age";
    - as the whole answer ("forty-two years");
    - after "I'm" or "I am", when nothing follows except "now"/"already".
  - A duration never yields an age: "married 20 years", "cover for 20 years", "a 20 year bond", "20 years left", "I'm 20 years from retirement", "30 days behind".
  - A stated age is never overridden by a later bare "twenty years". It is overridden only after a correction word ("no", "sorry", "actually", …).
  - Also handled:
    - "until/when/by the time I turn 65", "retire at age 65" and "I'll be 65 when…/in ten years" are not the current age.
    - "N this year" gives the turning-this-year reading (approximate, with a band when both possible ages share one).
- **Important 2 (counts):**
  - These cues mark someone as departed, scoped to the person they qualify:
    - before the person: "late", "deceased", Afrikaans "wyle";
    - after the person: "passed away", "passed on", "passed" ("passed matric" is excluded), "died", "dead", "deceased", "oorlede", "is late" ("late for" is excluded), "no longer with us", "no longer alive", "not alive";
    - a verb before the person: "lost my …", "buried my …".
  - Scope stays within one piece of the sentence. A piece that starts with "he/she/who" refers back to the last person named. A list joined by "and" ("my mom and dad passed away") shares the cue unless a singular verb is used ("…and my dad is late"). Children join the list only when the words say all of them ("both", "they", "have").
  - The departed are never counted as supported:
    - A departed spouse or parent named beside the living counts 0 in the household: "my late husband and my two kids" → `{dependants:2, children:2}`.
    - The departed alone give `{}`.
    - "just me since my husband passed away" → `{dependants:0}`.
- **Minors fixed:**
  - Dates and times are never figures:
    - day-month and month-day dates, d/m, d/m/y and d.m.y, y/m/d, m/yyyy;
    - the far end of "from 2019 to 2021", and the year in "March 15, 2026";
    - "15:30" and "15h30";
    - "half past three", "quarter to four", "ten past nine", "N o'clock", "N am", "at two thirty";
    - "15 may be" stays a figure.
  - "pm" is deliberately not treated as a time, because "R500 pm" means per month.
  - Money scaling (×1000 after a money question) applies only in these cases:
    - The answer is the number on its own, with filler, rate words, who earns it, or other figures: "fifteen a month", "I earn 15 and my wife 10".
    - The number is said roughly: "about", "or so", "-ish", or a range. This keeps C-0505's "about 180 on the car".
  - Scaling never applies after "I'm", "I am", "aged", "number" or a label, and never to the lone word "one". `scaled` still flags every scaled value. "-ish" now scales the way "about" does (Minor 6).
  - Compound spoken numbers now read as hundreds:
    - "three fifty" → 350, "twelve fifty" → 1250, "two forty-nine" → 249, "three fifty thousand" → 350000. The 3 and the 50 are kept alongside.
    - "hundred"/"honderd" with no "a" is 100.
    - Afrikaans "en" after honderd/duisend works like "and".
    - Afrikaans one-word and hyphenated numbers are split ("tweehonderdenvyftig", "tweehonderd-en-vyftig", "vyfentwintigduisend").
    - Digits before a smaller scale word compose: "1 million 200 thousand" → 1200000 (Minor 5).
  - `formatRand` now rounds half away from zero in both directions: -15000 → "-R 150", -150 → "-R 2", -49 → "R 0", -0 → "R 0".
  - An invalid or missing `today` makes date-based age readings null, never NaN. "I'm 42" still reads 42.
  - `isApprox` skips commas between "about" and the number (Minor 9).
  - A doc comment on `figuresFrom` now says it is the wrong tool for R5's strict writer check (Minor 12).

### Not fixed
- **Minor 10** ("two kids at school and one at varsity" → 2): telling an extra child ("and one at varsity") from one of the children already counted (", one is at varsity", C-0589) needs grammar. The count errs low, and the agent asks.
- **Minor 11:** this is an orchestrator process note, not code.
- **Known leftovers**, all in the refusing direction or flagged:
  - "2 thousand 500" is still [2000, 500], not 2500. This is strict on purpose, so "five thousand 2 kids" can never become 5002. The 500 is no longer scaled.
  - A bare decimal ("it's 10.15") is still scaled after a money question. That was already so before this round, and the value is flagged in `scaled`.
  - "2019-2021" and "between 2019 and 2021" with no year word are still a range, because they could be money.
  - "at 3 pm" stays a figure (see "pm" above).

### Concerns
- The money-scaling gate is a heuristic: on its own, or rough. A multi-number answer said exactly ("R1 200 for the car and 450 for insurance") gets no scaled twin. That fails in the refusing direction (`figure_not_said`).

## Fix round 2

**Status:** DONE
**Worktree:** `/home/user/call/.claude/worktrees/agent-abc7d47294f0d4607`
**Branch:** `worktree-agent-abc7d47294f0d4607`, on top of 0ebc6b4
**Commit:** `250b8b2` Figures: money said in thousands without the word (not pushed)
**Files:**
- `api/_lib/figures.ts`
- `test/figures.test.ts` (still 46 tests; assertions added inside the existing ones)
- `docs/superpowers/plans/2026-10-31-call-build.md` (a "fix round 2" notes line)

### TDD evidence
- **RED:** I wrote the new assertions first. The focused run gave 41 pass and 5 fail, each for a behaviour reason. Probe outputs on 0ebc6b4:
  - With MONEY, these got no twin at all: "I take home fifteen, sometimes sixteen" → [15,16]; "my salary is fifteen" → [15]; "my husband earns twenty" → [20]; "the rent is seven" → [7]; "I still owe 40 on the card" → [40].
  - "twelve five" with MONEY gave [5,12,5000,12000], with no 12500.
  - "I'm on fifteen" → [], "we live on twelve" → [], and "I'm on twelve and my wife is on ten" → [12].
  - "a couple of hundred" → [100], "a couple of thousand" → [], "a few hundred" → [100].
  - "I'm 42, the policy is 20 years old" → 20, "I'm 42 and my house is 30 years old" → 30, and "I'm 42 and in 10 years I'll be 52" → 51.
  - "my wife and three kids, one passed away last year" → `{dependants:4, children:3}`; "my father is no more, I support my mom" → parents 2; "my mom and dad, but my dad passed away last year" → parents 2.
- **GREEN:**
  - focused 46/46;
  - `tsc --noEmit` exit 0;
  - `npm test` 217/217 and `npm run test:intel` 217/217;
  - `criteria --missing` lists no Task 2.1 id, and there are 0 unknown tags;
  - `grep-models` OK.
- **Regression diff against 0ebc6b4** (about 220 probes): the only differences are the flagged ×1000 twins that now come back for numbers under 100. These are "I was 20 when I started", "I have 2 kids, 5 and 7", "aged 5 and 7" (the 7), "at 5", "five past" and "the 15 may be wrong". The re-review accepted this as the trade-off, and every one is in `scaled`.

### Fixed
- **Important 1: the ×1000 gate.**
  - The gate now also passes when `u.values.every(v => v < 100)`, which is the re-review's mutation-tested change. Under 100, a money answer keeps its flagged twin whatever words surround it.
  - From 100 to 999 the number must still be said alone or roughly.
  - `LABEL_BEFORE` gains "turn", "turned", "turning", "under" and "past". So "I turn 50 next month", "3 kids under 18" and "I'm past 50" get no twin, and neither do "I'm 42" or "aged".
  - Dates and times remain skipped.
  - All of the re-review's refused cases now carry their flagged twin. The tests assert 10 of them.
- **Important 2: "on N".**
  - "On N" with nothing after it is a day only in two cases: after a debit verb ("goes off", "comes off", "in", "out", "paid", "due", "debited", "deducted"), or when the turn mentions a debit, an order or a payday.
  - It is never a day after "I'm", "we're", "she's", "he's", "they're", "live", "survive", "by" or "earn".
  - "On N of/every/each" is still a day.
  - Results:
    - "I'm on fifteen", "I'm on 15", "we live on twelve", "I survive on ten", "I get by on fifteen" and "I'm on twelve and my wife is on ten" keep their figures.
    - "it goes off on 25", "it comes off on 1", "my debit order is on 15" and "I get paid on 25" stay days.
  - I kept the debit-verb case rather than requiring a month, "the" or an ordinal, because round 1's test pins "it goes off on 25" as a day.
- **"Twelve five" means R12 500.**
  - This is a second compound kind. A 10–99 phrase directly followed by a single unit word 1–9 gives the value a + b/10.
  - Under MONEY it is only ever a scaled value: "twelve five" → 12500, "twenty two five" → 22500, "fifteen five" → 15500.
  - Its parts are not scaled on their own, so the wrong 5000 twin is gone.
  - Without MONEY nothing is added.
  - "At twelve five" is a time.
- **Leftovers from the re-review, each a few lines:**
  - **Ages:**
    - A later clause with no "I" in it overrides a stated age only after a correction word (the re-review's change). So "the policy is 20 years old", "my house is 30 years old" and "the car is twenty years old" no longer override 42.
    - "Forty-two, no sorry, forty-three" still gives 43.
    - "Forty-two, forty-three", with no correction word, now keeps 42.
    - `notNow` also looks for a years word before "I'll be" or "turn", so "in 10 years I'll be 52" is no longer read as an age.
  - **A departed child said as "one".** In "one passed away", "one died", "one of them passed away" or "one has sadly passed on", the number (N) comes off the last group of more than one that was named. So "my wife and three kids, one passed away" → `{dependants:3, children:2}`, and "I have twins, one died at birth" → `{children:1}`.
  - **"Is no more"** is now a death cue, but not "no more than".
  - **The same person named twice.** In "my mom and dad, but my dad passed away", both mentions of a plainly said singular "dad" are treated as the departed one. "my other brother" is a different person.
  - **"A couple of hundred"** → 200 and "a couple of thousand" → 2000, both approximate. "A few hundred", "several hundred" and "many hundred" give no figure.

### Not fixed
These are re-review leftovers, all Minor and generous or refusing in direction.
- "At ten fifteen" → [10,15], "by three thirty" → 330, "at 10.15" → 10.15 and "Oct '26" → 26. These are clock and date forms not yet blanked. They are generous only: no ×1000 twins, because they are not alone and not rough.
- "I'm 30 next month" → 30, not 29. "I'm a 42-year-old teacher" → null. Both were like this before this round; the second is in the refusing direction.
- From round 1: "2 thousand 500" is not composed (strict on purpose); a bare decimal is still scaled, but flagged; "2019-2021" with no year cue is a range; "at 3 pm" stays a figure.

### Concerns
- Under 100, a money answer's twin is now generous by design. Non-money numbers in a money turn ("my son is 12", "I was 20 when I started") get a flagged twin. Task 2.3 must write `figure_scaled` for any kept value found in `scaled`, and should refuse a scaled value for labels that are never in thousands.

## Fix round 3

**Status:** DONE
**Worktree:** `/home/user/call/.claude/worktrees/agent-abc7d47294f0d4607`
**Branch:** `worktree-agent-abc7d47294f0d4607`, on top of 250b8b2
**Commit:** `ba50e90` Figures: only the client's own departed are uncounted (not pushed)
**Files:**
- `api/_lib/figures.ts`
- `test/figures.test.ts`: still 46 tests, with assertions added inside the existing ones
- `docs/superpowers/plans/2026-10-31-call-build.md`: a "fix round 3" notes line

### TDD evidence
- **RED:** I wrote the new assertions first. The focused run gave 43 pass and 3 fail, each for a behaviour reason. These are the outputs on 250b8b2:
  - "my husband who was 45 passed away, it's me and the two kids" → `{dependants:3, children:2}`
  - "my father aged 70 passed away, I support my wife and 2 kids" → `{dependants:4, children:2, parents:1}`
  - "my wife and 2 kids, my mom who was 80 died in June" → `{dependants:2, children:0, parents:1}`
  - "I support my wife and two kids and there is no more money left" → `{dependants:1}`
  - "my son is no more at school" → `{}`
  - "my mother is no more working" → `{}`
  - "my wife and two kids, but my brother's wife passed away" → `{dependants:2, children:2}`
  - "my mother in law passed away, I support my mother" → `{}`
  - "my wife's dad died, I look after my dad" → `{}`
  - "her mom passed away, I support my mom" → `{}`
  - "my debit order is R500 and my wife is on ten" → [500]
  - "in order to pay rent my wife is on ten" → []
  - "my payday is on 25 and my husband is on twenty" → [25]
  - "at ten fifteen" → [10,15], with flagged twins 10000 and 15000 under MONEY
  - "at three fifteen" → [3,15], with twins
  - "by three thirty" → [3,30,330]
  - "at 10.15" → [10.15], with twin 10150
  - "Oct '26" → [26], with twin 26000
  - "at 5" and "I finish at five" → twin 5000
- **A second RED, found while probing after the first green:** "my husband, who was only 45, passed away" → `{dependants:1}`. The husband was still counted because the cue's piece of the sentence has no subject. I added the test and saw it fail (45/1) before fixing it.
- **GREEN:**
  - focused 46/46;
  - `tsc --noEmit` exit 0;
  - `npm test` 217/217 and `npm run test:intel` 217/217;
  - `criteria --missing` lists no Task 2.1 id;
  - 0 unknown tags;
  - `grep-models` OK.
- **Regression diff against 250b8b2** (about 220 probes): the only differences are "at 5" and "I finish at five", which lost their flagged 5000 twin. That loss is intended. Every round-2 probe gives the same output as before.

### Fixed
- **Important (the count rules went too far).** I started from the re-review's four mutation-tested edits.
  - **(a) "N of them" needs the number to start its piece of the sentence** (after punctuation, "and", a segment word, or a person). Otherwise the cue falls through to the person named. So:
    - "my husband who was 45 passed away, it's me and the two kids" → `{dependants:2, children:2}`
    - "my mom who was 80 died" no longer zeroes the children
    - "my wife and three kids one passed away", with no comma, still gives 3/2
  - **(b) "is no more" is a death only when it ends the clause, and never after "there", "it", "that" or "this".**
    - "there is no more money", "my son is no more at school" and "my mother is no more working" keep the living person.
    - "my father is no more, I support my mom" still gives `{dependants:1, parents:1}`.
  - **(c) The same-person rule no longer matches across owners or in-laws.**
    - It skips a possessive owner ("brother's", "wife's"), "his/her/their/your" and a following "in law".
    - It also requires the same kind of relative.
    - "my brother's wife", "my mother in law", "my wife's dad" and "her mom" no longer remove the client's own wife, mother or dad.
  - **(d) My addition:** a death cue whose piece of the sentence has no subject is about the last person named. So "my husband, who was only 45, passed away" → `{}`, and "my wife and two kids, my dad, who was 70, passed away" → 3/2.
- **Minor: the debit cue for "on N" belongs to its clause.**
  - `DEBIT_TURN_RE` is gone. In its place, "debit", "debit order", "stop order", "payday" or "pay day" must appear within four tokens before "on", in the same clause.
  - "order" alone does not count.
  - A following "and" now ends the clause.
  - Results:
    - "my debit order is R500 and my wife is on ten" keeps 10
    - "in order to pay rent my wife is on ten" keeps 10
    - "my payday is on 25 and my husband is on twenty" keeps 20, and the 25 is a day
    - "the debit order is on 15 and I'm on twelve" makes the 15 a day and keeps 12
- **Minor: times that were not blanked.**
  - These are now times, with no figure and no twin:
    - "at/by/till/until" + hour 1–12 + minutes 1–59: "at ten fifteen", "at three fifteen", "by three thirty"
    - "at 10.15" (a dot time after one of those words)
  - "Oct '26" (a short year after a month) is now a date.
  - An hour 1–12 straight after "at" or "by" never gets a ×1000 twin ("at 5", "I finish at five"). "I'm at fifteen" keeps its twin.
  - **Correction to the round-2 report:** it said the unblanked clock and date forms got "no ×1000 twins". That was wrong after round 2's under-100 change, as the re-review showed. They are now blanked or blocked.

### Not fixed
These are all Minor, and each errs generous or refusing:
- "it's 10.15", a dot time with no "at" or "by", is still 10.15 and still gets a flagged twin under MONEY. "10.15" could be R10.15.
- "ten five to twelve five" does not compose a compound range.
- Two children counts are still too high, as before this round:
  - "I have three kids, one of my kids passed away" → 3
  - "my son and daughter, one passed away" → 2, because no group larger than one was named
- "nineteen eighty four" with no year word is still 1984.
- The leftovers listed in rounds 1 and 2 still stand.

### Concerns
- None new. As before, Task 2.3 must write `figure_scaled` for every kept value found in `scaled`, and refuse a scaled value for labels that are never in thousands.

## Fix round 4

**Status:** DONE
**Worktree:** `/home/user/call/.claude/worktrees/agent-a1b7e2a99b6868e64`. It was fast-forwarded to `worktree-agent-abc7d47294f0d4607` at ba50e90 first.
**Branch:** `worktree-agent-a1b7e2a99b6868e64`
**Commit:** `09e0348` Figures: pin every probed answer, and fix the departed and "at N" (not pushed)
**Files:**
- `api/_lib/figures.ts`
- `test/figures-corpus.test.ts` (new)
- `docs/superpowers/plans/2026-10-31-call-build.md` (a "fix round 4" notes line)

(The worktree isolation refused the shared-checkout path, so this report is written inside the worktree at the same relative path, `.superpowers/sdd/2026-10-31-call-build/task-2.1-report.md`. It is a copy of the shared report with this section appended. It is untracked and not committed.)

### The corpus (step 1)
`test/figures-corpus.test.ts` holds 595 rows in five table-driven tests. Each test lists every row that reads wrong, so a failure shows all the damage at once.

| Table | Reader | Rows |
|---|---|---|
| COUNTS | `countsFrom` | 198 |
| AGES | `ageFrom`, today 31 Oct 2026 | 61 |
| FIGURES | `figuresFrom`, no money question | 74 |
| MONEY_ANSWERS | `readFigures(…, MONEY)`: what is said, and what is flagged as scaled | 261 |
| RANGES | `rangeFrom(…, MONEY)` | 1 |

Where the rows came from:
- **471 rows** are the reviewers' probes:
  - the round-2 210-probe set (`r3/r2all.txt`), plus the rest of `r2/probes` (m1, m2, x run under MONEY);
  - every round-3 case file (`r3/c1`–`c5`, `m1`, `t1`, `f2`, `x`), which includes the 26 count cases.
- **124 rows** are this round's probes of the neighbours of the rules it added.

How the expected readings were set:
- Each row carries the reading the reviews agreed is right.
- A known leftover a review accepted is marked "accepted for now", with the right reading written beside it:
  - the compound ranges ("ten five to twelve five" and two like it);
  - "nineteen eighty four";
  - the "five past" twin.
- The rows carry no criteria tags.

### RED (on ba50e90)
- **The corpus as first written, 471 rows:** 63 rows fail.
  - countsFrom 29/131, ageFrom 3/43, figuresFrom 9/64, readFigures 22/232. rangeFrom passes.
  - The failures include every case rereview-3 names: "sadly / unfortunately / recently / last year / the / our youngest one passed away" → 4/3; "two have since passed away" → `{}`; "no more with us" → alive; "I'm at nine", "it's sitting at about ten" and "the overdraft is at five" with no twin; "went up by three fifty" → `[]`; "at 10.25%" → `[]`; "my debit order for the car is on 15" → [15]; "dead broke" → `{}`.
  - The 46 existing tests pass.
- **rereview-3's patch (mut2 + mut3) applied as given:** 21 rows still fail.
- **The final 595 rows:** HEAD fails 112 (57, 8, 11, 36). The mut3 patch alone fails 67.
- Output: `/tmp/claude-0/-home-user/ad36b136-336a-55d6-81b9-100e21138cdd/scratchpad/r4/red-head.txt` and `red-final.txt`.

### What changed
**The two round-3 Importants.** rereview-3's tested patch is applied as given:
- `CUE_FILLER` gains "since" and "already".
- "no more" accepts "with" and refuses "in".
- An `ageCue` exclusion replaces `pieceStart`, with a subset-size guard.
- The dot-time regex refuses a following "%" or "percent".
- `NOT_CLOCK_BEFORE` applies to the hour word and to the by/till/until compound.
- The debit window reaches the whole clause.
- The mut3 "dead" guard is folded in.

**Rows the patch still read wrong, now fixed:**
- **Counts:**
  - "dead" is a death only before the end of the clause, a time, a number or "to", so "are dead tired" and "we're dead broke" are the living.
  - "passed on the house" and "died laughing" are not deaths.
  - "no more by then" is a death.
  - "no more with" and "no longer with" are deaths only before us, me, them or you.
  - "sadly both passed away" now covers both.
  - A death said before the person ("recently passed away my mother", "died in 2020 my father", "also passed away is my wife") is about the person after it.
  - "one of my kids" and "one of the kids" come off the group named before.
  - A list of single children ("my son and daughter, one passed away") loses one.
  - More dead than the group and under 18 ("I have 2 kids and 3 passed away") are other people, so the two children are still counted.
  - "my dad, 70 passed away" is still the dad.
- **Ages:**
  - "at" before "I turn" is a place ("after 20 years at work I turn 50" → 49).
  - "my house is 30 years old" is not the client's age.
  - "Oct '84" is written out as 1984 (a two-digit year up to '39 is read as this century), so "born in Oct '84" → 42.
- **Figures:**
  - by, till and until after a change verb up to three words back are an amount: "they increased it by 2", "went up by 2.50".
  - "twelve five hundred" is R12 500 after a money question, flagged as scaled. The wrong 500 000 twin is gone.

**Found by this round's probes, fixed and pinned:**
- A spouse or parent named twice is one person: "my dad lives with us, I support my mom and dad" → 2.
- "I have three kids, one of my kids is at school" → 3 children, 1 under 18. It was `{}`.

### GREEN
- The corpus plus the existing 46 tests: 51/51.
- `tsc --noEmit` is clean.
- `npm test` passes 222/222 (217 + 5), and `npm run test:intel` passes 222/222.
- `criteria --missing` lists no Task 2.1 id, and there are 0 unknown tags.
- `grep-models` is OK.
- On the round-1 implementer probe set (`scratchpad/corpus.ts`, 96 sentences × 3 readers), my code reads the same as ba50e90 and as mut3.

### Pairs that cannot both be satisfied
None found. These are judgement calls, recorded in the corpus and the plan notes:
- **"I pay until twelve fifty" stays a time (`[]`).** rereview-3 listed it as a lost figure, but its own patch reads it as a time. Reading "pay" as an amount word also made "I'll pay by 10.30" a figure.
- **"the car is at three fifty" stays a time.** rereview-3's patch keeps "at" + hour + minutes a time.
- **"I have 3 kids and 3 passed away" is left unpinned.** It could mean "all three" or "three others".

### Not fixed (not in any corpus, found while probing)
- "my wife and my dad, 70 passed away": no group, and the list walk would take the wife too.
- "nine five hundred": a lead under 10 is not composed.
- "twelve five hundred and fifty".
- "at the end of the year I turn 50" → null.
- "it is 20 years old" → 20, read as a bare answer.

### Concerns
- None new. Task 2.3 must still write `figure_scaled` for every kept value found in `scaled`.
