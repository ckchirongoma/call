### Task 1.2: Seeds — categories, demo catalogue, pricing, disclosures, model_config

**Files:** Create `seed/categories.json` (13 from SPEC §4 with `need_kinds`), `seed/products.json` (24 demo products per SPEC §8.3, each with `summary` ≤ 60 words, `eligibility` JSON, `exclusions`, `keywords`, `min/max_age`, `min/max_cover`, `term_rules`, `verified_on: "2026-10-31"`, `is_demo: true`, `external_id`), `seed/pricing.json` (6–8 bands per product; life/IP/disability/CI `rate_per_1000`, funeral/gap/credit `flat_cents` or rate, smoker split for life/CI), `seed/disclosures.json` (ZA keys per C-1451 with `required`/`condition`), `db/0008_seed.sql` (generated INSERTs from the JSON by `scripts/seed-sql.ts`), `scripts/seed-sql.ts`, `test/seed.test.ts`, `api/_lib/catalogue-load.ts` (`loadCatalogue(brokerId): Promise<{products, pricing, categories, disclosures}>` with the broker-over-demo rule and a 60 s cache).

- [ ] **Step 1: Failing tests** `[C-0815][C-0816][C-1451][C-1452][C-1455][C-1526]` plus `[C-0845][C-0846][C-0848]` for `loadCatalogue`.
- [ ] **Step 2–4.** **Step 5: Commit** `Demo catalogue, pricing bands, disclosures and model roles as data`

