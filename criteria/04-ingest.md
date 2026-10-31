# 04 — Post-call ingestion (`POST /api/voice/post-call`, jobs `ingest_transcript`, `store_audio`)

Owner: `test/post-call.test.ts` for the HTTP layer, `test/ingest.test.ts` for the job, `test/queue.test.ts` for retries.

| id | area | journey | criterion | owner |
|---|---|---|---|---|
| C-0400 | webhook | transcript | Given a `post_call_transcription` request signed with the test secret over the exact raw body, then 200. | test/post-call.test.ts |
| C-0401 | webhook | transcript | Given a valid event, then a `webhook_events` row exists with `provider=elevenlabs`, `event_type=post_call_transcription`, `external_id=conversation_id`, `signature_ok=true`, `raw` = the parsed body. | test/post-call.test.ts |
| C-0402 | webhook | transcript | Given a valid event, then exactly one `jobs` row `kind=ingest_transcript` with the `webhook_events.id` in the payload. | test/post-call.test.ts |
| C-0403 | webhook | transcript | Given a valid event, then the handler responds in under 1,000 ms with 50 ms simulated DB latency. | test/post-call.test.ts |
| C-0404 | webhook | transcript | Given a valid event, then the worker is kicked (self-call to `/api/worker` with `WORKER_SECRET`) after the response. | test/post-call.test.ts |
| C-0405 | webhook | transcript | Given the body is 5 MB, then it is still accepted (raw body read as bytes, not parsed first). | test/post-call.test.ts |
| C-0406 | webhook | transcript | Given the body is parsed, then parsing happens only after signature verification. | test/post-call.test.ts |
| C-0407 | webhook | transcript | Given `type` is unknown, then 200 and `webhook_events` row with no job. | test/post-call.test.ts |
| C-0408 | webhook | transcript | Given the DB insert of `webhook_events` fails, then 500 (so ElevenLabs retries) and an incident. | test/post-call.test.ts |
| C-0409 | webhook | transcript | Given the job insert fails after the event row was written, then 500 and the next worker tick enqueues from the orphan event row (`webhook_events.processed_at IS NULL`). | test/post-call.test.ts |
| C-0410 | webhook | transcript | Given a GET, then 405. | test/post-call.test.ts |
| C-0411 | webhook | transcript | Given `ELEVENLABS_WEBHOOK_SECRET` unset, then every post-call request is 503 and `/api/health` says `post_call: unconfigured`. | test/post-call.test.ts |
| C-0412 | webhook | transcript | Given the header has two `v0=` values and the second matches, then 200. | test/post-call.test.ts |
| C-0413 | webhook | signature | Given a wrong signature, then 401 and `webhook_events(signature_ok=false)` with `raw = null` (body not stored). | test/post-call.test.ts |
| C-0414 | webhook | signature | Given `t` older than 30 minutes, then 401 `stale`. | test/post-call.test.ts |
| C-0415 | webhook | signature | Given `t` more than 5 minutes in the future, then 401 `future`. | test/post-call.test.ts |
| C-0416 | webhook | signature | Given `t` 29 minutes old, then 200. | test/post-call.test.ts |
| C-0417 | webhook | signature | Given a missing header, then 401 `missing`. | test/post-call.test.ts |
| C-0418 | webhook | signature | Given a malformed header (`v0=` only), then 401 `malformed`. | test/post-call.test.ts |
| C-0419 | webhook | signature | Given the body re-serialised with different whitespace, then the signature over the original bytes still verifies (we never re-serialise before verifying). | test/post-call.test.ts |
| C-0420 | webhook | signature | Given 3 signature failures within an hour, then one incident `webhook_signature_failures`. | test/post-call.test.ts |
| C-0421 | webhook | signature | Given signature comparison, then `timingSafeEqual` is used. | test/post-call.test.ts |
| C-0422 | webhook | signature | Given the signing secret is rotated (env has `ELEVENLABS_WEBHOOK_SECRET` and `ELEVENLABS_WEBHOOK_SECRET_PREVIOUS`), then either verifies for 24 h and which one is logged. | test/post-call.test.ts |
| C-0423 | webhook | dedupe | Given the same transcript event twice, then 200 both times and one job. | test/post-call.test.ts |
| C-0424 | webhook | dedupe | Given the same event twice concurrently, then the unique index makes the second a no-op (test with two parallel calls). | test/post-call.test.ts |
| C-0425 | webhook | dedupe | Given transcript and audio events for the same conversation, then two `webhook_events` rows (different `event_type`). | test/post-call.test.ts |
| C-0426 | webhook | dedupe | Given a duplicate after the first was processed, then `turns` are not duplicated (ingest is idempotent on `(session_id, idx)`). | test/ingest.test.ts |
| C-0427 | webhook | audio | Given `post_call_audio` before any transcript, then 200, a session is created for the conversation id, and the audio is stored at `recordings/{session_id}/call.mp3`. | test/post-call.test.ts |
| C-0428 | webhook | audio | Given the audio base64 is 8 MB, then it is decoded in the job, not in the handler (handler stores a pointer to the raw event). | test/post-call.test.ts |
| C-0429 | webhook | audio | Given the audio stored, then `recordings` row has `bytes`, `mime`, `storage_path`, `delete_after = now + broker.retention_days`. | test/ingest.test.ts |
| C-0430 | webhook | audio | Given the transcript then arrives, then it links to the same session and `sessions.duration_secs` comes from the transcript metadata. | test/ingest.test.ts |
| C-0431 | webhook | audio | Given the audio arrives for a `declined_consent` session, then it is not stored and the event is marked `discarded`. | test/ingest.test.ts |
| C-0432 | webhook | audio | Given Storage upload fails, then the job retries (3×) and then incident `audio_store_failed`; transcript processing is unaffected. | test/queue.test.ts |
| C-0433 | webhook | audio | Given the audio decodes to zero bytes, then no `recordings` row and `safety_events(check=empty_audio)`. | test/ingest.test.ts |
| C-0434 | webhook | audio | Given the audio event lacks a conversation id, then 200 and incident `audio_no_conversation`. | test/post-call.test.ts |
| C-0435 | webhook | audio | Given the raw event for audio is stored, then `webhook_events.raw` holds the base64 only until the job finishes, then it is nulled (storage budget). | test/ingest.test.ts |
| C-0436 | webhook | audio | Given the broker's `retention_days = 0`, then the audio is not stored at all and the session says `recording: not kept`. | test/ingest.test.ts |
| C-0437 | webhook | audio | Given audio after transcript, then the `recordings` row links and the dashboard player URL is signed. | test/ingest.test.ts |
| C-0438 | webhook | audio | Given audio after transcript for a session already `forgotten`, then discarded. | test/ingest.test.ts |
| C-0439 | webhook | audio | Given the `usage_ledger` already has `agent_minutes` from the transcript, then the audio event does not add a second minutes row. | test/ingest.test.ts |
| C-0440 | webhook | audio | Given `recordings.delete_after` passes, then the retention cron deletes the file (see 11). | test/retention.test.ts |
| C-0441 | ingest | turns | Given the transcript array, then `turns` rows exist with `idx` 0..n-1 in order. | test/ingest.test.ts |
| C-0442 | ingest | turns | Given `role: "agent"` → `turns.role="agent"`; `role: "user"` → `"client"`. | test/ingest.test.ts |
| C-0443 | ingest | turns | Given `time_in_call_secs`, then `t_start_secs` is set; `t_end_secs` = next turn's start. | test/ingest.test.ts |
| C-0444 | ingest | turns | Given a turn with `tool_calls`, then `turns.tool_calls` holds name and params (secrets never present). | test/ingest.test.ts |
| C-0445 | ingest | turns | Given a turn with `tool_results`, then results are stored alongside. | test/ingest.test.ts |
| C-0446 | ingest | turns | Given a turn whose `message` is null (tool-only turn), then stored with `text=""`. | test/ingest.test.ts |
| C-0447 | ingest | turns | Given client turn text with an ID number, then the stored text is redacted (C-0175). | test/ingest.test.ts |
| C-0448 | ingest | turns | Given the transcript, then `sessions.started_at` = `event_timestamp - duration` when `metadata.start_time_unix_secs` is absent, else that. | test/ingest.test.ts |
| C-0449 | ingest | turns | Given `metadata.call_duration_secs`, then `sessions.duration_secs` equals it. | test/ingest.test.ts |
| C-0450 | ingest | turns | Given the duration, then `usage_ledger(item=agent_minutes, qty=ceil(secs/60), cost_cents=qty*ELEVENLABS_CENTS_PER_MINUTE)`. | test/ingest.test.ts |
| C-0451 | ingest | turns | Given `metadata.cost` (credits) is present, then stored on `sessions.provider_cost` and shown on /admin next to our estimate. | test/ingest.test.ts |
| C-0452 | ingest | turns | Given `mode=call`, then `usage_ledger(item=telephony)` estimated from duration × `TELEPHONY_CENTS_PER_MINUTE` (default 1). | test/ingest.test.ts |
| C-0453 | ingest | turns | Given `mode=web`, then no telephony row. | test/ingest.test.ts |
| C-0454 | ingest | turns | Given `status` in the event is not `done` (e.g. `failed`), then `sessions.outcome=failed` and the pipeline stops after turns. | test/ingest.test.ts |
| C-0455 | ingest | turns | Given a transcript with 0 turns, then `outcome=failed`, incident `empty_transcript`. | test/ingest.test.ts |
| C-0456 | ingest | turns | Given a transcript of 400 turns, then all are stored (no cap). | test/ingest.test.ts |
| C-0457 | ingest | turns | Given the same conversation ingested twice, then `turns` count is unchanged. | test/ingest.test.ts |
| C-0458 | ingest | turns | Given `dynamic_variables` in the event include `client_name`/`client_phone` (web), then the client row is upserted if init did not do it. | test/ingest.test.ts |
| C-0459 | ingest | turns | Given the transcript's `conversation_initiation_client_data` names a different agent id than the broker's, then incident and the broker from the session row is kept. | test/ingest.test.ts |
| C-0460 | ingest | turns | Given ingest finishes, then `webhook_events.processed_at` is set. | test/ingest.test.ts |
| C-0461 | ingest | analysis | Given `analysis.data_collection_results`, then `sessions.provider_analysis` holds it verbatim. | test/ingest.test.ts |
| C-0462 | ingest | analysis | Given `data_collection_results.monthly_budget = 500` and our facts have `budget/monthly_budget = 500`, then `safety_events(check=dc_agree, detail.field=monthly_budget)`. | test/ingest.test.ts |
| C-0463 | ingest | analysis | Given DC says 500 and ours says 800, then `dc_disagree` with both values and ours remains the active fact. | test/ingest.test.ts |
| C-0464 | ingest | analysis | Given DC has a field we have no fact for, then a `facts` row `source=elevenlabs_dc, status=refused, reason=unbacked` (visible to the broker as "ElevenLabs also heard: …", never used). | test/ingest.test.ts |
| C-0465 | ingest | analysis | Given `evaluation_criteria_results.readback_done = failure`, then `sessions.readback_confirmed=false` if our checker agrees; if ours says pass, `eval_disagree`. | test/ingest.test.ts |
| C-0466 | ingest | analysis | Given `evaluation_criteria_results.consent_given = failure` and our consent fact says yes, then `eval_disagree` and the pipeline continues (ours is the record). | test/ingest.test.ts |
| C-0467 | ingest | analysis | Given `analysis` absent, then no error; `dc_absent` event. | test/ingest.test.ts |
| C-0468 | ingest | analysis | Given `analysis.transcript_summary`, then stored on the session as `provider_summary` and shown to the broker labelled "ElevenLabs summary (not checked)". | test/ingest.test.ts |
| C-0469 | ingest | eval | Given `no_advice_on_call = failure`, then incident `agent_advised`. | test/ingest.test.ts |
| C-0470 | ingest | eval | Given `no_advice_on_call = failure`, then the quote (if any) is `held` with reason. | test/journey.e2e.test.ts |
| C-0471 | ingest | eval | Given `no_identifiers_requested = failure`, then incident `agent_requested_identifier` severity critical. | test/ingest.test.ts |
| C-0472 | ingest | eval | Given `hardship_handled = failure`, then `sessions.mode=stabilising` if our distress rules agree, else `eval_disagree`. | test/ingest.test.ts |
| C-0473 | ingest | consent | Given no consent fact and no consent turn detectable (client's first turn is not an agreement), then `outcome=declined_consent` and turns are not stored. | test/ingest.test.ts |
| C-0474 | ingest | consent | Given no consent tool call but the client's first turn is "yes, that's fine", then consent is inferred `method=voice`, `safety_events(consent_inferred)`, and the pipeline runs. | test/ingest.test.ts |
| C-0475 | ingest | consent | Given consent inferred from "ja", "sure", "okay", "go ahead", "yebo", then granted. | test/ingest.test.ts |
| C-0476 | ingest | consent | Given the first client turn is "no", "I don't want to be recorded", "rather not", then declined. | test/ingest.test.ts |
| C-0477 | ingest | consent | Given consent declined but the agent continued and facts were saved by tool, then those facts are deleted and `questions_after_decline` incident. | test/ingest.test.ts |
| C-0478 | ingest | consent | Given consent granted, then `consents` has exactly one `recording` row per session. | test/ingest.test.ts |
| C-0479 | ingest | dropped | Given the `dropped` fixture (ends mid-questions), then `outcome=dropped`, `readback_confirmed=false`. | test/ingest.test.ts |
| C-0480 | ingest | dropped | Given dropped, then facts remain `confidence=agent`. | test/ingest.test.ts |
| C-0481 | ingest | dropped | Given dropped, then the pipeline still produces needs and a draft quote. | test/journey.e2e.test.ts |
| C-0482 | ingest | dropped | Given dropped, then the broker notification says "Call dropped at {mm:ss} — {n} facts unconfirmed". | test/journey.e2e.test.ts |
| C-0483 | ingest | dropped | Given dropped with no channel, then the notification adds "No channel — call the client". | test/journey.e2e.test.ts |
| C-0484 | ingest | dropped | Given dropped and the client calls back within 24 h, then init marks `known_client=yes` and the new session links `continues_session_id`. | test/voice-init.test.ts |
| C-0485 | queue | retries | Given `extract_facts` throws, then the job's `attempts` increments and `run_after` is backoff (10 s, 60 s, 300 s). | test/queue.test.ts |
| C-0486 | queue | retries | Given 3 failures, then `status=failed`, `last_error` set, incident `job_failed` with kind and session. | test/queue.test.ts |
| C-0487 | queue | retries | Given a failed job, then `/admin` offers "retry" which resets attempts. | test/admin.test.ts |
| C-0488 | queue | retries | Given `ingest_transcript` succeeded and `extract_facts` failed, then re-running `ingest_transcript` does not duplicate turns and `extract_facts` is re-enqueued once. | test/queue.test.ts |
| C-0489 | queue | retries | Given a job locked by a worker that died, then after `lock_timeout` (120 s) another worker reclaims it. | test/queue.test.ts |
| C-0490 | queue | retries | Given two workers claim concurrently, then exactly one gets the job (`claim_job` RPC / conditional update). | test/queue.test.ts |
| C-0491 | queue | retries | Given a job whose session was forgotten mid-pipeline, then it finishes as `skipped` writing nothing. | test/queue.test.ts |
| C-0492 | queue | retries | Given the worker's time budget (240 s) is nearly spent, then it stops claiming and hands on (self-call). | test/queue.test.ts |
| C-0493 | queue | retries | Given a `DeadlineError` inside a model call, then the job is requeued without counting as a failure. | test/queue.test.ts |
| C-0494 | queue | retries | Given the pipeline steps run in order ingest → extract → needs → match → write → check → notify, then each step's job carries `session_id` and is idempotent (running twice yields the same rows). | test/queue.test.ts |
| C-0495 | queue | retries | Given `notify_broker` fails (Resend down), then retried; the quote status is unaffected. | test/queue.test.ts |
| C-0496 | queue | retries | Given the worker is called without `WORKER_SECRET`, then 401. | test/queue.test.ts |
| C-0497 | queue | retries | Given `/api/worker?tick=1` from cron with `CRON_SECRET`, then it drains. | test/queue.test.ts |
| C-0498 | queue | retries | Given the queue is empty, then the worker returns `{claimed:0}` in under 200 ms. | test/queue.test.ts |
| C-0499 | queue | retries | Given 20 queued jobs for 5 sessions, then jobs for one session run in order and sessions run in parallel up to 3. | test/queue.test.ts |
