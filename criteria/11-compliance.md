# 11 — Retention, forget, consent, minimality, record of advice, safety events

Owner: `test/retention.test.ts`, `test/forget.test.ts`, `test/consent.test.ts`, `test/redact.test.ts`, `test/roa.test.ts`, `test/safety.test.ts`, `test/seed.test.ts`.

| id | area | journey | criterion | owner |
|---|---|---|---|---|
| C-1400 | retention | cron | Given `GET /api/cron/retention` with `CRON_SECRET`, then every `recordings` row with `delete_after < now` and `deleted_at IS NULL` has its file removed from Storage and `deleted_at` set. | test/retention.test.ts |
| C-1401 | retention | cron | Given a Storage delete fails, then the row is left for the next run and an incident after 3 consecutive failures for the same row. | test/retention.test.ts |
| C-1402 | retention | cron | Given the cron without the secret, then 401 and nothing deleted. | test/retention.test.ts |
| C-1403 | retention | cron | Given a run, then the response reports `{deleted, failed, remaining}`. | test/retention.test.ts |
| C-1404 | retention | cron | Given the broker changes `retention_days`, then existing `delete_after` values are recomputed from `created_at` on the next run. | test/retention.test.ts |
| C-1405 | retention | cron | Given `retention_days=0`, then no recordings are ever stored for that broker (C-0436) and the cron has nothing to do. | test/retention.test.ts |
| C-1406 | retention | cron | Given meeting chunks, then the same rule applies per chunk. | test/retention.test.ts |
| C-1407 | retention | cron | Given a run deletes 500 files, then it stops at 200 per run (time budget) and reports `remaining`. | test/retention.test.ts |
| C-1408 | retention | cron | Given `webhook_events.raw` older than 30 days, then nulled by the same cron (transcript lives in `turns`). | test/retention.test.ts |
| C-1409 | forget | cascade | Given `forgetClient()`, then zero rows remain in every client-linked table (full list in C-1208) — asserted by counting every table in the fake DB. | test/forget.test.ts |
| C-1410 | forget | cascade | Given a new table added to the schema with a `client_id` or `session_id` column, then `test/forget.test.ts` fails until it is in the cascade list (the test enumerates tables from the migrations). | test/forget.test.ts |
| C-1411 | forget | cascade | Given the client has an open meeting session, then it is closed and deleted too. | test/forget.test.ts |
| C-1412 | forget | cascade | Given the client has a queued `send_quote` job, then the job is cancelled (`status=cancelled`). | test/forget.test.ts |
| C-1413 | forget | cascade | Given the job runs twice, then the second run deletes nothing and succeeds. | test/forget.test.ts |
| C-1414 | forget | cascade | Given `audit_log` rows referencing the client's entities, then their `before/after` payloads are replaced with `{forgotten:true}` while the action rows remain. | test/forget.test.ts |
| C-1415 | forget | cascade | Given the client requested via WhatsApp, then the confirmation message is sent before deletion and nothing is sent after. | test/forget.test.ts |
| C-1416 | forget | cascade | Given a broker-initiated forget, then the client is emailed/WhatsApped a one-line notice only if a channel exists, before deletion. | test/forget.test.ts |
| C-1417 | forget | cascade | Given the forget, then `incidents` referencing the session keep only the fingerprint. | test/forget.test.ts |
| C-1418 | forget | cascade | Given the forget, then `clients.forgotten_at` is set and the row is excluded from every dashboard query. | test/forget.test.ts |
| C-1419 | forget | cascade | Given two clients share an email (family), then only the requested client is forgotten. | test/forget.test.ts |
| C-1420 | forget | cascade | Given the forget completes, then `/api/health.forgets_last_30d` increments. | test/forget.test.ts |
| C-1421 | consent | record | Given a call with consent, then exactly one `consents(kind=recording)` row with `turn_id` of the client's "yes". | test/consent.test.ts |
| C-1422 | consent | record | Given a channel, then `consents(kind=contact)` with the address stored on the client, not in the consent row. | test/consent.test.ts |
| C-1423 | consent | record | Given a meeting, then `consents(kind=in_person, method=in_person)` with the broker user id. | test/consent.test.ts |
| C-1424 | consent | record | Given the ROA, then the consent rows are listed with time and method. | test/roa.test.ts |
| C-1425 | consent | record | Given a declined consent, then the row has `granted=false` and the session has no turns. | test/consent.test.ts |
| C-1426 | consent | record | Given consent inferred (no tool call), then `method=voice_inferred` and a safety event. | test/consent.test.ts |
| C-1427 | consent | record | Given the dashboard header, then "Consent: yes at 00:12" or "declined". | test/app.test.ts |
| C-1428 | consent | record | Given consent rows, then they are deleted with forget and never exported elsewhere. | test/forget.test.ts |
| C-1429 | minimality | stored | Given every fixture transcript ingested, then no stored `turns.text` matches the ID pattern (13 digits). | test/redact.test.ts |
| C-1430 | minimality | stored | Given every fixture, then no stored text matches the card pattern. | test/redact.test.ts |
| C-1431 | minimality | stored | Given every fixture, then no `facts.value_text` contains "diagnos", "HIV", "cancer", "diabet" (medical terms list) — such mentions stay in turns only. | test/redact.test.ts |
| C-1432 | minimality | stored | Given every fixture, then no `facts.label` is a capitalised personal name (heuristic: not in the kinds list and matches `^[A-Z][a-z]+$`). | test/redact.test.ts |
| C-1433 | minimality | stored | Given the agent prompt, then it contains the §4 ban list verbatim. | test/agent-prompt.test.ts |
| C-1434 | minimality | stored | Given the extractor prompt, then it instructs to never output identifiers or medical details. | test/extract.test.ts |
| C-1435 | minimality | stored | Given `fact_refusals.raw`, then identifiers are redacted before storage. | test/facts.test.ts |
| C-1436 | minimality | stored | Given `webhook_events.raw`, then the ElevenLabs transcript is stored as received (it is the record) but `redact()` is applied to the copy served to the dashboard and to `turns`. | test/ingest.test.ts |
| C-1437 | minimality | stored | Given `incidents.summary`, then it never includes a phone number or email (regex test over all incidents written by the suite). | test/safety.test.ts |
| C-1438 | minimality | stored | Given alert emails, then client names are first-name only and no numbers. | test/alerts.test.ts |
| C-1439 | minimality | stored | Given logs (`console.*` in `api/`), then no handler logs a request body (static grep: `console.log(.*body`). | test/security-static.test.ts |
| C-1440 | minimality | stored | Given the broker notification, then first name, duration, counts, link — nothing else. | test/deliver.test.ts |
| C-1441 | roa | contents | Given the ROA, then it has headings in this order: Who, Consent, Information the advice was based on, Needs identified, Products considered, Products recommended and why, Replacement disclosure, Checks, Changes by the broker, Disclosures. | test/roa.test.ts |
| C-1442 | roa | contents | Given "Information…", then each line has the fact, confidence, source and `mm:ss`. | test/roa.test.ts |
| C-1443 | roa | contents | Given "Needs identified", then each need with priority and the client's words. | test/roa.test.ts |
| C-1444 | roa | contents | Given "Products considered", then every considered product with reason, including budget moves. | test/roa.test.ts |
| C-1445 | roa | contents | Given "Products recommended and why", then the `why`, the cover, the premium and `premium_basis` fields (band, rate, verified_on). | test/roa.test.ts |
| C-1446 | roa | contents | Given a replacement, then what is replaced, what is lost, waiting periods. | test/roa.test.ts |
| C-1447 | roa | contents | Given "Checks", then every `safety_events` row for the session with engine and outcome. | test/roa.test.ts |
| C-1448 | roa | contents | Given "Changes by the broker", then every audit row for the session's entities. | test/roa.test.ts |
| C-1449 | roa | contents | Given the ROA footer, then "Prepared by Call for {broker}, FSP {n}, generated {datetime}" and version. | test/roa.test.ts |
| C-1450 | roa | contents | Given the ROA, then it states which facts were confirmed by the client on the call versus noted by the broker. | test/roa.test.ts |
| C-1451 | disclosures | seed | Given `seed/disclosures.json`, then ZA rows for keys: indicative, underwriting, fsp, recording, data_use, forget, demo, auto_send, no_advice_on_call, replacement. | test/seed.test.ts |
| C-1452 | disclosures | seed | Given each row, then `verified_on` set and text ≤ 80 words. | test/seed.test.ts |
| C-1453 | disclosures | seed | Given the document, then it includes every row with `required=true` and the conditional ones only when the condition holds. | test/quotedoc.test.ts |
| C-1454 | disclosures | seed | Given a second country row set (KE placeholder with `active=false`), then the ZA document never pulls it. | test/quotedoc.test.ts |
| C-1455 | disclosures | seed | Given the `forget` disclosure, then it names the reply word ("reply FORGET ME") and the broker's email. | test/seed.test.ts |
| C-1456 | disclosures | seed | Given disclosures are public-read, then the anon key can select them (RLS test). | test/rls.test.ts |
| C-1457 | safety | events | Given every check in `safety.ts`/`check.ts`/`distress.ts`, then it writes exactly one `safety_events` row per invocation. | test/safety.test.ts |
| C-1458 | safety | events | Given Jev configured and reachable, then `engine=jev`. | test/safety.test.ts |
| C-1459 | safety | events | Given Jev unreachable and the model row enabled, then `engine=model` and `safety_events(check=jev_fallback)`. | test/safety.test.ts |
| C-1460 | safety | events | Given neither, then `engine=none, outcome=unavailable`. | test/safety.test.ts |
| C-1461 | safety | events | Given `unavailable`, then `/api/health.guardrails_live=false` and an incident `guardrails_unavailable` (critical, once per hour). | test/health.test.ts |
| C-1462 | safety | events | Given a judgement, then it can flag or hold but never deletes or rewrites client-facing text silently (static test: no code path from `judge()` mutates `quotes.html`). | test/safety.test.ts |
| C-1463 | safety | events | Given the one hard stop (identifier requested by the agent), then `outcome=block` and incident critical. | test/safety.test.ts |
| C-1464 | safety | events | Given a check's model call times out, then `unavailable` for that check only. | test/safety.test.ts |
| C-1465 | safety | events | Given `safety_events.detail`, then it never contains the full transcript (≤ 500 chars, turn indices instead). | test/safety.test.ts |
| C-1466 | safety | events | Given `/admin`, then counts by check and outcome for the last 24 h. | test/admin.test.ts |
| C-1467 | safety | events | Given the Jev client, then out-of-credit is a critical incident naming the fallback. | test/safety.test.ts |
| C-1468 | safety | events | Given the Jev client, then a question over the token budget is split, never sent oversize (ported rule). | test/safety.test.ts |
| C-1469 | safety | events | Given the rubric check, then the prompt includes the facts and the text, not the catalogue. | test/safety.test.ts |
| C-1470 | safety | events | Given `TRACKING_OFF=1` in tests, then events are still written to the fake DB (tracking is alerts, not events). | test/safety.test.ts |
