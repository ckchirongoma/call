# Chase Intelligence — Phase 0 for Call, and how it is built

Written 2026-10-31, read-only, from the repository and its planned services.
The contract is `docs/INTEL-CONTRACT.md`, copied unchanged from Charlie
(`ckchirongoma/charlie`, commit `59b6cb4`); this file is everything Call does
on top of it.

## 1. What data is here today

Call has not been built yet. The repository holds research, design, criteria
and a plan, and no application has run, so there are **no rows to count and
nothing of ours is on a timer yet**. The useful Phase 0 work is the other
way round: name every place data *will* appear, and every timer that would
lose it, so capture is built in from the first line of code instead of
retrofitted.

| Where | What it will hold | Worth for training | Timer |
|---|---|---|---|
| ElevenLabs conversation history | Every call: transcript, tool calls, evaluation and data-collection results, audio | **Highest**: the whole fact-find, turn by turn, with the agent's decisions | ElevenLabs keeps history per its own retention setting (**verify** on the agent's privacy settings). Call copies everything at the post-call webhook, so this timer stops mattering once the webhook is live. |
| `post_call_transcription` / `post_call_audio` webhooks → `webhook_events.raw` | The same, as received | High | Our own retention nulls `raw` after 30 days (SPEC §12). Safe only because `intel_events` keeps the turns, tools and checks first. |
| `turns`, `facts`, `fact_refusals`, `needs`, `recommendations`, `quotes`, `deliveries`, `safety_events`, `audit_log` | What was said, what was kept and refused, what was matched, what the broker changed, what was sent | **Highest**: asked → seen → decided → checked → corrected → ended | None. Deleted only by "forget me". |
| `recordings` (Storage) | Call and meeting audio | Medium (the contract keeps files as type and size, never bytes) | Deleted after `retention_days` (default 30). Kept out of `intel_events` by the contract. |
| `jobs` | Every pipeline step and retry | High: failures and how they were fixed | Done rows deleted after 30 days (C-1607). `intel_events` `job` rows keep them. |
| OpenRouter | Every post-call model call | **Highest**: what each model was shown and what it said | OpenRouter's own logs are outside the repo (**verify** the account's retention). Call captures every call whole in `intel_events`, so nothing depends on them. |
| Resend | Email delivery logs | Low | 30-day log retention on the free plan. Call captures each send and status. |
| Twilio | Call logs and metadata | Low | Account retention (**verify**). Call's session row carries duration and caller id. |
| Meta WhatsApp | Nothing is stored by Meta for us to read back | — | Call captures every message in and out. |
| `seed/`, `criteria/`, `test/fixtures/` (git) | The catalogue, the rules, 40 scripted conversations | Medium: labelled examples of right and wrong agent behaviour | None. |

## 2. What would have been lost without this

- **Every model call's prompt and answer.** Without capture only token counts
  (`usage_ledger`) survive. This is the largest gap in every Chase product so
  far, and here it is closed from day one.
- **Broker corrections as corrections.** The `audit_log` keeps before/after,
  but only `intel_events` puts them in the same ordered trace as the call
  that caused them: the training signal is "the agent heard 52, the client
  said 42, the broker swapped funeral provider A for B, and the client
  accepted".
- **The agent's own reasoning inside ElevenLabs.** Not available to us: we
  see what the agent said and which tools it called, not the prompt
  ElevenLabs built for each turn. Recorded as `say` with
  `meta.generated_by = "elevenlabs_agent"`. If the agent ever moves to a
  custom LLM endpoint through OpenRouter (RESEARCH §3a), every agent turn
  becomes a full `model` row.

## 3. How Call adapts the contract (additive only)

| Contract | Call |
|---|---|
| `app` | `"call"` |
| `trace_id` order | The task is the **session** (a call, a widget session or a meeting), so `s_<session_id>` is the one id: init, every tool, both webhooks, every job, every broker action on that session's quotes, every send and every delivery status share it. Otherwise `job_<id>`, then `r_` + 16 hex, as the contract. |
| `turn_id` | `t_` + 16 hex of sha256(`session_id:idx`) for transcript turns; of the wamid for WhatsApp. |
| `business_id` | The **client's** id (the person the data is about; forgetting is by client). The broker is `meta.broker_id`. |
| `channel` | `phone`, `web`, `meeting`, `dashboard`, `email`, `whatsapp`, `system` (the column is text; the contract's list is examples). |
| `tool` | The voice agent's server tool calls. Actor `model` (the agent's LLM chose the call), not `their_ai`. |
| `ask` / `say` | Client and agent turns, captured at ingest with the transcript's own timestamps in `content.t`; WhatsApp in; every email and WhatsApp out. |
| Broker actions | `track`, actor `person`, channel `dashboard`, `name = "broker:<action>"`, `content.props` {before, after, reason}. This is where corrections live. |
| Declined consent | The trace keeps the shape only (`content = null`) whatever the switch says: the person refused recording. |
| Telling the person | The agent's first message, the `data_use` disclosure and the meeting consent panel say the call is kept to prepare the recommendation and to improve the service, and that "forget me" deletes it (AGENT-PROMPT §1). |

## 4. Owner actions

1. **Run the Supabase prompt** (`docs/SUPABASE-PROMPT.md`, generated in Task
   1.3) so `intel_events` exists. Until then capture writes nothing and logs
   one line; nothing else is affected.
2. **ElevenLabs history retention**: on the agent's privacy settings, keep
   history at its maximum until the post-call webhook has been live for a
   week. After that it does not matter.
3. **Database size**: full capture keeps every prompt. Check Supabase →
   Database size monthly against the free 500 MB. The free choices if it
   nears the limit are `INTEL_CAPTURE=meta` or export-then-delete old months;
   anything else costs money and is your decision.
4. **OpenRouter, Resend and Twilio log retention**, if those logs matter to
   you: they are outside this repository.
