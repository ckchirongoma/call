# Task 1.2 report: seeds (categories, demo catalogue, pricing, disclosures, model_config) and loadCatalogue

**Status:** DONE
**Worktree:** /home/user/call/.claude/worktrees/agent-af717e642491c9efb
**Branch:** worktree-agent-af717e642491c9efb (fast-forwarded onto worktree-agent-a6388f5a8ec7632e4 / 01309e9 first)
**Commit:** ff1c1a7 `Demo catalogue, pricing bands, disclosures and model roles as data` (not pushed)

This report is in the worktree because writing to the shared `/home/user/call/.superpowers/…` path was refused. It is not committed.

## TDD evidence

- **RED:** I wrote `test/seed.test.ts` and the new Postgres test in `test/migrations.test.ts` before any implementation. Both files failed with `ERR_MODULE_NOT_FOUND: Cannot find module …/scripts/seed-sql.ts`, which is the right reason because the generator did not exist yet (`# tests 2 # pass 0`). The output is saved in `/tmp/claude-0/-home-user/ad36b136-336a-55d6-81b9-100e21138cdd/scratchpad/red.txt`.
- **A second red, on real Postgres:** the first generated 0008 failed with `unterminated /* comment`. The header contained `seed/*.json`, and Postgres treats a `/*` inside a block comment as the start of a nested comment. I fixed the header wording and added a test assertion that the header opens exactly one comment.
- **GREEN:**
  - `test/seed.test.ts`: 32/32.
  - With `TEST_DATABASE_URL` set, migrations + rls + fakes + seed: 122/122.
  - `npm run typecheck` passes.
  - `npm test`: 181/181 (192/192 with `TEST_DATABASE_URL` set).
  - `npm run test:intel`: 181/181.
  - `criteria --missing` lists none of my ids, and `--matrix` passes.
  - `grep-models` passes.
  - `npm run seed-sql -- --check` passes.

## Files

**New**
- `seed/categories.json`, `seed/products.json`, `seed/pricing.json`, `seed/disclosures.json`, `seed/model_config.json`
- `scripts/seed-sql.ts` — `readSeed`, `validateSeed`, `seedRows`, `seedSQL`, `seedId`, `EXCLUSION_FACTS`, and a CLI with `--check` and `--root`
- `db/0008_seed.sql` (generated)
- `api/_lib/catalogue-load.ts` — `loadCatalogue`, `Catalogue`, `CATALOGUE_CACHE_MS`, `__clearCatalogueCache`
- `test/seed.test.ts`

**Modified**
- `db/0004_catalogue.sql`: adds `disclosures.required` and `disclosures.condition` with checks, plus a units note.
- `api/_lib/types.ts`: adds `DisclosureCondition`, the two new Disclosure fields, and a cents note on the cover columns.
- `test/_fakes.ts`: adds the disclosure columns and the `required` default.
- `test/migrations.test.ts`: the 0008 Postgres test.
- `package.json`: adds the `seed-sql` script.
- `criteria/12-ops-security.md`: C-1526 now says db/0008 instead of db/0002.
- `docs/superpowers/plans/2026-10-31-call-build.md`: Task 1.2 boxes ticked, and a Notes paragraph added.

## Criteria tagged

| Criterion | Where it is tagged |
|---|---|
| C-0815, C-0816, C-1451, C-1452, C-1455, C-1748 | `test/seed.test.ts` |
| C-1526 | `test/seed.test.ts`: the JSON, the generated SQL, and `loadModelConfig` reading the seeded rows |
| C-0845, C-0846, C-0848 | `test/seed.test.ts`: `loadCatalogue` on the fake database, seeded with `seedRows()` |
| C-1526 and C-0815 again | `test/migrations.test.ts`, real Postgres |

The Postgres test checks four things:
- After three runs of every migration file, there are 13 categories, 24 products and 183 bands, 10 ZA disclosures and 7 roles.
- What is stored equals `seedRows()` column for column.
- A re-run puts back a hand edit to a demo product and deletes a band that seed/ no longer lists.
- A re-run keeps a founder's changed model, and both disclosure CHECK constraints work.

## Decisions (also in the plan notes)

1. **Re-runnable without a new constraint.** `products` has no `external_id` column. Each seeded id is an RFC 4122 v5 uuid derived from `external_id`:
   - bands: product + ages + smoker flag;
   - disclosures: country + key.

   So `ON CONFLICT (id) DO UPDATE` updates the rows the last run made. seed/ is the source of truth for demo rows. One scoped `DELETE` removes stale bands, and only for seeded product ids. Categories upsert on `id`, disclosures on `(country, key)`, and model roles use `ON CONFLICT (role) DO NOTHING`.
2. **The disclosure columns went into the 0004 CREATE TABLE, not an ALTER in 0008.** `rls.test.ts` compares the fake and `types.ts` against CREATE TABLE only, and 0004 has not been applied anywhere yet. The columns are `required boolean NOT NULL DEFAULT true` and `condition` (`demo_product` | `auto_send` | `replacement`), with `CHECK (required = (condition IS NULL))`.
3. **Units.** All money is integer cents.
   - `rate_per_1000` is rand per R1 000 per month.
   - Income protection's cover is the monthly benefit.
   - A saving is marked `contribution: true`, its rate is 1000 and its cover is the monthly contribution, so the premium equals the contribution. `min_premium_cents` is the minimum contribution.
   - Gap cover has a flat price and no cover limits.
4. **`unit_trust` answers the `education_saver` need.** It should never answer a need named "tax-free".
5. **Exclusions and eligibility share one vocabulary.** Exclusions are fact codes (`informal_debt`, `treated_condition`, `smoker`). Eligibility uses SPEC §7.3 fact paths plus the `family_option` and `extended_option` flags. Task 5.3 should move this vocabulary into `eligibility.ts`.
6. **loadCatalogue and switched-off categories.** If a broker has any rows in a category, even if all are switched off, that category is the broker's and demo rows never fill it. This follows B6's "has none in that category" and is consistent with C-0352. A test pins it. Beyond that:
   - Only active rows are returned.
   - Products are read in two scoped queries: `eq broker_id` and `is null`.
   - Pricing is read by `in product_id`, in chunks of 150.
   - Categories and disclosures are read by the broker's country.
   - The result is frozen, sorted and cached per broker for 60 s; failures are never cached.
7. **The voice row departs from the brief.** The brief said voice should take a model and fallbacks from HARD_FALLBACKS. Instead it uses the transcription model Charlie's db/0005 settled on, with no fallbacks. `models.ts` itself says HARD_FALLBACKS are chat models and cannot transcribe, so chat fallbacks there would only produce 400s.
8. **Chat roles use only the free HARD_FALLBACKS.** Their cost rates are 0. The paid entry stays reachable only as the code's last resort.
9. **Nothing in the data invents a statutory figure.**
   - The tax-free account's cap is a demo product limit, and its summary says the broker confirms the legal limits.
   - No summary or disclosure carries a figure.
   - Disclosures use only the `{broker_name}`, `{broker_email}` and `{fsp_number}` placeholders.
   - The demo row opens with SPEC §8.3's footer words.

## Concerns

- **Two criteria are only partly provable now.** Both have an "and the quotation's §9 / footer" half that needs `quotedoc` (Task 6.3), which does not exist yet:
  - C-0846's footer half: I assert the demo rows are `is_demo` and that the `demo_product` disclosure row is present.
  - C-1748's §9 half: I assert `data_use` is required with no condition.

  Task 6.3's C-1453 test should close both.
- **Task 8.5 needs a column that does not exist yet.** C-1226 (upsert by `external_id`) needs `products.external_id`. This is noted in the plan for that task.
- **One cost will be recorded as zero.** If the paid last-resort model is ever used, `costCents` uses the role's zero rates, so the ledger will under-report that call.
- **Transcription is not free on OpenRouter.** A meeting transcribed before the founder adds credit will fail and be retried.
