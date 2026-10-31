# Call

A phone number (and a browser button) that runs an insurance and investment
fact-find with a client, reads the facts back, and within minutes hands the
broker a matched, drafted quotation to approve and send by email or WhatsApp.
The same pipeline runs on a recording of an in-person meeting. Everything is
recorded, stored, sourced and costed. South Africa first.

**Status:** planned, not yet built. This repository currently holds the
research, the design, the behaviour matrix, the acceptance criteria and the
implementation plan. Start at `CLAUDE.md`.

| Path | What it is |
|---|---|
| `CLAUDE.md` | The build brief and reading order |
| `BEHAVIOR-MATRIX.md` | Part A: how Claude works here. Part B: how the product behaves, state by state, with criteria ids |
| `docs/SPEC.md` | The design: rules, journeys, data model, pipeline, matching, the document, dashboard, in-person, ops, security, testing |
| `docs/AGENT-PROMPT.md` | The voice agent's prompt, pushed to ElevenLabs from the repo |
| `docs/RESEARCH.md` | How the problem is solved elsewhere, the free stack's real limits, the regulatory shape, cost per call |
| `docs/superpowers/plans/2026-10-31-call-build.md` | The implementation plan: phases, tasks, TDD steps, for execution agents |
| `criteria/` | 1,337 acceptance criteria; `npm run criteria -- --check` proves each is tagged in a test |
| `docs/BUILD-PROMPT.md` | The prompt that starts the build in a new chat |
| `docs/INTEL-CONTRACT.md`, `docs/INTEL-PHASE0.md` | Chase Intelligence v1: every task recorded whole under one id |
| `scripts/` | `criteria.ts`, the CI greps, the TypeScript loader |

## The shape of the code (once built)

```
Client phone ──▶ Twilio ──▶ ElevenLabs agent ◀── browser widget (/demo, /meeting)
                               │ init · tools · post-call webhooks
                               ▼
                 Vercel functions ─▶ jobs (Supabase) ─▶ worker
                               │
   turns · facts (sourced) · needs · one recommendation per need · quotation (R8 HTML + PDF)
                               │
                 /app broker dashboard: approve → email (Resend) / WhatsApp (Meta)
```

## Running the checks

```bash
npm install
npm run verify
```
