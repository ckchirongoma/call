# Research — how this problem is solved, and what the free stack really gives us

*Written 2026-10-31 from web research. Direct fetches of vendor pages were
blocked by this session's network policy, so every figure below comes from
search results, mostly third-party 2026 guides, and is marked **verify** where
the vendor's own page was not read. The builder confirms each **verify** item
against the live page in Phase 0 and records the answer in `docs/VERIFIED.md`.*

## 1. The problem, as Mike described it (call of 2026-10-16)

> "Wealth advisors and brokers take a two-hour conversation with someone,
> listen to their story, then take another five hours to figure out which
> products would be best for this person. Then they take a week to reach out
> and follow up."

Two shapes of the same product:

1. **Call-in.** A client phones a number. A voice agent runs the fact-find,
   reads the facts back, asks "email or WhatsApp?", and hangs up. Within
   minutes the broker has a matched, drafted quotation to approve and send.
2. **In-person.** The broker sits with the client, switches the recorder on,
   and the same pipeline runs on the meeting's transcript.

Mike wants a live demo for a distributor who will take it to brokers across the
country, and the cost per call so it can be priced.

## 2. How this category is solved today

| Who | What they do | What to take |
|---|---|---|
| Advisor meeting note-takers (Wealthbox AI Notetaker, Jump, Zocks, Zeplyn, Aveni in the UK) | Record the meeting, write notes, draft a follow-up email the advisor sends "in two clicks" from the CRM | **Broker approves, then sends.** None of them send straight to the client. The two-click approval is the product. |
| Insurance voice agents (Retell/Matic, Parloa, Yellow.ai deployments) | Inbound intake: qualify, collect and **confirm all required information**, hand a structured summary to a human | **Confirm before hand-off.** The read-back at the end of the call is what makes the structured summary trustworthy. Reported containment figures (70–85%) are vendor-reported and for claims/data intake, not advice. |
| Charlie (this founder's own WhatsApp product) | Grounded, one-recommendation advice; a per-business knowledge graph where every fact carries its source and every figure must be one the owner typed; a reply checker that refuses "you told me" when they did not | **The whole trust layer.** Ported, not re-invented: `graphUpdates()`-style refusal rules, read-back before use, one recommendation per need, stabilising mode, no invented prices, email-safe HTML. |

Nobody in the search results does the fact-find itself by voice and turns it
into a product-matched quotation for a regulated broker. The closest are
intake agents (structured capture, no matching) and note-takers (matching
left to the human). The gap is real; so is the reason for it (section 4).

## 3. The stack, and what each free tier actually allows

| Layer | Choice | Free tier (as researched) | Where it bites | Fallback |
|---|---|---|---|---|
| Voice agent | **ElevenLabs Agents** | Free plan: 15 agent minutes a month, 4 concurrent, Workflow Builder and knowledge base included, **no commercial licence** (**verify**). Starter $6/month: 75 minutes; overage $0.08/min. LLM usage billed separately at the provider's rate (**verify** whether the free plan includes LLM for native models). Silence charged at 5%. | 15 minutes is **three demo calls**. A ten-call demo day needs Starter. | Pay $6 the week of the demo. Ask the founder first (BEHAVIOR-MATRIX rule 9). |
| Phone number | **Twilio** (ElevenLabs native integration) | Trial: one number, inbound only from **verified caller IDs** (SMS-verified), a trial preamble on calls, expires after 30 days. US numbers available on trial; a **+27 number requires an upgraded account and a regulatory bundle** (ID, proof of local address in the number's area, no PO boxes). | A stranger cannot phone the trial number. Demo callers must be verified first (fine: Mike, the distributor, the founder). | Browser widget (section 3b) for anyone unverified. SIP trunk from a local SA provider later. |
| Backend | **Vercel** functions, TypeScript, no framework | Hobby: **personal, non-commercial use** per Vercel's FAQ; 100 GB-hours of function execution; 2 cron jobs (**verify** minimum frequency: the Charlie code base assumes once a day); function `maxDuration` on Hobby **verify** (Charlie sets 300 with Fluid compute). | The non-commercial clause: a paid distributor deal moves this to Pro ($20). For the prototype it is fine. | None needed now. |
| Database + files | **Supabase** | Free: 500 MB database, 1 GB storage, 5 GB egress, two projects, **paused after one week idle**. | Recordings: a 10-minute call is ~5 MB of MP3; 1 GB is ~200 calls. The idle pause will hit the demo after a quiet week. | A daily keep-alive request from the Vercel cron (`/api/health?ping=1`). Retention job deletes audio after N days (section 5). |
| Post-call model work | **OpenRouter** (same as Charlie) | Free models exist; with under $10 of credit bought, **~50 requests a day** (1,000 a day once $10 is bought, **verify**). `response_format` (JSON mode) is silently ignored by some models. | Each call costs ~4 model requests (extract, needs, write, check). 50/day = 12 calls/day. | Buy $10 of credit once (ask first). Keep every prompt JSON-robust with repair + retry, as Charlie's `models.ts` does. |
| Email | **Resend** | Free: 3,000 a month, **100 a day**, one webhook endpoint, 30-day logs; until a domain is verified the default sender only delivers to the account's own address. | Verify a domain before the demo or the quote only reaches us. | Founder verifies a domain they own (DNS records). |
| WhatsApp | **Meta Cloud API** directly (as Charlie) | Service conversations free; a quote sent *first* needs an approved **utility template** (~$0.008 a message in ZA + VAT, **verify** the post-October-2026 rate). Test number: free, 5 test recipients. | Template approval takes hours to days. Sending a PDF outside the 24-hour window needs the template. | Email is the day-one channel; WhatsApp when the template is approved. Reuse Charlie's `wa.ts`. |
| Guardrail engine | **Jev (TypeSafe System One)**, optional | Whatever the founder's account has. | Not needed for the demo. | Model backstop from `model_config` `safety` row, exactly as Charlie's `safety.ts`. Every check writes `safety_events` either way. |
| In-person transcription | **ElevenLabs Scribe v2 Realtime** or the browser's own `MediaRecorder` + batch Scribe | Scribe v2 batch ~$0.22/hour, realtime ~$0.39/hour (**verify** free-plan STT minutes). | Cost is trivial; the free allowance is the question. | Record in the browser, upload to Supabase Storage, transcribe in batch through OpenRouter's audio endpoint (Charlie's `transcribe.ts`) — zero new accounts. **This is the plan.** |

### 3a. ElevenLabs Agents: the mechanics we build against (all **verify** against the live docs)

- **Agent config** is pushed from the repo with the ElevenLabs API (`scripts/push-agent.ts`), so the prompt, the first message, the tools, the data-collection fields and the evaluation criteria are version-controlled, never hand-edited in the dashboard.
- **Conversation initiation client data webhook.** On an inbound call ElevenLabs POSTs `caller_id`, `agent_id`, `called_number`, `call_sid` to our endpoint *before the call connects*, and we return `dynamic_variables` (broker name, agent name, whether this caller is known) and optional `conversation_config_override` (first message). Enabled on the agent's Security tab with the override fields listed. Response limit 256 KB; it must answer fast or the call is delayed; a failure can stop the call from starting — so our handler never fails: it returns defaults on any error.
- **Server tools (webhook tools).** The agent calls our HTTPS endpoints mid-call with LLM-extracted parameters; we authenticate with a header secret from the ElevenLabs secrets manager. Timeout is short (Resemble documents 1–60 s; **verify** ElevenLabs' own) — every tool answers in under 2 s from Postgres only, no model call inside a tool.
- **System dynamic variables** such as `system__conversation_id`, `system__caller_id`, `system__called_number` are available in prompts and tool parameters, which is how a tool call is tied to the call row.
- **Post-call webhooks.** Two events: `post_call_transcription` (transcript turns, `analysis` with `data_collection_results` and `evaluation_criteria_results`, `metadata` including duration and cost) and `post_call_audio` (base64 audio, minimal fields). Signed with header `elevenlabs-signature: t=<unix>,v0=<hex>`, HMAC-SHA256 over `<t>.<raw body>`; reject older than 30 minutes or more than 5 minutes in the future; more than one `v0=` may be present, any match is valid. Must answer 200 within ~10 s; auto-disabled after 10 consecutive failures; events may arrive **out of order** (audio before transcript). There is a "migration notice: enhanced webhook format" on the docs page — the builder reads the current format first.
- **Data collection & evaluation.** Up to 30 evaluation criteria per agent (success/failure/unknown with rationale), plus typed data-collection fields extracted by ElevenLabs after the call. We use them as a *second opinion* next to our own extraction, never as the source of truth (they are not grounded to a transcript line).
- **Widget.** `<elevenlabs-convai agent-id="…">` plus the unpkg script, or `@elevenlabs/react`'s `useConversation().startSession()`. Needs microphone permission; blocked in some embedded previews. Our demo page hosts it on our own domain.
- **LLM inside the agent.** ElevenLabs-native models (the current docs list Gemini Flash family, Qwen, GPT-OSS) billed at the provider's rate, or a **custom LLM** at any OpenAI-compatible endpoint. Day one: a native Gemini Flash model for latency. Option kept open: `/api/llm` proxying OpenRouter under a `voice_brain` row in `model_config`.

### 3b. The demo path that needs no phone number

Browser widget on `/demo` with the same agent, same tools, same post-call
webhook. A browser session's `caller_id` is empty, so `/demo` asks for a name
and mobile number first and passes them as dynamic variables; the rest of the
pipeline cannot tell the difference. This is what the distributor sees first.

## 4. The regulatory shape (South Africa) — what it changes in the design

| Rule | What it says (as researched) | What we do |
|---|---|---|
| **FAIS "advice"** | Any recommendation, guidance or proposal of a financial nature about a product. Purely factual information is not advice — but the Ecsponent debarment held that "hand-holding" through a decision turns facts into advice. Giving advice without an FSP licence is an offence. | **The agent never recommends on the call.** It collects, confirms, and says "your broker will come back to you with a recommendation". The recommendation is produced for the **licensed broker**, who approves it; the quotation is sent **from the broker**, under the broker's FSP number. Auto-send is a demo switch, off by default, and even then the document says who the FSP is. |
| **Robo-advice** (FSCA Fit & Proper) | Advice through an electronic medium using algorithms without a natural person's direct involvement requires a key individual and ongoing monitoring of the automated advice. | Not what we are. Human in the loop by design; the dashboard *is* the monitoring. |
| **General Code s8 — needs analysis** | Before advice: obtain information about the client's financial situation, needs and objectives; analyse it; identify suitable products. | The fact-find is built on s8: situation (income band, dependants, debts, existing cover), needs, objectives, budget. The structure is `docs/AGENT-PROMPT.md` §3. |
| **General Code s9 — record of advice** | Must reflect: (a) a brief summary of the information and material the advice was based on; (b) the financial products considered; (c) the product(s) recommended and why they are likely to satisfy the client's needs; (d) replacement-product disclosures. Not a tick-box. Retention commonly stated as five years. | The quotation document has these as sections, and the dashboard exports a "Record of advice" for the broker's file with every fact linked to its transcript line. Replacement: if an existing policy would be cancelled, the document says so and lists what is lost. |
| **RICA / POPIA recording** | A party to a call may record it (one-party consent); once stored and processed for business, POPIA's conditions apply (purpose, security, minimality, retention). Practice: play a notice at the start. | The first message states: it is an AI assistant, the call is recorded, what it is used for, and asks to continue. A "no" ends the call politely and nothing is stored beyond the consent refusal. Minimality: no ID numbers, bank details or medical history by phone; the agent declines and says why. Retention: audio deleted after a configurable number of days (default 30), transcripts and facts kept for the broker's s9 record. "Forget me" deletes everything for that client. |
| **Direct marketing regs (2025)** | Telephonic consent requests must be electronically recorded. | Inbound only. The channel question ("email or WhatsApp?") and its answer are stored as the consent record with the transcript line. |
| **Premiums** | Real premiums depend on underwriting. | Every figure is **indicative**, from the catalogue's pricing bands, with a `verified_on` date; the document says "your broker confirms the final premium". |

The practical consequence, which the plan builds in rather than warns about:
**the call captures; the broker advises; the system drafts and records.**
That is also what the note-taker market (section 2) converged on.

## 5. Cost per call (for Mike's pricing), to be filled with measured numbers

| Item | Unit cost (researched, **verify**) | Per 8-minute call |
|---|---|---|
| ElevenLabs agent minutes | $0.08–0.12/min on paid tiers | $0.64–0.96 |
| LLM inside the agent | Provider pass-through; Gemini Flash class, ~2k tokens/turn × ~25 turns | ~$0.02–0.05 |
| Telephony (Twilio inbound, US number) | ~$0.0085/min + number ~$1.15/month | ~$0.07 |
| Post-call model work (4 calls through OpenRouter) | Free models $0; small paid ~$0.01 | $0–0.01 |
| Email | Free | $0 |
| WhatsApp utility template | ~$0.009 | $0.01 |
| Storage | 1 GB free | $0 |
| **Total** | | **≈ $0.75–1.10 per call** (≈ R14–R20) |

Against a broker's five hours of matching work, the price can be whatever the
distributor wants it to be. The system writes an actual `usage_ledger` row per
call (minutes from the webhook's metadata, tokens from OpenRouter's usage,
messages sent) so the demo shows a real number, not this table.

## 6. Decisions this research settles

1. ElevenLabs Agents for voice; Twilio native integration for the number; browser widget for the demo.
2. Vercel + Supabase + OpenRouter + Resend + Meta Cloud API, the same shapes as Charlie so code ports directly.
3. Broker approves before anything reaches a client. Auto-send exists only as `brokers.auto_send` for the demo and is off by default.
4. The agent collects and confirms; it does not recommend on the call. The recommendation engine runs after the call, for the broker.
5. Our own transcript-grounded extraction is the source of truth; ElevenLabs' data collection is a cross-check logged in `safety_events`.
6. Catalogue is fictitious and labelled so ("Demo Life", "Demo Short-Term"), with pricing bands as data, until a real insurer's rate tables arrive.
7. Audio is deleted after 30 days by default; transcripts and facts are the record.
8. In-person mode records in the browser, uploads, transcribes in batch, and joins the same pipeline at the "transcript ready" step.

## Sources

ElevenLabs pricing and plans: [quiq.com](https://quiq.com/blog/elevenlabs-pricing/), [cloudtalk.io](https://www.cloudtalk.io/blog/elevenlabs-pricing/), [getmacha.com](https://www.getmacha.com/blog/elevenlabs-agents-complete-guide), [cloudzero.com](https://www.cloudzero.com/blog/elevenlabs-pricing/), [a8gent.com](https://a8gent.com/platforms/elevenlabs-agents), [pxlpeak.com](https://pxlpeak.com/blog/ai-tools/elevenlabs-pricing-guide), [usagepricing.com (price cut)](https://www.usagepricing.com/blueprint/activity/elevenlabs-2026-05-07-conversational-ai-price-cut).
ElevenLabs docs (titles from search; pages not fetched): [post-call webhooks](https://elevenlabs.io/docs/agents-platform/workflows/post-call-webhooks), [webhooks API reference](https://elevenlabs.io/docs/eleven-api/resources/webhooks), [tools overview](https://elevenlabs.io/docs/eleven-agents/customization/tools), [webhook tools](https://elevenlabs.io/docs/eleven-agents/customization/tools/webhook-tools.md), [Twilio personalization / initiation webhook](https://elevenlabs.io/docs/eleven-agents/customization/personalization/twilio-personalization), [personalization](https://elevenlabs.io/docs/conversational-ai/customization/personalization), [Twilio native integration](https://elevenlabs.io/docs/eleven-agents/phone-numbers/twilio-integration/native-integration), [SIP trunking](https://elevenlabs.io/docs/eleven-agents/phone-numbers/sip-trunking), [success evaluation](https://elevenlabs.io/docs/conversational-ai/customization/agent-analysis/success-evaluation), [agent analysis](https://elevenlabs.io/docs/eleven-agents/customization/agent-analysis), [Next.js data-collection cookbook](https://elevenlabs.io/docs/cookbooks/agents-platform/post-call-webhooks), [widget](https://elevenlabs.io/docs/eleven-agents/customization/widget), [LLM options](https://elevenlabs.io/docs/eleven-agents/customization/llm), [optimizing LLM costs](https://elevenlabs.io/docs/eleven-agents/customization/llm/optimizing-costs.md).
Webhook signature details: [dev.to — verifying ElevenLabs signatures](https://dev.to/asazhin/verifying-elevenlabs-webhook-signatures-on-cloudflare-worker-without-their-sdk-47pg), [hookdeck guide](https://hookdeck.com/webhooks/platforms/guide-to-elevenlabs-webhooks-features-and-best-practices).
Scribe pricing: [costbench Scribe](https://costbench.com/software/ai-transcription-apis/elevenlabs-scribe/), [developer.puter.com](https://developer.puter.com/tutorials/elevenlabs-api-pricing/).
Twilio: [SA regulatory guidelines](https://www.twilio.com/en-us/guidelines/za/regulatory), [SA voice guidelines](https://www.twilio.com/en-us/guidelines/za/south-africa--voice-guidelines---twilio), [trial account](https://static0.twilio.com/docs/usage/trials.md), [free trial tutorial](https://www.twilio.com/docs/usage/tutorials/how-to-use-your-free-trial-account), [help: trial limits](https://support.twilio.com/hc/en-us/articles/360036052753).
Vercel: [limits](https://vercel.com/docs/limits), [pricing FAQ (Hobby non-commercial)](https://vercel.com/pricing).
Supabase: [jetadmin 2026 guide](https://www.jetadmin.io/blog/supabase-pricing-2026-guide-to-plans-limits-and-real-world-costs/), [automationatlas](https://automationatlas.io/answers/supabase-free-tier-limits-2026/), [costbench](https://costbench.com/software/developer-tools/supabase-dev/free-plan/).
OpenRouter: [Simon Willison on response_format](https://simonwillison.net/2025/Mar/10/llm-openrouter-04), [buldrr free models 2026](https://buldrr.com/?p=9486), [aieatingtheworld](https://www.aieatingtheworld.com/articles/openrouter-free-models).
Resend: [wpmailsmtp review](https://wpmailsmtp.com/resend-review/), [automationatlas](https://automationatlas.io/answers/resend-free-tier-explained-2026/), [superdupr](https://superdupr.com/blog/resend-pricing), [resend.com/pricing](https://www.resend.com/pricing.md).
WhatsApp pricing: [Meta pricing](https://developers.facebook.com/docs/whatsapp/pricing), [chatmaxima ZA](https://chatmaxima.com/whatsapp-api-pricing/south-africa/), [manychat rates](https://help.manychat.com/hc/en-us/articles/14281380243740), [go4whatsup ZA](https://go4whatsup.com/south-africa/whatsapp-business-api-pricing/).
FAIS: [Acts Online — General Code Part VII](https://www.acts.co.za/financial/bn80_part_vii_furnishing_of_advice), [Obiter — regulation of advice](https://www.obiter.mandela.ac.za/article/download/14289/18673/84906), [Mondaq — when conduct is advice](https://www.mondaq.com/southafrica/financial-services/807278/when-does-conduct-constitute-financial-advice), [Mondaq — record of advice](https://www.mondaq.com/southafrica/financial-services/1450992/legal-significance-of-keeping-a-record-of-advice-for-financial-service-providers), [GoLegal — record of advice](https://www.golegal.co.za/?p=60338), [Masthead — CAR and FNA](https://www.masthead.co.za/newsletter/importance-client-advice-record-financial-needs-analysis/), [Moonstone — Ecsponent debarment](https://www.moonstone.co.za/tribunal-upholds-debarment-for-providing-unauthorised-advice-on-ecsponent-preference-shares/), [Moonstone — tick-box records](https://www.moonstone.co.za/client-advice-records-are-you-still-following-a-tick-box-approach/), [FSCA Communication 46 of 2020](https://www.moonstone.co.za/wp-content/uploads/library/Moonstone%20Library/MS%20Industry%20News/FSCA%20Communication%2046%20of%202020%20(FAIS).pdf), [SAFLII — FAIS Act](https://www.saflii.org/za/legis/consol_act/faaisa2002423/), [Profile's robo-advice note](https://profile.co.za/uthb/2021-2u/files/basic-html/page40.html).
Recording law: [andrewscott.co.za](https://andrewscott.co.za/when-can-you-legally-record-conversations), [recordinglaw.com — South Africa](https://www.recordinglaw.com/world-laws/world-recording-laws/south-africa-recording-laws/), [suretel — VoIP compliance](https://suretel.co.za/blog/voip-compliance-call-recording-laws-south-africa), [mjkinc — 2025 POPIA regulations](https://mjkinc.co.za/popia/regulations-2025-amendments), [Michalsons — OUTsurance enforcement](https://www.michalsons.com/blog/outsurance-enforcement-action-direct-live-call-marketing/81466).
Market: [Retell — conversational AI in insurance](https://www.retellai.com/blog/conversational-ai-in-insurance), [CallTower/Parloa case study](https://info.calltower.com/hubfs/How%20an%20Insurance%20Leader%20is%20Automating%20Voice%20Tasks%20to%20Improve%20Claims%20Journeys%20-%20Case%20Study.pdf), [Brilo roundup](https://www.brilo.ai/resources/best-ai-voice-agents-for-insurance), [Wealthbox AI Notetaker](https://www.wealthbox.com/ai-notetaker/), [Aveni — UK adviser tools](https://aveni.ai/blog/7-ai-meeting-tools-for-uk-financial-advisers-in-2026/), [recall.ai — advisor notetakers](https://www.recall.ai/solutions/financial-advisors).
Products and needs analysis: [FAnews — tailoring FNA](https://www.fanews.co.za/article/intermediaries-brokers/7/general/1227/tailoring-financial-needs-analysis-for-client-success/39189), [IOL — what cover and when](https://www.iol.co.za/personal-finance/insurance/so-what-cover-do-you-need-and-when-18838941), [1Life — over/under insured](https://www.1life.co.za/blog/over-under-insured), [Moonstone — R298bn payouts, lapses](https://www.moonstone.co.za/life-insurers-pay-out-r298bn-as-policy-lapses-remain-a-concern/).
