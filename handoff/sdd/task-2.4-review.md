# Task 2.4 review: Distress (`api/_lib/distress.ts`)

Diff 250b8b2..c9c16e4. Worktree `/home/user/call/.claude/worktrees/agent-ab827ef619f00fed9`. Line numbers are worktree file lines. I probed `readDistress` with about 190 realistic South African sentences (`node --experimental-strip-types`). I did not re-run the suite.

What each error costs (from the brief):
- **False severe:** the sale stops. The broker can recover that.
- **False negative:** a policy is sold to someone in debt distress. That is the harm R6 exists to prevent.
- **Severe read as mild:** the policy is still quoted. It only carries an `affordability` flag.
- **Read as none:** no flag at all.

### Spec Compliance

- ✅ Files: `api/_lib/distress.ts` and `test/distress.test.ts` are new. The plan box is ticked, with a Notes line (plan:617-620).
- ✅ Port: `saysMoneyTrouble`, `saysSevereMoneyTrouble` and `saysSteadied` are ported. The header names its source, as A5 requires (distress.ts:1-5), and Charlie's round-23 and live-test why-comments are kept (distress.ts:114-118, 195-203).
- ✅ C-0205 to C-0213: each then-clause is asserted literally, in tagged tests (test:56, 70, 82, 92, 99, 152, 168, 222, 321).
- ✅ C-0549: the "distress NOT triggered" half is asserted (test:232). The `owes/informal` half belongs to Task 2.3 (see Minor 6).
- ✅ SPEC §7.5: all seven SA words are on the list and are severe when the client says them of themselves (test:108).
- ✅ SPEC §3.3: the example triggers pass ("they're repossessing", "I've got nothing left after the loans", "arrears", "garnishee").
- ✅ AGENT-PROMPT §4.6: the list is exported as `AGENT_DISTRESS_PHRASES` (distress.ts:74), with one canonical sentence per phrase.
- ✅ Orchestrator ruling: the module is pure, writes no `safety_events` row, and needs no `capture()`. That is right for a module of predicates.
- ✅ The commit subject and attribution lines are as the brief requires.
- ⚠️ **R6 / §7.5 intent: the floor misses realistic first-person distress.** There are two separate causes:
  - The discount rules over-fire, so severe becomes mild or none (Critical 1, Critical 2, Important 5).
  - Vocabulary is missing, including the agent's own first word "can't pay" (Important 3, Important 4).

  The §4.6 agreement test (test:108) checks only one shape per phrase, so it cannot see the gap that C-0217 depends on: the agent switches and the code disagrees.

### Strengths

- **Ordinary fact-find debt is quiet.** Every ordinary answer in the brief's focus reads `none`: "I owe about R40k on the car", "my credit card is R12 000", "my credit card is about twelve thousand", "I've got about R2 000 on my Edgars account", "half my salary goes to the bond". Dropping Charlie's "I owe", "my loan" and "take a loan" is the right call and is well argued (distress.ts:28-35). Budget caps and payment methods are also not distress (test:194-220).
- **The focus negations work:**
  - "I'm not under debt review", "never been blacklisted" and "I've never been blacklisted" read none.
  - "Debt review? No, never." reads none: the echo answered no.
  - "No, I'm under debt review" stays severe.
  - "I don't want them to repossess the car" stays severe.
  - "I'm not under debt review, but I'm behind on the bond" stays severe.
- **The focus past-and-over cases work:**
  - "I was under debt review, it's done now" and "…I've got my clearance certificate" read mild.
  - "the bank repossessed the car last year" stays severe, because nothing says it is over. That is a sound lean.
  - Past and over → mild rather than none is a good decision: the broker still gets the heads-up.
- **The judgement calls in the report are sound:**
  - A spouse, partner or the kids count as the household. This matches C-0548's `household_income` carve-out and R6's question, which is whether the household can pay.
  - "What's debt review?" → severe is the cheaper error, because the agent never raises the term.
  - "Skuld" alone is not debt ("dis my skuld" means "it's my fault").
  - "my employer is under business rescue" → none is right.
- **`readDistress()` returns `phrase`, `clause` and `discounted[{why}]`.** That is the right interface for the hardship-note quote and the `safety_events` detail. The raw `*_RE` exports are non-global, so callers have no `lastIndex` state to trip on.
- **Charlie's false-positive guards are kept or extended:** garnish the salad, repossess my time, blacklisted their number, going under the knife, I'm a sheriff.
- **It is fast enough.** A 6,600-word turn takes about 13 ms. Adversarial inputs of 15-40k characters ("very " × 5000, "they " × 5000) finish in under 20 ms, with no catastrophic backtracking.

### Issues

#### Critical

**1. `past_steadied` fires on live trouble: three routes turn severe into mild.**

Where: distress.ts:442-443 (`ENDED_BEFORE`), :454 and :536 (`USED_TO.test(c.text)`), :515 and :538 (a `steadied` flag for the whole turn), and :275 (`RECOVERY_PARTS`).

All of these were probed and read **mild**:

- **(a) `ENDED_BEFORE` matches "out of / off / free of / rid of / paid" with no check of what governs it.**
  - "I can't get out of debt review"
  - "I'm trying to get out of debt review"
  - "How do I get out of debt review?"
  - "I'm not out of debt review yet"
  - "I want to get rid of the mashonisa"
  - "I'll never be free of the loan sharks"
  - "we're living off the mashonisa"
  - "I paid the loan shark R500 interest this week"
  - "I've paid the garnishee for two years and there's still R30 000 to go"

  The words that say the client is stuck are what discount the trouble. "Trying to get out of debt review" is perhaps the most natural thing a client under debt review says.
- **(b) `USED_TO` is tested against the whole clause, and "and now" does not break a clause.**
  - "I used to earn more and now I can't pay the bond"
  - "I used to pay the bond on time and now I'm three months behind"
- **(c) The steadied flag covers the whole turn, belongs to nobody, and counts "better, getting better, improving, picking up, looking up" as over.** Any past marker in the clause ("last month", "was", "went", "got") then discounts a garnishee, arrears or eviction that is still running.
  - "I got a garnishee order last month, but things are getting better"
  - "we were evicted last month, things are looking up now"
  - "I went into arrears last month, it's improving"
  - "Since my husband passed last year we've been behind on the bond, but it's getting better"
  - "I was told I'm blacklisted, but I'm fine now"
  - "My brother's business is picking up. I got a garnishee order last month." The brother's sentence steadies the client's live garnishee.

Charlie's RECOVERY_RE was built to let an owner leave stabilising mode. Here it is reused as evidence that a trouble is *over*, which is a different claim.

Fix:
- Have `ENDED_BEFORE` accept only completed forms: paid off, paid back, paid up, settled, cleared, came off, got off, finished with, done with. It must not fire when the clause before it has can't, cannot, trying to, want to, how (do|can) I, never, not or get.
- Test `USED_TO` only when "used to" governs the matched trouble: it is in the text before the match, with no "now" or new verb in between.
- For C-0213-style discounting, use a separate list of "over" words: fine, ok, sorted, settled, paid off, cleared, done, over, behind me. Leave out better, improving, picking up, looking up, easier and calmer. The client's own clause must say it, in the same sentence or the next.
- Make lasting statuses (garnishee, debt review, blacklisting, administration, sequestration) need an explicit end (`ENDED_*`).
- Update test:334 ("I had to borrow from a mashonisa last year, things are better now"). "Better" is not "over".

**2. `someone_else` swallows the client's own distress: severe becomes none, with no affordability flag either.**

Where: distress.ts:312 (`OTHER_PERSON`), :314 (`HOUSEHOLD`), :321 (`REF_RE`), and :419-431 (`partyOf`, where the nearest person before the match wins).

All of these were probed and read **none**:

- "Me and my brother are blacklisted" and "Me and my mom are under debt review". The SA word order defeats the test:254 case "my brother and I".
- "I stood surety for my brother and now the bank is coming for my house". The matched phrase itself contains "my house".
- "My boss says there's a garnishee order on my salary". The match is followed by "my salary".
- "someone from the bank said they're going to repossess the car". "Someone" is the creditor's messenger, but it counts as `named_other`.
- "Everybody's blacklisted these days, me too".
- "my son goes to bed hungry". `sons?` and `daughters?` are in OTHER_PERSON while kids, children, child and baby are in HOUSEHOLD, so a hungry child counts or not depending on the noun.

Fix:
- A client possessive inside the match, or right after it in the clause ("my house", "my salary", "my car"), decides before the rule of the nearest person before.
- "me and X", "X and me" and "both of us" count as the client.
- someone, somebody, people and everybody are neutral (`party: null`), not other.
- Move son and daughter to HOUSEHOLD (§7.3 `supports.children_under_18`).
- Add each of the sentences above as a regression test.

#### Important

**3. "Can't pay", the agent's first §4.6 word, is severe only in narrow shapes.**

Where: distress.ts:130 (the `\s*$` anchor), :95 (`CANT`) and :127 (the verbs).

- Read **mild**:
  - "I can't pay, I lost my job"
  - "I can't pay right now"
  - "I can't pay this month"
  - "i cant pay i lost my job", as an unpunctuated transcript
  - "I can't pay back the loan"
  - "I can't afford to pay the bond anymore"
  - "we are failing to pay the bond"
  - "I can't pay my creditors"
- Read **none**:
  - "I can no longer pay the bond"
  - "I'm no longer able to pay the bond"
  - "I can't repay the loan"
  - "I've not been able to pay the rent"
  - "I wasn't able to pay the bond last month"

The prompt stops the sale on all of these, but the floor would not.

Fix:
- Add to `CANT`: "can no longer", "no longer able to", "not been able to", "wasn't able to", "failing to".
- Add to the verbs: repay, pay back, pay off, afford to pay.
- Replace the `\s*$` anchor with the `NOT_A_CAP` lookahead, so caps and methods still stay out.
- Make sure "no longer" before a "can't pay" does not turn into `past_steadied`.
- Add two or three sentence variants per phrase to test:108.

**4. SA distress vocabulary is missing.**

Where: `SEVERE_TROUBLE_PARTS` (distress.ts:120-190) and `MILD_TROUBLE_PARTS` (:208-258).

- Read **none** where severe is expected:
  - "I've missed two bond payments"
  - "I defaulted on my loan" / "the bond is in default"
  - "my account has been handed over to attorneys" / "I've been handed over". This is the standard SA phrase.
  - "I have a judgment against me" / "there's a default judgment against me"
  - "there's a court order on my salary" / "I've got an EAO on my salary"
  - "the house is going on auction" / "selling the house in execution"
  - "they cut off our electricity" / "the municipality cut our water"
  - "I don't have money for food" / "there's no food in the house" / "I can't feed my kids" / "we don't have enough to eat"
  - "I don't have the money to pay the bond" / "I don't earn enough to pay the bond"
  - "I'm behind on everything" / "I'm behind on paying the bond"
  - "once the debit orders go off there's nothing left" / "I take home nothing after deductions"
- Read **none** where at least mild is expected:
  - "we're short every month"
  - "the money runs out before month end"
  - "I borrow from my sister every month"
  - "my credit card is maxed out"

Fix: add the phrases. For the "don't have money for food" family, the negator is part of the distress, so the pattern must start at "don't" or "no", or the negation rule will cancel it. Pin each phrase in a test.

**5. The negation window runs across verbs and conjunctions: severe becomes none.**

Where: distress.ts:434-435 (`NEGATOR`) and `negatedBefore` (:460-462), which checks the last four words.

All of these were probed and read **none**:

- "I'm not working and can't pay the bond"
- "I didn't know I was blacklisted (until the bank told me)"
- "I never thought I'd be blacklisted"
- "I'm not sure if I'm blacklisted"

Fix:
- End the window at and, or, if, that, until, or a new subject.
- Treat factive "didn't know / realise / find out" and "never knew / thought" as not negating their complement. "I don't think I'm blacklisted" can stay negated (test:279).

**6. Ordinary fact-find answers about debit orders read severe.**

Where: distress.ts:97 (`ASSET` matches "car" as the modifier in "car payment"), :99 (`CREDITOR` includes bare "they") and :166 (the take-pattern).

Probed as **severe**:
- "the bank takes my car payment on the first"
- "they take the car payment off my account on the 25th"
- "the bank takes the car instalment on the 1st"
- "they took the car in for a service"

This is how clients describe a debit order when the agent asks what they owe. It contradicts decision #2 in the report: left in, every client with car finance risks a stopped sale.

Fix:
- Give `ASSET` a negative lookahead: `(?!\s+(?:payments?|instalments?|installments?|finance|loan|insurance|licen[cs]e|service|repayments?))`.
- In the take-pattern, require an intent or threat form ("going to / want to / came to take", "take … back") when the subject is bare "they".
- Add these sentences to test:182.

#### Minor

1. **Jobs and roles read severe.** Employment is a fact-find question.
   - "my husband is a debt collector": the lookbehind at :138 misses "is a".
   - "I work at a debt review company"
   - "I work in the arrears department at the municipality"
   - "I'm a landlord and I had to evict a tenant"
2. **The "don't want" carve-out is too broad.** It is right for "I don't want them to repossess the car" (NEGATOR :434), but it also makes these severe:
   - "I pay everything on time, I don't want to end up blacklisted"
   - "I never want to be blacklisted"
   - "I don't want to get into debt review"

   A prudent client answering the debt question will say this. Exclude "want to (be|end up|get into|go)".
3. **"Arrears? None." reads severe.** `ANSWER_NO` (:456) has no bare "none".
4. **"the company I work for is under administration" reads severe.** The implementer already lists this as a known limit. "Under administration" should need a personal subject.
5. **Mis-tag at test:279.** The negation test is tagged [C-0211], but C-0211 is the row about a word in a non-money clause, not negation.
6. **C-0549 drops off `criteria --missing` early.** It is now tagged here (test:232, 239), so it leaves the missing list before `facts.test.ts` asserts its `owes/informal` half. `criteria.ts` counts a tag in any file. The orchestrator's Task 2.3 brief should name C-0549 explicitly. The implementer flagged this.
7. **Languages are inconsistent.**
   - isiZulu "angikwazi ukukhokha" ("I can't pay") is mild, while English "I just can't pay" is severe.
   - isiXhosa "andikwazi ukuhlawula" reads none.
   - Afrikaans "Ek het nie geld vir kos nie" ("I don't have money for food") reads none.

### Assessment

Task quality: **Needs fixes**

The structure is right: clause reading, a `discounted` list with reasons, quiet on ordinary debt, and leaning severe. Every criterion row passes literally. But the brief's own question is the cost of each error, and the heuristics added for C-0212 and C-0213 discount too much. "I can't get out of debt review", "I'm trying to get out of debt review", "I got a garnishee order last month, but things are getting better", "I used to earn more and now I can't pay the bond", "My boss says there's a garnishee order on my salary" and "someone from the bank said they're going to repossess the car" all fall below severe, and some fall to none. Those are the false negatives R6 exists to prevent.

Critical 1 and 2 must be fixed and pinned with the probe sentences above. Important 3 to 6 should go in the same round, because that is where the floor and the §4.6 list disagree and where ordinary debit-order answers would stop sales.
