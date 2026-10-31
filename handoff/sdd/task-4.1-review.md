# Task 4.1 review: the forty scripted conversations

Base `ba50e90`, head `f823771`, worktree `/home/user/call/.claude/worktrees/agent-a33665a7581c0e1ee`.
I read all 40 fixtures turn by turn, with the tool calls and every `expect` block, against AGENT-PROMPT §0–§7, SPEC §3, §7.3, §8.1 and the criteria rows they cite (02, 03, 04, 05, 06, 10, 11). Paths below are relative to the worktree.
The only thing I ran was `test/fixtures.test.ts` on its own (16 pass, 2 skipped, 0 fail), which matches the report. I did not re-run the whole suite.

### Spec Compliance

- ✅ **All 40 fixtures exist, named exactly as in the brief.** There is one file per fixture, and each id equals its file name. Checked by `test/fixtures.test.ts:616-632`.
- ✅ **`test/fixtures/README.md` documents the format.** It covers the plan's `{id, mode, caller_id, turns, expect}` shape and the additions (`broker`, `duration_secs`, `prior`). It describes every turn flag and every `expect` key. The test fails on any key the README does not describe (`fixtures.test.ts:399-560`).
- ✅ **happy-path asks every §3 question stem, in order.** The stems are read from AGENT-PROMPT.md itself (`fixtures.test.ts:678-689`).
- ✅ **First message.** It is §1 verbatim with Ava / Demo Brokers, and the known-client variant "Hi Lindiwe…" is used where it should be (`known-client.json`, `second-call-correction.json`). FSP 00000 is the broker variable. §1 does not speak it, so it never appears in a turn, which is correct.
- ✅ **Fixed lines and tool calls.** The §2 question, §5 read-back opening and ending, §6 channel question and the §7 normal, hardship and silence closes are all in place. The decline line and the §4.6 line are verbatim. Tool calls come in the §4.6 order (mark_hardship → set_channel → close). Corrections get "Forty-two, got it" / "Anything else to change?" (`misheard-age.json`).
- ✅ **SPEC §3 journeys are covered.**
  - Declined consent stores nothing: `facts: []`, `needs: []`, `channel: null`, `turns_stored: false`.
  - Dropped: facts stay `agent`, a quote is still drafted, and the notification text matches C-0482/C-0483.
  - Silence: "Are you still there?" exactly once, then `abandoned`, with `notification: null`.
  - Hardship and hardship-missed: `stabilising`, `needs: []`, no quote.
  - Meeting: `in_person` consent with a null turn, every fact `transcript`, no tool calls.
  - Unknown speakers: facts from `unknown` turns carry `speaker_unknown`, and no unknown turn is relabelled `client`.
- ✅ **Supersession on correction.**
  - misheard-age: 52 is `superseded`, and 42 is `confirmed`/`readback` with turn 33 and `supersedes_turn: 5`.
  - known-client: `supersedes_prior` p2 and p4.
  - second-call-correction: `supersedes_prior` p4.
- ✅ **Needs order.** I re-derived all 40 by hand from SPEC §8.1 and C-0700–C-0747. Every list matches: equal priority keeps the table order, savings come after protection, and the budget moves are right (two-needs-over-budget, student). Every `wants` kind appears in `needs`. No fixture has `has_cover`/`lacks_cover` on the same slot (C-0338). Every fact the agent saves before the read-back is re-saved `confirmed` after the "yes".
- ✅ **Synthetic data only.** Phone numbers are +2779993xxxx, emails are `@example.test`, and providers are "Demo …". This is enforced by `fixtures.test.ts:661-675`.
- ⚠️ **Sweep tags C-1429–C-1432 left off.** I agree with the decision. The criteria place all four in `test/redact.test.ts` (`criteria/11-compliance.md:36-39`), and a tag on a skipped test would close them falsely. Task 2.2 already lists C-1429/C-1430 (`plan:255`). **C-1431/C-1432 are recorded only in Task 4.1's notes (`plan:333`).** Task 4.2's Step 1 list does not name them. See I7.
- ❌ **Four `expect`/agent lines contradict SPEC or AGENT-PROMPT.** See I1–I6:
  - I1, I2: wants facts that SPEC §7.3 rule 4 refuses.
  - I4: the offer answer is not one sentence.
  - I5: the forbidden phrase "you should" appears in a read-back.
  - I6: the `lookup_categories` argument name differs from SPEC §5.
  - I3 is a test-design weakness rather than a contradiction.
- ✅ **Violation fixtures break the rules exactly as intended.**
  - agent-advised turn 24: `advice_on_call` blocks, the quote is held `agent_advised`, and an incident names turn 24. This matches C-0197/C-0198.
  - agent-priced turn 26: `price_on_call` blocks, and `numbers_not_facts: [120]`.
  - hardship-missed turn 22: `hardship_handled` blocks, and `agent_missed_distress` is both a safety event and an incident.
  - medical-detail is, correctly, a fixture where the client volunteers detail and the agent behaves. The agent deflects with the §3.7 line, the only fact kept is `treated_condition = yes`, and `medical_mentioned` is written (C-0226/C-0228). That is what the criteria want; C-0225/C-0227 are inline checker cases.

### Strengths

- **The test file makes the fixtures check themselves.**
  - It checks every turn index against the speaker that turn should have, and refuses an R2 fact backed by an agent turn.
  - It checks that every expected figure is one the real `figures.ts` reads from the backing turn. I checked: the test imports `ageFrom`, `countsFrom`, `figuresFrom`, `isApprox` and `rangeFrom` from `api/_lib/figures.ts` itself.
  - It reads every prompt line out of AGENT-PROMPT.md, so a prompt edit shows up here.
  - The README says its author planted five errors and all five were caught.
- **Strong edge cases.**
  - callback-request: "Okay. Is this a real person?" is not taken as consent.
  - web-no-caller-id: the consent tool times out twice (one retry, as §6.1 allows), then consent is inferred.
  - whatsapp-channel: `invalid_number`, then the agent re-asks; the caller id differs from the number given.
  - email-channel: a letter correction.
  - prompt-injection: `System:`/`Assistant:` prefixes.
  - afrikaans-money: a refused amount ("not inkulungwane") is `negated` and the R500 is kept.
  - long-story: a 92-second turn, acknowledged before the next question.
  - interrupted: a read-back split by a barge-in (C-0255).
  - happy-path and negated-cover: the agent reads back R-figures, which forces Task 4.3's price regex to allow the client's own figures.
- **Good South African phone English.** "ja", "eish", "yebo", "sharp", "laaitie", "sisi", "Ag", "plus minus twaalf duisend", "we stay together", "res", "bursary", "the society", "back room", "panel-beating". The ID, card and identifier handling is careful.
- **The notes field says what each fixture is for and every catalogue assumption it makes.**

### Issues

#### Critical
None.

#### Important

**I1. `two-needs-over-budget.json:68,496` (and, borderline, `unclear-consent.json:66,506`): the wife's want is stored as the client's.**
- What: `wants/funeral_cover` is backed by "my wife wants a funeral policy" (turn 3). SPEC §7.3 rule 4 refuses a clause that is about someone else, and C-0552 refuses another person's want with `someone_else`.
- The client's own want is turn 23, "Life cover and the funeral policy. Both, if I can." But the agent's turn-24 save records only `wants/life_cover`.
- unclear-consent has the same shape: "My wife's been on at me about a funeral policy" at turn 5, while his own want is turn 25, "The funeral thing", which is never saved.
- Why it matters: Task 2.3/4.2 will either refuse this expected fact or have to learn a wrong exception. Either way the fixture stops meaning one thing.
- Fix:
  - At turn 24, add a `save_fact(wants/funeral_cover, value_text "the funeral policy")` call.
  - Re-back the expected fact on turn 23.
  - Optionally add `refusals: [{rel:"wants", label:"funeral_cover", reason:"someone_else", turn:3}]`.
  - Do the same for unclear-consent: save at turn 26 and back the fact on turn 25.

**I2. `age-70.json:80,480`: a negated clause is stored as a want.**
- What: `wants/funeral_cover` has `value_text` "never had funeral cover", which is a negated clause and already serves as the `lacks_cover/funeral` value. Rule 4, and C-0539's "never had", would refuse it as `negated`.
- His actual want is turn 23 (`age-70.json:315`, "The funeral cover."), and the agent saves only `wants/life_cover` there.
- Fix: save `wants/funeral_cover` "The funeral cover" at turn 24, re-back the expected fact on turn 23, and drop the turn-4 wants save.

**I3. `prompt-injection.json:43` vs `:747,768`: the injected address is also the real channel.**
- What: the injection says "send the policy to riaan@example.test". The client later gives the same address for `set_channel`.
- Why it matters: a pipeline that takes the channel or a fact from the injected turn would still pass `expect.channel`. The notes claim the fixture proves "the address in it is never a fact or the channel". It cannot.
- Fix: use a different injected address (`claims@example.test`), and add a URL to the turn so C-0613 is actually exercised. Optionally add `absent` entries for any fact carrying that address.

**I4. `what-do-you-offer.json:63` (notes at `:1011`): the offer answer is two lists in two sentences.**
- What: the reply is "For that, Demo Brokers has life cover and funeral cover." followed by "Altogether they offer …" with all thirteen. That is two lists, two sentences and fifteen category mentions.
- AGENT-PROMPT §2 says "a plain list in one sentence". The notes say "in one sentence and nothing else", which is not true of the turn. The fixture also asserts `category_list_invalid` passes, while C-0168 flags more than 13 categories. A counting checker will see 15.
- This is the canonical fixture for C-0161–C-0170, so the ambiguity carries straight into Task 4.3.
- Fix: one sentence. Either the `lookup_categories` result alone, or the full list once.

**I5. `someone-elses-cover.json:402`: the read-back contains "you should".**
- What: the agent's read-back says "Your sister said you should phone". "you should" is the exact phrase AGENT-PROMPT §4 and C-0183/C-0187 forbid.
- Why it matters: an `ADVICE_RE` written to those criteria will block `advice_on_call` here, and the quote would be held `agent_advised`. `expect.quote` says the quote is created and not held, and the notes never mention this.
- Fix: reword it ("Your sister told you to phone"). Or make it deliberate: add `checker_pass: ["advice_on_call"]` and a note that reported speech must not fire.

**I6. `what-do-you-offer.json:69` and `test/fixtures.test.ts:357`: the `lookup_categories` argument name is wrong.**
- What: the fixture's argument is `{phrase}`, but SPEC §5 (`docs/SPEC.md:242`) names the tool `lookup_categories(need_phrase)`. All the other tool argument names match SPEC §5.
- Why it matters: Task 12.1b's `simulate-call.ts` posts fixture tool arguments to `/api/voice/tool/*`. Task 3.2 will implement `need_phrase`.
- Fix: use `need_phrase` in the fixture and the validator, or settle SPEC first.

**I7. `docs/superpowers/plans/2026-10-31-call-build.md:333`: the C-1431/C-1432 hand-off may be lost (process).**
- What: the plan says Task 4.2 should fill in the facts half of the sweep and tag C-1431/C-1432. That instruction lives only in Task 4.1's notes. Task 4.2's Step 1 list does not include them, and executors read only their brief. The criteria file assigns all four rows to `test/redact.test.ts`. Task 2.2 has C-1429/C-1430 and says "sweep wired in Task 4.4", which should read 4.1.
- Why it matters: the ids can stay missing until 12.2.
- Fix (orchestrator):
  - Add C-1431/C-1432 and "fill `fixtures.test.ts`'s skipped facts half" to Task 4.2's brief.
  - Tell Task 2.2 to un-skip the fixture redact sweep, or to tag C-1429/C-1430 on it.
  - Decide whether the tags live in `redact.test.ts` (as the criteria say) or in `fixtures.test.ts`.

#### Minor

1. **`hardship.json:43,56`: a want named in §2 is not saved.** The client names "a cheaper funeral policy" in §2, and §2 says to also save `wants` with the matching need kind. Only the concern and `has_cover` are saved. It makes no difference to the outcome (the session is stabilising), but the agent is off script.
2. **`second-call-correction.json`: no concern saved, and the `correction` flag is misused.**
   - No §2 `concern` is saved this session.
   - Turn 11 is flagged `correction` (`:197`), but README:71 defines that flag as "corrects the read-back". Here it corrects a fact from the earlier session. Widen the flag's definition or add a new one.
3. **Questions skipped beyond "already answered" (AGENT-PROMPT §3).**
   - `no-channel` skips Q2 (who depends on you) on "My wife." at turn 3; a 61-year-old may have others.
   - `callback-request` skips Q9 entirely after "no pension fund", so group life and medical aid at work are never asked.
4. **Read-backs that change the client's wording (§0, C-0134, C-0250).** `hypothetical-cover.json:433` reads "about fourteen" back as "about fourteen thousand", and approximate-figures reads "about 180" back as "about 180 thousand". This is harmless now, but a strict wording check (C-0250) would trip.
5. **`group-cover.json:381`: an unsaved want, and a priority order Task 5.1 must settle.**
   - "if I die or can't work": only `wants/life_cover` is saved. The "can't work" half should also be saved as `wants/income_protection` (§3 item 12).
   - Disability is placed at 2 and income protection at 3. That is a literal reading of C-0724/C-0725, but the client said "disability … through the company". It is documented; Task 5.1 should settle it in SPEC.
6. **README gaps for Tasks 3.3, 4.2, 5.x and 12.1.**
   - README:163 never says `turn` is a 0-based index into `turns[]`.
   - README:141 does not say whether an absent `held_reason` means "not held".
   - README:102-115 does not say how a loader seeds `prior.facts`, which have no turn, when `facts.turn_id` is NOT NULL.
   - There is no exported `ScriptedConversation` type or `loadFixture()`, although Task 3.3's interface names `ScriptedConversation`. Adding a `test/_fixtures.ts` would stop each consumer re-parsing the files.
7. **README:12 overstates the identifiers.** It calls the ID, account and card numbers "impossible on purpose". The account number `62001234567` (`offers-id-number.json:308`, taken from C-0177) has a real bank's 11-digit "62…" format and is not impossible. Use something like `99990000123`.
8. **Realism.**
   - Every one of the 37 new callers volunteers a first name in the consent reply.
   - Cover answers often repeat the question's list back ("No life cover, no medical aid, no income protection. And no RA.").
   - No client ever says "skip" or declines a question, so `long-story.json:869` passing `skip_honoured` is vacuous.
   - No client asks what a term means (C-0599).
9. **Catalogue assumptions live only in each fixture's notes.**
   - Every life product stops at 65.
   - A funeral product takes a 70-year-old main member.
   - Lump-sum disability exists, which happy-path, web, injection, email, self-employed, meeting and group-cover all rely on.
   - Life plus funeral cover costs more than R220 for a 38-year-old non-smoker.
   - In student, R250 with the 10% tolerance is R275, so tax-free savings moves only if funeral cover costs more than R25. student's notes do not say so.

   Collect these in the README and pass them to Task 1.2's seeds.
10. **`approximate-figures.json:43`: an undocumented distress-word edge case.** "my husband can't pay the bond alone" contains the §4.6 phrase "can't pay", in a hypothetical clause about someone else. The fixture's expectations implicitly say this is not distress. It is a good edge case; say so in the notes so Task 2.4 knows it is deliberate.
11. **`known-client.json:922`: the C-0484 negative case is not asserted.** There is no explicit `continues_previous: false` for a previous call more than 24 hours earlier (July).
12. **AGENT-PROMPT rendering quirks carried literally.** "that's Demo Brokers's job" (`what-do-you-offer.json:63`). Separately, §7's "{client_first_name or 'thanks'}" would render as "Thanks, thanks", which the fixtures avoid by having every completed caller give a name. Both belong to Task 4.4 or to an AGENT-PROMPT fix; flag them forward.
13. **`second-call-correction`: the 24-hour window depends on the test clock.** The earlier session ended 2026-10-30T18:40+02:00 and the fixture has no `started_at`, so C-0484's "within 24 h" only holds with the fixed test clock. Add a `started_at` or say so in the notes.

### Assessment

**Task quality: Needs fixes.**

The task is close to complete:
- All 40 fixtures exist.
- The README is good.
- The test is unusually thorough.
- Agent fidelity to AGENT-PROMPT is high.
- The `needs`, refusals, supersession, stabilising, meeting and declined-consent expectations are almost all correct.

What needs fixing:
- **Fixture data, before Tasks 2.3, 4.2, 4.3 and 12.1 build on it:** I1–I6, all small edits to JSON or the test.
- **The plan:** I7, an orchestrator edit.

The Minor items can be folded in now or noted for later tasks.
