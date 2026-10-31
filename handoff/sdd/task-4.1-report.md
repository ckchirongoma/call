# Task 4.1 report: forty scripted conversations

**Status:** DONE_WITH_CONCERNS (the four sweep criteria are left untagged on purpose; see below)

- Worktree: `/home/user/call/.claude/worktrees/agent-a33665a7581c0e1ee`
- Branch: `worktree-agent-a33665a7581c0e1ee` (fast-forwarded to `ba50e90` first, as instructed)
- Commit: `f823771` "Forty scripted conversations the whole pipeline is tested on" (not pushed)
- This report: written into the worktree, because writing to the shared checkout's `.superpowers/` was refused. It is untracked and not committed.

## What was built

- `test/fixtures/conversations/*.json`: the 40 fixtures named in the brief, one file each. They are call, widget and meeting conversations in South African English: "ja", "eish", "yebo", "about ten", "twelve bar", "plus minus twaalf duisend", "ishumi", "inkulungwane", "laaitie", "my bond", "the society". Agent lines are `docs/AGENT-PROMPT.md` rendered for Ava, Demo Brokers and FSP 00000: the §1 first message word for word (the known-client "Hi Lindiwe" variant where it applies), the §3 stems, the §5 read-back, §6 digit-by-digit read-backs, the §7 closes and the §4 refusal lines. Tool calls use the arguments from §3 and §6.1, with results: save_fact, check_existing_cover, lookup_categories, request_callback, mark_hardship and set_channel, including a tool timeout and an `invalid_number` reply. Only synthetic data appears: numbers `+2779993xxxx`, emails `@example.test`, Demo providers. The ID number uses month 13 and the card number starts with 0, so neither can be real.
- `test/fixtures/README.md`: documents the format, every turn flag with the role it belongs on, the value conventions, `prior`, and every `expect` key and Fact key.
- `test/fixtures.test.ts`: 18 tests; 16 pass and 2 are skipped with reasons. They check:
  - all 40 files exist, each parses against the README shape, and no key is undocumented;
  - ids are unique and match their file names;
  - every caller_id is in range for calls and null for web and meetings;
  - `t` never decreases;
  - cross-key rules from SPEC hold (declined, stabilising, meeting, known client);
  - every expected figure is one that `figures.ts` reads from its backing client turn (`figuresFrom`, `ageFrom`, `countsFrom`, `rangeFrom`, `isApprox`);
  - every save_fact value is the client's own words;
  - no real insurer, bank or medical scheme is named;
  - every §3 stem appears in happy-path in order, and every call opens with §1 and ends on the right §7 close (all parsed from AGENT-PROMPT.md);
  - every save_fact before the read-back is confidence agent.
- Plan: Task 4.1 is ticked, with a Notes line recording the decisions below.

**Red step:** before any fixture existed, 16 tests failed and 2 were skipped. **Green step:** 16 pass and 2 are skipped. I also planted five errors (a wrong figure, a fact on an agent turn, an unknown need, an out-of-range phone number, a save_fact value that was never said) and all five were caught.

**Full suite:** `npm test` gives 233 pass, 0 fail, 2 skipped (both mine); `npm run test:intel` gives the same counts; typecheck passes. Criteria: 0 unknown tags. C-1429 to C-1432 are still listed by `--missing`.

## The sweep, C-1429 to C-1432 (the four tags are left off)

I read those four rows first. Each one is about stored data: turns after `redact()` and facts after `factUpdates()`. Neither `api/_lib/redact.ts` (Task 2.2) nor `factUpdates()` (Tasks 2.3 and 4.2) is on this branch yet.

- The redact half imports the module behind a guard and is skipped with "redact.ts not on this branch yet". It runs by itself once redact.ts lands, and that is when C-1429 and C-1430 should be added to its name.
- The facts half is a skipped placeholder for Task 4.2, which should fill it in and tag C-1431 and C-1432.
- What runs untagged today: the raw turns do contain things for the sweep to catch (a 13-digit ID, a card, an account number, a diagnosis, and a personal name that is expected to be refused not_a_kind), and the fixtures' own expectations already follow the four rules.

The criteria script counts a `[C-xxxx]` tag anywhere in a test file, so the ids appear only without brackets.

## Decisions (also in the plan notes)

- Format additions beyond the plan's: `duration_secs`, an optional `prior` (a known client's earlier session and facts, or the client picked on /meeting) and an optional `broker.categories`.
- A stabilising session ends with outcome `hardship`.
- `expect.needs` is the exact list in priority order. Equal priorities keep the order of the §8.1 table, with protection before savings.
- group-cover reads C-0724 and C-0725 literally: disability at priority 2 comes before income protection, which is lowered to 3.
- agent-priced is held with reason `price_on_call` until Task 6.2 names a reason.
- Every completed caller gives a first name, so the §7 close never reads "Thanks, thanks."
- Assumptions about the demo catalogue are written into the fixture notes:
  - life products stop at 65 (no-product-fits, age-70);
  - a funeral product accepts a 70-year-old (age-70);
  - life cover plus funeral cover costs more than R220 a month for a 38-year-old (two-needs-over-budget).

## Concerns

1. `figures.ts` reads "a million and a half" as 1,000,000. email-channel says "one and a half million" instead. The gap belongs to Task 2.1.
2. AGENT-PROMPT §2 renders as "that's Demo Brokers's job". The fixtures keep this literal rendering.
3. C-1771 names a `forget-on-call` fixture. It is not one of the forty and was not made.
4. Several needs orders depend on SPEC §8.1 rules that the criteria only partly settle (group cover; credit life priority when there is car finance). The fixture notes give the reading I used, so a later `needsFrom()` can be checked against it.
