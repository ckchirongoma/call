# Context every Call executor and reviewer reads first

Repository: `/home/user/call` (build here). Reference: `/home/user/charlie` (read-only; port from it).
Branch: `claude/call-phone-agent-build-f50v1t` (already checked out). Never switch branches, never push
(the orchestrator pushes), never touch `main`.

## Read before starting
- `CLAUDE.md`, `BEHAVIOR-MATRIX.md` Part A (how work is done here) and the Part B rows your brief names.
- `docs/SPEC.md` §0 (rules R1–R16) and the sections your brief names.
- The criteria rows your brief names, in `criteria/*.md` — the then-clause of each row is what its test must assert.
- Only the criteria rows and spec sections your task needs. Never read the whole plan file; your brief is the task text.

## Global constraints (verbatim from the plan)
- Node `>=22.6`; `"type": "module"`; every relative import in `api/` ends in `.js` (CI greps). Tests import `.ts` directly.
- No framework, no bundler, no build step. `npm run typecheck`, `npm test`, `npm run verify`.
- Dependencies: exactly the four in `package.json` plus dev `typescript`, `@types/node`. Adding one is a plan change (forbidden to executors).
- No model slug anywhere in `api/` except `HARD_FALLBACKS` in `api/_lib/models.ts` (SPEC R10). Roles: `extract`, `needs`, `writer`, `checker`, `safety`, `voice`, `summary`.
- Documents (`quotedoc.ts`, `roa.ts`, `docparts.ts`): `<table role="presentation">`, inline hex, no grid/flex/`var()`/external CSS (SPEC R8). Brand hex: charcoal `#171f1a`, green `#1f7a4d`, light `#f4f6f5`, rule `#d9e0dc`, text `#222`.
- Every test name carries its criteria ids: `test("[C-0412][C-0413] …")`. A task is not done until `npm run criteria -- --missing` no longer lists its ids.
- Test numbers only in the range `+2779993xxxx`; emails `*@example.test`; providers "Demo …" (BEHAVIOR-MATRIX A11/A12). Never a real insurer's name or price, never a real phone number or email.
- Every webhook verifies HMAC over raw bytes with `timingSafeEqual` before parsing; events are stored, then processed in a job.
- Every table: RLS on; only `products`, `product_categories`, `disclosures` have a `SELECT` policy for `anon, authenticated`. Every table has `created_at timestamptz not null default now()`.
- Every model call: through `askJSON()` in `models.ts` with retries, fallbacks, truncation handling, `max_tokens ≥ 1200`.
- Money is integer cents in the database; `formatRand(cents)` renders "R 1 235" (space thousands, whole rand).
- Dates in documents: "31 October 2026"; times in the dashboard: SAST (`Africa/Johannesburg`).
- Chase Intelligence v1 (SPEC §16, BEHAVIOR-MATRIX A21, `criteria/13-intel.md`): every task that adds an entry point, a model call, a check, a tool, a send, a job, a person action or a status change adds its `capture()` call in that task, and its test asserts the row (kind, name, trace id). Capture never throws, never awaits, never changes a result. (From Task 0.6 on; `api/_lib/intel.ts`.)
- `jobs.id` is `bigint generated always as identity`.
- Never a secret anywhere (keys, tokens, webhook secrets) — tests use obvious fakes like `test-secret`.

## Porting from Charlie (BEHAVIOR-MATRIX A5)
Copy, put "Ported from Charlie `api/_lib/x.ts`; the why-comments are kept." in the file header, then trim to what
Call uses. Keep the comments that explain the failure each rule came from. New behaviour gets its own why-comment.
Match the surrounding code's comment density, naming and idiom.

## How you work (TDD, BEHAVIOR-MATRIX A2)
1. Write the failing test(s) first. Run them and capture the failing output (it must fail for the right reason —
   missing module/function or wrong behaviour, not a typo).
2. Implement. Run the focused tests → green. Then `npm run typecheck` and the full `npm test` once → green.
   Also run `npm run test:intel` once (the suite with Chase Intelligence capture on) → green, same pass count.
3. `npm run criteria -- --missing | grep -E "C-XXXX"` for your ids → none listed.
4. Commit only your task's files (`git add <paths>`; never `git add -A` of unrelated files), message = the brief's
   commit subject, a blank line, a 1–3 line body if useful, a blank line, then exactly these two lines:

       Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
       Claude-Session: https://claude.ai/code/session_01Q73dSdrQHuH76uboEMpq7y

   Never put a model identifier in the commit message otherwise.
5. Tick your task's checkboxes in `docs/superpowers/plans/2026-10-31-call-build.md` (`- [ ]` → `- [x]` under your
   task heading only) in the same commit. If you had to decide something the plan leaves open, add a line
   `**Notes (decided while building):** …` under your task in the plan, in the same commit.

Run tests with: `npm test` (whole suite, capture off) or, for one file,
`TRACKING_OFF=1 node --experimental-strip-types --import ./scripts/register-ts.mjs --test test/x.test.ts`
(`npm test -- test/x.test.ts` runs the whole suite plus that file).

You never spawn agents or subagents of any kind. If the plan leaves a decision open, decide it the simplest way
consistent with SPEC and record it in the plan notes; stop and report NEEDS_CONTEXT only if every path is a guess.

## Secret-shaped test values (GitHub push protection blocks them)
Never write a literal that looks like a real credential in any file — not even a fake one in a test: Supabase
`sb_secret_…`/`sb_publishable_…`, JWTs (`eyJ…` three-part), `sk-…`/`sk_live_…`, AWS `AKIA…`, Slack `xox…`, GitHub
`ghp_…`, PEM blocks, `whsec_` + long base64. Build such test values at runtime from parts
(`["sb", "secret", "TESTONLY…"].join("_")`) or use obviously fake short values like `test-secret`.
