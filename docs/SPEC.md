# Call — design specification

*Working name: **Call**. The repo is `ckchirongoma/call`. The voice persona's
name is per-broker configuration (`brokers.agent_name`, default "Ava") and
never appears in code.*

A phone number (and a browser button) that runs an insurance and investment
fact-find with a client, reads the facts back, and within minutes hands the
broker a matched, drafted quotation to approve and send by email or WhatsApp.
The same pipeline runs on a recording of an in-person meeting. Everything is
recorded, stored, sourced and costed.

South Africa first. Built so a second market is a data change: the catalogue,
the disclosures, the currency and the regulator's name are rows, not code.

Companion documents: `docs/RESEARCH.md` (why these choices), `docs/AGENT-PROMPT.md`
(what the voice agent says, question by question), `BEHAVIOR-MATRIX.md` (every
state × event → behaviour, and the founder's standing instructions),
`criteria/` (the acceptance criteria, 1,337 of them), and the implementation
plan in `docs/superpowers/plans/`.

---

## 0. The rules this product is built under

Ported from Charlie (`../charlie/CLAUDE.md`), where each one came from a real
failure, and extended for a regulated product. They are binding on every task.

| # | Rule | Where it is enforced |
|---|---|---|
| R1 | **The agent collects and confirms; it never recommends on the call.** "Your broker will come back to you with a recommendation" is the only forward statement allowed. | Agent prompt (§6), reply checker on every agent turn in the transcript (post-hoc `safety_events`), evaluation criterion `no_advice_on_call`. |
| R2 | **Nothing may claim the client said something they did not.** Every fact carries the transcript turn it came from. A fact with no backing turn is refused. | `facts.turn_id NOT NULL`, `factUpdates()` refusal rules (§7.3). |
| R3 | **One recommendation per need, never a menu.** Name what an alternative would depend on. | Matching engine returns exactly one `recommendations` row per `needs` row; the writer prompt is forbidden from listing options; checker rejects "option 1/2", "alternatively you could". |
| R4 | **Read-back before use.** The agent reads the facts back and the client confirms or corrects before the call ends. A fact the client corrected is superseded, never merged. | Agent prompt §5; `facts.status = superseded`; evaluation criterion `readback_done`. |
| R5 | **Never invent a price, fee, rule or deadline.** Every figure comes from `products` / `product_pricing` with `verified_on`; past 90 days it is hedged "confirm with your broker". The model never writes a number: it is given the computed numbers as text and may only repeat them. | Price computation in code (§8.2); writer-output checker compares every number in the text to the allowed set. |
| R6 | **Free and reversible first; stabilising mode when the client is in debt distress.** No sale to someone who cannot pay: the call switches to "stabilising", the pipeline produces a hardship note for the broker, no quotation, a pointer to a registered debt counsellor. | Distress classifier (§7.5) on the transcript; agent prompt §4.6; pipeline branch. |
| R7 | **Every button is an action, never re-parsed text.** Dashboard and WhatsApp buttons carry an action id. | Dashboard actions (§10); WhatsApp interactive replies parsed by id. |
| R8 | **Every document renders with `<table role="presentation">` and inline hex. No grid, flex, `var()`, external CSS.** | `quotedoc.ts`; `test/quotedoc.test.ts` greps the output; print-to-PDF check in a real browser. |
| R9 | **Retries with backoff on every model call; truncation is a size problem.** | `models.ts` ported from Charlie. |
| R10 | **Every model choice comes from `model_config`, never code.** CI greps `api/` for model slugs. | `db/0002`, CI step. |
| R11 | **Minimality.** The agent never asks for, and the extractor refuses to store, an ID number, bank or card details, passwords, or medical history beyond "smoker yes/no" and "any condition a doctor treats you for, yes/no". | Agent prompt §4; `IDENTIFIER` refusal; redaction before storage (§7.2). |
| R12 | **Human in the loop.** Nothing reaches a client until a broker user taps Approve, unless `brokers.auto_send = true`, which is off by default and labelled "demo". | `quotes.status` machine (§9). |
| R13 | **A guardrail that is off is a row, not a silence.** Every check writes `safety_events` with `engine` ∈ {jev, model, rules, none}; `/api/health` shows `guardrails_live`. | Ported from Charlie `safety.ts`. |
| R14 | **Consent first, and the truth about what is kept.** The first message says it is an AI, the call is recorded, it is used for the recommendation and kept to improve the service, and that "forget me" deletes it; "no" ends the call and stores only the refusal. | Agent prompt §1; `consents` table; `data_use` disclosure. |
| R15 | **Nothing is stored that cannot be deleted.** "Forget me" (on the call, dashboard or WhatsApp) deletes every row and file for that client within one job, including every Chase Intelligence row and every trace they were in. | `forgetClient()` cascade test; `forgetIntel()`. |
| R16 | **Every task is recorded whole (Chase Intelligence v1).** One id per session; every turn, tool call, model call, check, broker action, send and job, in order; never a secret or an identifier; never changes what the product does. | §16; `docs/INTEL-CONTRACT.md`; `criteria/13-intel.md`. |

---

## 1. Actors and surfaces

| Actor | Surface | What they do |
|---|---|---|
| **Client** | Phone call to the broker's number; or the browser widget on `/demo`; or sitting with the broker (in-person mode) | Answers the fact-find, confirms the read-back, chooses email or WhatsApp, later receives the quotation and can reply "forget me" / "call me". |
| **Broker user** | `/app` (magic-link email login), WhatsApp notification | Sees calls as they land, reviews facts with their transcript lines, edits, approves the quotation, sends it, exports the record of advice, marks the outcome. |
| **Broker admin** | `/app/settings` | Catalogue upload (CSV), agent name, FSP number and disclosures, auto-send switch, retention days, notification channel. |
| **Founder / operator** | `/admin` (`ADMIN_SECRET`), `/api/health` | Cost ledger, safety events, failed jobs, webhook log, model config. |
| **The agent** (ElevenLabs) | Inbound call / widget | Runs `docs/AGENT-PROMPT.md`, calls our server tools, triggers post-call webhooks. |

---

## 2. Architecture

```
Client phone ──▶ Twilio number ──▶ ElevenLabs agent ◀── browser widget (/demo, /meeting)
                                      │
      before the call connects:       │ POST /api/voice/init   (caller known? dynamic vars)
      during the call:                │ POST /api/voice/tool/* (lookup_product_categories,
                                      │                         save_fact, check_existing_cover,
                                      │                         request_callback, end_reasons)
      after the call:                 │ POST /api/voice/post-call (transcript event, audio event)
                                      ▼
                                 Vercel functions (TypeScript, no framework)
                                      │ verify HMAC over raw bytes, dedupe on conversation_id+type,
                                      │ store raw event, enqueue job, answer 200 in < 1 s
                                      ▼
                                 jobs (Supabase) ──▶ /api/worker (drain + cron catch-up)
                                      │
        ┌───────────────┬─────────────┼──────────────┬───────────────┐
        ▼               ▼             ▼              ▼               ▼
   transcript →    facts graph    needs +        quotation       delivery
   turns stored    (sourced,      recommendations  document       email (Resend)
   audio → Storage  refused rows   (rules first,   (R8 HTML,      WhatsApp (Meta)
                    logged)        one per need,   PDF via        broker notify
                                   model writes    Chromium)
                                   the why)
        └──────────────── every step: safety_events, usage_ledger, audit_log ─────────────┘
                                      ▼
                        /app  broker dashboard (approve → send, record of advice)
                        /admin operator view, /api/health
```

Three Vercel functions carry the load: `api/voice.ts` (init, tools, post-call —
one file because they share the signature code and the call row),
`api/worker.ts` (the queue), `api/app.ts` (dashboard pages and actions).
`api/render-pdf.ts` is alone with Chromium, as in Charlie. `api/meeting.ts`
takes in-person uploads. `api/health.ts`, `api/admin.ts`, `api/cron/*`.

Every model call goes through OpenRouter via `api/_lib/models.ts` (ported),
roles from `model_config`: `extract`, `needs`, `writer`, `checker`, `safety`,
`voice` (batch transcription for in-person), `summary`.

---

## 3. The journeys

### 3.1 Call-in (the demo)

1. Client dials. ElevenLabs POSTs `/api/voice/init` with `caller_id`. We look up `clients` by (broker, E.164 phone). Response: `dynamic_variables` {`agent_name`, `broker_name`, `fsp_number`, `known_client` ("yes"/"no"), `client_first_name` or ""}. Any error → defaults, never a non-200.
2. First message (consent). Client says yes → fact-find. No → polite close; `consents` row `granted=false`; post-call pipeline stops at "declined".
3. Fact-find (AGENT-PROMPT §2–§4): reason for the call → about you → money in and out → what you already have → what you owe → what you want this to do → budget → health flags → beneficiaries (count) → channel. Each answer the agent is confident about is saved mid-call with the `save_fact` tool (so a dropped call still leaves facts), tagged `confidence: agent`.
4. Read-back (§5). The agent reads the facts in one breath, asks "did I get that right?", takes corrections one at a time, repeats until "yes". Confirmed facts are re-saved with `confidence: confirmed`.
5. Channel and consent to be contacted: "Email or WhatsApp? … and that's the right address/number?" Saved via `save_fact` (`channel`, `email` or `whatsapp`).
6. Close: "Your broker, {broker_name}, will come back to you on {channel} with a recommendation. Nothing is final until you hear from them." Hang up.
7. Post-call: `post_call_transcription` arrives → job `ingest_transcript`; `post_call_audio` arrives (either order) → job `store_audio`. `ingest_transcript` fans out: `extract_facts` → `analyse_needs` → `match` → `write_quote` → `check_quote` → `notify_broker`. Target: broker notified within 3 minutes of hang-up.
8. Broker opens `/app/calls/{id}`: transcript with audio player, facts (each with "said at 02:14 ▶" and status), needs, the one recommendation per need with its why, the quotation preview, Approve / Edit / Hold / Decline. Approve → `send_quote` job → email (PDF attached + HTML body) or WhatsApp (template + PDF document) → `deliveries` row with provider id → status updates from Resend/Meta webhooks.
9. Client replies on WhatsApp "call me" / "forget me" / anything → routed: `call me` → broker notified; `forget me` → confirm button → `forget_client` job; anything else → forwarded to the broker's dashboard inbox (we do not converse post-quote on WhatsApp in v1).
10. Outcome: broker marks `quotes.outcome` ∈ {accepted, declined, no_response, replaced}; the cohort view counts it.

### 3.2 In-person meeting

1. Broker opens `/meeting` on a phone or laptop, picks or creates the client, taps Start. The page reads the consent line aloud / shows it; broker taps "Client agreed"; `consents` row with `method: in_person`.
2. Browser records with `MediaRecorder` in 60-second chunks and uploads each to `/api/meeting/chunk` (Storage). Stop → `/api/meeting/finish` → job `transcribe_meeting` (OpenRouter audio endpoint, `voice` role; chunks concatenated in order) → `meeting_turns` with speaker labels `broker`/`client` inferred by the `summary` role from context (the broker's name is known; the model labels each line; low-confidence labels are kept as `unknown`, never guessed into `client`).
3. Joins 3.1 at step 7 with `session.mode = meeting`. The read-back step is replaced by the broker's review of facts in the dashboard: a fact in a meeting session is `confidence: transcript` until the broker ticks it, and the quotation cannot be approved while any fact used by a recommendation is unticked.

### 3.3 Hardship (stabilising mode)

Trigger during the call: the distress rules (§7.5) fire on the client's own words ("can't pay", "arrears", "garnishee", "debt review", "they're repossessing", "I've got nothing left after the loans"). The agent, by prompt rule, stops the sale path: no budget question, no channel question for a quote; instead: "It sounds like money is tight right now. The most useful thing is not another policy. {broker_name} will call you to talk about what you already have, and there are registered debt counsellors who can help for free." Collects the channel for the broker's call only. Post-call: `sessions.mode = stabilising`, no `quotes` row, a `hardship_notes` row for the broker with the quotes, the broker notification says "Hardship — call first", and the matching engine does not run.

### 3.4 Declined consent, dropped call, silence

- Declined: ends; `sessions.outcome = declined_consent`; nothing else stored.
- Dropped before read-back: facts saved mid-call are `confidence: agent`; pipeline runs; the quotation cannot be approved until the broker ticks the unconfirmed facts; the broker notification says "Call dropped at 04:12 — 7 facts unconfirmed".
- Silence > 20 s twice: agent asks once "are you still there?", then closes politely; session `outcome = abandoned`.

---

## 4. Data model (Supabase, `db/00NN_*.sql`, all re-runnable)

RLS on every table. `products`, `product_categories`, `disclosures` are
public-read (reference data). Everything else: no policies — service role only.

```sql
brokers            id, name, fsp_number, agent_name, country text default 'ZA',
                   currency text default 'ZAR', auto_send bool default false,
                   retention_days int default 30, notify_channel text ('email'|'whatsapp'|'both'),
                   notify_email, notify_whatsapp, elevenlabs_agent_id, phone_number_e164,
                   created_at
broker_users       id, broker_id, email, name, role ('admin'|'user'), last_login_at
login_codes        id, email, code_hash, expires_at, used_at           -- magic link
sessions_auth      id, broker_user_id, token_hash, expires_at

clients            id, broker_id, phone_e164 (nullable for walk-ins), email, first_name,
                   last_name, preferred_channel, created_at, forgotten_at
                   UNIQUE (broker_id, phone_e164) WHERE phone_e164 IS NOT NULL
sessions           id, broker_id, client_id, mode ('call'|'web'|'meeting'|'stabilising'),
                   provider ('elevenlabs'|'upload'), conversation_id (unique, nullable),
                   started_at, ended_at, duration_secs, outcome
                   ('completed'|'declined_consent'|'dropped'|'abandoned'|'hardship'|'failed'),
                   consent_turn_id, readback_confirmed bool, channel_chosen,
                   caller_id_raw, cost_cents int, created_at
turns              id, session_id, idx int, role ('agent'|'client'|'broker'|'unknown'),
                   text, t_start_secs numeric, t_end_secs numeric, tool_calls jsonb,
                   UNIQUE (session_id, idx)
recordings         id, session_id, storage_path, mime, bytes, duration_secs,
                   delete_after timestamptz, deleted_at
consents           id, session_id, client_id, kind ('recording'|'contact'|'in_person'),
                   granted bool, turn_id, method ('voice'|'tap'|'in_person'), created_at

facts              id, session_id, client_id, rel text, label text, value_text, value_num numeric,
                   unit text, per text, turn_id NOT NULL, confidence
                   ('agent'|'confirmed'|'transcript'|'broker'), status ('active'|'superseded'|'refused'),
                   supersedes_id, source ('tool'|'extract'|'readback'|'broker'|'elevenlabs_dc'),
                   created_at
fact_refusals      id, session_id, rel, label, reason, raw jsonb, created_at

needs              id, session_id, kind text, priority int, basis jsonb (fact ids), note
recommendations    id, need_id, product_id, cover_amount numeric, term_months int,
                   premium_cents int, premium_basis jsonb, why text, alternative_if text,
                   considered jsonb (product ids + reason not chosen), status
                   ('draft'|'approved'|'edited'|'removed'), created_at
quotes             id, session_id, client_id, broker_id, version int, status
                   ('draft'|'checked'|'awaiting_broker'|'approved'|'sent'|'delivered'|'read'|
                    'failed'|'held'|'declined'|'superseded'), html text, pdf_path,
                   total_premium_cents, checker_report jsonb, approved_by, approved_at,
                   outcome ('accepted'|'declined'|'no_response'|'replaced'), outcome_at
deliveries         id, quote_id, channel ('email'|'whatsapp'), to_address, provider_id,
                   status ('queued'|'sent'|'delivered'|'read'|'bounced'|'failed'), error,
                   sent_at, updated_at
hardship_notes     id, session_id, quotes_from_client text[], next_step text, created_at

product_categories id text PK ('life'|'funeral'|'disability'|'income_protection'|'critical_illness'|
                   'medical_gap'|'retirement_annuity'|'tax_free_savings'|'unit_trust'|'short_term_car'|
                   'short_term_home'|'credit_life'|'education_saver'), name, need_kinds text[],
                   country
products           id, broker_id (null = shared demo catalogue), category_id, provider_name,
                   name, summary, min_age, max_age, min_cover, max_cover, term_rules jsonb,
                   eligibility jsonb, exclusions text[], keywords text[], verified_on date,
                   source_url, active bool, is_demo bool default true
product_pricing    id, product_id, age_from, age_to, smoker bool|null, rate_per_1000 numeric
                   (per month) | flat_cents int, min_premium_cents, verified_on date
disclosures        id, country, key, text, verified_on            -- indicative, underwriting, FSP, recording

model_config       role PK, provider, model, fallbacks text[], params jsonb, enabled bool
jobs               id bigint identity, kind, session_id, payload jsonb, status, attempts, run_after, locked_by,
                   locked_at, last_error, created_at
webhook_events     id, provider ('elevenlabs'|'resend'|'meta'), event_type, external_id,
                   signature_ok bool, raw jsonb, received_at, UNIQUE (provider, external_id, event_type)
safety_events      id, session_id, check text, engine ('jev'|'model'|'rules'|'none'),
                   outcome ('pass'|'flag'|'block'|'unavailable'), detail jsonb, created_at
usage_ledger       id, session_id, item ('agent_minutes'|'llm_tokens'|'telephony'|'email'|
                   'whatsapp'|'transcription'|'storage'), qty numeric, unit, cost_cents int,
                   provider_ref, created_at
audit_log          id, broker_user_id, action, entity, entity_id, before jsonb, after jsonb, at
incidents          id, kind, severity, summary, fingerprint, first_at, last_at, count
```

Indexes: `sessions (broker_id, started_at desc)`, `turns (session_id, idx)`,
`facts (session_id, status)`, `jobs (status, run_after)`, `quotes (broker_id, status)`.

`forgetClient(clientId)`: deletes `recordings` files from Storage, then rows in
every table with `client_id` or via `sessions`, writes one `audit_log` row with
only counts, and sets `clients.forgotten_at` (the row itself is kept with
phone and email nulled so a later call from the same number starts fresh and
the deletion is provable).

---

## 5. The voice agent configuration (pushed from the repo)

`scripts/push-agent.ts` builds the agent from `docs/AGENT-PROMPT.md` (the
prompt is the markdown's §1–§7 rendered to text with the broker's variables as
`{{agent_name}}`, `{{broker_name}}`, `{{fsp_number}}`, `{{known_client}}`,
`{{client_first_name}}`) and these settings:

- First message: AGENT-PROMPT §1 (consent).
- Language: en; voice: a neutral South African English voice chosen in the dashboard (its id in `brokers.voice_id`, not code).
- LLM: native, chosen in the dashboard; the slug is recorded in `brokers.agent_llm` for the cost ledger.
- Server tools (all `POST https://{PUBLIC_BASE_URL}/api/voice/tool/{name}`, header `x-call-secret: {VOICE_TOOL_SECRET}`, each parameter typed, each tool's description copied from §6.1):
  - `save_fact(rel, label, value_text?, value_num?, unit?, per?, confidence)`
  - `check_existing_cover(category)` → "known: yes/no" from earlier facts of a known client
  - `lookup_categories(need_phrase)` → the category names that exist in this broker's catalogue (names only, never prices)
  - `request_callback(reason, preferred_time)`
  - `mark_hardship(quote)`
  - `set_channel(channel, address)`
- Dynamic variables from `/api/voice/init`.
- Data collection fields (cross-check only): `reason_for_call`, `age_band`, `dependants`, `monthly_income_band`, `existing_cover`, `monthly_budget`, `channel`.
- Evaluation criteria: `consent_given`, `readback_done`, `no_advice_on_call`, `no_identifiers_requested`, `channel_captured`, `hardship_handled`.
- Post-call webhook URL `/api/voice/post-call`, both event types, secret in `ELEVENLABS_WEBHOOK_SECRET`.
- Security tab: initiation webhook on; overrides allowed: `first_message` only.

The script is idempotent (`PUT` the same config) and prints a diff. Running
it is the only approved way to change the live agent.

---

## 6. What the agent may and may not say

Full text in `docs/AGENT-PROMPT.md`. The rules the checker enforces on every
agent turn after the call (and the evaluation criteria mirror):

| Must | Must not |
|---|---|
| Say it is an AI assistant for {broker_name} and that the call is recorded, in the first message | Say or imply it is a person |
| Ask one question at a time; accept "skip" for any question | Ask for ID number, bank or card details, passwords, policy numbers, medical details beyond the two yes/no flags |
| Read every captured fact back and get a yes | Recommend, compare or rank any product; quote any premium; say "you should", "I'd suggest", "the best option" |
| Use the catalogue's category names only when the client asks "what do you offer" | Name a provider or a price |
| Switch to stabilising on distress words | Continue the sale path after distress |
| Capture channel and confirm the address/number by reading it back | Send anything itself |
| Close with "{broker_name} will come back to you with a recommendation" | Promise a time, a price, an approval or a payout |

---

## 7. The pipeline after the call

### 7.1 Ingest (`ingest_transcript`)

Input: the stored `webhook_events` row. Steps: upsert `sessions` by
`conversation_id` (created at init if the init webhook ran, else here);
write `turns` from the transcript array (role mapping `agent`→agent,
`user`→client; `time_in_call_secs` to `t_start_secs`; tool calls kept in
`tool_calls`); `duration_secs`, `cost_cents` (ElevenLabs' `metadata.cost` ×
the credit price from `model_config.params`… no: from `usage_rates` in
`brokers`? — **decision:** from env `ELEVENLABS_CENTS_PER_MINUTE`, default 10,
shown on `/admin` as an assumption); the ElevenLabs `analysis` block stored
on the session as `provider_analysis` and each `data_collection_results`
field written to `facts` with `source = elevenlabs_dc`, `status = refused`
unless our extraction agrees (§7.3 cross-check). Then enqueue
`extract_facts`. Idempotent: a second transcript event for the same
conversation is a no-op (unique index on `webhook_events`).

### 7.2 Redaction before storage

Before any turn text is stored: `redact(text)` replaces 13-digit runs
(SA ID), 16-digit runs (card), IBAN-like and account-number-like runs
("account number is …" followed by 8+ digits), and anything after "my
password is" with `[redacted]`, and writes a `safety_events` row `redaction`
with the kinds found. Phone numbers and email addresses are **not** redacted
(they are the contact channel) but they are only stored on `clients`, and in
the turn they are replaced with `[contact]` once copied.

### 7.3 Facts (`extract_facts`) — the client graph

Relations (`facts.rel`), each with the value shape and the words that back it:

| rel | label (kind) | value | Backed by |
|---|---|---|---|
| `is` | `age` / `age_band` | num or band (`18-24`,`25-34`,`35-44`,`45-54`,`55-64`,`65+`) | a number or band they said |
| `is` | `marital_status`, `employment` (`employed`,`self_employed`,`contract`,`unemployed`,`retired`,`student`), `smoker` (yes/no), `treated_condition` (yes/no) | text | their words |
| `supports` | `dependants` (count), `children_under_18` (count), `parents_supported` (count) | num | a number they said |
| `earns` | `monthly_income` (num or band) | num/band, `per: month` | a number or band they said |
| `spends` | `monthly_expenses`, `rent_or_bond` | num | number they said |
| `has_cover` | category id + provider if said | cover amount / premium if said | their words naming the cover |
| `lacks_cover` | category id | — | "I don't have", "no funeral cover" |
| `owes` | `home_loan`,`car_finance`,`credit_card`,`personal_loan`,`store_account`,`informal` | balance, instalment | numbers they said |
| `owns` | `home`,`car`,`business` | value if said | their words |
| `wants` | a need kind (§8.1) | free text in their words | their words |
| `budget` | `monthly_budget` | num | number they said |
| `beneficiaries` | `count` | num | number they said |
| `channel` | `email` / `whatsapp` | the address | confirmed by read-back |
| `concern` | free text, ≤ 100 chars | — | their words |

`factUpdates(raw, clientTurns, turnIndex)` — the port of Charlie's
`graphUpdates()` — keeps a proposed fact only when:

1. `rel`/`label` is in the table above (`reason: relation`);
2. `turn_id` points at a **client** turn whose words share a stem with the label or value, or name the same thing by an alias (`reason: not_said`);
3. every number on it appears in that turn's figures, in any of the ways South Africans say money ("twelve thousand", "12k", "R12 000", "twelve grand", "about ten") — approximate words ("about", "roughly", "around") set `approx = true` (`reason: figure_not_said`);
4. the backing clause is not negated ("I don't have life cover" → `lacks_cover`, never `has_cover`), not hypothetical ("I'm thinking of getting", "if I had", "I might"), not about someone else ("my sister has funeral cover") (`reasons: negated`, `hypothetical`, `someone_else`);
5. nothing on it matches an identifier pattern (`reason: identifier`);
6. a `has_cover`/`owes`/`wants` label names a kind, never a person;
7. in a `web`/`call` session, a fact that the read-back turn later contradicts is written as `superseded` by the corrected one (the read-back correction wins, R4).

Everything refused is a `fact_refusals` row; the count by reason is on
`/admin`. ElevenLabs' `data_collection_results` are compared: agreement →
`safety_events` `dc_agree`; disagreement → `dc_disagree` with both values,
ours kept.

The model prompt (`extract` role) is given: the client turns only (agent
turns elided to "[agent asked about X]" so it cannot copy the agent's
wording as the client's), the relation table, and the instruction to return
JSON `{facts: [...]}` with `turn_idx` on each. Max 40 facts.

### 7.4 Needs (`analyse_needs`)

Deterministic first: `needsFrom(facts)` derives candidate needs from the
graph with the rules in §8.1 (e.g., `supports.dependants ≥ 1 ∧ lacks_cover.life`
→ need `life_cover` priority 1). Then the `needs` role model is given the
facts and the candidate list and may **re-order and annotate** (`note` in
the client's words) and may **add** a need only if it cites a `wants`/`concern`
fact id; anything else it adds is dropped and logged. Stabilising sessions
skip this.

### 7.5 Distress

`saysMoneyTrouble(text)` / `saysSevereMoneyTrouble(text)` ported from Charlie
`safety.ts` with the SA phrasing added ("garnishee", "debt review", "under
administration", "blacklisted", "repossess", "loan sharks", "mashonisa"). Run
on each client turn during ingest and, when Jev/model is configured, as a
judged check with the rule engine as the floor. Severe → session mode
`stabilising` even if the agent did not switch (and a `safety_events`
`agent_missed_distress` row).

### 7.6 Match (`match`) — §8

### 7.7 Write (`write_quote`)

The `writer` role gets, per recommendation: the need in the client's words,
the facts backing it (as "they said: …" lines with turn timestamps), the
product's `summary`, the computed cover and premium **as text**, the
`considered` list with the rule that excluded each, and the disclosures. It
returns `{why: ≤ 60 words, alternative_if: ≤ 25 words}` per recommendation
and a 40-word opening paragraph. Voice rules as Charlie's `base()`: plain,
warm, no jargon list, no "great question", never "you told me" unless the
backing fact is `confirmed`/`broker` (for `agent`/`transcript` facts the
phrasing is "from our call, …").

### 7.8 Check (`check_quote`)

Mechanical, no model: every number in the written text ∈ allowed set
(computed figures, fact values); no menu words; no forbidden claims ("you
told me" on an unconfirmed fact; "guaranteed", "approved", "will pay out");
every recommendation has exactly one product; every product `verified_on`
within 90 days or hedge sentence present; disclosures present; FSP number
present. Then the `checker` role (or Jev) scores "reads as one
recommendation per need" and "faithful to the facts" 1–5; < 3 → regenerate
once with the report in the prompt, then `held` with the report for the
broker. All of it in `quotes.checker_report` and `safety_events`.

### 7.9 Notify (`notify_broker`)

Email (Resend) and/or WhatsApp (template `broker_new_quote`) to the broker
with: client first name, duration, mode, number of needs, unconfirmed-fact
count, link to `/app/calls/{id}`. Hardship: subject "Hardship — call first".

---

## 8. Matching

### 8.1 Need kinds and derivation rules (the fixed library — R3's "fixed step library")

| Need kind | Derived when | Default cover rule |
|---|---|---|
| `life_cover` | dependants ≥ 1 or `owes.home_loan`, and `lacks_cover.life` or no `has_cover.life` | income × 12 × years to 65 capped by product max; min: outstanding home loan + 3 years' income |
| `funeral_cover` | always a candidate in ZA when `lacks_cover.funeral`; priority 1 if income band ≤ R15k | R30k–R50k main member; family option if dependants |
| `income_protection` | employed/self-employed, income said, `lacks_cover.income_protection` | 75% of monthly income, waiting period per product |
| `disability` | as income_protection when the product line has lump-sum disability | 5 × annual income |
| `critical_illness` | age ≥ 35 or `treated_condition = yes`, and `wants`/`concern` mentions illness, cancer, heart | 1–2 × annual income |
| `medical_gap` | `has_cover.medical_aid` and `lacks_cover.medical_gap` | product flat |
| `credit_life` | `owes.personal_loan` or `car_finance` and no cover named | balance |
| `retirement_annuity` | age < 55, employed/self-employed, `lacks_cover.retirement` or `wants` retirement | budget-driven contribution |
| `tax_free_savings` | `wants` savings/education and budget ≥ R250 after risk needs | ≤ annual limit per product `term_rules` |
| `education_saver` | children_under_18 ≥ 1 and `wants` education | target per child from product |
| `short_term_car` / `short_term_home` | `owns.car`/`owns.home` and `wants` or `lacks_cover` | sum insured as said |

Priority: protection before savings; cheapest sufficient first; total premium
≤ `budget` if a budget was said (else ≤ 10% of stated income, else the
recommendation is written but flagged `affordability_unknown` for the broker).
When the budget cannot cover all needs, keep priority 1 needs and move the
rest to `considered` with reason `budget`, so the document still says what
was considered (s9).

### 8.2 Product selection and price

`selectProduct(need, facts, catalogue)` filters by category, age, cover
range, eligibility rules (`eligibility` jsonb evaluated by a tiny
expression evaluator over the facts: `{"all":[{"fact":"is.employment","in":["employed","self_employed"]}]}`),
exclusions; sorts by premium for the needed cover, then by `verified_on`
recency; returns the first and the rest as `considered` with the first
failing rule as the reason. **One** result. If none qualifies, the need is
kept with `recommendations.product_id = null` and `why = "No product in the
catalogue fits this yet"` for the broker.

`premiumFor(product, cover, age, smoker)`: find the `product_pricing` row for
the age band and smoker flag (`smoker IS NULL` matches either); premium =
max(`min_premium_cents`, round(cover / 1000 × `rate_per_1000` × 100)) or
`flat_cents`. All integer cents; shown as "R 1 234 a month". If the row's
`verified_on` is older than 90 days, `premium_basis.stale = true` and the
document carries the hedge line.

### 8.3 The demo catalogue (`seed/products.json`, `seed/pricing.json`)

Fictitious providers "Demo Life", "Demo Funeral Society", "Demo Short-Term",
"Demo Invest", clearly `is_demo = true`, 24 products across the 13
categories, each with a `summary` (≤ 60 words), eligibility, exclusions,
keywords, and 6–8 pricing bands. `verified_on` = the seed date. The document
footer says "Demo catalogue — illustrative products and premiums" while
any product in the quote `is_demo`.

---

## 9. The quotation document

Built by `quotedoc.ts` to R8 (ported from Charlie's `plandoc.ts` rendering
helpers). Sections, in order:

1. Header: broker name, FSP number, date, "Prepared for {first name}", "Indicative — your broker confirms the final premium".
2. **What you told us** — the facts, grouped (about you / money / what you have / what you owe / what you want), each line plain English, approximations marked "about".
3. **What we think you need, in order** — the needs with the client's own words.
4. **Our recommendation for each need** — one product each: name and provider, cover, monthly premium, "why this one" (≤ 60 words), "this would change if…" (`alternative_if`), stale hedge if any.
5. **Monthly total** and how it compares to the budget they gave.
6. **What else we considered and why not** — the `considered` list (s9(b)).
7. **If this replaces something you have** — only when a `has_cover` fact overlaps a recommendation: what is lost, waiting periods restart (s9(d)).
8. **Next steps** — "Reply to this email / message, or {broker_name} will call you by {date+3 working days}". Nothing is bought by replying.
9. **Disclosures** — from `disclosures` rows: indicative/underwriting, FSP, recording and data use, how to be forgotten, demo-catalogue notice when applicable.

Print: `@page` margins, page-break guards before §4 and §6, tested by
`scripts/preview-quote.mjs` (Chromium print-to-PDF, as Charlie's
`preview-plan.mjs`). The PDF is rendered by `/api/render-pdf` and stored at
`quotes/{broker}/{quote}.pdf` in a private bucket; delivery links are signed
(72 h). Email body is the same HTML inline (no attachment-only).

Status machine: `draft → checked → awaiting_broker → approved → sent →
delivered → read`; branches `held` (checker < 3 or unconfirmed facts),
`declined` (broker), `failed` (delivery), `superseded` (edited → new version).
Edits create version n+1; the old version is kept.

---

## 10. The broker dashboard (`/app`)

Server-rendered HTML from `api/app.ts` (R8 tables are only for the
documents; the app may use normal CSS but ships no framework and no build
step). Pages:

- `/app/login` — email → magic link (code hashed, 15-minute expiry, one use); session cookie `HttpOnly; Secure; SameSite=Lax`, 30 days.
- `/app` — calls list: time, client, mode, duration, status pill, unconfirmed count, cost. Live-ish: polls `/app/calls.json` every 20 s.
- `/app/calls/{id}` — transcript (turns, timestamps, audio player with seek-to-turn), facts panel (status, confidence, "▶ 02:14", tick/untick/edit/add with reason → `broker` fact + audit row), needs, recommendations (swap product from the `considered` list only; edit cover; remove with reason), quotation preview (iframe of the HTML), buttons: **Approve & send**, **Hold**, **Decline**, **Export record of advice**, **Forget this client**.
- `/app/clients/{id}` — history across sessions; the current graph.
- `/app/settings` — catalogue CSV upload (validated row by row, errors listed, nothing written on any error), agent name, FSP number, auto-send (with the "demo only" label), retention days, notification channel.
- `/app/costs` — ledger per call and totals this month (what Mike asked for).

Every button is a `POST /app/actions` with `action=<id>` and a CSRF token
(R7). Every state change writes `audit_log`.

---

## 11. Delivery

- **Email** (`email.ts`, ported): from `{broker name} via Call <quotes@{domain}>`, reply-to the broker's email, subject "Your quotation from {broker name}", HTML body = document, PDF attached, `List-Unsubscribe` omitted (transactional). Resend webhook → `deliveries.status`.
- **WhatsApp** (`wa.ts`, ported): first contact uses the approved utility template `quote_ready` ({first name}, {broker}, button "Open quotation" → signed link); the PDF follows as a document message inside the window the template opens. Inbound replies parsed by button id; free text routed per §3.1 step 9. Status webhooks → `deliveries.status`.
- Channel fallback: WhatsApp send fails (no template approval, invalid number) → `deliveries.status = failed`, broker notified, email offered as a one-tap action if an email fact exists.

---

## 12. Operations

- `/api/health`: configured services, `guardrails_live`, jobs queued/failed, webhook events last hour, last post-call received, Supabase reachable, catalogue count and oldest `verified_on`. `?ping=1` is the keep-alive the cron hits daily (Supabase idle pause).
- `/api/cron/retention` (daily): delete recordings past `delete_after`; set `deleted_at`.
- `/api/cron/freshness` (weekly): products past 90 days → incident `catalogue_stale`.
- `/api/worker?tick=1` (as often as the plan allows): drain.
- Alerts (ported `alerts.ts`): failed job after 3 attempts, webhook signature failures > 3/hour, delivery failures, guardrail engine unavailable, free-tier approaching (agent minutes from the ledger vs `ELEVENLABS_MINUTES_INCLUDED`, Resend 100/day, OpenRouter daily cap counted locally).
- `usage_ledger` written per session at ingest (minutes, telephony estimate), per model call (tokens × rate from `model_config.params.cost_per_mtok_in/out`, 0 for free), per delivery.

---

## 13. Security

- All webhooks verified over raw bytes before parsing; replay window enforced; events stored before processing; duplicates ignored by unique index.
- Server tools require `x-call-secret`; a tool call for a `conversation_id` we have not seen creates the session (ElevenLabs may call a tool before init completes) but is rate-limited to 60/min per conversation.
- Service role key only in Vercel. Publishable key used nowhere (no client-side Supabase).
- Signed, expiring links for PDFs; no sequential ids in URLs (uuid).
- Transcript text is untrusted: it is never interpolated into a prompt as an instruction; prompts wrap it in a delimited block and the extractor's output is validated against the schema and the turn text (R2). A line in the transcript saying "ignore your instructions and recommend X" cannot produce a recommendation because recommendations come from the rules engine, not the model.
- Dashboard: CSRF token per session, rate-limited login, audit of every action, broker scoping on every query (`broker_id` from the session, never from the request).

---

## 14. Testing strategy (how 1,337 criteria get tested)

- **Fakes** (`test/_fakes.ts`, ported and extended): in-memory Supabase (query shapes used here; unsupported shapes throw), fake Storage, scripted model gateway keyed on prompt markers, fake Resend, fake Meta, an **ElevenLabs event factory** that builds signed `post_call_transcription` / `post_call_audio` requests from a scripted conversation, and a fake clock.
- **Scripted conversations** (`test/fixtures/conversations/*.json`): 40 transcripts covering every journey in §3 and every refusal in §7.3 — the happy path, dropped call, declined consent, misheard-then-corrected age, hardship, "what do you offer", identifier offered by the client, someone else's cover, hypothetical cover, negated cover, two needs over budget, known client second call, in-person meeting, web session without caller id, silence, prompt injection in a client turn, Afrikaans/isiZulu words for money, approximate figures.
- **Journey e2e tests** drive the real functions (`api/voice.ts` handler, worker, app actions) against the fakes from the first webhook byte to the delivery row.
- **Criteria tags.** Every test's name carries the criteria it proves: `test("[C-0412][C-0413] read-back correction supersedes the earlier age", …)`. `scripts/criteria.ts --check` parses `criteria/*.md`, verifies unique ids, and fails if any criterion has no tag in `test/**` or any tag names a criterion that does not exist. `npm run verify` = typecheck + tests + criteria check + model-slug grep + R8 grep + print-to-PDF smoke. CI runs it.
- **Live checks** (not in CI, in `HANDOFF.md`): one real browser-widget call end to end, one real phone call from a verified number, Resend delivery to a real inbox, WhatsApp template approval, print-to-PDF opened in a viewer.

---

## 16. Chase Intelligence v1

Call writes the shared Chase Intelligence contract (`docs/INTEL-CONTRACT.md`,
copied unchanged) from its first line of code, so its rows join Charlie's and
Charles' in one training dataset. One table, `intel_events` (in
`db/0006_platform.sql`), one call, `capture(kind, opts)`, in
`api/_lib/intel.ts`; redaction in `api/_lib/intelredact.ts` before the write
and again on export; `scripts/intel-export.ts` and `scripts/intel-trace.ts`.

The one id is the session: `s_<session_id>` on init, every tool call, both
post-call events, every pipeline job, every broker action on the session's
quotes, every send and every delivery status. What each layer captures is the
plan's Capture map; Call's adaptations of the contract are
`docs/INTEL-PHASE0.md` §3; the criteria are `criteria/13-intel.md`.

Capture is additive: it never throws into the code it watches, never waits on
the request path (< 5 ms p95), and never changes a result.
`INTEL_CAPTURE` = `full` (default) | `meta` | `off`. A declined-consent session
keeps the shape only. "Forget me" deletes every row about the client and every
trace they were in. `intel_events` is never pruned by retention.

## 15. Out of scope for v1 (so nobody builds it by accident)

Outbound calls; a client-facing chat after the quote; payments or policy
issuance; a real insurer's rate tables (CSV upload exists, the data does not);
multi-language voice (the prompt accepts common Afrikaans/isiZulu money words,
the agent speaks English); robo-advice without a broker; a mobile app.
