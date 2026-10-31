# Task 2.4 report: Distress

**Status:** DONE
**Worktree:** `/home/user/call/.claude/worktrees/agent-ab827ef619f00fed9`
**Branch:** `worktree-agent-ab827ef619f00fed9` (fast-forwarded onto `worktree-agent-abc7d47294f0d4607` at 250b8b2 first)
**Commit:** `c9c16e4` "Distress rules with South African phrasing" (not pushed)

The shared-checkout report path was refused because this agent is isolated in the worktree. This copy is at the same relative path inside the worktree and is not committed.

## Files changed
- `api/_lib/distress.ts` (new): port of Charlie `safety.ts` `saysMoneyTrouble`, `saysSevereMoneyTrouble`, `saysSteadied`, why-comments kept, with an attribution header.
- `test/distress.test.ts` (new): 33 tests.
- `docs/superpowers/plans/2026-10-31-call-build.md`: Task 2.4 box ticked, plus a "Notes (decided while building)" line.

## TDD evidence
- RED: `TRACKING_OFF=1 node … --test test/distress.test.ts` failed with `ERR_MODULE_NOT_FOUND … api/_lib/distress.ts` (tests 1, pass 0, fail 1).
- First GREEN run: 31/32. `"I can't pay my accounts any more"` read as past-and-over, because "any more" was treated as "over". Fixed so "any more" means over only after a negation ("not blacklisted any more").
- I then ran a probe of about 80 realistic sentences. It found 8 misses, all fixed and added as regression tests:
  - "I'm going to pay" form
  - "debt collection" and "debt collector" as the client's job
  - "I'm a sheriff"
  - "can't pay by card"
  - "can't afford to lose my job"
  - the sheriff attaching the TV (now severe)
  - "can't afford to eat" (now severe)
  - "garnish the salad"
- Final runs:
  - focused: 33/33
  - `npm test`: 250/250
  - `npm run test:intel`: 250/250
  - `npm run typecheck`: clean
  - `npm run grep-models`: clean
  - `npm run criteria -- --missing`: none of my ids listed
  - `npm run criteria -- --check`: 0 unknown tags. It still exits non-zero, but only for the 1,222 criteria other tasks own.

## Criteria tagged
C-0205, C-0206, C-0207, C-0208, C-0209, C-0210, C-0211, C-0212, C-0213, C-0549.

C-0549 is owned by `test/facts.test.ts`. Here it asserts the "distress NOT triggered" half of its then-clause. Task 2.3 should tag it again for the `owes/informal` refusal.

## Exports (interfaces for later tasks)
- `saysSevereMoneyTrouble(text)`, `saysMoneyTrouble(text)` and `saysSteadied(text)`. Severe implies mild, as in Charlie.
- `readDistress(text) → { level: "severe"|"mild"|null, phrase, clause, discounted: [{ phrase, clause, why: "someone_else"|"negated"|"past_steadied" }] }`. Ingest can use it for the hardship-note quote and the `safety_events` detail.
- Phrase lists, for Task 4.3 and C-0201:
  - `AGENT_DISTRESS_PHRASES` (the §4.6 list)
  - `SEVERE_TROUBLE_PARTS`, `MILD_TROUBLE_PARTS`, `RECOVERY_PARTS`
  - `SEVERE_TROUBLE_RE`, `MONEY_TROUBLE_RE`, `RECOVERY_RE`: words only, with no clause logic, and non-global.

## Decisions (also in the plan notes)
1. **Rules apply per clause.** A match does not count when its clause is:
   - **About someone else.** The nearest person before the match decides, else the first one after it. "He" and "she" point back to the last person named. "They" counts as the creditor, unless it follows a named person in the same sentence ("my parents, they're under debt review").
   - **Negated.** A negator in the four words before the match counts, but not "don't want". "No" counts only right before the trouble. An echo answered no ("Debt review? No.") also counts.
   - **Past and over.** This needs a past marker plus a steadied clause, or "used to", "no longer", or the trouble named as finished ("paid off the arrears", "off debt review", "garnishee was lifted").
2. **The brother case (C-0212) returns false for both levels**, with `discounted: someone_else`. It is the brother's distress, the same line facts.ts draws for someone_else.
3. **A spouse, partner or the kids count as the household**, so "my husband is under debt review" is severe. Their trouble comes out of the same money that pays the premium.
4. **Past and over is not severe, but stays mild.** This gives the broker an affordability heads-up.
5. **Leaning to severe on ambiguous words.** A false positive only means the broker calls first, so the rules lean to severe:
   - Past without a word that it is over stays severe ("we used a mashonisa last month", "I was blacklisted years ago").
   - Present trouble is never cancelled by "I'm fine now".
   - Questions about debt review are severe.
6. **Charlie's ordinary-debt words are out of mild**: "I owe", "my loan", "take a loan", bare "lender", generic "borrowed money", "liquidate", "broke again". The fact-find asks about debt, so with those words left in, every client with a bond would be flagged. Budget caps, payment methods and "can't afford to lose my job" are also not distress.
7. **Trimmed from Charlie**: the trade-only phrasing (staff, suppliers, stock, auctioneers, KCCA) and the "ready to build the plan" recovery half.
8. **"Skuld" alone does not trigger**, because it also means fault. Afrikaans needs a phrase ("in die skuld"). A few cheap isiZulu forms are in: "angikwazi ukukhokha", "anginamali", "kumashonisa".

## Concerns
- **Pure code, with no `capture()` call.** distress.ts adds no entry point, check row, send or model call, and `api/_lib/intel.ts` does not exist on this line yet. The caller that writes `safety_events` will need to capture: ingest, Task 3.x / 4.x.
- **C-1457** ("every check in distress.ts writes one safety_events row") assumes a check function lives here. As built, distress.ts holds only predicates. The orchestrator should decide whether a `checkDistress()` wrapper belongs here or in ingest.
- **Known heuristic limits:**
  - "my brother owes the loan sharks and they're after me" reads false. The trouble is in the brother's clause.
  - "the company I work for is under administration" reads severe.
  - "I don't think they'll repossess the car" reads negated.

## Fix round 1

**Status:** DONE. Commit `f967be0` "Distress: the client's own trouble, said any way, is never discounted", on top of `c9c16e4`, not pushed. This is the worktree copy again: the shared path is outside this agent's isolation.

### TDD evidence
- RED first. I added `test/distress-corpus.test.ts`: the reviewer's probe set plus my round-1 probe set, table-driven, grouped by finding. I also updated the unit tests whose answers ruling R23 changes. Result: 12 failing.
  - Every corpus group failed. Critical 1 was 18/18 wrong, Critical 2 9/11, Important 3 13/13, Important 4 29/29, Important 5 6/6, Important 6 4/5, Minors 9/10 and languages 4/4.
  - The unit tests for group order, "they", "better is not over" and household failed too.
- GREEN after the rewrite: 46/46.
- A second probe looked for new false alarms from the broader rules. It found 9, all fixed and pinned as a corpus group:
  - "can't pay it all at once"
  - "nothing is in arrears"
  - "handed over the keys" and "handed over to my wife"
  - "can't afford to eat out"
  - "maxed out my gym sessions"
  - "my ex can't pay maintenance" and "my ex-husband is under debt review"
- Final runs:
  - distress tests: 47/47 (corpus 242 rows)
  - `npm test`: 264/264
  - `npm run test:intel`: 264/264
  - typecheck: exit 0
  - grep-models: clean
  - criteria: 0 unknown tags, none of C-0205–C-0213 or C-0549 missing
- Speed:
  - a realistic 30k-character turn: about 30 ms
  - adversarial repeats: 3–13 ms
  - a pathological 26k-character run of "I can't pay, " in one sentence: 144 ms

### What changed (ruling R23: lean to flagging; a discount only in its own clause, only when unambiguous; the client's live trouble anywhere wins)

**Critical 1: past-and-over on live trouble.**
- `ENDED_BEFORE` now accepts only completed forms: paid off/back/up, settled, cleared, came/got off, finished, done with, "I'm off", "got rid of".
- It never fires when the clause has can't, trying, want, how, get, never, not, still, will or similar.
- The new `STILL_IN` rule keeps "not out of debt review yet", "never be free of" and "can't get out of" live.
- "Used to" counts only when it governs the trouble. "And now" ends the clause.
- The turn-wide `steadied` flag is gone. C-0213 is now its own rule. It needs:
  - a past verb or time on the trouble;
  - no present marker right before it;
  - the very next clause in the same sentence saying, of the client, that it is over (`OVER_RE`: fine/ok/sorted now, paid off, done, cleared, clearance certificate).
- "Better", "improving", "picking up" and "looking up" never count. `saysSteadied` keeps Charlie's "eased" meaning and no longer feeds any discount.

**Critical 2: someone-else.**
- A client ref in or after the match ("my salary", "my house", "me") decides first.
- A group ref counts as the client: "me and my brother", "my brother and me", "both of us", "me too". The clause-break no longer splits "me and …".
- "They", "someone", "people", "everybody" and "anyone" are neutral and never decide.
- Son and daughter are household. "My ex" is someone else.
- No party is carried from an earlier clause. "He" and "she" still point back to the last person named, because they are never the speaker.

**Important 3: "can't pay".**
- `CANT` adds: can no longer, no longer able to, not been able to, wasn't able to, failing/failed to.
- `PAY` adds: pay back/off, repay, afford to pay.
- The `$` anchor is replaced by `NOT_A_CAP`. Caps, methods, products and "it all at once" stay out.
- isiZulu "angikwazi ukukhokha", isiXhosa "andikwazi ukuhlawula" and Afrikaans "kan nie (meer) betaal", "het nie geld vir kos" are severe.

**Important 4: vocabulary.**
- Added as severe:
  - missed payments; defaulted / in default
  - handed over (to attorneys or collections); a judgment against me
  - a court order or EAO / emoluments attachment on the salary
  - a sale in execution; on auction
  - the power or water cut off (not load shedding or maintenance)
  - no money, or not enough, for food; can't feed the kids
  - not enough money to pay the bond; behind on everything; behind on paying
  - nothing left once the debit orders go off; take home nothing after deductions
- Added as mild:
  - short every month
  - the money runs out before month end
  - borrowing every month or to get to month end
  - a maxed-out card or limit

**Important 5: negation.**
- The window reaches back only to the last and/or/if/that/until or subject.
- Neg-raising "don't think / believe" stays negated.
- Factive verbs (didn't know, never thought, realise) do not negate.
- "Don't want to be / end up / get into" is negated. "Don't want them to …" is not.

**Important 6: debit orders.**
- `ASSET` has a lookahead, so a car payment, instalment, finance, a service or "in for" is not the car.
- The take-pattern needs taking/took/coming for or an intent form. Plain "takes" does not count.

**Minors.**
- 1: "is a debt collector", a debt review company, the arrears department, evicting a tenant and an employer under administration are none.
- 2: covered under Important 5.
- 3: a bare "None." answer negates.
- 4: the employer under administration reads none.
- 5: the [C-0211] mis-tag is removed from the negation test.
- 6: C-0549's `owes/informal` half is **Task 2.3's** (`test/facts.test.ts`) and is not asserted here. Only "distress NOT triggered" is, as a comment in the test now says. Because `criteria.ts` counts a tag in any file, C-0549 is already off `--missing`, so **the Task 2.3 brief must name C-0549 explicitly**.
- 7: languages are aligned.

### Unit-test expectations R23 changed
These were none or mild and are now severe:
- "my parents, they're under debt review"
- "everyone here uses a mashonisa"
- "I had to borrow from a mashonisa last year, things are better now"
- isiZulu "angikwazi ukukhokha"

### Concerns
- **Known false positives the ruling accepts.** These read severe:
  - general remarks with "people" or "they" ("people can't pay their bills these days");
  - helping others with debt review ("I help people get out of debt review");
  - a voluntary auction ("I put my car up for auction").
- **Turns made only of distress phrases.** Very long turns that are nothing but distress phrases are O(n²) in one sentence (144 ms at 26k characters). Ordinary turns are well under that.
- **Still open from round 1:** C-1457 (whether a `checkDistress()` that writes `safety_events` lives here or in ingest), and no `capture()` because the module is pure.
