# 13 — Chase Intelligence: every task recorded whole (`intel.ts`, `intelredact.ts`, `intelexport.ts`)

The contract is `docs/INTEL-CONTRACT.md` (copied unchanged from Charlie).
Call's adaptations are in `docs/INTEL-PHASE0.md` §3 and SPEC §16.

Owner: `test/intel.test.ts`, `test/intel-redact.test.ts`, `test/intel-trace.e2e.test.ts`, `test/intel-export.test.ts`.

| id | area | journey | criterion | owner |
|---|---|---|---|---|
| C-1700 | intel | capture | Given the buffer's flush target throws (DB down), when `capture()` is called, then it returns normally and the calling code's result is unchanged. | test/intel.test.ts |
| C-1701 | intel | capture | Given 1,000 `capture()` calls each carrying a 50 KB prompt, then p95 time per call is under 5 ms. | test/intel.test.ts |
| C-1702 | intel | capture | Given `capture()`, then it returns `void` synchronously (no promise) and performs no network or DB call itself. | test/intel.test.ts |
| C-1703 | intel | capture | Given a handler that captured rows, then the rows are written in one batch after the response is sent (through `flushIntel()` in `waitUntil` / after `res.end`), never before. | test/intel.test.ts |
| C-1704 | intel | switch | Given `INTEL_CAPTURE=off`, then a whole happy-path call writes zero `intel_events` rows. | test/intel.test.ts |
| C-1705 | intel | switch | Given `INTEL_CAPTURE=meta`, then every row has `content = null`, `content_mode = "meta"`, and `meta` filled. | test/intel.test.ts |
| C-1706 | intel | switch | Given `INTEL_CAPTURE` unset, then mode is `full`. | test/intel.test.ts |
| C-1707 | intel | switch | Given `TRACKING_OFF=1` and `INTEL_CAPTURE` unset, then capture is off; given `TRACKING_OFF=1` and `INTEL_CAPTURE=full`, then capture is on (tests opt in explicitly). | test/intel.test.ts |
| C-1708 | intel | rows | Given any row, then `app = "call"` and `v = 1`. | test/intel.test.ts |
| C-1709 | intel | rows | Given two rows captured in the same millisecond, then `seq` orders them; sorting by `(at, seq)` reproduces capture order. | test/intel.test.ts |
| C-1710 | intel | ids | Given a call session, then init, every tool call, both post-call events, every pipeline job, every dashboard action on that session or its quotes, every send, every delivery webhook and every client WhatsApp reply about that quote all carry `trace_id = "s_" + session_id`. | test/intel-trace.e2e.test.ts |
| C-1711 | intel | ids | Given an HTTP request tied to no session (login, settings, catalogue upload), then `trace_id = "r_" + 16 hex`, the same for every row of that request. | test/intel.test.ts |
| C-1712 | intel | ids | Given a job with no session (retention cron, freshness), then `trace_id = "job_" + id`. | test/intel.test.ts |
| C-1713 | intel | ids | Given a task that enqueues a job, then a `job` row `name = "job_enqueued"` with `meta.job_id` (bigint) is in the enqueuing trace, and `jobs.id` is a bigint identity. | test/intel.test.ts |
| C-1714 | intel | ids | Given a transcript turn, then `turn_id = "t_" + sha256(session_id + ":" + idx)` truncated to 16 hex; given a WhatsApp inbound, then `"t_" + sha256(wamid)` truncated; no `turn_id` ever contains a phone number. | test/intel.test.ts |
| C-1715 | intel | ids | Given a row about a client, then `business_id = clients.id` and `meta.broker_id` is set; given a broker-only row (settings), then `business_id = null` and `meta.broker_id` set. | test/intel.test.ts |
| C-1716 | intel | ids | Given any row, then `channel ∈ {phone, web, meeting, dashboard, email, whatsapp, system}`. | test/intel.test.ts |
| C-1717 | intel | ask | Given ingest of a transcript, then one `ask` row per client turn with `content = {text, kind: "turn", t}` where `text` equals the stored (redacted) `turns.text`, and `meta = {chars, idx}`. | test/intel.test.ts |
| C-1718 | intel | say | Given ingest, then one `say` row per agent turn with `meta.generated_by = "elevenlabs_agent"` and `meta.llm = brokers.agent_llm`. | test/intel.test.ts |
| C-1719 | intel | ask | Given a WhatsApp inbound from a client, then an `ask` row `channel = whatsapp` with the text (or `{kind: "voice_note", type, size}`). | test/intel.test.ts |
| C-1720 | intel | say | Given every email or WhatsApp message to a client or a broker, then a `say` row with the text version in `content.text` and `meta.html_bytes` when there is HTML. | test/intel.test.ts |
| C-1721 | intel | model | Given any `askJSON`/`askText` call, then a `model` row with `content.messages` (everything it was shown), `content.response` (everything it said), `content.reasoning`, and `meta` {model, role, served_by, provider, usage, truncated, error}; a retry or fallback is a second row. | test/intel.test.ts |
| C-1722 | intel | model | Given `transcribeAudio`, then the `model` row's content holds the audio as `{type, size}` and the transcript text, never bytes. | test/intel.test.ts |
| C-1723 | intel | check | Given every `safety_events` write, then a `check` row `name = "check:<check>"` with `meta` {check, engine, outcome} and `content.detail`. | test/intel.test.ts |
| C-1724 | intel | check | Given every fact refusal, then a `check` row `name = "check:fact_refusal"` with `content` {label, reason}. | test/intel.test.ts |
| C-1725 | intel | check | Given ElevenLabs evaluation criteria results and data-collection results at ingest, then one `check` row each with `meta.engine = "elevenlabs"`. | test/intel.test.ts |
| C-1726 | intel | tool | Given every server tool call, then a `tool` row `actor = "model"`, `name = <tool>`, `content` {args, result}, `meta` {tool, ok, ms, error}. | test/intel.test.ts |
| C-1727 | intel | track | Given the init webhook, then a `track` row `name = "voice:init"` with the dynamic variables returned (redacted) and `ms`. | test/intel.test.ts |
| C-1728 | intel | send | Given every email and WhatsApp delivery, then a `send` row with the payload minus the address/number, and `meta` {type, skipped, error, code, provider_id}. | test/intel.test.ts |
| C-1729 | intel | track | Given every Resend or Meta delivery status webhook, then a `track` row `name = "delivery:<status>"` in the session's trace. | test/intel.test.ts |
| C-1730 | intel | track | Given every broker dashboard action (tick, untick, edit, add, swap, edit cover, remove, restore, re-match, hold, decline, approve, outcome, relabel, fallback, forget), then a `track` row `actor = "person"`, `channel = "dashboard"`, `name = "broker:<action>"`, `content.props` {before, after, reason}. | test/intel.test.ts |
| C-1731 | intel | track | Given every `quotes.status` transition, then a `track` row `name = "quote:<from>-><to>"`. | test/intel.test.ts |
| C-1732 | intel | job | Given every job enqueued, started, finished, failed, held or skipped, then a `job` row with `meta` {job_id, kind, attempt} and `content.payload`. | test/intel.test.ts |
| C-1733 | intel | error | Given every `trackFailure()`, then an `error` row with `content` {props, summary} and `meta` {category, severity}. | test/intel.test.ts |
| C-1734 | redact | bytes | Given every fixture run through the whole pipeline with capture on, then no `intel_events` row contains a base64 run longer than 200 chars (no audio or PDF bytes). | test/intel-redact.test.ts |
| C-1735 | redact | bytes | Given a PDF rendered or sent, then the related rows carry `{type: "application/pdf", size}` only. | test/intel-redact.test.ts |
| C-1736 | redact | secrets | Given every deployment secret in env (`SUPABASE_SERVICE_ROLE_KEY`, `OPENROUTER_API_KEY`, `ELEVENLABS_API_KEY`, `ELEVENLABS_WEBHOOK_SECRET`, `VOICE_TOOL_SECRET`, `SESSION_SECRET`, `WORKER_SECRET`, `RESEND_API_KEY`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET`, `TYPESAFE_API_KEY`, `CRON_SECRET`, `ADMIN_SECRET`) set to a known test value and placed in a prompt, a tool arg and a turn, then no row contains the value. | test/intel-redact.test.ts |
| C-1737 | redact | secrets | Given text containing a bearer token, a JWT, an `sk-`/`xi-`-style key, a PEM private key, a `postgres://` connection string, a `Cookie:` header and a signed `/q/…?exp=…&sig=…` link, then each is removed. | test/intel-redact.test.ts |
| C-1738 | redact | secrets | Given JSON with keys `secret`, `token`, `password`, `authorization`, `cookie`, `api_key`, `x-call-secret`, `signature` (any case, nested), then their values are removed. | test/intel-redact.test.ts |
| C-1739 | redact | identifiers | Given text with a 13-digit SA ID, a 10-digit phone, a 16-digit card and an 11-digit account number, then each run of 9+ digits is removed (with or without spaces/dashes inside). | test/intel-redact.test.ts |
| C-1740 | redact | identifiers | Given "R1 500 000", "about twelve thousand", "12000", "31 October 2026" in text and `{"cover_cents": 150000000, "premium_cents": 85000}` in JSON, then all survive. | test/intel-redact.test.ts |
| C-1741 | redact | identifiers | Given the login-code email, then its `say` row has `content = null` and `meta.kind = "login_code"` even in full mode. | test/intel-redact.test.ts |
| C-1742 | redact | identifiers | Given "my PIN is 4471" or "the OTP is 552019", then the digits are removed. | test/intel-redact.test.ts |
| C-1743 | redact | identifiers | Given a turn where the client read out their email or number for the channel, then the `ask` row carries `[contact]` exactly as `turns.text` does. | test/intel-redact.test.ts |
| C-1744 | consent | declined | Given the declined-consent fixture, then every row in the trace has `content = null` and `content_mode = "meta"`, regardless of `INTEL_CAPTURE`. | test/intel.test.ts |
| C-1745 | consent | forget | Given `forgetClient()`, then every `intel_events` row with `business_id` = the client and every row in any trace that contains such a row is deleted, including rows still in the buffer. | test/intel.test.ts |
| C-1746 | consent | forget | Given forget runs twice, then the second deletes nothing and succeeds. | test/intel.test.ts |
| C-1747 | consent | told | Given the rendered first message (`AGENT-PROMPT.md` §1), then it says the call is recorded, used to prepare the recommendation and to improve the service, and that saying "forget me" or asking the broker deletes it. | test/agent-prompt.test.ts |
| C-1748 | consent | told | Given the `data_use` disclosure row, then it says the same in writing, and the quotation's §9 includes it. | test/seed.test.ts |
| C-1749 | consent | told | Given `/meeting`'s consent panel, then it reads the same lines. | test/meeting.test.ts |
| C-1750 | storage | table | Given the retention cron runs, then no `intel_events` row is deleted. | test/retention.test.ts |
| C-1751 | storage | table | Given the migrations, then `intel_events` has RLS enabled, no policies, and `REVOKE ALL … FROM anon, authenticated`. | test/rls.test.ts |
| C-1752 | storage | table | Given the migrations, then `intel_events` has exactly the columns of `docs/INTEL-CONTRACT.md` §1 (parsed from the contract's table) plus `created_at`, the four indexes, and the `kind`/`actor`/`content_mode` checks. | test/rls.test.ts |
| C-1753 | storage | contract | Given `docs/INTEL-CONTRACT.md`, then its sha256 equals `5060897adb1cea96918731fc9629de0ba4aad6805e807a7e12a6fb3e8f5baaf8` (Charlie's file, unchanged). | test/intel.test.ts |
| C-1754 | trace | read | Given `readTrace(id)` with any of: `s_` id, the session uuid, the ElevenLabs conversation id, a turn id, `job_<n>`, a bare job number, then it returns every row of the task in `(at, seq)` order with the jobs it queued folded in. | test/intel-trace.e2e.test.ts |
| C-1755 | trace | read | Given the happy-path fixture driven end to end (init → tools → post-call → pipeline → broker approve → email → delivered webhook), then `readTrace(session)` contains, in this order: `track voice:init`, `tool save_fact`, `ask`/`say` turns, `job ingest_transcript`, `model extract`, `check` rows, `model writer`, `check:quote_numbers`, `track broker:approve`, `say` + `send` email, `track delivery:delivered`. | test/intel-trace.e2e.test.ts |
| C-1756 | trace | unchanged | Given the happy-path fixture run twice, with `INTEL_CAPTURE=off` and `full`, then every table except `intel_events` ends identical and every HTTP response body and status is identical. | test/intel-trace.e2e.test.ts |
| C-1757 | trace | unchanged | Given `npm run test:intel` (the whole suite with `INTEL_CAPTURE=full`), then it passes with the same counts as `npm test`. | package.json script, checked in CI |
| C-1758 | trace | missing table | Given `intel_events` is absent (migration not yet run), then capture writes nothing, logs one line naming the migration, retries after 10 minutes, and nothing else is affected. | test/intel.test.ts |
| C-1759 | export | files | Given `scripts/intel-export.ts`, then `intel-export/<time>/` holds `traces.jsonl`, `intel_events.jsonl`, one `<table>.jsonl` per `EXPORT_TABLES` entry, and `manifest.json` with counts per table, trace count, capture mode and errors. | test/intel-export.test.ts |
| C-1760 | export | files | Given the export, then `login_codes`, `sessions_auth`, `broker_users.email`, `webhook_events.raw` signatures and any secret are never in it, and every line has been re-redacted (a secret planted in a table row does not come out). | test/intel-export.test.ts |
| C-1761 | export | git | Given `.gitignore`, then `intel-export/` is ignored. | test/intel-export.test.ts |
| C-1762 | export | trace | Given `scripts/intel-trace.ts <id>`, then it prints the task in order, one line per row (`at kind name actor ok ms`), content behind `--full`. | test/intel-export.test.ts |
| C-1763 | ops | admin | Given `/admin`, then intel counts by kind for the last 24 h, the capture mode, buffered and dropped counts. | test/admin.test.ts |
| C-1764 | ops | health | Given `/api/health`, then `intel` {mode, table_present, buffered, last_flush_at, dropped}. | test/health.test.ts |
| C-1765 | ops | flush | Given a flush fails three times, then those rows are dropped, `dropped` increments, an incident is filed once, and no request ever fails because of it. | test/intel.test.ts |
| C-1766 | ops | flush | Given 2,000 buffered rows, then they are written in inserts of at most 500 rows or 1 MB. | test/intel.test.ts |
| C-1767 | ops | size | Given a 200 KB model prompt in full mode, then it is kept whole; given content over 1 MB, then it is cut to 1 MB with `meta.truncated_bytes`. | test/intel.test.ts |
| C-1768 | ops | agent | Given `scripts/push-agent.ts --apply`, then a `track` row `agent:pushed` with the redacted diff. | test/push-agent.test.ts |
| C-1769 | ops | catalogue | Given a catalogue upload, then a `track` row `broker:catalogue_upload` with the counts and, in full mode, the validated rows. | test/catalogue.test.ts |
| C-1770 | ops | pdf | Given every PDF render, then a `track` row `pdf:rendered` with `ms` and `size`. | test/render-pdf.test.ts |
| C-1771 | consent | forget | Given the client says "forget me" during the call (fixture `forget-on-call`), then the agent's next turn confirms and closes, a `consent/forget` fact is saved, and after the post-call webhook `forgetClient()` runs for that client; no facts, needs, quote, recording or intel content survive, and the broker sees one line "Caller asked to be forgotten at {time}". | test/journey.e2e.test.ts |
| C-1772 | consent | forget | Given the rendered prompt, then it contains the "forget me" instruction with the "Done — I'll make sure it's deleted" line. | test/agent-prompt.test.ts |
