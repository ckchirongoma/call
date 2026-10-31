# 10 — In-person meeting mode (`public/meeting.html`, `api/meeting.ts`, `transcribe.ts`)

Owner: `test/meeting.test.ts`, `test/transcribe.test.ts`, `test/journey-meeting.e2e.test.ts`.

| id | area | journey | criterion | owner |
|---|---|---|---|---|
| C-1300 | meeting | start | Given a logged-in broker opens `/meeting`, then a client picker (search existing by name/phone, or "new") is shown. | test/meeting.test.ts |
| C-1301 | meeting | start | Given "new" with first name and optional phone/email, then a `clients` row. | test/meeting.test.ts |
| C-1302 | meeting | start | Given the page before recording, then the consent line is displayed in large type under the heading "Read this to the client". | test/meeting.test.ts |
| C-1303 | meeting | start | Given "Client agreed" tapped, then `POST /api/meeting/start` creates `sessions(mode=meeting, provider=upload)` and `consents(kind=in_person, granted=true, method=in_person)`. | test/meeting.test.ts |
| C-1304 | meeting | start | Given "Client declined", then no session; the page returns to the picker. | test/meeting.test.ts |
| C-1305 | meeting | start | Given start without login, then 401. | test/meeting.test.ts |
| C-1306 | meeting | start | Given start, then the response has `session_id` and an `upload_token` (signed, 3 h). | test/meeting.test.ts |
| C-1307 | meeting | start | Given the page, then it requests the microphone only after "Client agreed". | test/meeting.test.ts |
| C-1308 | meeting | start | Given microphone denied, then the page explains and offers "upload a recording instead". | test/meeting.test.ts |
| C-1309 | meeting | start | Given the page, then it shows a running timer and a "Stop" button. | test/meeting.test.ts |
| C-1310 | meeting | start | Given the page is reloaded mid-meeting, then it offers to resume the open session (from `localStorage` session id + token). | test/meeting.test.ts |
| C-1311 | meeting | start | Given two open meeting sessions for one broker user, then the second start returns 409 with the open session id. | test/meeting.test.ts |
| C-1312 | meeting | start | Given the page, then no ElevenLabs code is loaded (meeting mode uses the browser recorder only). | test/meeting.test.ts |
| C-1313 | meeting | chunks | Given recording, then `MediaRecorder` emits a chunk every 60 s and the page POSTs it to `/api/meeting/chunk` with `idx`. | test/meeting.test.ts |
| C-1314 | meeting | chunks | Given a chunk, then stored at `recordings/{session}/chunk-{idx:04}.webm` and a `meeting_chunks` row. | test/meeting.test.ts |
| C-1315 | meeting | chunks | Given a chunk with a bad token, then 401. | test/meeting.test.ts |
| C-1316 | meeting | chunks | Given a chunk over 6 MB, then 413. | test/meeting.test.ts |
| C-1317 | meeting | chunks | Given a chunk upload fails, then the page retries with backoff (3×) and keeps the blob in memory until acknowledged. | test/meeting.test.ts |
| C-1318 | meeting | chunks | Given the same `idx` twice, then the second overwrites (idempotent). | test/meeting.test.ts |
| C-1319 | meeting | chunks | Given a gap in idx at finish, then finish returns 409 listing missing chunks; the page re-sends. | test/meeting.test.ts |
| C-1320 | meeting | chunks | Given 2 h elapsed, then recording stops automatically and finish is called. | test/meeting.test.ts |
| C-1321 | meeting | chunks | Given the network drops for 3 minutes, then on return the queued chunks upload in order. | test/meeting.test.ts |
| C-1322 | meeting | chunks | Given `recordings.delete_after` for meeting audio = retention days like calls. | test/meeting.test.ts |
| C-1323 | meeting | chunks | Given chunk storage total exceeds 200 MB for the broker this month, then 429 and an operator alert (Supabase 1 GB). | test/limits.test.ts |
| C-1324 | meeting | chunks | Given an uploaded file instead of live recording (`/api/meeting/upload`), then accepted as a single chunk up to 50 MB. | test/meeting.test.ts |
| C-1325 | meeting | finish | Given `POST /api/meeting/finish`, then `sessions.ended_at`, `duration_secs` from the sum of chunk durations, and a `transcribe_meeting` job. | test/meeting.test.ts |
| C-1326 | transcribe | job | Given the job, then chunks are concatenated in idx order and sent to the `voice` role's transcription endpoint. | test/transcribe.test.ts |
| C-1327 | transcribe | job | Given the `voice` row `provider=openrouter`, then the OpenRouter audio endpoint is used; `groq`/`openai` route direct (ported from Charlie). | test/transcribe.test.ts |
| C-1328 | transcribe | job | Given a transcript with segments and timestamps, then `turns` are written with `t_start_secs`. | test/transcribe.test.ts |
| C-1329 | transcribe | job | Given no timestamps, then turns split on sentence boundaries with estimated times (`estimated=true`). | test/transcribe.test.ts |
| C-1330 | transcribe | job | Given the transcription fails, then retry ×3, then `outcome=failed` and the broker page offers "retry". | test/transcribe.test.ts |
| C-1331 | transcribe | job | Given a 90-minute meeting, then the audio is sent in ≤ 25 MB parts and the results stitched with offset times. | test/transcribe.test.ts |
| C-1332 | transcribe | job | Given the transcript, then `redact()` runs before storage. | test/transcribe.test.ts |
| C-1333 | transcribe | job | Given `usage_ledger`, then a `transcription` row with minutes and `cost_cents` from `model_config.params.cost_per_minute` (0 if free). | test/transcribe.test.ts |
| C-1334 | transcribe | job | Given the job finishes, then `extract_facts` is enqueued (joins the call pipeline). | test/transcribe.test.ts |
| C-1335 | transcribe | job | Given an empty transcript (silence), then `outcome=failed`, incident `empty_transcript`, broker told. | test/transcribe.test.ts |
| C-1336 | transcribe | job | Given the transcript language is detected non-English, then stored with `language` and the broker is told facts may be thin. | test/transcribe.test.ts |
| C-1337 | transcribe | job | Given the `voice` row disabled, then the job fails cleanly with incident `voice_model_disabled`. | test/transcribe.test.ts |
| C-1338 | transcribe | job | Given the raw provider response, then stored on `sessions.provider_analysis` for debugging with any PII fields removed. | test/transcribe.test.ts |
| C-1339 | transcribe | job | Given the job, then chunk files are kept (they are the recording) and `recordings` row points at the concatenated file if produced, else the chunk list. | test/transcribe.test.ts |
| C-1340 | transcribe | job | Given the broker's `retention_days=0`, then chunks are deleted right after transcription. | test/transcribe.test.ts |
| C-1341 | speakers | label | Given the `summary` role labels each turn, then labels ∈ {broker, client, unknown}. | test/transcribe.test.ts |
| C-1342 | speakers | label | Given the model's confidence for a line < 0.7 (or absent), then `unknown`. | test/transcribe.test.ts |
| C-1343 | speakers | label | Given a line that addresses someone by name ("so, Thabo, what do you earn?"), then the labeller is told the addressee is not the speaker; the line is `client` only when the model says so with confidence ≥ 0.7, else `unknown`. | test/transcribe.test.ts |
| C-1344 | speakers | label | Given the labelling model fails, then all turns `unknown` and the pipeline continues. | test/transcribe.test.ts |
| C-1345 | speakers | label | Given facts extraction, then only `client` turns and `unknown` turns are inputs; `broker` turns are elided like agent turns. | test/extract.test.ts |
| C-1346 | speakers | label | Given a fact from an `unknown` turn, then `confidence=transcript` and flagged `speaker_unknown`; approve blocked until ticked. | test/facts.test.ts |
| C-1347 | speakers | label | Given the broker relabels a turn to `client` in the dashboard, then facts from it lose the `speaker_unknown` flag on re-extract. | test/app.test.ts |
| C-1348 | speakers | label | Given the broker relabels to `broker`, then facts from that turn are superseded. | test/app.test.ts |
| C-1349 | pipeline | meeting | Given the `meeting` fixture transcript, then needs, recommendations and a draft quote exist. | test/journey-meeting.e2e.test.ts |
| C-1350 | pipeline | meeting | Given the quote, then all facts are `confidence=transcript`. | test/journey-meeting.e2e.test.ts |
| C-1351 | pipeline | meeting | Given approve before ticking, then 422 listing the facts. | test/journey-meeting.e2e.test.ts |
| C-1352 | pipeline | meeting | Given the broker ticks all cited facts, then approve works and delivery follows the client's channel recorded at start (or chosen on the page). | test/journey-meeting.e2e.test.ts |
| C-1353 | pipeline | meeting | Given no channel on the client, then the page asks for one before approve. | test/journey-meeting.e2e.test.ts |
| C-1354 | pipeline | meeting | Given the quote document, then §2 header is the meeting variant and no read-back wording appears. | test/journey-meeting.e2e.test.ts |
| C-1355 | pipeline | meeting | Given the checker, then "you told me" fails on `transcript` facts; "in our meeting you mentioned" passes once ticked (`broker`). | test/check.test.ts |
| C-1356 | pipeline | meeting | Given distress words in the client's turns, then stabilising applies exactly as for calls. | test/journey-meeting.e2e.test.ts |
| C-1357 | pipeline | meeting | Given the broker themself says a price during the meeting, then it is not a fact and not an allowed number for the writer. | test/journey-meeting.e2e.test.ts |
| C-1358 | pipeline | meeting | Given the notification, then "Meeting transcribed — {n} facts to confirm". | test/journey-meeting.e2e.test.ts |
| C-1359 | pipeline | meeting | Given the ROA, then it records `method=in_person` consent. | test/roa.test.ts |
| C-1360 | pipeline | meeting | Given the meeting session, then `usage_ledger` has no `agent_minutes` and does have `transcription`. | test/journey-meeting.e2e.test.ts |
