# Call — build brief for Claude Code

> **Read `BEHAVIOR-MATRIX.md` first.** Part A is how you work here (execution
> agents, TDD, the criteria as the definition of done, free stack, ask before
> money). Part B is how the product behaves, state by state.

## What this is

A phone number and a browser button that run an insurance and investment
fact-find with a client, read the facts back, and within minutes hand the
broker a matched, drafted quotation to approve and send by email or WhatsApp.
The same pipeline runs on a recording of an in-person meeting. Everything is
recorded, stored, sourced and costed. South Africa first.

The agent **collects and confirms; it never recommends on the call**. The
**broker approves** before anything reaches a client. That is the licensing
posture and it is not negotiable (`docs/RESEARCH.md` §4).

## Read in this order

1. `BEHAVIOR-MATRIX.md` — how to work, and the product's behaviour matrix.
2. `docs/SPEC.md` — the design: rules R1–R15, journeys, data model, pipeline, matching, the document, the dashboard, in-person, ops, security, testing.
3. `docs/AGENT-PROMPT.md` — the voice agent's prompt, which is also a spec.
4. `docs/superpowers/plans/2026-10-31-call-build.md` — the implementation plan, task by task, TDD, for execution agents.
5. `criteria/README.md` and `criteria/*.md` — the 1,264 acceptance criteria. Every one is tagged in a test before the work is done.
6. `docs/RESEARCH.md` — why these choices; what still says **verify**.
7. `../charlie` — the reference implementation this ports from. Read `charlie/CLAUDE.md`'s ten rules; they hold here as SPEC R1–R15.

## Stack (free tier of each; see RESEARCH §3)

ElevenLabs Agents (voice, Twilio native integration for the number, browser
widget for the demo) · Vercel functions in TypeScript with no framework and no
build step (Node ≥ 22.6, native type stripping, like Charlie) · Supabase
(Postgres, Storage, RLS on everything) · OpenRouter for post-call model work,
roles from `model_config` · Resend for email · Meta WhatsApp Cloud API ·
Jev optional for guardrails with the model backstop.

## How you work here

- **Orchestrator + execution agents** (`superpowers:subagent-driven-development`). The orchestrator reads the plan, dispatches one task at a time to a fresh execution agent with the task text, the Interfaces block, the criteria ids and the fakes to use; a fresh reviewer checks the diff against the task and the criteria; the orchestrator runs `npm run verify` after every phase.
- **TDD on every task.** Red, run it, green, run it, commit. The reviewer rejects a task whose test was not shown failing.
- **Criteria tags in test names**: `test("[C-0412][C-0413] …")`. `npm run criteria -- --check` must pass before a phase is called done.
- **`npm run verify`** = `typecheck` + `test` + `criteria --check` + `grep-models` + `grep-doc-css` + `preview-quote` smoke.
- **Port from Charlie** with attribution in the file header and the "why" comments kept.
- **Ask before money, production numbers, Meta verification, real client data.** Everything else: build it.
- **Reply briefly.** What changed, the PR link, the verify counts, the founder's steps, one tester prompt.

## Running it

```bash
npm install
npm run typecheck
npm test
npm run criteria -- --check     # every criterion tagged, every tag real
npm run verify                  # everything CI runs
node --experimental-strip-types --import ./scripts/register-ts.mjs scripts/preview-quote.mjs   # print-to-PDF proof
```

## Definition of done for the demo

- A verified phone number (or the `/demo` widget) where Mike or the distributor completes consent → fact-find → read-back → channel, and within 3 minutes the broker dashboard shows the call, the sourced facts, one recommendation per need, and the quotation; one tap sends it by email (WhatsApp once the template is approved); the client receives a PDF that prints cleanly.
- The in-person page records a meeting and lands in the same dashboard.
- `/app/costs` shows the real cost of each call.
- `npm run verify` green: every test, every criterion tagged, no model slug in `api/`, no grid/flex/var() in a document, PDF smoke passing.
- `HANDOFF.md` lists what cannot be ticked from inside a repository (a live number, a stranger completing the flow, template approval) and how the founder ticks it.
