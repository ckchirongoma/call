# Task 1.2 review: seeds, demo catalogue, pricing, disclosures, model roles, seed→SQL, loadCatalogue

Diff 01309e9..ff1c1a7 (one commit, ff1c1a7). Files read at `/home/user/call/.claude/worktrees/agent-af717e642491c9efb`.
Probe run: `scripts/seed-sql.ts --check` → "db/0008_seed.sql matches seed/." (exit 0). I did not re-run the suite (as instructed). The grep for real SA insurer and bank names over every changed file found nothing (the one hit was "appSecret" in the plan).

### Spec Compliance

- ✅ `seed/categories.json:1-15`: the 13 SPEC §4 ids, each with `need_kinds` from §8.1. Every one of the 12 need kinds is answered by a category that has a product (the validator checks this at `scripts/seed-sql.ts` validateSeed, and so does the test).
- ⚠️ `seed/categories.json:10`: `unit_trust` answers `education_saver`. This is defensible (§8.1 has no discretionary-savings kind, and a unit trust should never answer "tax-free"), and it is recorded in the plan notes. It means `education_saver` is the only need that two categories answer, and the tie goes to Education Saver only because its uuid happens to be lower (C-0773).
- ✅ `seed/products.json`: 24 products in all 13 categories (3 life, 3 funeral, then 2/2/2/2/2/1/1/1/2/2/1). The four providers are exactly "Demo Life", "Demo Funeral Society", "Demo Short-Term" and "Demo Invest". Every summary is ≤ 60 words with no digit. Every product has eligibility, exclusions, keywords (≥ 4), ages, cover limits, term_rules, `verified_on` = 2026-10-31, `is_demo: true` and an `external_id`.
- ✅ Age and cover ranges for a 25–60-year-old earning R8k–R60k a month, worked against the §8.1 default cover rules:
  - life: 18–65, R100k–R10M (FP R50k–R1.5M);
  - funeral: 18–75, R10k–R80k, so the R30k–R50k rule fits;
  - income protection: R2k–R100k a month, so 75% of R8k–R60k fits;
  - disability lump sum: R100k–R5M, so 5× annual income (R480k–R3.6M) fits;
  - critical illness: R50k–R3M, so 1–2× annual income fits;
  - RA, TFSA and education saver: minimum contributions of R300–R500;
  - car: R30k–R1.5M comprehensive;
  - home: contents R20k–R2M, buildings R200k–R10M;
  - gap: flat, no cover limits.
  - Funeral family options: `family_option` on funeral.family, and both `family_option` and `extended_option` on funeral.extended (C-0785 and C-0718 can be shown).
  - Exception: credit life is narrow at both ends (Minor 2).
- ✅ `seed/pricing.json`: 183 bands. Each product has 6–7 distinct age bands, and life and critical illness have 6 per smoker flag. Every product starts at 18 and runs to max(65, max_age), contiguous with no overlap, for each smoker group. The validator enforces this as well as the test.
  - The split is right: smokers are priced apart for life and critical illness, and one row covers both everywhere else.
  - The pricing method is right: a rate for life, income protection, disability and critical illness; flat for gap; a rate for funeral and credit life (the brief allows "flat or rate"). Savings use rate 1000 with `min_premium_cents` = `min_cover`, and every band has `min_premium_cents`.
  - Reading "6–8 bands" as age bands per smoker group is a reasonable reading.
- ✅ The premiums are invented but plausible:
  - Term life at 30, non-smoker: about R220/month per R1M.
  - Funeral: R66/month for R30k single at 25.
  - Income protection: about R270/month for a R15k benefit at 30.
  - Gap: R145–R299.
  - Comprehensive car: about R840/month on a R200k car.
  - Credit life: R3.30–R3.90 per R1 000.
- ✅ `seed/disclosures.json`: all ten ZA keys required by C-1451. `required`/`condition` are consistent, and the CHECK constraint in `db/0004_catalogue.sql:99-105` enforces it. Every text is ≤ 80 words with no digit, and the placeholders are only `{broker_name}`, `{broker_email}` and `{fsp_number}`.
  - SPEC §9 item 9 is covered: indicative, underwriting, FSP, recording, data use, forget (C-1455 "reply FORGET ME" plus `{broker_email}`), and the demo notice, which starts with SPEC §8.3's exact footer words.
- ✅ C-1748: `data_use` (line 37) makes every promise of AGENT-PROMPT §1: recorded, used to prepare the recommendation from the broker, kept to help get better / improve the service, "forget me" or ask the broker, deleted. It is required with no condition. The "§9 includes it" half rightly waits for quotedoc (Task 6.3, C-1453), and the report says so.
- ⚠️ Recording and data-use wording on in-person meetings: see Important 3.
- ✅ `seed/model_config.json`: all seven roles with `max_tokens ≥ 1200`. The SQL is `ON CONFLICT (role) DO NOTHING` (`scripts/seed-sql.ts:623`), and the Postgres test proves a founder's edit survives. Slugs appear only in the JSON values and the SQL VALUES (the test checks no slug is in the header or comments). `grep-models` is unaffected.
- ✅ The `voice` row departs from the brief, and the departure is correct. It is `openai/whisper-1` on `openrouter` with no fallbacks, which is exactly Charlie's corrected row (`charlie/db/0005_platform.sql:259-272`). Charlie later moved voice to MiMo on `openrouter_chat` (db/0009). Call's `models.ts` (around line 820, the transcription header) explicitly declines that route because a chat model paraphrases, and `transcribeAudio` cannot use HARD_FALLBACKS (they cannot hear). Chat fallbacks on the voice row would only produce 400s.
- ✅ The C-1526 wording change (db/0002 → db/0008) is correct. db/0002's own header already says "The rows themselves are seeded by db/0008 (Task 1.2), from seed/", and the then-clause (seven roles, max_tokens ≥ 1200) is unchanged. It fixes a stale pointer and does not weaken the criterion. One follow-on was missed (Minor 5).
- ✅ The generator is deterministic. There is no clock, no randomness, and stable JSON key order. A test checks byte-for-byte equality, `--check` passed in my probe, and the CLI refuses an invalid seed without writing. Ids are v5 uuids from `external_id`, products and bands upsert on `id`, and one scoped DELETE removes stale bands. The nested-`/*` header trap is guarded by a test.
- ✅ `api/_lib/catalogue-load.ts`:
  - The broker's rows win a category, and demo rows fill only the categories where the broker has no rows at all (tested, including the "all switched off" case, which is consistent with C-0352 and recorded).
  - Only active rows are returned.
  - Every products query names `broker_id` (eq this broker, or is null), so C-0848 holds and the test inspects the query log.
  - Categories and disclosures are read by the broker's country.
  - The result is frozen and sorted. The 60 s per-broker cache is tested at 59 999 and 60 000 ms. The promise is cached and failures are not.
- ✅ Criteria tags are present for C-0815, C-0816, C-0845, C-0846, C-0848, C-1451, C-1452, C-1455, C-1526 and C-1748, plus C-1526 and C-0815 again on real Postgres.

### Strengths

- `validateSeed()` turns most of the catalogue rules into checks that refuse to write the SQL: band gaps and overlaps per smoker group, figures in summaries and disclosures, unknown fact paths and exclusion codes, provider allow-list, placeholder set, max_tokens floor. It has a "bites on each kind of bad data" test with 20 cases. This is the right place for these checks.
- The real-Postgres test is strong. After three runs it compares what is stored with `seedRows()` column for column. It then checks that a hand edit is put back, a stray band is deleted, a founder's model choice is kept, and both CHECK constraints fire.
- The loadCatalogue tests build the fake from `seedRows()`, so the fake holds exactly what the SQL inserts. C-0848 is proved from the query log, not just from the result.
- The units are written down in four places (types.ts, the 0004 header, the 0008 header, the plan notes). The "no statutory figure in summaries or disclosures" rule is enforced by the validator.

### Issues

#### Critical

None.

#### Important

1. **The narrower or complementary product in a category always wins on price, so matching will routinely recommend the wrong kind of cover.** Files: `seed/products.json:122` (disability.accident), `:190` (illness.cancer), `:343` (car.third_party), `:377` (home.buildings); `seed/pricing.json`.
   - **What.** SPEC §8.2 and C-0771 sort by premium for the needed cover. In every band, the narrow product is cheaper:
     - Accident-only disability (0.06–0.21 against 0.12–1.1; minimum R50 against R100) wins every disability need up to R2M. That is every earner below about R33k a month under the "5× annual income" rule, and it does not cover illness.
     - Cancer-only cover (0.08–2.0 against 0.2–5.3) wins every critical-illness need up to R1M, even when the client's concern was "heart" or "stroke".
     - Third party, fire and theft (min R180, 1.4–2.6) wins for every car up to R400k, including financed cars.
     - Buildings insurance (0.55–0.62) is cheaper per R1 000 than contents (1.05–1.25). So a client who says their contents are worth R300k is recommended *Buildings Insurance*, because the `short_term_home` need is "sum insured as said" and the matcher has nothing that tells the two apart.
     - In the same way, Income Protector (standard) and Gap Cover Plus can never be chosen. That is acceptable ("cheapest sufficient"), but it shows the pattern.
   - **Why.** This task's job is that "every need kind has a plausible product so matching can produce a recommendation". For four categories, the catalogue as priced makes the produced recommendation implausible. Nothing machine-readable on these rows says "narrower scope" or "covers contents, not structure", so Task 5.3 cannot tell "sufficient" from "cheapest". The disability.accident summary itself says it is "a good fit when full disability cover is out of reach for now", which means it was meant as a budget fallback, not the default.
   - **Fix.** Make the scope machine-readable now, where the data lives, and hand Task 5.3 the rule:
     - Add an eligibility flag alongside the existing tie-break flags (`ELIGIBILITY_FLAGS`, C-0785 pattern), for example `"budget_option": true` on disability.accident, illness.cancer and car.third_party.
     - Add `term_rules.covers: "contents" | "structure"` on the two home products.
     - Add a plan note for Task 5.3: a `budget_option` product is chosen only when the full product does not fit the budget (otherwise it goes in `considered` with reason "narrower cover"), and `short_term_home` picks by what the client said they own or want covered.
     - Extend `validateSeed` so every category with two or more products marks its narrow one.

2. **`loadCatalogue` can silently drop pricing bands at PostgREST's row cap.** File: `api/_lib/catalogue-load.ts:43,101-104`.
   - **What.** Pricing is read with `.in("product_id", 150 ids)` and no paging. Supabase's API returns at most `max_rows` rows (1000 by default) and says nothing when it truncates. The seed alone allows 16 rows per product (8 age bands × 2 smoker flags), so 150 products can be 2 400 rows. Broker CSV uploads (Task 8.5, up to 2 MB, C-1230) can carry real per-age-year rate tables of about 96 rows per product.
   - **Why.** Any band past row 1000 vanishes. `premiumFor` then returns `no_rate` for that age (C-0814's behaviour), and the product drops out of matching. Nothing errors, and the cache serves the hole for a minute. The `Catalogue.pricing` docstring promises "the bands of exactly those products". Charlie pages for exactly this reason (`charlie/api/_lib/alerts.ts:283-300`, `intelexport.ts:63-67`). The demo's 183 rows hide the bug today.
   - **Fix.** Page each chunk with `.order("id").range(off, off + 999)` until a short page comes back, the way Charlie does in `eventsBetween`. At minimum, throw when a page comes back with exactly the cap, so the job retries instead of quoting from partial data. Add a fake-db test with more than 1000 bands. Do the same for the two products queries (a cheap guard).

3. **The `recording` and `data_use` disclosures say "Your call was recorded", which is false on a quotation from an in-person meeting.** File: `seed/disclosures.json:29,37`.
   - **What.** SPEC §3.2 step 3 sends the meeting into the same pipeline (`session.mode = meeting`, consent `method: in_person`). Disclosures are keyed per country with no per-mode variant, so every meeting quotation will tell the client their *call* was recorded.
   - **Why.** These are compliance disclosures the client receives, and the in-person journey is part of the demo definition of done. Both rows also open with the same sentence, so the document says it twice.
   - **Fix.**
     - `recording`: "This conversation was recorded with your agreement. …"
     - `data_use`: "What you told us when we spoke is used to prepare … and conversations are kept to help us get better at helping people and improve the service. …"
     - Alternatively, drop the duplicated opening from `data_use`.
     - The C-1748 regexes still pass (`recorded` must stay in `data_use`). Then regenerate 0008.

#### Minor

1. **Units trap for Task 5.2.** Files: `docs/SPEC.md:436`, `criteria/06-matching.md:68,103`.
   - The seed stores cover in cents (`premium = cover_cents / 1000 × rate`).
   - SPEC §8.2's formula is `cover / 1000 × rate × 100`, which is right only if cover is in rand. C-0761 ("cover 1,500,000") and C-0796 ("rate 0.85, cover 1,000,000 → 85 000 cents") are also written in rand, while Task 5.2's interface takes `coverCents`.
   - Fix: add a one-line note under SPEC §8.2, or in the Task 5.2 notes, saying "cover is cents here; the ×100 applies to rand", so the premium is not computed 100× too high.
2. **Credit life's cover range is narrow at both ends.** File: `seed/products.json:401-402`.
   - The R5k minimum excludes small personal loans (C-0764 excludes anything below `min_cover`).
   - The R500k maximum means a R60k earner's R600k car finance is capped (C-0763), so a credit-life policy would leave part of the debt to the family.
   - Fix: widen to roughly R1k–R1.5M (100000–150000000 cents).
3. **Home Loan Life Cover can undercut Term Life for someone with no bond.** File: `seed/pricing.json:39-55`.
   - Its minimum premium is R120 against Term's R150, and it has the lower uuid.
   - With C-0768 (an absent `owes.home_loan` fact does not exclude), "Home Loan Life Cover" beats Term Life for small or broker-edited covers (for example R500k at 30: R125 against R150) for a client who never mentioned a bond.
   - Fix: set its minimum premium ≥ Term's (and rates ≥ Term's), or fold it into Important 1's flag.
4. **Gap cover's medical-aid requirement is not where the matcher looks.** File: `seed/products.json:216,233`.
   - "You must belong to a medical aid" lives in `term_rules.requires`, which nothing evaluates. Eligibility is `{"all": []}`.
   - The need derivation (C-0727 and C-0728) covers it today, but the product should carry its own rule: `{"fact": "has_cover.medical_aid", …}`. That path is already in `FACT_PATHS`.
5. **A stale migration pointer in models.ts.** File: `api/_lib/models.ts:289`.
   - The `role_missing` incident still says "is db/0002 applied?". The rows now come from db/0008. This is a follow-on to the C-1526 wording fix.
6. **The voice row's cost fields are misleading.** File: `seed/model_config.json:47`.
   - `cost_per_mtok_in/out: 0` (and `max_tokens`) on a per-minute, *paid* transcription route says the cost is 0. The report itself notes that OpenRouter transcription is not free.
   - Fix: drop the token rates from this row, or leave a `notes`-style comment in the plan for the meeting task that ledgers `transcription` by minutes.
7. **The `data_use` purpose clause reads awkwardly.** File: `seed/disclosures.json:37`.
   - "kept to help us get better at helping people, to improve the service" doubles the clause. Write "…and improve the service" (this can be done with Important 3).
8. **A product removed from seed/ stays live.** File: `scripts/seed-sql.ts:594`.
   - Only bands are pruned. A product taken out of `seed/products.json` stays `active` in the shared demo catalogue forever.
   - Fix: add `UPDATE public.products SET active = false WHERE broker_id IS NULL AND is_demo AND id NOT IN (…)`, or document the gap in the header.
9. **An empty catalogue is returned silently.** File: `api/_lib/catalogue-load.ts:94-96`.
   - If the broker's country has no categories (for example, 0008 not applied), every product is filtered out and an empty catalogue comes back, cached for 60 s. Every need then becomes "no product fits".
   - Fix: throw (so the job retries) or raise an incident when `categories` is empty.
10. **The schema change only works on databases that never ran 0004.** File: `db/0004_catalogue.sql:99-105`.
    - The new columns are only in `CREATE TABLE IF NOT EXISTS`. On any database that already ran 0004 they are never added, and 0008 then fails. "Safe to run more than once" rests on the claim that 0004 has never been applied.
    - Fix: an idempotent `ALTER TABLE … ADD COLUMN IF NOT EXISTS` plus a guarded constraint would keep the claim true. Low risk now, cheap insurance.
11. **The TFSA limit is a real legal figure.** File: `seed/products.json:283`.
    - The tax-free account's `max_cover` of R3 000 a month is exactly the statutory R36 000 annual cap, written as a "demo product limit".
    - This is harmless, but it is a real legal figure in the data, which the notes say there is none of. Either label it in the plan notes or pick an obviously demo cap.
12. **C-0778's named example cannot be shown on the seed.** Files: `criteria/06-matching.md:85`, `seed/categories.json:4`.
    - C-0778's example ("income_protection → income_protection, disability") is not representable on the seed, because disability answers only `disability`.
    - Fix: add a plan note for Task 5.x that C-0778 is shown on `education_saver` (unit_trust + education_saver), or on a fake catalogue. Mapping disability to `income_protection` would compare a lump sum against a monthly benefit.

### Assessment

The task meets the spec. The data, the generator, the re-runnable SQL and `loadCatalogue` are built with care and well tested, and both deviations (the voice row and the C-1526 pointer) are correct. Three issues need fixing before the task is marked complete:

- The pricing makes four categories recommend the narrow product (accident-only, cancer-only, third party, buildings-for-contents).
- `loadCatalogue` can silently truncate pricing at Supabase's 1000-row cap.
- Two required disclosures say "your call was recorded" on in-person quotations.

All three are small changes: data or wording edits plus a paging loop, then a regenerate and a plan note.

**Task quality: Needs fixes**
