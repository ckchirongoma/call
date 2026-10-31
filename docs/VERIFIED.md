# Verified against live pages

Every **verify** item in `docs/RESEARCH.md` is checked here before the code
that depends on it is written (BEHAVIOR-MATRIX A18). One row per item: what
was checked, where, when, the answer, and which task it unblocks.

| Item | Page | Checked on | Answer | Unblocks |
|---|---|---|---|---|
| ElevenLabs free plan: agent minutes, concurrency, commercial licence, LLM included? | elevenlabs.io/pricing | | | Phase 0 |
| Post-call webhook current payload (field names for transcript turns, `metadata`, `analysis`) | docs: post-call webhooks | | | Task 4.1 |
| ElevenLabs post-call webhook signature header format | docs: post-call webhooks (elevenlabs.io/docs/agents-platform/workflows/post-call-webhooks) | from docs search, not fetched (2026-10-31) | Header `ElevenLabs-Signature: t=<unix>,v0=<hex>`, hex = HMAC-SHA256(secret, `${t}.${rawBody}`) over the raw body; validate both hash and timestamp; the docs' sample allows 30 × 60 s of age. Several `v0` values and the 300 s future limit are not in the search (our tolerance, pinned in `test/crypto.test.ts`). | Task 0.2, Task 3.3 |
| Resend webhook signature (svix scheme) | resend.com/docs/webhooks/verify-webhooks-requests | from docs search, not fetched (2026-10-31) | Headers `svix-id`, `svix-timestamp`, `svix-signature`; raw body; base64 HMAC-SHA256 over `${id}.${timestamp}.${body}` keyed with the base64-decoded part of `whsec_…`; several space-separated `v1,` values, any one matching; about 5 min window. The construction came from a third-party guide and the svix format, not a Resend page. | Task 0.2, Task 7.1 |
| Meta WhatsApp webhook signature | developers.facebook.com: Graph API webhooks | from docs search, not fetched (2026-10-31) | `X-Hub-Signature-256: sha256=<hex>`, HMAC-SHA256 of the raw body keyed with the app secret, compared in constant time; the app secret signs POSTs, the verify token is only for the GET handshake. Every result was third-party, none was Meta's own page. | Task 0.2, Task 7.2 |
| Conversation-initiation webhook request/response field names | docs: Twilio personalization | | | Task 4.5 |
| Server tool timeout and auth header mechanism | docs: webhook tools | | | Task 4.3 |
| System dynamic variable names (`system__conversation_id`, `system__caller_id`) | docs: dynamic variables | | | Task 4.3 |
| Widget embed and `@elevenlabs/react` `startSession` with dynamic variables | docs: widget / React SDK | | | Task 9.3 |
| Twilio trial: inbound from verified caller IDs only; number countries on trial | twilio docs: trials | | | HANDOFF |
| Vercel Hobby: `maxDuration`, cron minimum frequency, body limit | vercel.com/docs/limits | | | Task 0.3 |
| Supabase free: storage, idle pause period | supabase.com/pricing | | | Task 12.2 |
| OpenRouter free-tier daily request cap with and without $10 credit | openrouter.ai/docs/limits | | | Task 12.4 |
| Resend free: per day, webhooks on free, attachment size | resend.com/pricing, docs | | | Task 8.2 |
| Meta WhatsApp: utility template price ZA after 2026-10-01; document message with template | developers.facebook.com | | | Task 8.3 |
| FAIS General Code s8/s9 current text | FSCA / Acts Online | | | Task 11.3 |
