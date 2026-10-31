# Task 2.1 review: Figures (`api/_lib/figures.ts`)

Reviewed: base 67fd21d, head ec24411. I read the worktree files (`api/_lib/figures.ts`, `test/figures.test.ts`) and the plan diff. I also ran focused probes with `node --experimental-strip-types` against the worktree's `figures.ts`, about 300 inputs in all. I did not re-run the suite.

### Spec Compliance

Interfaces (brief):
- ✅ `figuresFrom(text, ctx?)` figures.ts:590. `ageFrom(text, today)` figures.ts:824. `countsFrom` figures.ts:902. `isApprox` figures.ts:656. `rangeFrom` figures.ts:595. `bandFor` figures.ts:667. `AgeBand` figures.ts:37. `formatRand` figures.ts:1017. `parseMoneyInput` figures.ts:1031.
- ✅ The additions are additive and optional: `readFigures → {figures, scaled}` (figures.ts:564), the optional `ctx` on `rangeFrom`, and the exported types. They are recorded in the plan notes.

Criteria (each tagged test asserts its then-clause):
- ✅ C-0563–C-0580: money forms (test:40–180). Each asserts `has(...)` on the criterion's own text, plus `lacks(...)` guards where a wrong parser would differ:
  - "R12 000" must not give 12.
  - "12km" must not give 12000.
  - "a bar" must not give 1000.
  - "10,15" must not give 10.15.
  - "25th", "on the twenty-fifth" and "on the 25 of every month" must not give 25.
  - "since 2019", "since twenty nineteen" and "in two thousand and nineteen" must not give 2019.
- ✅ C-0579: "ten to fifteen" gives 10000 and 15000 only with `MONEY` (test:158–169), and stays 10 and 15 without it.
- ✅ C-0525: test:184. 10000 is in the figures, `scaled` equals `[10000]`, and `isApprox` is true. The other half of the then-clause (fact kept, `safety_events(figure_scaled)`) belongs to Task 2.3, and the file header says so.
- ✅ C-0526: test:201. A bare "ten" stays 10 without a money question. "ten years", "two kids", "ten percent" and "10%" are never scaled, even after a money question. This covers Review Focus 1. The implementer's mutation check (making scaling unconditional) failed C-0525/C-0526/C-0576/C-0579, so the tests do tell the right and wrong implementations apart.
- ✅ C-0531: test:223. The range is 10000–15000 with mid 12500, approx is true, 12500 is a figure, and the bare 10 is not.
- ✅ C-0532: test:246. `{band:"25-34", approx:true}` with no `age`.
- ✅ C-0581–C-0586: test:290–344. Exact `deepEqual` checks. C-0585 pins age 42 in October and 41 in February, both with band 35-44 and approx. C-0586 returns null for someone else and still finds the client's own age next to someone else's.
- ✅ C-0587, C-0588, C-0590: exact `deepEqual` on the criterion text (test:363, 371, 392).
- ⚠️ C-0589 (test:377) is a defensible reading. The given text, "one is at varsity", has no "under 18"/"at school" cue, so `children_under_18` is absent (the criterion says "else null"). Text with a cue gives 2. "Absent" stands in for null because the interface field is optional. If the orchestrator reads the row as "this text gives 2", only one assertion and the varsity handling change.
- ✅ C-1163: `parseMoneyInput("12 000") === 12000` (test:410). Rand, not cents, consistent with `facts.value_num` in C-0525.
- ✅ SPEC §8.2 and C-0808/C-0809 values: `formatRand` gives "R 850", "R 1 235" and "R 1 500 000", in whole rand with ASCII space thousands (figures.ts:1017). These are tested but not tagged, correctly, because price.test.ts owns those ids.
- ✅ SPEC §7.3 rule 3: every way of saying money listed in the rule is read, and "about" sets approx.
- ✅ Pure. There are no imports, no clock (`today` is passed in) and no I/O. The header attributes the port to Charlie (`grounding.ts`, `phones.ts`) and keeps the why-comments.

### Strengths

- **One grammar for all of it.** A tokenizer plus a phrase reader (figures.ts:185–460) covers the cases below. Every probe I tried came out right:
  - digits with space or comma thousands, and the decimal comma only before a scale or currency;
  - k, m, bn, mil, grand and bar, with "bar" and "k" only after a numeral;
  - words with "and", "and a half", "point", "half a"; Afrikaans compounds; the isiZulu expansions;
  - the "five thousand and two kids" checkpoint;
  - a far-end scale carried back ("ten to fifteen thousand", "10-15k", "two to three hundred").
- **The scaling design is honest.** The unscaled value stays in the set. Every value that is there only because of ×1000 is reported in `scaled`, so Task 2.3 can write `figure_scaled`. A count noun after a number, a currency or a scale word, and "-ish" all stop scaling.
- **No false ranges.** A descending pair is not a range ("R500 to R450", "R5 000 to 10 people"). This is a cleaner rule than Charlie's ×10 heuristic.
- **Phones and IDs are blanked before parsing**, as in Charlie: 079 993 1234, +27 79 993 1234, a 13-digit ID and "850101 5009 087". ISO dates are blanked too.
- **Ages refuse to over-claim.** No band is given when the words span two bands ("mid forties", "30 to 40", born 1981). Someone else's clause is skipped. The last correction wins.
- **No throws on garbage.** I tried `undefined`, `null`, `{}`, `[]`, NUL, emoji, Arabic digits, and 40–100k-character adversarial strings ("1 1 1 …%", nested parens, repeated words). Each run of all four readers took 5–260 ms. `parseMoneyInput` returns null on non-strings. `formatRand` throws `RangeError` only on non-finite input, and that is documented.
- **The tests can fail.** They have negative lists (`isApprox` with "about funeral cover", "I finish at five"), exact `deepEqual` on counts and ages, and `lacks` guards on every money criterion.

### Issues

#### Critical

None.

#### Important

1. **`ageFrom` reads any "N years" duration as the client's age, and because the last clause wins, it overrides an age stated in the same turn.** Location: figures.ts:793–796, line 795 (`["years","yrs","year"].includes(w(p.end))`), together with the last-wins rule at figures.ts:857.
   - Probes, today 2026-10-31:
     - `"I'm 42 and I've been married 20 years"` → `{age:20}`
     - `"I'm 42, been working there 20 years"` → `{age:20}`
     - `"I'm 42. I want cover for 20 years."` → `{age:20}`
     - `"I need cover for 20 years"` → `{age:20}`
     - `"my bond is for 30 years"` → `{age:30}`
     - `"the bond has 18 years left"` → `{age:18}`
     - `"it's a 20 year bond"` → `{age:20}`
   - **Why it matters:** cover terms, bond terms, years employed and years married come up all the time on an insurance fact-find. The age picks the pricing band (§8.2 `premiumFor`), so a wrong age gives a wrong premium. The doc comment promises "the client's own age, from what they said". This breaks that promise, and it breaks R2 for any consumer that trusts `ageFrom`.
   - **Fix:** in the `opts.neutral` block, count a number as an age only when "years" is followed by "old" or "of age" (`42 years old`, `42 years of age`). Keep the `aged N` / `age N` cues. A bare "42 years" given as the whole answer is still read through the bare-answer path, because "years" is in `AGE_FILLER`.
   - **Tests to add:** `"I'm 42 and I've been married 20 years"` → `{age:42, approx:false}`; `"I need cover for 20 years"` → null; `"it's a 20 year bond"` → null.

2. **`countsFrom` counts dead relatives as dependants.** Location: figures.ts:911–960. The mention loop has no deceased cue, so the household total at figures.ts:1001–1006 includes them.
   - Probes:
     - `"my dad passed away so it's just my mom"` → `{dependants:2, parents:2}`
     - `"my late husband and my two kids"` → `{dependants:3, children:2}`
     - `"my husband died last year, so it's me and the two kids"` → `{dependants:3, children:2}`
     - `"my father is deceased"` → `{dependants:1, parents:1}`
     - `"my mom is no longer with us"` → `{dependants:1, parents:1}`
   - **Why it matters:** on a South African funeral-cover call, a death in the family is often the reason for the call. A supported parent or spouse who has died is the parser claiming something the client did not say (R2). It would inflate `parents_supported`/`dependants`, and so the cover and the premium.
   - **Fix:** in the client's clause, give a mention qty 0 or drop it when any of these appear around it:
     - "late" directly before the noun;
     - "passed away", "passed on", "passed", "died" or "deceased" after the noun;
     - "no longer with us" after the noun.
   - **Tests to add:** the first two probes should give `{dependants:1, parents:1}` and `{dependants:2, children:2}`.

#### Minor

1. **After a money question, non-money numbers also get ×1000 twins.** Location: figures.ts:530–531, 573.
   - Probes, all with `{moneyContext:true}`:
     - `"I'm 42"` → 42000 (scaled)
     - `"the funeral one and 200 for the other"` → 1000 (scaled)
     - `"number 1 is rent"` → 1000 (scaled)
     - `"debit order on 15 March"` → 15000 (scaled)
     - `"at 15:30"` → 15000 and 30000 (scaled)
   - **On the question about R2 and R5:** the loosening itself is required. C-0505 needs "about 180 on the car" → 180000, so digit numbers must scale. It is acceptable because every twin is in `scaled`.
   - R5 is not directly affected. Per §7.8 the checker's allowed set comes from fact values and computed figures, not from turn figures. A wrongly kept fact does flow into that set, though.
   - The real guard is Task 2.3. It must write `figure_scaled` for every kept value in `scaled`, and it should consider refusing a scaled value for labels that are never in thousands (`monthly_budget`, a premium on `has_cover`).
   - **Tightening that is cheap here:**
     - a number right after `i'm`/`im`/`aged`/`number`/`no.` is not bare;
     - nor is the pronoun "one" after an adjective or noun ("the funeral one");
     - nor is a number that is part of a day-month date or a clock time.

2. **Dates and times are still read as figures, except ISO dates and "on the 25th".** Location: figures.ts:230, 521.
   - Probes:
     - `"on 15 March"` → 15
     - `"it goes off on 25"` → 25
     - `"31 October 2026"` → 31
     - `"10/12/2025"` → 10, 12 and 2025
     - `"at 15:30"` → 15 and 30
     - `"from 2019 to 2021"` → 2021
   - Day-month order is the SA convention. The cost today is only a looser rule 3, but each one also gains a twin under minor 1.
   - **Fix:**
     - blank `\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b` and `\b\d{1,2}:\d{2}\b` the same way as ISO dates;
     - skip an integer 1–31 directly before a `MONTH` word, or after "on"/"every" with no "the" in between;
     - treat the far end of a year-cued range as a year as well.

3. **"three fifty" and "one fifty", the usual SA way of saying a premium, are not composed.** Location: figures.ts:343–349, where tens are accepted after a unit only via "en".
   - Probes: `"three fifty"` → [3, 50]. `"about one fifty"` with a money question → [1, 50, 1000, 50000], with no 150.
   - This fails in the refusing direction (`figure_not_said`), so it is safe for R2, but it misses common speech.
   - **Fix:** when a unit 1–9 is directly followed by tens 20–90 with no "hundred", also add `unit*100 + tens` as an alternative figure.

4. **Afrikaans "honderd en …" is not composed.** Location: figures.ts:412–418 (`en` only after a unit) and 211–214 (a hyphenated compound is not split).
   - Probes: `"vyfhonderd en vyftig"` → [500, 50]. `"twee honderd en vyftig"` → [200, 50]. `"tweehonderd-en-vyftig"` → [].
   - The `afrikaans-money` fixture (Task 2.x fixtures) is likely to hit this. It fails in the refusing direction.
   - **Fix:** accept `en` after `hundred` the way `and` is accepted (figures.ts:399), and split hyphen parts through the compound rule.

5. **Digit-normalised speech-to-text output is not composed.** Location: figures.ts:312 ("digits only ever start a phrase").
   - Probe: `"1 million 200 thousand"` → [1000000, 200000], not 1200000.

6. **"-ish" blocks money-context scaling.** Location: figures.ts:531 (`!p.ish`).
   - Probe: `"ten-ish"` after an income question gives no 10000, while `"about ten"` does.
   - The two are inconsistent, though the inconsistency fails in the refusing direction. Either scale "-ish" too, or leave a comment saying why it is excluded.

7. **`formatRand` rounds negative halves asymmetrically.** Location: figures.ts:1019.
   - Probe: `formatRand(-150)` → "-R 1", while `formatRand(150)` → "R 2". `Math.round` rounds halves toward +∞.
   - **Fix:** `const rand = Math.sign(cents) * Math.round(Math.abs(cents) / 100);`

8. **`ageFrom` with an invalid `Date` returns a bogus band.** Location: figures.ts:703–718.
   - Probe: `ageFrom("born in 1984", new Date("x"))` → `{age: NaN, band: "18-24", approx: true}`. NaN passes the `<`/`>` guards, and `bandFor(NaN)` falls through to "18-24".
   - **Fix:** return null when `!Number.isFinite(today.getTime())`, or guard with `Number.isFinite(age)` in `aroundThisYear`.

9. **The filler skip in `isApprox` stops at punctuation.** Location: figures.ts:643.
   - Probe: `"uh about, like, twelve"` → false.

10. **`countsFrom` drops a child mentioned only as "one".** Location: figures.ts:944–955.
    - Probes: `"two kids at school and one at varsity"` → `children: 2` (there are 3). `"two kids from my first marriage and one with my wife"` → `children: 2`.
    - The count comes out under, not over, and the agent asks anyway.

11. **Process note for the orchestrator, not an implementer defect.**
    - C-0525/C-0526/C-0531/C-0532 (owner `test/facts.test.ts`) and C-1163 (owner `test/app.test.ts`) are tagged here with figures-level assertions. The brief sanctions this.
    - `scripts/criteria.ts` counts a tag anywhere in `test/**`, so these ids no longer appear in `--missing` before their own then-clauses are tested. Those are the `figure_scaled` row, the `is/age_band` fact and the 422/edit HTTP path.
    - Task 2.3's Step 1 range (C-0500…C-0562) still names the four facts ids. Make sure the app task re-tags C-1163 from its own checklist rather than from `--missing`.

12. **Advice for Task 6.2 (R5).** If `checkQuoteText` reuses `figuresFrom` to pull numbers out of the writer's text, the skip rules will hide invented numbers from the checker: years after in/since, days, phone-length runs, the "10,15" split and the pronoun "one". Use a strict "every digit run" extractor there. `figuresFrom` is built to be generous to the client, not strict with the writer.

### Assessment

- **Spec compliance:** ✅. All 33 tagged criteria assert their figures-level then-clause. Interfaces match the brief, with additions only. Review Focus 1 is pinned and was mutation-checked.
- **Task quality:** Needs fixes. Two Important issues: `ageFrom` takes any "N years" duration as the age and lets it override a stated age, and `countsFrom` counts dead relatives as dependants. Both are realistic on a South African insurance call. Each fix is small and local and needs two or three new tests. The 12 Minor items can be fixed now or deferred to the plan notes. Minors 1 and 2 are the ones that matter most to Task 2.3.
