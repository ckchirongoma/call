# Behaviour matrix — Call

Two matrices in one file, because both must be read before anything is built:

- **Part A** — how Claude works in this repository: the founder's standing
  instructions. Added to the turn an instruction arrives, edited not
  duplicated, committed with that round's work.
- **Part B** — how the product behaves: every state × event → behaviour, the
  criteria ids that pin it, and where in the code it lives. A line in Part B
  with no criteria id is a gap; `scripts/criteria.ts --matrix` lists them.

---

## Part A — how Claude works here

| # | Rule | Since | What it means in practice |
|---|------|-------|---------------------------|
| A1 | **Execution agents are required here.** The orchestrating session (Opus 5.5) plans and reviews; fresh execution agents implement, one task at a time, with a fresh reviewer per task and a whole-branch review per phase. Every agent it spawns — executor, reviewer, phase reviewer — runs on Opus 5.5 too. | 2026-10-31 (founder, round 1; "every agent on Opus 5.5" round 3) | Use `superpowers:subagent-driven-development`. The orchestrator never writes product code itself except to unblock a stuck agent; it writes the brief, reads the result, runs `npm run verify`. An execution agent spawns no agents of its own. |
| A2 | **Test-driven, no exceptions.** Every task: failing test first, shown to fail, then the code, then green, then commit. | 2026-10-31 | A test that was not seen failing proves nothing. The plan's steps are written in that order; an agent that skips the red step has its task rejected by the reviewer. |
| A3 | **The criteria are the definition of done.** `criteria/*.md` holds 1,337 acceptance criteria. Each one is proved by at least one test that carries its id in the test name (`[C-0412]`). `scripts/criteria.ts --check` fails on any untested criterion and any tag with no criterion. | 2026-10-31 | Nothing ships to the founder as "done" until `npm run verify` is green: typecheck, every test, every criterion tagged, no model slug in `api/`, no grid/flex/var() in a document, the print-to-PDF smoke. Opus 5.5 runs it, and the reply quotes the counts. |
| A4 | **Free stack only, and ask before any money.** ElevenLabs free → Starter ($6) only the week of a demo and only when told; Twilio trial; Vercel Hobby; Supabase free; Resend free; OpenRouter free models ($10 credit only when told); Meta test number. | 2026-10-31 | Every cost is a row in `usage_ledger` and a line on `/admin`. A task that needs a paid thing stops and says so in the reply; it does not buy, and it does not pretend. |
| A5 | **Build on Charlie, don't rebuild it.** `../charlie` is the reference: `models.ts`, `safety.ts`, `jev.ts`, `graph.ts` (refusal rules), `wa.ts`, `email.ts`, `queue.ts`, `plandoc.ts` (R8 rendering), `test/_fakes.ts`, `alerts.ts`, `track.ts`. Port, attribute in the file header, and keep the comments that explain the failure each rule came from. | 2026-10-31 | A ported file keeps its "why" comments. New behaviour gets its own why. No framework, no build step, Node ≥ 22.6 native type stripping, as Charlie. |
| A6 | **The agent never advises on the call; the broker approves before anything is sent.** This is not a preference: it is the licensing posture (`docs/RESEARCH.md` §4). | 2026-10-31 | Any change that lets a client receive a recommendation without a broker tap, other than the labelled `auto_send` demo switch, is refused and named in the reply. |
| A7 | **Never invent a price, fee, rule, deadline or fact.** Every figure comes from `products` / `product_pricing` / `disclosures` with `verified_on`. The model repeats numbers; it never produces them. | 2026-10-31 (Charlie rule 10) | The checker compares every number in generated text to the allowed set. A new number in a prompt's output is a test failure. |
| A8 | **Nothing may claim the client said something they did not.** Every fact has a transcript turn. | 2026-10-31 (Charlie rule 2) | `facts.turn_id NOT NULL`; `factUpdates()` refusals; "you told me" only on confirmed facts. |
| A9 | **Documents render with tables and inline hex, nothing else.** | 2026-10-31 (Charlie rule 8) | `test/quotedoc.test.ts` greps for `display:\s*(grid|flex)`, `var(`, `<link`, `<style` with classes beyond `@page`/`@media print`. Print to PDF in a real browser before any PR that touches `quotedoc.ts`. |
| A10 | **Every model choice from `model_config`.** CI greps `api/` for slugs (`/[a-z0-9-]+\/[a-z0-9.:-]+(:free)?/` near "model"). The one allowed literal list is `HARD_FALLBACKS` in `models.ts`. | 2026-10-31 (Charlie rule 4) | |
| A11 | **Never print a secret.** No keys, tokens, webhook secrets, phone numbers of real people, or email addresses in replies, commits, logs, tests or docs. Test numbers: `+27 79 993 xxxx`, emails `*@example.test`. | 2026-10-31 | |
| A12 | **Synthetic clients only.** Tests and demo seeds use the `+2779993*` range and `Demo` providers. Never a real insurer's name or price. | 2026-10-31 | The catalogue says "Demo" on every row until the founder supplies real rate tables and says so. |
| A13 | **Merge it yourself when it is green.** One PR per phase against `main`; merge it with the GitHub tools as soon as `npm run verify` and CI are green, so `main` always holds working software and nothing is left unmerged at the end. If `main` does not exist on the remote yet, create it from the planning commit first (`git push origin <planning-sha>:refs/heads/main`). | 2026-10-31 (founder, round 2: "it must merge everything when done"; replaces "never merge") | Merge commit, not squash, so each task's red/green commits stay readable. Never force-push `main`. A PR whose CI is red is fixed, not merged. |
| A14 | **Commit and push before stopping.** Nothing is left uncommitted. Commit messages end with the session's attribution lines. No model identifiers in anything pushed. | 2026-10-31 | |
| A15 | **Supabase changes are paste-ready prompts.** Migrations in `db/` are numbered and re-runnable; `docs/SUPABASE-PROMPT.md` is generated from them with a precheck and a success-criteria table. Claude never applies them to a live project. | 2026-10-31 (Charlie rule 21) | |
| A16 | **No regression; test every door.** A rule holds on the phone, on the widget, in a meeting, in email and on WhatsApp. A fix's test is shown failing on the old code. The reply names regressions Claude caused. | 2026-10-31 (Charlie rule 17) | |
| A17 | **Drift check every round.** Before each PR, audit the round against Part A, SPEC §0 (R1–R15) and this Part B; say what drifted and what was put back. | 2026-10-31 | |
| A18 | **Research before building anything new.** A new integration or rule starts with a note in `docs/RESEARCH.md` (what was found, sources, what is `verify`), and `docs/VERIFIED.md` records what was checked against a live page and when. | 2026-10-31 | The researcher in this session could not fetch vendor pages; every `verify` item is confirmed in Phase 0 before the code that depends on it is written. |
| A19 | **Reply briefly; never ask the founder to test.** Claude runs every test itself: the suite, the criteria check, the simulated call through a local server, the dashboard in the session's Chromium, and print-to-PDF. The reply has what was built, the merged PR links, the verify counts, and only the steps that need the founder's own hands (keys, accounts, anything that costs money, the one live call on a real number). | 2026-10-31 (founder, round 2: "it mustn't ask me to just test everything end-to-end over and over again") | No tester prompt. No "please test end to end". No "can you check X" when Claude can check X. A live check that truly needs the founder is listed once, in `HANDOFF.md`, with what to look at. |
| A20 | **Build what was asked; don't relitigate the risks.** The design already carries the regulatory and privacy posture (SPEC §0). Don't re-raise it in replies; just keep it true. | 2026-10-31 (founder) | |
| A21 | **Track everything (Chase Intelligence v1).** Every task is recorded whole under one id in the shared contract (`docs/INTEL-CONTRACT.md`, copied unchanged from Charlie; `app = "call"`): what the client and the agent said, every tool the agent called, everything each model call was shown and answered, every check, every broker action and correction, every send, every job, and how it ended. | 2026-10-31 (founder, round 2; owner decisions D93/D94) | Built in from the first line of code, not retrofitted: Task 0.6 builds the core, and every later task adds its own capture call and asserts it. Capture never throws, never waits (< 5 ms p95), never changes a result; `INTEL_CAPTURE` = full \| meta \| off. No secrets and no identifiers ever (redacted before the write and again on export). A declined-consent call keeps the shape only, never the words. "Forget me" deletes every row and every trace the client was in. The agent's first message says calls are kept to help and to improve, and how to delete them. Exports go to `intel-export/`, never git. Phase 0 is `docs/INTEL-PHASE0.md`. |
| A22 | **Decide, don't stall.** Where the plan or SPEC leaves a choice open, the orchestrator decides, writes the decision into the task's notes in the plan, and carries on. The founder is asked only before spending money, registering a production number, submitting Meta verification, or touching real client data. | 2026-10-31 (founder, round 2) | A vendor page that cannot be fetched is not a blocker: build to the documented shape, make the parser tolerant, pin it with tests, and mark the row in `docs/VERIFIED.md` "from docs search, not fetched". |

---

## Part B — how the product behaves

Legend: **Where** = file that owns it. **Criteria** = ids in `criteria/`.
Event names are the ones the code uses.

### B1. Before the call connects

| State | Event | Behaviour | Where | Criteria |
|---|---|---|---|---|
| — | `POST /api/voice/init` with known `caller_id` | 200 within 1 s; `dynamic_variables` with `known_client=yes`, `client_first_name`, broker vars; `sessions` row created `mode=call` with `caller_id_raw` | `api/voice.ts` `init()` | C-0001–C-0012 |
| — | init with unknown caller | `known_client=no`, `client_first_name=""`; `clients` row created with `phone_e164` | same | C-0013–C-0016 |
| — | init with no caller id (widget) | `known_client=no`; session `mode=web`; if `name`/`phone` passed by the demo page they are used | same | C-0017–C-0021 |
| — | init with bad secret / malformed body / DB down | still 200 with default variables; `safety_events` `init_degraded`; incident | same | C-0022–C-0028 |
| — | init for a broker whose `elevenlabs_agent_id` does not match `agent_id` | defaults; incident `agent_mismatch` | same | C-0029–C-0030 |

### B2. The conversation (what the transcript must show; checked post-hoc and by evaluation criteria)

| State | Event | Behaviour | Where | Criteria |
|---|---|---|---|---|
| start | first message | contains "AI assistant", "recorded", "{{broker_name}}", a yes/no question; nothing else first | `docs/AGENT-PROMPT.md` §1, `test/agent-prompt.test.ts`, `checker.ts` | C-0100–C-0108 |
| consent asked | client says no | agent closes with §1 wording; no further question; session `declined_consent`; only `consents(granted=false)` stored; no facts, no quote, no notify beyond a one-line broker note | prompt §1, `pipeline.ts` | C-0109–C-0120 |
| consent asked | unclear | one re-ask, plain yes/no | prompt §1 | C-0121–C-0123 |
| fact-find | each question | one question per turn; "skip" accepted; answer saved via `save_fact` with `confidence=agent` | prompt §3, `tools.ts` | C-0124–C-0160 |
| fact-find | "what do you offer?" | category names only, from the catalogue; then the "I can't recommend" line | prompt §2, `lookup_categories` | C-0161–C-0170 |
| fact-find | client offers ID/bank/card/policy number | agent declines with §4 wording; `redact()` scrubs the turn; `safety_events` `identifier_offered` | prompt §4, `redact.ts` | C-0171–C-0182 |
| fact-find | client asks for a recommendation or a price | §4 refusal lines; checker flags any agent turn containing advice/price patterns | prompt §4, `checker.ts` | C-0183–C-0200 |
| fact-find | distress words | §4.6: stop sale path, offer broker call + free counselling, `mark_hardship`, channel for a call only; no budget/cover/beneficiary questions after | prompt §4.6, `distress.ts` | C-0201–C-0222 |
| fact-find | health question | yes/no only; details deflected | prompt §3.7 | C-0223–C-0228 |
| fact-find | known client | `check_existing_cover` before each category; "still right?" phrasing | prompt §3.3 | C-0229–C-0236 |
| fact-find | silence 20 s | "Are you still there?" once; then close; `abandoned` | prompt §7 | C-0237–C-0242 |
| read-back | all questions done | every saved fact read in one run; "Did I get that right?" | prompt §5 | C-0243–C-0255 |
| read-back | correction | corrected fact said back alone; saved `confirmed`; earlier fact `superseded`; "Anything else?"; final re-read of changed facts | prompt §5, `facts.ts` | C-0256–C-0272 |
| read-back | yes | every fact re-saved `confirmed` | prompt §5 | C-0273–C-0276 |
| channel | asked | email or WhatsApp; address read back digit by digit; `set_channel`; "none" → callback number | prompt §6 | C-0277–C-0292 |
| close | normal / hardship / declined / silence | fixed wordings §7; never a promise of time/price/approval | prompt §7 | C-0293–C-0300 |

### B3. Server tools (during the call)

| Tool | Event | Behaviour | Where | Criteria |
|---|---|---|---|---|
| any | missing/wrong `x-call-secret` | 401, nothing written, incident after 3/min | `api/voice.ts` `tool()` | C-0301–C-0306 |
| any | unknown `conversation_id` | session created on the fly (`mode=call`, `provider=elevenlabs`), rate-limited 60/min/conversation | same | C-0307–C-0312 |
| `save_fact` | valid | `facts` row `source=tool`, `turn_id` = latest client turn placeholder (resolved at ingest by timestamp), 200 `{saved:true}` in < 2 s | `tools.ts` | C-0313–C-0325 |
| `save_fact` | identifier in any field | refused, `fact_refusals(reason=identifier)`, 200 `{saved:false, reason:"identifier"}` | same | C-0326–C-0330 |
| `save_fact` | unknown rel/label | refused `relation`; 200 | same | C-0331–C-0334 |
| `save_fact` | same rel/label again with `confirmed` | earlier row `superseded`, new row active | same | C-0335–C-0339 |
| `check_existing_cover` | known client with fact | `{known:"yes", detail}` from active facts only; forgotten client → `no` | same | C-0340–C-0346 |
| `lookup_categories` | phrase | names of active categories with a keyword hit; never a price or provider in the response; empty → `{categories:[]}` | same | C-0347–C-0353 |
| `request_callback` | — | `sessions.outcome` unchanged; `hardship_notes`/`callbacks` row; broker notified at ingest | same | C-0354–C-0357 |
| `mark_hardship` | — | `sessions.mode=stabilising`; `hardship_notes` row with the quote; `safety_events` `hardship_marked` | same | C-0358–C-0363 |
| `set_channel` | email/whatsapp/none | validated (RFC-ish email; E.164 for ZA numbers incl. `0xx` → `+27xx`); invalid → `{ok:false, reason}` so the agent re-asks | same | C-0364–C-0372 |

### B4. Post-call ingestion

| State | Event | Behaviour | Where | Criteria |
|---|---|---|---|---|
| — | `post_call_transcription` with valid signature | raw stored in `webhook_events`; job `ingest_transcript` enqueued; 200 in < 1 s; worker kicked | `api/voice.ts` `postCall()` | C-0400–C-0412 |
| — | bad signature / stale `t` / future `t` | 401; `webhook_events(signature_ok=false)`; incident after 3/hour | same | C-0413–C-0422 |
| — | duplicate event | 200; no second job | same | C-0423–C-0426 |
| — | `post_call_audio` before transcript | stored to Storage under the conversation id; session created if absent; linked when transcript arrives | same, `store_audio` | C-0427–C-0436 |
| — | audio after transcript | linked; `recordings.delete_after = now + retention_days` | same | C-0437–C-0440 |
| ingest | transcript array | `turns` written with idx, role map, timestamps, tool calls; `redact()` applied; duration, cost → `usage_ledger` | `ingest.ts` | C-0441–C-0460 |
| ingest | `analysis.data_collection_results` | stored as `provider_analysis`; each field cross-checked after extraction; `dc_agree`/`dc_disagree` safety events | same | C-0461–C-0468 |
| ingest | evaluation `no_advice_on_call = failure` | incident `agent_advised`; quote still built but `held` with the reason | same | C-0469–C-0472 |
| ingest | consent fact missing or `granted=false` | pipeline stops; outcome `declined_consent`; turns kept only if consent true | same | C-0473–C-0478 |
| ingest | call ended before read-back | `readback_confirmed=false`; facts stay `agent`; notification says "N facts unconfirmed" | same | C-0479–C-0484 |
| ingest | any step throws | job retried ×3 with backoff; then `failed` + incident; nothing half-written (each step idempotent) | `queue.ts` | C-0485–C-0499 |

### B5. Facts

| Input | Behaviour | Where | Criteria |
|---|---|---|---|
| model proposes a fact whose words are in the client turn | kept, `source=extract`, `turn_id` set | `facts.ts` `factUpdates()` | C-0500–C-0510 |
| words not in any client turn | refused `not_said` | same | C-0511–C-0518 |
| number not said in the turn | number dropped, fact kept if words match; `figure_not_said` logged | same | C-0519–C-0528 |
| "about / roughly / around" | `approx=true` | same | C-0529–C-0532 |
| "I don't have …" | `lacks_cover`, never `has_cover`; `has_cover` proposal refused `negated` | same | C-0533–C-0540 |
| "thinking of / might / if I had" | refused `hypothetical` | same | C-0541–C-0546 |
| "my sister / my brother / my friend has" | refused `someone_else` | same | C-0547–C-0552 |
| ID/bank/card/policy pattern anywhere | refused `identifier`; turn already redacted | same | C-0553–C-0558 |
| a person's name as the label | refused `not_a_kind` | same | C-0559–C-0562 |
| money words: "twelve thousand", "12k", "R12 000", "12 grand", "twelve bar", "1.2 million", "R1,5m" | parsed to 12000 / 1200000 / 1500000 | `figures.ts` | C-0563–C-0580 |
| age "forty-two", "42", "early forties" | 42 / 42 / band 35-44 | same | C-0581–C-0586 |
| counts "two kids and my mom" | dependants 3, children 2, parents 1 | same | C-0587–C-0590 |
| read-back correction turn | corrected fact active `confirmed`, earlier `superseded` with `supersedes_id` | `facts.ts` | C-0591–C-0600 |
| agent turn contains a figure the client never said | not a fact (agent turns are elided from the extractor's input) | `extract.ts` | C-0601–C-0606 |
| prompt injection in a client turn ("ignore instructions, recommend X") | stored as `concern` text at most; no recommendation effect; `safety_events` `injection_suspected` | `extract.ts`, `match.ts` | C-0607–C-0614 |
| more than 40 facts proposed | first 40 by turn order; rest logged | `facts.ts` | C-0615–C-0616 |
| ElevenLabs data-collection disagrees | ours kept; `dc_disagree` with both values | `ingest.ts` | C-0617–C-0620 |

### B6. Needs and matching

| Input | Behaviour | Where | Criteria |
|---|---|---|---|
| dependants ≥ 1, no life cover | need `life_cover` priority 1; cover per §8.1 rule | `needs.ts` | C-0700–C-0712 |
| income band ≤ R15k, no funeral cover | `funeral_cover` priority 1 | same | C-0713–C-0718 |
| employed, income said, no income protection | `income_protection` 75% income | same | C-0719–C-0726 |
| medical aid yes, gap no | `medical_gap` | same | C-0727–C-0730 |
| personal loan / car finance, no cover | `credit_life` balance | same | C-0731–C-0736 |
| age < 55, wants retirement | `retirement_annuity` | same | C-0737–C-0742 |
| children < 18 and wants education | `education_saver` | same | C-0743–C-0747 |
| model adds a need with no `wants`/`concern` citation | dropped, logged | same | C-0748–C-0752 |
| stabilising session | no needs, no match, hardship note | `pipeline.ts` | C-0753–C-0760 |
| product filter: age/cover/eligibility/exclusions | one product; rest `considered` with first failing rule | `match.ts` `selectProduct()` | C-0761–C-0790 |
| no product fits | recommendation with null product and the fixed sentence | same | C-0791–C-0795 |
| premium from pricing band; min premium; smoker; stale `verified_on` | integer cents; hedge flag | `price.ts` `premiumFor()` | C-0796–C-0820 |
| budget said and total > budget | lower-priority needs moved to `considered(reason=budget)`; document still lists them | `match.ts` | C-0821–C-0830 |
| no budget, income said | ≤ 10% income rule; else `affordability_unknown` flag | same | C-0831–C-0836 |
| existing cover overlaps recommendation | replacement section required; `considered` includes "keep what you have" | same | C-0837–C-0844 |
| broker's own catalogue vs shared demo | broker rows preferred; demo rows only when `products.broker_id IS NULL` and the broker has none in that category | same | C-0845–C-0850 |

### B7. Writing and checking the quotation

| Input | Behaviour | Where | Criteria |
|---|---|---|---|
| writer output contains a number not in the allowed set | checker fails; regenerate once; then `held` | `check.ts` | C-0900–C-0912 |
| menu words ("option 1", "alternatively you could", "or you could choose") | fail | same | C-0913–C-0918 |
| "you told me" on an `agent`/`transcript` fact | fail; "from our call" allowed | same | C-0919–C-0924 |
| "guaranteed", "approved", "will pay out", "best" | fail | same | C-0925–C-0930 |
| product `verified_on` > 90 days | hedge sentence required | same | C-0931–C-0934 |
| disclosures / FSP missing | fail | same | C-0935–C-0940 |
| checker model/Jev unavailable | rules result stands; `safety_events(engine=none)`; `/api/health guardrails_live=false` | `safety.ts` | C-0941–C-0946 |
| document HTML | tables only, inline hex, no grid/flex/var()/external CSS; sections 1–9 in order; page-break guards; prints to PDF | `quotedoc.ts` | C-0947–C-0990 |
| demo products present | footer "Demo catalogue" | same | C-0991–C-0993 |
| edited by broker | version n+1, old `superseded`, checker re-run | `app.ts` | C-0994–C-0999 |

### B8. Delivery

| State | Event | Behaviour | Where | Criteria |
|---|---|---|---|---|
| `awaiting_broker` | Approve | `approved` → job `send_quote` | `app.ts`, `deliver.ts` | C-1000–C-1006 |
| `awaiting_broker` with unconfirmed facts used by a recommendation | Approve refused with the list; tick first | `app.ts` | C-1007–C-1012 |
| `held` | Approve | allowed only after "Reviewed held reasons" tick; audit | same | C-1013–C-1016 |
| approved, channel email | Resend send with HTML + PDF; `deliveries(sent)`; webhook → delivered/bounced | `email.ts` | C-1017–C-1036 |
| approved, channel whatsapp | template `quote_ready` + PDF document; `deliveries`; status webhooks | `wa.ts` | C-1037–C-1058 |
| whatsapp fails | `failed`; broker notified; one-tap "send by email instead" if an email fact exists | `deliver.ts` | C-1059–C-1066 |
| Resend 100/day reached | queued with `run_after` next UTC day; broker told | `deliver.ts` | C-1067–C-1070 |
| client WhatsApp reply: button `forget_me` | confirm button; then `forget_client` job | `api/wa.ts` | C-1071–C-1078 |
| reply "call me" / free text | broker inbox; no model reply to the client | same | C-1079–C-1084 |
| `auto_send=true` (demo) | skips `awaiting_broker` → `approved` by `system`; audit says demo; document still names the FSP | `pipeline.ts` | C-1085–C-1090 |

### B9. Dashboard

| Page/event | Behaviour | Where | Criteria |
|---|---|---|---|
| login: email known | code emailed; 15-min expiry; one use; cookie set | `auth.ts` | C-1100–C-1114 |
| login: unknown email / 6 wrong codes | same response text; lockout 15 min | same | C-1115–C-1120 |
| `/app` list | broker-scoped; status pills; unconfirmed counts; cost; polling | `app.ts` | C-1121–C-1134 |
| `/app/calls/{id}` from another broker | 404 | same | C-1135–C-1138 |
| transcript + audio | turns with timestamps; player seeks to turn; audio missing → "deleted after N days" note | same | C-1139–C-1148 |
| facts panel actions: tick / untick / edit / add | `broker` facts with reason; audit; recommendations recomputed on edit | same | C-1149–C-1168 |
| recommendations: swap from `considered` / edit cover / remove | new quote version; checker re-run | same | C-1169–C-1180 |
| Hold / Decline / outcome | status + audit | same | C-1181–C-1190 |
| Export record of advice | HTML (R8) with facts + turn refs, considered, recommended, replacement, broker user, time | `roa.ts` | C-1191–C-1204 |
| Forget this client | confirm; job; everything gone; audit counts only | `forget.ts` | C-1205–C-1216 |
| settings: catalogue CSV | row validation; all-or-nothing; `verified_on` required; demo rows untouched | `catalogue.ts` | C-1217–C-1236 |
| settings: auto_send | label "demo only"; audit | same | C-1237–C-1240 |
| `/app/costs` | per-call ledger; month totals; assumptions shown | `app.ts` | C-1241–C-1250 |
| CSRF missing / wrong | 403 | same | C-1251–C-1254 |

### B10. In-person meeting

| Event | Behaviour | Where | Criteria |
|---|---|---|---|
| `/meeting` start | client pick/create; consent line shown; "Client agreed" tap → `consents(in_person)`; session `mode=meeting` | `public/meeting.html`, `api/meeting.ts` | C-1300–C-1312 |
| chunk upload | 60-s chunks to Storage; order by idx; resume after a network blip; max 2 h | same | C-1313–C-1324 |
| finish | `transcribe_meeting` job; chunks concatenated; `voice` role; `turns` with `broker`/`client`/`unknown` | `transcribe.ts` | C-1325–C-1340 |
| speaker labelling low confidence | `unknown`, never `client` by default; facts only from `client`/`unknown`-with-broker-tick | same | C-1341–C-1348 |
| pipeline | same as call from extract onward; facts `confidence=transcript`; approve blocked until ticked | `pipeline.ts` | C-1349–C-1360 |

### B11. Compliance, privacy, retention

| Event | Behaviour | Where | Criteria |
|---|---|---|---|
| retention cron | recordings past `delete_after` deleted from Storage; row marked | `api/cron/retention.ts` | C-1400–C-1408 |
| forget client | every row/file gone; counts in audit; later call from same number starts fresh | `forget.ts` | C-1409–C-1420 |
| consent record | `consents` row per session with turn ref; channel consent with address | `ingest.ts` | C-1421–C-1428 |
| minimality | no ID/bank/card/password/medical detail in any stored text (redaction test over all fixtures) | `redact.ts` | C-1429–C-1440 |
| record of advice contents | s9(a)–(d) sections present | `roa.ts` | C-1441–C-1450 |
| disclosures rows | per country; `verified_on`; document pulls them | `seed/disclosures.json` | C-1451–C-1456 |
| safety events | every check writes one; engine named; `unavailable` is a row | `safety.ts` | C-1457–C-1470 |

### B12. Model layer, ops, security

| Event | Behaviour | Where | Criteria |
|---|---|---|---|
| model truncation | retry same model with more tokens | `models.ts` | C-1500–C-1506 |
| model 429/5xx | next fallback; then `HARD_FALLBACKS` | same | C-1507–C-1514 |
| invalid JSON | repair then retry; then fail the step | same | C-1515–C-1520 |
| `model_config` row disabled/missing | fallback chain; incident | same | C-1521–C-1526 |
| slug literal in `api/` | CI fails | `scripts/grep-models.sh` | C-1527–C-1528 |
| `/api/health` | fields per SPEC §12; `?ping=1` cheap | `api/health.ts` | C-1529–C-1540 |
| alerts | thresholds per SPEC §12; rate-limited | `alerts.ts` | C-1541–C-1552 |
| free-tier guards | minutes, emails/day, OpenRouter/day counted; warn at 80% | `limits.ts` | C-1553–C-1562 |
| cron auth | `CRON_SECRET` required; fail closed | `api/cron/*` | C-1563–C-1566 |
| RLS | public tables readable with anon key; owner tables not; every new table in the lockdown test | `db/0001`, `test/rls.test.ts` | C-1567–C-1580 |
| signed links | 72 h; tamper → 404 | `links.ts` | C-1581–C-1586 |
| webhook raw-byte verification everywhere | ElevenLabs, Resend, Meta | `crypto.ts` | C-1587–C-1596 |
| job fencing | a job claimed by a dead worker is reclaimed after lock timeout; no double processing | `queue.ts` | C-1597–C-1610 |

### B13. Chase Intelligence (every task recorded whole)

| Event | Behaviour | Where | Criteria |
|---|---|---|---|
| any capture | never throws, never awaits, < 5 ms p95; batched flush after the response; `INTEL_CAPTURE` full/meta/off | `api/_lib/intel.ts` | C-1700–C-1709 |
| ids | `s_<session_id>` for everything tied to a session (init, tools, post-call, every job, dashboard actions, sends, delivery webhooks, client replies); `r_` + 16 hex per request otherwise; `job_<id>` for a job with no session; `turn_id` hashed, never a number; `business_id` = client id; `meta.broker_id` | `intel.ts` `traceOf()` | C-1710–C-1716 |
| what is captured | client and agent turns (`ask`/`say`), WhatsApp in, every email/WhatsApp out (`say` + `send`), every model call whole (`model`), every check and fact refusal and ElevenLabs evaluation (`check`), every server tool call (`tool`, actor `model`), every broker action and status change (`track`, actor `person`), every job (`job`), every failure (`error`) | call sites per the plan's Capture map | C-1717–C-1733 |
| redaction | no audio/PDF bytes; no deployment key by value; no token, JWT, key, connection string, cookie, signed link; nothing under a secret-named key; no 9+ digit run in text; money and dates stay; login codes as kind only; contact data as `[contact]` | `api/_lib/intelredact.ts` | C-1734–C-1743 |
| consent and forgetting | declined consent → meta only; forget deletes every row and trace, buffered too; first message, disclosure and meeting panel say what is kept and how to delete | `intel.ts`, `forget.ts`, `AGENT-PROMPT.md` §1 | C-1744–C-1749 |
| storage | never pruned by retention; RLS on, no policies; columns exactly the contract's; contract file byte-identical to Charlie's | `db/0006_platform.sql` | C-1750–C-1753 |
| read back and prove | `readTrace(any id)` returns the whole call in order with jobs folded in; the happy-path call reads back asked → seen → decided → checked → approved → sent → delivered; capture off vs on changes nothing; the whole suite passes with capture on | `intel.ts`, `test/intel-trace.e2e.test.ts` | C-1754–C-1758 |
| "forget me" said on the call | agent confirms and closes; post-call runs `forgetClient()`; nothing survives; broker gets one line | `AGENT-PROMPT.md` §1, `ingest.ts` | C-1771–C-1772 |
| export and operate | export to `intel-export/<time>/` (traces, events, every table, manifest), re-redacted, credentials never; `intel-trace.ts`; `/admin` and `/api/health` show mode, buffered, flushed, dropped; flush failure never fails a request; big prompts kept whole up to 1 MB | `scripts/intel-export.ts`, `scripts/intel-trace.ts` | C-1759–C-1770 |
