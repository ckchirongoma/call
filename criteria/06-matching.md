# 06 — Needs, product selection, price, budget (`needs.ts`, `match.ts`, `price.ts`)

Owner: `test/needs.test.ts`, `test/match.test.ts`, `test/price.test.ts`. Fact fixtures are built with `test/_facts.ts` helpers (`fact("earns","monthly_income",12000)` etc.).

| id | area | journey | criterion | owner |
|---|---|---|---|---|
| C-0700 | needs | life | Given `dependants=2`, no `has_cover/life`, then `needsFrom()` includes `life_cover` with `priority=1`. | test/needs.test.ts |
| C-0701 | needs | life | Given `dependants=0`, no home loan, then no `life_cover` need. | test/needs.test.ts |
| C-0702 | needs | life | Given `dependants=0` and `owes/home_loan=800000`, then `life_cover` need (debt reason) with `basis` citing the loan fact. | test/needs.test.ts |
| C-0703 | needs | life | Given `has_cover/life` active, then no `life_cover` need unless `wants/life_cover` (then priority 3, note "has cover already"). | test/needs.test.ts |
| C-0704 | needs | life | Given `age=42`, `income=12000`, then default cover = 12000 × 12 × 23 = 3,312,000 before product cap. | test/needs.test.ts |
| C-0705 | needs | life | Given `owes/home_loan=800000` and income 12000, then minimum cover = 800000 + 3 × 144000 = 1,232,000. | test/needs.test.ts |
| C-0706 | needs | life | Given no income fact, then cover rule falls back to the product minimum and `basis.affordability_unknown=true`. | test/needs.test.ts |
| C-0707 | needs | life | Given `age=66`, then `life_cover` need still derived; product filter decides eligibility. | test/needs.test.ts |
| C-0708 | needs | life | Given `basis`, then every fact id cited exists and is `active`. | test/needs.test.ts |
| C-0709 | needs | life | Given a superseded fact, then it is never in `basis`. | test/needs.test.ts |
| C-0710 | needs | life | Given `wants/life_cover` in the client's words, then `needs.note` is those words. | test/needs.test.ts |
| C-0711 | needs | life | Given income as a band `10000-15000`, then midpoint 12500 is used and `approx=true` carried. | test/needs.test.ts |
| C-0712 | needs | life | Given the same facts twice, then `needsFrom()` is deterministic (same ids, same order). | test/needs.test.ts |
| C-0713 | needs | funeral | Given ZA and `lacks_cover/funeral`, then `funeral_cover` need. | test/needs.test.ts |
| C-0714 | needs | funeral | Given income ≤ 15000, then `funeral_cover` priority 1. | test/needs.test.ts |
| C-0715 | needs | funeral | Given income > 15000 and dependants, then priority 2 (after life). | test/needs.test.ts |
| C-0716 | needs | funeral | Given `has_cover/funeral` and `wants/funeral_cover` ("the society is unreliable"), then need with note and `replacement_candidate=true`. | test/needs.test.ts |
| C-0717 | needs | funeral | Given `dependants ≥ 1`, then `basis.family=true` (family option). | test/needs.test.ts |
| C-0718 | needs | funeral | Given `parents_supported ≥ 1`, then `basis.extended=true`. | test/needs.test.ts |
| C-0719 | needs | income | Given `employment=employed`, `income=12000`, `lacks_cover/income_protection`, then `income_protection` need with cover 9000/month. | test/needs.test.ts |
| C-0720 | needs | income | Given `employment=self_employed`, then same need, `basis.self_employed=true`. | test/needs.test.ts |
| C-0721 | needs | income | Given `employment=unemployed`, then no `income_protection`. | test/needs.test.ts |
| C-0722 | needs | income | Given `employment=retired`, then none. | test/needs.test.ts |
| C-0723 | needs | income | Given no income fact, then need derived with `affordability_unknown` and no cover figure. | test/needs.test.ts |
| C-0724 | needs | income | Given `has_cover/group_income` (employer), then need priority lowered to 3 with note "check employer cover". | test/needs.test.ts |
| C-0725 | needs | income | Given both `income_protection` and `disability` candidates, then `disability` is priority 2 and cites the same facts. | test/needs.test.ts |
| C-0726 | needs | income | Given `disability` cover = 5 × 144000 = 720000. | test/needs.test.ts |
| C-0727 | needs | gap | Given `has_cover/medical_aid` and `lacks_cover/medical_gap`, then `medical_gap` need. | test/needs.test.ts |
| C-0728 | needs | gap | Given no medical aid, then no gap need (gap requires medical aid). | test/needs.test.ts |
| C-0729 | needs | gap | Given `has_cover/medical_gap`, then none. | test/needs.test.ts |
| C-0730 | needs | gap | Given medical aid via employer (`group_medical`), then gap need still derived. | test/needs.test.ts |
| C-0731 | needs | credit | Given `owes/personal_loan=50000` and no cover named, then `credit_life` need cover 50000. | test/needs.test.ts |
| C-0732 | needs | credit | Given `owes/car_finance=180000`, then `credit_life` 180000 unless `has_cover/credit_life`. | test/needs.test.ts |
| C-0733 | needs | credit | Given `owes/home_loan`, then `credit_life` NOT derived (life cover covers it; note). | test/needs.test.ts |
| C-0734 | needs | credit | Given `owes/credit_card` only, then `credit_life` priority 4. | test/needs.test.ts |
| C-0735 | needs | credit | Given `owes/informal`, then no credit life; `basis.informal_debt=true` on life need and broker note. | test/needs.test.ts |
| C-0736 | needs | credit | Given the loan balance was approximate, then cover rounds up to the nearest 10000. | test/needs.test.ts |
| C-0737 | needs | retirement | Given `age=42`, `employment=employed`, `lacks_cover/retirement`, then `retirement_annuity` need. | test/needs.test.ts |
| C-0738 | needs | retirement | Given `age=58`, then no RA need unless `wants/retirement`. | test/needs.test.ts |
| C-0739 | needs | retirement | Given `has_cover/group_pension`, then RA need priority 4 with note. | test/needs.test.ts |
| C-0740 | needs | retirement | Given `wants/retirement`, then priority 2. | test/needs.test.ts |
| C-0741 | needs | retirement | Given budget said, then RA contribution = remaining budget after protection needs, min product minimum. | test/match.test.ts |
| C-0742 | needs | retirement | Given no budget and no income, then RA need kept with `affordability_unknown`. | test/needs.test.ts |
| C-0743 | needs | education | Given `children_under_18=2` and `wants/education_saver`, then need with `basis.children=2`. | test/needs.test.ts |
| C-0744 | needs | education | Given `wants/education_saver` and no children fact, then need with note "confirm children" and priority 4. | test/needs.test.ts |
| C-0745 | needs | education | Given children but no want, then no education need (savings are want-driven). | test/needs.test.ts |
| C-0746 | needs | education | Given `tax_free_savings` want and remaining budget ≥ 250, then `tax_free_savings` need. | test/needs.test.ts |
| C-0747 | needs | education | Given remaining budget < 250, then TFSA moved to `considered(reason=budget)`. | test/match.test.ts |
| C-0748 | needs | model | Given the `needs` model adds `{kind:"critical_illness", cites:[wantsFactId]}` and that fact says "cancer runs in my family", then kept priority 3. | test/needs.test.ts |
| C-0749 | needs | model | Given the model adds a need citing no fact, then dropped and `safety_events(need_uncited)`. | test/needs.test.ts |
| C-0750 | needs | model | Given the model adds a need citing a non-`wants`/`concern` fact, then dropped. | test/needs.test.ts |
| C-0751 | needs | model | Given the model re-orders priorities, then the new order is kept only if every priority-1 rule need stays ≤ 2. | test/needs.test.ts |
| C-0752 | needs | model | Given the model output is invalid, then the rule-derived needs stand unchanged and `safety_events(needs_model_failed)`. | test/needs.test.ts |
| C-0753 | pipeline | stabilising | Given `sessions.mode=stabilising`, then `analyse_needs` writes zero needs. | test/journey.e2e.test.ts |
| C-0754 | pipeline | stabilising | Given stabilising, then `match` is not enqueued. | test/journey.e2e.test.ts |
| C-0755 | pipeline | stabilising | Given stabilising, then `hardship_notes.next_step` = "Broker to call; registered debt counsellor suggested". | test/journey.e2e.test.ts |
| C-0756 | pipeline | stabilising | Given stabilising, then the broker page shows "Hardship" and no quote section. | test/app.test.ts |
| C-0757 | pipeline | stabilising | Given stabilising and the broker later marks "steadied", then a new session is needed; no quote from this one. | test/app.test.ts |
| C-0758 | pipeline | stabilising | Given stabilising, then no delivery to the client exists. | test/journey.e2e.test.ts |
| C-0759 | pipeline | stabilising | Given stabilising, then `usage_ledger` still records the call. | test/journey.e2e.test.ts |
| C-0760 | pipeline | stabilising | Given stabilising, then `safety_events(check=stabilising_mode, outcome=block)` exists. | test/journey.e2e.test.ts |
| C-0761 | match | filter | Given category `life`, `age=42`, cover 1,500,000 and the demo catalogue, then `selectProduct()` returns exactly one product. | test/match.test.ts |
| C-0762 | match | filter | Given `age=70` and all life products `max_age=65`, then no product; recommendation with `product_id=null`. | test/match.test.ts |
| C-0763 | match | filter | Given cover above every product's `max_cover`, then cover is capped at the highest `max_cover` and `premium_basis.capped=true`. | test/match.test.ts |
| C-0764 | match | filter | Given cover below a product's `min_cover`, then that product is excluded with reason `min_cover`. | test/match.test.ts |
| C-0765 | match | filter | Given eligibility `{"all":[{"fact":"is.employment","in":["employed","self_employed"]}]}` and employment unemployed, then excluded reason `eligibility:is.employment`. | test/match.test.ts |
| C-0766 | match | filter | Given eligibility `{"any":[…]}`, then any-of semantics. | test/match.test.ts |
| C-0767 | match | filter | Given eligibility `{"fact":"is.smoker","eq":"no"}` and smoker yes, then excluded. | test/match.test.ts |
| C-0768 | match | filter | Given eligibility references a fact that is absent, then the product is NOT excluded but `premium_basis.unverified_eligibility` lists it. | test/match.test.ts |
| C-0769 | match | filter | Given `exclusions` contains "informal_debt" and `owes/informal`, then excluded reason `exclusion:informal_debt`. | test/match.test.ts |
| C-0770 | match | filter | Given `active=false`, then never selected or considered. | test/match.test.ts |
| C-0771 | match | filter | Given two products qualify, then the cheaper monthly premium for the needed cover wins. | test/match.test.ts |
| C-0772 | match | filter | Given equal premiums, then the more recent `verified_on` wins. | test/match.test.ts |
| C-0773 | match | filter | Given equal again, then the lower `id` wins (deterministic). | test/match.test.ts |
| C-0774 | match | filter | Given the result, then `considered` lists every other active product in the category with `reason` = first failing rule or `"more expensive"`. | test/match.test.ts |
| C-0775 | match | filter | Given `considered`, then each entry has `product_id`, `name`, `reason`, and `premium_cents` when it qualified. | test/match.test.ts |
| C-0776 | match | filter | Given a `term_rules` `{max_term_to_age:65}` and age 42, then `term_months = 276`. | test/match.test.ts |
| C-0777 | match | filter | Given `term_rules` `{fixed_term_months:120}`, then 120. | test/match.test.ts |
| C-0778 | match | filter | Given the need kind maps to two categories (`income_protection` → `income_protection`, `disability`), then products from both are compared and one is chosen. | test/match.test.ts |
| C-0779 | match | filter | Given an exact-age band boundary (age 44 vs band 35-44), then inclusive upper bound. | test/match.test.ts |
| C-0780 | match | filter | Given `age` absent but `age_band` present, then the band midpoint is used for filtering and `premium_basis.age_from_band=true`. | test/match.test.ts |
| C-0781 | match | filter | Given neither age nor band, then no product selected; reason `age_unknown`; broker note. | test/match.test.ts |
| C-0782 | match | filter | Given `selectProduct()` is pure (no DB, no model), then it runs in under 5 ms for 50 products. | test/match.test.ts |
| C-0783 | match | filter | Given the same inputs, then the same output (snapshot). | test/match.test.ts |
| C-0784 | match | filter | Given a product with `keywords`, then keywords never affect selection (they are for `lookup_categories` only). | test/match.test.ts |
| C-0785 | match | filter | Given `funeral` with `basis.family=true`, then products whose `eligibility.family_option=true` are preferred (tie-break before price). | test/match.test.ts |
| C-0786 | match | filter | Given `medical_gap`, then products are `flat_cents` priced. | test/match.test.ts |
| C-0787 | match | filter | Given `credit_life` cover 180000 and product `max_cover=150000`, then capped with `capped=true` and note "balance above cover". | test/match.test.ts |
| C-0788 | match | filter | Given a product `min_age=18` and age 17, then excluded `min_age`. | test/match.test.ts |
| C-0789 | match | filter | Given the client is a smoker and the product has only `smoker=false` pricing rows, then excluded `no_smoker_rate`. | test/match.test.ts |
| C-0790 | match | filter | Given the selection, then exactly one `recommendations` row per `needs` row (DB unique index `(need_id)` where status != removed). | test/match.test.ts |
| C-0791 | match | none | Given no product fits, then `recommendations.product_id IS NULL`, `why = "No product in the catalogue fits this yet"`. | test/match.test.ts |
| C-0792 | match | none | Given no product fits, then `considered` still lists every product with its reason. | test/match.test.ts |
| C-0793 | match | none | Given no product fits, then the document shows the need under "What we could not match yet" and the broker notification counts it. | test/quotedoc.test.ts |
| C-0794 | match | none | Given no product fits for every need, then no `quotes` row is created; the broker gets a "needs only" page. | test/journey.e2e.test.ts |
| C-0795 | match | none | Given the broker later uploads a fitting product, then "Re-match" on the call page re-runs `match` and creates a new quote version. | test/app.test.ts |
| C-0796 | price | band | Given `rate_per_1000=0.85`, cover 1,000,000, then premium = 85,000 cents (R850). | test/price.test.ts |
| C-0797 | price | band | Given `min_premium_cents=15000` and computed 8,500, then 15,000. | test/price.test.ts |
| C-0798 | price | band | Given `flat_cents=24900`, then 24,900 regardless of cover. | test/price.test.ts |
| C-0799 | price | band | Given age 42 and bands 35-44 / 45-54, then the 35-44 row. | test/price.test.ts |
| C-0800 | price | band | Given smoker yes and rows `smoker=true` and `smoker=false`, then the true row. | test/price.test.ts |
| C-0801 | price | band | Given smoker unknown and a `smoker=null` row, then that row; else the `smoker=true` row with `premium_basis.assumed_smoker=true`. | test/price.test.ts |
| C-0802 | price | band | Given no row for the age, then `premium=null`, `reason=no_rate`, product excluded. | test/price.test.ts |
| C-0803 | price | band | Given rounding, then half-cents round half-up and the result is an integer. | test/price.test.ts |
| C-0804 | price | band | Given `verified_on` 91 days ago, then `premium_basis.stale=true`. | test/price.test.ts |
| C-0805 | price | band | Given `verified_on` 89 days ago, then `stale=false`. | test/price.test.ts |
| C-0806 | price | band | Given stale, then the document carries "confirm with your broker" on that line. | test/quotedoc.test.ts |
| C-0807 | price | band | Given `premium_basis`, then it records `pricing_id`, `rate_per_1000` or `flat_cents`, `age_used`, `smoker_used`, `cover_used`. | test/price.test.ts |
| C-0808 | price | band | Given the premium, then `formatRand(85000)` = "R 850" and `formatRand(123456)` = "R 1 235" (display rounds to whole rand; cents are kept in the data). | test/price.test.ts |
| C-0809 | price | band | Given cover display, then `formatRand(150000000)` = "R 1 500 000". | test/price.test.ts |
| C-0810 | price | band | Given a per-year product (`per=year` in `term_rules`), then the document shows "a year" and the total converts to monthly for the comparison line. | test/quotedoc.test.ts |
| C-0811 | price | band | Given `premiumFor()` is called with cover 0, then throws `InvalidCover`. | test/price.test.ts |
| C-0812 | price | band | Given negative rate in data, then the catalogue validator rejects the row at upload. | test/catalogue.test.ts |
| C-0813 | price | band | Given overlapping age bands in data, then the validator rejects the upload. | test/catalogue.test.ts |
| C-0814 | price | band | Given a gap in bands (35-44, 46-54), then the validator warns and age 45 yields `no_rate`. | test/catalogue.test.ts |
| C-0815 | price | band | Given the demo seed, then every product has at least one pricing row per age decade 18-65. | test/seed.test.ts |
| C-0816 | price | band | Given the demo seed, then every `verified_on` equals the seed date and is within 90 days of the test's fixed clock. | test/seed.test.ts |
| C-0817 | price | band | Given the total, then `quotes.total_premium_cents` = sum of recommendation premiums with a product. | test/match.test.ts |
| C-0818 | price | band | Given one recommendation has `premium=null`, then the total excludes it and the document says "excluding {need}". | test/quotedoc.test.ts |
| C-0819 | price | band | Given the model is asked to write, then all premium and cover figures are passed as pre-formatted strings. | test/write.test.ts |
| C-0820 | price | band | Given the checker, then the allowed-number set is built from `premium_basis`, `cover_amount`, fact values and the total (formatted and raw). | test/check.test.ts |
| C-0821 | match | budget | Given budget 600 and needs life (R350) + funeral (R120) + income protection (R400), then IP moves to `considered(reason=budget)` and total = 470. | test/match.test.ts |
| C-0822 | match | budget | Given budget covers all, then nothing moved. | test/match.test.ts |
| C-0823 | match | budget | Given priority-1 needs alone exceed budget, then they are kept and `quotes.flags` includes `over_budget` for the broker. | test/match.test.ts |
| C-0824 | match | budget | Given needs moved for budget, then the document §6 lists them with "within your budget of R600 we started with…". | test/quotedoc.test.ts |
| C-0825 | match | budget | Given a moved need, then its `recommendations.status=removed` with `reason=budget` and product still recorded. | test/match.test.ts |
| C-0826 | match | budget | Given budget approximate ("about six hundred"), then a 10% tolerance applies (660). | test/match.test.ts |
| C-0827 | match | budget | Given budget 0 ("nothing right now"), then stabilising-lite: recommendations drafted but `flags.no_budget` and the document opens with "when you're ready". | test/match.test.ts |
| C-0828 | match | budget | Given RA/TFSA needs, then they take the remainder after protection, never before. | test/match.test.ts |
| C-0829 | match | budget | Given the broker removes a recommendation, then budget allocation is recomputed on the new version. | test/app.test.ts |
| C-0830 | match | budget | Given the broker edits cover upward past budget, then the version is created with `over_budget` flag and a confirm step. | test/app.test.ts |
| C-0831 | match | affordability | Given no budget and income 12000, then the cap is 1200. | test/match.test.ts |
| C-0832 | match | affordability | Given no budget and no income, then no cap and `flags.affordability_unknown`. | test/match.test.ts |
| C-0833 | match | affordability | Given income band, then midpoint × 10%. | test/match.test.ts |
| C-0834 | match | affordability | Given expenses ≥ income, then `flags.negative_cashflow` and the document opens cautiously ("you mentioned money is tight"). | test/match.test.ts |
| C-0835 | match | affordability | Given `affordability_unknown`, then the broker page shows a yellow banner. | test/app.test.ts |
| C-0836 | match | affordability | Given cap applies, then the same move-to-considered logic as budget with `reason=affordability`. | test/match.test.ts |
| C-0837 | match | replacement | Given `has_cover/funeral` (provider "the society") and a funeral recommendation, then `recommendations.replaces_fact_id` set. | test/match.test.ts |
| C-0838 | match | replacement | Given a replacement, then `considered` includes `{name:"Keep what you have", reason:"existing cover"}`. | test/match.test.ts |
| C-0839 | match | replacement | Given a replacement, then the document §7 is present and names waiting periods restarting. | test/quotedoc.test.ts |
| C-0840 | match | replacement | Given no overlap, then §7 absent. | test/quotedoc.test.ts |
| C-0841 | match | replacement | Given the existing cover amount is said and ≥ the need, then no recommendation; `needs.note="already covered"`. | test/match.test.ts |
| C-0842 | match | replacement | Given existing cover amount unknown, then recommendation drafted with `flags.verify_existing`. | test/match.test.ts |
| C-0843 | match | replacement | Given group (employer) cover, then never treated as replaceable; note instead. | test/match.test.ts |
| C-0844 | match | replacement | Given the record of advice, then replacement disclosures (s9(d)) appear whenever `replaces_fact_id` is set. | test/roa.test.ts |
| C-0845 | match | catalogue | Given the broker has own rows in `life`, then demo `life` rows are not considered. | test/match.test.ts |
| C-0846 | match | catalogue | Given the broker has no rows in `funeral`, then demo funeral rows are used and the document footer says demo. | test/match.test.ts |
| C-0847 | match | catalogue | Given a broker row `is_demo=false`, then no demo footer for that line. | test/quotedoc.test.ts |
| C-0848 | match | catalogue | Given another broker's rows, then never visible (query scoped by `broker_id IN (this, NULL)`). | test/match.test.ts |
| C-0849 | match | catalogue | Given the catalogue changes after a quote was built, then the existing quote's `premium_basis` is unchanged (snapshot). | test/match.test.ts |
| C-0850 | match | catalogue | Given a product is deactivated, then "Re-match" excludes it and the old quote still renders. | test/app.test.ts |
