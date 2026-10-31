# 08 — Approve, email, WhatsApp, replies, auto-send (`deliver.ts`, `email.ts`, `wa.ts`, `api/wa.ts`)

Owner: `test/deliver.test.ts`, `test/email.test.ts`, `test/wa.test.ts`, `test/wa-inbound.test.ts`.

| id | area | journey | criterion | owner |
|---|---|---|---|---|
| C-1000 | deliver | approve | Given `awaiting_broker` and action `approve`, then `quotes.status=approved`, `approved_by`, `approved_at` set. | test/deliver.test.ts |
| C-1001 | deliver | approve | Given approved, then one `send_quote` job. | test/deliver.test.ts |
| C-1002 | deliver | approve | Given approve twice, then one job (idempotent). | test/deliver.test.ts |
| C-1003 | deliver | approve | Given approve on a `superseded` version, then 409. | test/deliver.test.ts |
| C-1004 | deliver | approve | Given approve by a user of another broker, then 404. | test/deliver.test.ts |
| C-1005 | deliver | approve | Given approve, then `audit_log(action=approve)`. | test/deliver.test.ts |
| C-1006 | deliver | approve | Given `send_quote` runs, then the PDF is rendered first (`/api/render-pdf`) and stored; failure → job retry, status stays approved. | test/deliver.test.ts |
| C-1007 | deliver | unconfirmed | Given a recommendation whose `basis` cites an `agent` fact, then approve returns 422 with the fact ids. | test/deliver.test.ts |
| C-1008 | deliver | unconfirmed | Given the broker ticks those facts, then approve succeeds. | test/deliver.test.ts |
| C-1009 | deliver | unconfirmed | Given `transcript` facts (meeting), then same block. | test/deliver.test.ts |
| C-1010 | deliver | unconfirmed | Given an unconfirmed fact not cited by any recommendation, then approve is allowed. | test/deliver.test.ts |
| C-1011 | deliver | unconfirmed | Given the block, then the page lists "Confirm these first" with ▶ links. | test/app.test.ts |
| C-1012 | deliver | unconfirmed | Given `auto_send=true` and unconfirmed cited facts, then auto-send does NOT fire; `awaiting_broker` with reason. | test/deliver.test.ts |
| C-1013 | deliver | held | Given `held`, then approve requires `reviewed_held=1` in the action. | test/deliver.test.ts |
| C-1014 | deliver | held | Given reviewed, then `audit_log.after.reviewed_held=true`. | test/deliver.test.ts |
| C-1015 | deliver | held | Given held for `agent_advised`, then the page shows the agent's offending turn. | test/app.test.ts |
| C-1016 | deliver | held | Given held for `numbers`, then approve is refused until a new version passes (no override for invented numbers). | test/deliver.test.ts |
| C-1017 | email | send | Given channel email, then Resend is called once with `to=[client email]`, `from=QUOTE_EMAIL_FROM` display "{broker} via Call", `reply_to=broker email`. | test/email.test.ts |
| C-1018 | email | send | Given the send, then subject "Your quotation from {broker name}". | test/email.test.ts |
| C-1019 | email | send | Given the send, then `html` = the document and `text` = a plain-text rendering with the same sections. | test/email.test.ts |
| C-1020 | email | send | Given the send, then one attachment `quotation-{date}.pdf`. | test/email.test.ts |
| C-1021 | email | send | Given the PDF is over 4 MB, then no attachment and a signed link instead; `deliveries.note`. | test/email.test.ts |
| C-1022 | email | send | Given Resend 200, then `deliveries(status=sent, provider_id)`, `quotes.status=sent`. | test/email.test.ts |
| C-1023 | email | send | Given Resend 4xx, then `deliveries(status=failed, error)`, `quotes.status=failed`, broker notified. | test/email.test.ts |
| C-1024 | email | send | Given Resend 5xx/timeout, then job retry; after 3, failed. | test/email.test.ts |
| C-1025 | email | send | Given `RESEND_API_KEY` unset, then the send is `skipped`, `deliveries.status=failed`, error "email not configured", `/api/health` says so. | test/email.test.ts |
| C-1026 | email | send | Given `QUOTE_EMAIL_FROM` unset, then from = `onboarding@resend.dev` and `deliveries.note="sandbox sender"`. | test/email.test.ts |
| C-1027 | email | send | Given the client email is invalid at send time, then failed `invalid_address`. | test/email.test.ts |
| C-1028 | email | send | Given the idempotency key = `quote:{id}:v{n}`, then Resend is called with it. | test/email.test.ts |
| C-1029 | email | webhook | Given a Resend `email.delivered` webhook with a valid signature, then `deliveries.status=delivered`. | test/email.test.ts |
| C-1030 | email | webhook | Given `email.bounced`, then `bounced` and broker notified. | test/email.test.ts |
| C-1031 | email | webhook | Given `email.opened`, then `read` and `quotes.status=read`. | test/email.test.ts |
| C-1032 | email | webhook | Given an invalid Resend signature, then 401 and `webhook_events(signature_ok=false)`. | test/email.test.ts |
| C-1033 | email | webhook | Given an unknown `provider_id`, then 200 and logged. | test/email.test.ts |
| C-1034 | email | send | Given the email, then it contains the "how to be forgotten" line with the reply instruction. | test/email.test.ts |
| C-1035 | email | send | Given the email, then no tracking pixel is added by us. | test/email.test.ts |
| C-1036 | email | send | Given `usage_ledger`, then an `email` row with qty 1. | test/email.test.ts |
| C-1037 | wa | send | Given channel whatsapp, then the first message is template `WHATSAPP_TEMPLATE_QUOTE_READY` with params `[first name, broker name]` and a URL button carrying the signed link. | test/wa.test.ts |
| C-1038 | wa | send | Given template accepted (Meta returns a message id), then a document message follows with the PDF (uploaded via media API) and caption "Your quotation from {broker}". | test/wa.test.ts |
| C-1039 | wa | send | Given the template send fails with 132001 (template not approved), then `deliveries.failed(error=template_unapproved)` and broker notified with the fallback offer. | test/wa.test.ts |
| C-1040 | wa | send | Given 131026 (not a WhatsApp user), then failed `not_on_whatsapp`. | test/wa.test.ts |
| C-1041 | wa | send | Given 131047 (re-engagement), then the template path is used (it is already). | test/wa.test.ts |
| C-1042 | wa | send | Given the number is inside a 24-hour service window (client messaged first), then free text + document is sent instead of the template. | test/wa.test.ts |
| C-1043 | wa | send | Given `WHATSAPP_ACCESS_TOKEN` unset, then skipped and `deliveries.failed(error=whatsapp not configured)`. | test/wa.test.ts |
| C-1044 | wa | send | Given the send, then `deliveries(provider_id=wamid)`. | test/wa.test.ts |
| C-1045 | wa | status | Given a status webhook `delivered` for that wamid, then `deliveries.status=delivered`. | test/wa.test.ts |
| C-1046 | wa | status | Given `read`, then `read` and `quotes.status=read`. | test/wa.test.ts |
| C-1047 | wa | status | Given `failed` with an error code, then `failed` with the code and broker notified. | test/wa.test.ts |
| C-1048 | wa | status | Given the Meta webhook signature is invalid, then 401. | test/wa.test.ts |
| C-1049 | wa | status | Given the Meta verify handshake GET with the right token, then the challenge is echoed. | test/wa.test.ts |
| C-1050 | wa | send | Given the template body, then it contains no price (the template is generic; the PDF has the numbers). | test/wa.test.ts |
| C-1051 | wa | send | Given the PDF upload fails, then the template still goes, the document is retried, and the signed link covers access. | test/wa.test.ts |
| C-1052 | wa | send | Given the document message, then filename `quotation-{date}.pdf`. | test/wa.test.ts |
| C-1053 | wa | send | Given the limits of WA text (4096), then any text message is split per `wa.ts splitText`. | test/wa.test.ts |
| C-1054 | wa | send | Given the broker notification template `broker_new_quote`, then params `[client first name, duration, needs count, link]`. | test/wa.test.ts |
| C-1055 | wa | send | Given `usage_ledger`, then a `whatsapp` row per template message with `cost_cents` from `WHATSAPP_UTILITY_CENTS` (default 1). | test/wa.test.ts |
| C-1056 | wa | send | Given a number not in E.164, then normalised before send or failed `invalid_number`. | test/wa.test.ts |
| C-1057 | wa | send | Given the Meta API version comes from env, then no version literal in code. | test/wa.test.ts |
| C-1058 | wa | send | Given the send succeeds, then `quotes.status=sent`. | test/wa.test.ts |
| C-1059 | deliver | fallback | Given WhatsApp failed and an email fact exists, then the broker page shows "Send by email instead" action. | test/app.test.ts |
| C-1060 | deliver | fallback | Given that action, then a new `deliveries` row channel email and the quote status cycles to sent. | test/deliver.test.ts |
| C-1061 | deliver | fallback | Given no email fact, then the action is "Record a call" instead. | test/app.test.ts |
| C-1062 | deliver | fallback | Given WhatsApp failed, then the broker notification names the error in plain words ("template not approved yet"). | test/deliver.test.ts |
| C-1063 | deliver | fallback | Given both channels failed, then `quotes.status=failed` and incident. | test/deliver.test.ts |
| C-1064 | deliver | fallback | Given a fallback send, then `audit_log(action=fallback_email)`. | test/deliver.test.ts |
| C-1065 | deliver | fallback | Given the fallback email, then consent for email contact is checked: if the client chose WhatsApp only, the email action is labelled "client did not choose email — confirm first" and requires a tick. | test/deliver.test.ts |
| C-1066 | deliver | fallback | Given that tick, then `consents(kind=contact, method=tap, granted=true)` by the broker user with audit. | test/deliver.test.ts |
| C-1067 | deliver | limits | Given 100 emails already sent today (UTC), then `send_quote` is queued with `run_after = next UTC midnight` and status `approved` (not failed). | test/deliver.test.ts |
| C-1068 | deliver | limits | Given the queueing, then the broker page says "Queued — daily email limit; sends after 02:00 SAST". | test/app.test.ts |
| C-1069 | deliver | limits | Given 80 emails today, then an operator alert `email_quota_80`. | test/limits.test.ts |
| C-1070 | deliver | limits | Given the day rolls over, then the queued job runs. | test/deliver.test.ts |
| C-1071 | wa | inbound | Given an inbound interactive reply with button id `forget_me`, then the bot replies with a confirm button pair (`forget_yes`, `forget_no`). | test/wa-inbound.test.ts |
| C-1072 | wa | inbound | Given `forget_yes`, then a `forget_client` job is enqueued and the bot says "Done — we've deleted what we had." after it completes. | test/wa-inbound.test.ts |
| C-1073 | wa | inbound | Given `forget_no`, then "No changes made." | test/wa-inbound.test.ts |
| C-1074 | wa | inbound | Given free text "forget me" / "delete my data" / "stop", then treated as `forget_me` (intent words), with the confirm step. | test/wa-inbound.test.ts |
| C-1075 | wa | inbound | Given a reply from a number that is no client of any broker, then one polite line "This number sends quotations on behalf of brokers; we can't help here" and no further replies for 24 h. | test/wa-inbound.test.ts |
| C-1076 | wa | inbound | Given inbound from a client, then the Meta message id is deduped (`webhook_events`). | test/wa-inbound.test.ts |
| C-1077 | wa | inbound | Given the forget confirm, then the audit row records only counts. | test/wa-inbound.test.ts |
| C-1078 | wa | inbound | Given forget completes, then a later inbound from the same number is treated as unknown (C-1075). | test/wa-inbound.test.ts |
| C-1079 | wa | inbound | Given "call me", then `callbacks` row and broker notified; bot replies "{broker} will call you." | test/wa-inbound.test.ts |
| C-1080 | wa | inbound | Given any other free text, then stored in `client_messages`, shown in the broker's inbox, and the bot replies once "Thanks — {broker} will see this." | test/wa-inbound.test.ts |
| C-1081 | wa | inbound | Given two free texts within 10 minutes, then the auto-reply is sent once. | test/wa-inbound.test.ts |
| C-1082 | wa | inbound | Given an inbound voice note, then stored as a message with "voice note" and no transcription in v1. | test/wa-inbound.test.ts |
| C-1083 | wa | inbound | Given a client reply, then `clients.last_inbound_at` set (opens the service window for C-1042). | test/wa-inbound.test.ts |
| C-1084 | wa | inbound | Given the inbound handler, then no model call is made (no conversational AI on this door in v1). | test/wa-inbound.test.ts |
| C-1085 | deliver | auto | Given `brokers.auto_send=true` and the quote checked clean with all cited facts confirmed, then status goes `checked → approved` with `approved_by="system:auto_send"`. | test/deliver.test.ts |
| C-1086 | deliver | auto | Given auto-send, then `audit_log(action=auto_send, after.demo=true)`. | test/deliver.test.ts |
| C-1087 | deliver | auto | Given auto-send and `held`, then not sent; awaits broker. | test/deliver.test.ts |
| C-1088 | deliver | auto | Given auto-send, then the document still names the broker and FSP and says "sent automatically for demonstration" in §9. | test/quotedoc.test.ts |
| C-1089 | deliver | auto | Given `auto_send` default, then false on a new broker row (migration default). | test/rls.test.ts |
| C-1090 | deliver | auto | Given auto-send toggled on, then `/app/settings` shows the "demo only" label and the toggle requires typing the broker name. | test/app.test.ts |
