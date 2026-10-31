# Build prompt — paste everything below the line into a new chat

Attach both repositories to the new chat: `ckchirongoma/call` (where you
build) and `ckchirongoma/charlie` (read-only reference).

---

Build **Call** in `ckchirongoma/call`, from the plan already in the repository, all the way to the end. Test everything yourself, record everything under Chase Intelligence v1, and merge it all into `main`.

**What Call is.** A phone number (and a browser button) where an ElevenLabs voice agent runs an insurance and investment fact-find with a client. It reads the facts back and asks "email or WhatsApp?". Within three minutes the broker's dashboard has the call, every fact with the second it was said, one recommendation per need from the catalogue, and a quotation to approve and send. The same pipeline runs on a recorded in-person meeting. Stack: Vercel, Supabase, ElevenLabs, OpenRouter, Resend, Meta WhatsApp Cloud API, all on free tiers.

**Read first, in this order, and treat it as binding.**
1. `CLAUDE.md`
2. `BEHAVIOR-MATRIX.md`. Part A is how you work here and overrides any tool or skill default. Part B is the product's behaviour.
3. `docs/SPEC.md`
4. `docs/AGENT-PROMPT.md`
5. `docs/INTEL-CONTRACT.md` and `docs/INTEL-PHASE0.md`
6. `docs/superpowers/plans/2026-10-31-call-build.md`
7. `criteria/README.md`

The plan ports a lot from `../charlie`: models, safety, Jev, the graph refusal rules, WhatsApp, email, queue, the document renderer, fakes, alerts, tracking and the Chase Intelligence code. If `charlie` is not in the session, add it with read access.

**How you work.**
- **Orchestrator plus execution agents** (`superpowers:subagent-driven-development`). One task at a time: a fresh executor with the plan's brief template, then a fresh reviewer with the review template. At most two executors at once, and only on tasks the plan marks parallel-safe. Executors spawn no agents. No research fan-outs, no swarms.
- **Test-driven on every task.** Write the failing test and run it red before writing the code. Every test name carries its criteria ids, for example `test("[C-0412] …")`.
- **Chase Intelligence v1 from the first line of code** (BEHAVIOR-MATRIX A21; the plan's Capture map). Task 0.6 builds the core. Every later task adds its own `capture()` call and asserts it.
  - One id per session, `s_<session_id>`.
  - Captured: every client and agent turn, every tool the agent called, every model call whole, every check, every broker action and correction, every send, every job, and how it ended.
  - Capture never throws and never waits (under 5 ms at p95), and never changes a result. `INTEL_CAPTURE` is full, meta or off.
  - No secrets and no identifiers, ever: redacted before the write and again on export, proved by tests.
  - A declined-consent call keeps the shape only. "Forget me" deletes every row and every trace the client was in.
  - Exports go to `intel-export/`, never into git.
  - `docs/INTEL-CONTRACT.md` stays byte-identical to Charlie's.
- **Decide, don't stall** (A22). Where the plan leaves a choice open, decide, write it in the task's notes in the plan, and carry on. Vendor pages may be blocked in this session. Build to the documented shape, keep the parser tolerant, pin it with tests, and mark the row in `docs/VERIFIED.md` as "from docs search, not fetched".
- **Ask me only** before spending money, registering a production number, submitting Meta verification, or touching real client data. Nothing else needs me.
- **Never ask me to test** (A19). You run all of it:
  - the suite, with capture off and on
  - the criteria check
  - `npm run simulate-call` through the local dev server
  - the dashboard, driven by Playwright in the pre-installed Chromium (`require('playwright')`, no install)
  - print-to-PDF
  
  Look at the screenshots yourself. No tester prompt, no "please test end to end". The one live call on a real number is listed once in `HANDOFF.md`, and that's the only thing I do.
- **Merge everything** (A13). If the remote has no `main`, first create it from the planning commit: `git push origin origin/claude/determined-maxwell-h4wc00:refs/heads/main`. Each phase ends with a PR into `main`, merged with the GitHub tools as soon as CI is green, using merge commits, never squash or force-push. A red CI is fixed, not merged. At the end, `main` holds every phase.
- **Keep going until Task 12.4 is done.** Don't stop to report between phases. The plan's checkboxes are your memory: tick them as you go, commit and push after every task.
- **Never put any of these anywhere:** secrets; real phone numbers or emails (test numbers are `+2779993xxxx`, emails `*@example.test`); real insurers' names or prices (the catalogue is "Demo …"); model identifiers in commits, PRs or docs.
- **Commit messages** end with this session's attribution lines.

**Done means:**
- Every task in the plan is ticked.
- `npm run verify` is green: typecheck, tests in both modes, every one of the 1,337 criteria tagged, the model-slug and document-CSS greps, and the print smoke.
- `npm run simulate-call -- happy-path` produces a session, and `npm run intel-trace -- <that session id>` reads it back in order: asked, seen, decided, checked, approved, sent, delivered.
- The browser test approves and sends a quote in Chromium.
- `HANDOFF.md` and `docs/SUPABASE-PROMPT.md` are written.
- Every PR is merged into `main`.

**Final reply, brief:** what was built, the merged PR links, the counts (tests in each mode, criteria tagged out of total), the intel-trace summary of the simulated call, and only the steps that need my own hands. Those are: keys to set in Vercel; the Supabase prompt to paste; ElevenLabs, Twilio and Resend accounts; the WhatsApp templates to submit; anything that costs money, waiting for my yes; and the one live call.
