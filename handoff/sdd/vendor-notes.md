# Vendor shapes (from docs search on 2026-10-31; vendor pages are blocked by this session's proxy — "from docs search, not fetched")

Build to these shapes, keep parsers tolerant (accept both layouts where noted), pin with tests, and mark the
VERIFIED.md row "from docs search, not fetched" with the date 2026-10-31.

## ElevenLabs Agents
- Post-call webhook header `elevenlabs-signature: t=<unix>,v0=<hex>`; hex = HMAC-SHA256(secret, `${t}.${rawBody}`).
  Retries are off by default and a retry is indistinguishable from the first delivery → handlers idempotent. Must answer 200.
- Event envelope: `{ type: "post_call_transcription" | "post_call_audio" | "call_initiation_failure", event_timestamp: <unix>, data: {...} }`.
- `post_call_transcription.data`: `agent_id`, `conversation_id`, `status`, `transcript: [{ role: "agent"|"user", message, time_in_call_secs, tool_calls?: [...], tool_results?: [...] }]`,
  `metadata: { start_time_unix_secs, call_duration_secs, cost, phone_call?: {...} }`,
  `analysis: { evaluation_criteria_results: { <id>: { criteria_id, result: "success"|"failure"|"unknown", rationale } }, data_collection_results: { <id>: { data_collection_id, value, rationale } }, call_successful, transcript_summary }`,
  `conversation_initiation_client_data: { dynamic_variables: {...} }`. `time_in_call_secs` per turn is from knowledge, not confirmed by search — parse tolerantly (missing → null).
- `post_call_audio.data`: `agent_id`, `conversation_id`, `full_audio` (base64 MP3). English docs describe `full_audio` top-level, samples put it in `data` → read `data.full_audio ?? full_audio`.
- Conversation-initiation (Twilio personalisation) webhook request: `caller_id`, `agent_id`, `called_number`, `call_sid`, `conversation_id`.
  Response: `{ type: "conversation_initiation_client_data", dynamic_variables: {...}, conversation_config_override?: { agent: { first_message } } }`.
  `dynamic_variables` must contain every custom variable the agent defines; `system__*` variables cannot be sent. Overrides must be enabled in the agent's Security tab.
- Dynamic variables can be placed in tool parameters and headers; `secret__` prefix keeps a variable out of the LLM (use for the tool secret header if configured as a variable). System variables (`system__conversation_id`, `system__caller_id`) not confirmed by search — server tools get the conversation id as a tool parameter filled from `{{system__conversation_id}}`; parse tolerantly (body `conversation_id` or header).
- Server-tool timeout: not confirmed; design for < 2 s responses (criteria say so).

## Vercel (Hobby)
- Cron jobs: once per day maximum on Hobby; more frequent expressions fail at deploy; timing imprecise within the hour.
- maxDuration: sources disagree; keep values in vercel.json as the plan lists and note "confirm on deploy".

## Resend (from knowledge; svix scheme)
- Webhook headers `svix-id`, `svix-timestamp`, `svix-signature: v1,<base64>[ v1,<base64>]`; secret `whsec_<base64>`; signed content `${id}.${timestamp}.${rawBody}`, HMAC-SHA256 with the base64-decoded secret; 300 s tolerance.
- Free plan: 100 emails/day, 3,000/month; attachments up to 40 MB total per email.

## Meta WhatsApp Cloud API (from knowledge)
- `X-Hub-Signature-256: sha256=<hex>` = HMAC-SHA256(app secret, raw body). Verify handshake `hub.mode=subscribe`, `hub.verify_token`, `hub.challenge`.
- Business-initiated first contact needs an approved template; documents/free text only inside the 24-hour service window.

## OpenRouter (from knowledge)
- Free models: ~50 requests/day with < $10 credit, ~1,000/day with ≥ $10 credit; ~20 requests/minute.

## Supabase free (from knowledge)
- 500 MB database, 1 GB storage, project paused after 7 days without activity (keep-alive cron).
