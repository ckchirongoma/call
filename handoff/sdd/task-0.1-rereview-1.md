# Task 0.1 re-review, fix round 1

This covers the fix commit `52fdded Fakes: refuse shapes and buckets the real client would reject`, read from `review-de2f40f..52fdded.diff`. The four touched files are unchanged between `52fdded` and the current HEAD (`0160f15`, a behaviour-matrix commit), so the line numbers below hold at HEAD.

The fix report (`task-0.1-report.md`, "## Fix round 1") names a covering test for each finding. It shows RED output: 12 new tests failing against the unchanged fake, each for the missing behaviour, while the 40 earlier tests still pass. It also shows GREEN: 52/52 under `npm test` and `test:intel`, and a clean typecheck. I re-ran the file once to settle the doubt the first review could not: `test/fakes.test.ts` gives 52 pass and 0 fail, and `tsc --noEmit` is clean. I also ran one scratchpad probe on edge cases, written outside the checkout.

## Finding Verdicts

| Finding | Verdict | Where |
|---|---|---|
| **Important 1**: filter/order column shapes not validated; unknown columns should be loud | **ADDRESSED** | `test/_fakes.ts:106` `COLUMNS` and `:167` `JSONB` are checked against `types.ts` in both directions at type level, and `tsc` is clean. `:301-303` defines `PLAIN` and `JSON_TEXT` (camelCase keys allowed). `:326` `resolveColumn` refuses `->`, deeper paths, casts, `->>` on a non-jsonb column and any unknown column. It is used by every filter, by `not()` and by `order` (`:868`). Projections, write keys and seeds also go through `requireColumn` (`:305`). The review listed plain-column typos as "not covered"; they are now caught too, so no "Not emulated" line is needed (`:38-40` is updated anyway). Test: `test/fakes.test.ts:399`. |
| **Important 2**: storage accepts any bucket | **ADDRESSED** | `test/_fakes.ts:1033` sets `BUCKETS = {recordings, quotes}`. At `:1060-1061`, upload, download, list and remove on any other bucket return supabase-js's `{ data: null, error: "Bucket not found" }` and store nothing. Test: `test/fakes.test.ts:680` covers both `fakeStorage()` and `db().storage`. |
| **Minor 1**: builder options silently ignored | **ADDRESSED** | `test/_fakes.ts:288` `onlyOptions` is applied to select (`:788`, which allows only `count: "exact"` and `head`, and allows no options after a write), insert (`:812`), update (`:821`), upsert (`:829`), delete (`:849`), order (`:868`, with `nullsFirst` now implemented), limit and range (`:875`, `:881`) and rpc (`:940`). Test: `test/fakes.test.ts:432`. A follow-on test for ragged batches is at `:461`. |
| **Minor 2**: `rpc()` returns a bare Promise | **ADDRESSED** | `test/_fakes.ts:940` returns a lazy builder that runs and logs only when awaited. It has `single()` and `maybeSingle()`, which go through the shared `finish`. Any other method throws, naming `rpc("claim_job").x(...)`, and wrong arguments throw. Test: `test/fakes.test.ts:470`. |
| **Minor 3**: upsert batch not one statement; duplicate key in a batch | **ADDRESSED** | `test/_fakes.ts:685` `upsertRows` stages every row and returns 21000 on a repeated conflict key; with `ignoreDuplicates` the repeat is skipped (`:692-710`). It then checks the end state with `firstConflict` (`:592`) and applies all rows or none. The same end-state check now covers insert (`:613`) and update (`:768` onward). Test: `test/fakes.test.ts:499`, including the case where two rows of one UPDATE collide. |
| **Minor 4**: explicit `id` on `jobs` / `intel_events` | **ADDRESSED** | `test/_fakes.ts:615` (insert), `:687` (upsert) and `:768` (update) all return 428C9 with Postgres's messages (`:504-506`). Seeds are exempt, as a fixture's OVERRIDING SYSTEM VALUE would be. Test: `test/fakes.test.ts:547`. |
| **Minor 5**: `undefined` filter value matches nothing | **ADDRESSED** | `test/_fakes.ts:382` `checkFilterValue` throws on undefined, including inside `in()`. It also throws on null anywhere but `is()`, and `is()` accepts only null, true or false. Test: `test/fakes.test.ts:561`. |
| **Minor 6**: `claim_job` treats NULL timestamps as due | **ADDRESSED** | At `test/_fakes.ts:917-926`, `due` and `stale` are false for a NULL or unparsable value, and NULL sorts last. Test: `test/fakes.test.ts:576`. The plan notes item (10) records this for Task 1.1. |
| **Minor 7**: FakeNet string-only bodies; `/g` and `/y` RegExp state | **ADDRESSED** | `test/_fakes.ts:1259` `recordBody` adds `bytes` and `form`; URLSearchParams and Blobs become text, and a stream throws. At `:1242-1244`, `toRe` copies the pattern without `g` and `hits` resets `lastIndex`. Tests: `test/fakes.test.ts:819` and `:847`. The `/y` test's prompt starts with "You extract facts" (`:764`), so it really exercises the sticky case. |
| **Minor 8**: DEFAULTS gaps; `intel_events` `created_at` (ruling: none, the timestamp is `at`) | **ADDRESSED** | `test/_fakes.ts:226` `DEFAULTS` is now typed `Partial<TableRows[T]>` and covers sessions `readback_confirmed` and `cost_cents` (`:228`) and quotes `flags` (`:231`), among others. Defaults apply only when a key is absent. Following the ruling, `intel_events` gets `at`, `seq`, `v` and `content_mode` and no `created_at` (`:244`); `fill` adds `created_at` only where the table has that column (`:581`). The `types.ts:22` header states the rule. Plan notes items (8) and (9) give Task 1.1 the full list, including the C-1580 exemption (`docs/superpowers/plans/2026-10-31-call-build.md:111`). Tests: `test/fakes.test.ts:593` (`cost_cents + 1`, and no `created_at` key at `:622`) and `:428` (`order("created_at")` on intel_events is refused). |
| **Minor 9**: indentation drift | **ADDRESSED** | The `makeBucket` body (`test/_fakes.ts:1057-1100`), `ModelCall.payload` (`:1209`) and `const payload` (`:1320`) are now 2-space, as the diff shows. |

Minor 10 was deferred and was not verified.

## New Breakage in the Fix Diff

No Critical or Important breakage. Two Minor gaps sit in the new code. Neither has a call site yet.

1. **Minor: `rpc("claim_job", { p_worker: undefined })` passes the new argument check.** `test/_fakes.ts:940` (the key-count check). The probe confirms the fake claims a job with `locked_by: null`. In production, supabase-js drops the undefined key from the JSON body, so PostgREST receives `{}` and answers PGRST202. This is the same call-site bug Minor 5 closed for filters. Fix: refuse an undefined `p_worker`.
2. **Minor: `->>` key text can differ from Postgres.** `test/_fakes.ts:303` (`JSON_TEXT`) and `columnValue`.
   - **Nested values:** `->>` on a nested object or array value returns `JSON.stringify` text, such as `{"a":1}`. Postgres's jsonb text is `{"a": 1}`. The probe matched the fake's spelling and not Postgres's, so this is a silent mismatch. The implementer listed it as concern 3.
   - **Digit-only keys:** a key such as `payload->>0` is read as an object key. PostgREST reads digits as an array index.
   - **Fix:** refuse `->>` when the stored value is an object or array, or when the key is digits only.

## Out-of-Scope Observations

- The fix goes beyond what the review asked for, and each addition is tested: a full column whitelist, refusal of ragged batches (supabase-js sends the union of keys, and PostgREST writes NULL into each gap), null outside `is()`, and `not(col, "is", true/false)`. As concern 1 of the report says, later tasks that need `->`, `count: "planned"` or heterogeneous batches must teach the fake.
- The DEFAULTS that SPEC §4 does not state are the implementer's own choices: `'active'`, `'draft'`, `'queued'`, `'{}'` arrays, `count 1` and the intel_events `seq`, `v` and `content_mode`. They are recorded for Task 1.1 in plan note (8). Task 1.1 must either match them or edit the fake in the same commit.
- HEAD has moved one commit past the fix (`0160f15`, behaviour matrix A23). It does not touch the fix files.

## Verdict

**APPROVED.** Every finding under verification is addressed, each with a covering test that was shown red and then green. The suite and the typecheck re-run green. The fix introduced only two Minor gaps, and neither blocks the task.
