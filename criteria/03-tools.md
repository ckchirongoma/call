# 03 — Server tools during the call (`POST /api/voice/tool/{name}`)

Owner: `test/voice-tools.test.ts` unless stated.

| id | area | journey | criterion | owner |
|---|---|---|---|---|
| C-0301 | tools | auth | Given no `x-call-secret` header, then 401 and no row written. | test/voice-tools.test.ts |
| C-0302 | tools | auth | Given a wrong secret, then 401 and no row written. | test/voice-tools.test.ts |
| C-0303 | tools | auth | Given the right secret, then the tool runs. | test/voice-tools.test.ts |
| C-0304 | tools | auth | Given 3 wrong-secret calls within a minute, then an incident `tool_auth_failures` is created once (fingerprinted). | test/voice-tools.test.ts |
| C-0305 | tools | auth | Given the secret compared, then comparison is constant-time (uses `timingSafeEqual`). | test/voice-tools.test.ts |
| C-0306 | tools | auth | Given `VOICE_TOOL_SECRET` unset in env, then every tool returns 503 and `/api/health` says `voice_tools: unconfigured`. | test/voice-tools.test.ts |
| C-0307 | tools | session | Given a `conversation_id` with no session, then a session is created `mode=call, provider=elevenlabs` and the tool proceeds. | test/voice-tools.test.ts |
| C-0308 | tools | session | Given the created-on-the-fly session, then when init later arrives for the same id, the rows merge (no duplicate session). | test/voice-tools.test.ts |
| C-0309 | tools | session | Given 61 tool calls within a minute for one conversation, then the 61st returns 429 `{ok:false, reason:"rate_limited"}`. | test/voice-tools.test.ts |
| C-0310 | tools | session | Given a missing `conversation_id`, then 400 `{ok:false, reason:"no_conversation"}`. | test/voice-tools.test.ts |
| C-0311 | tools | session | Given a tool call for a session whose outcome is `declined_consent`, then `{ok:false, reason:"declined"}` and nothing written. | test/voice-tools.test.ts |
| C-0312 | tools | session | Given a tool call after the post-call transcript was ingested, then it is accepted and flagged `late_tool_call`. | test/voice-tools.test.ts |
| C-0313 | tools | save_fact | Given a valid call `{rel:"earns", label:"monthly_income", value_text:"about twelve thousand", value_num:12000, unit:"ZAR", per:"month", confidence:"agent"}`, then a `facts` row exists with those values, `source="tool"`, `status="active"`. | test/voice-tools.test.ts |
| C-0314 | tools | save_fact | Given the tool call, then the response is `{saved:true, id}` within 2 s. | test/voice-tools.test.ts |
| C-0315 | tools | save_fact | Given the tool call arrives before any turns exist, then `turn_id` is a placeholder turn `role=client, text="[pending]"` with `t_start_secs` = seconds since session start, resolved at ingest to the real client turn nearest in time. | test/voice-tools.test.ts |
| C-0316 | tools | save_fact | Given ingest resolves placeholders, then no `[pending]` turns remain and every tool-sourced fact points at a real client turn. | test/ingest.test.ts |
| C-0317 | tools | save_fact | Given ingest cannot find a client turn within 30 s of the placeholder, then the fact is marked `status=refused, reason=no_turn` and logged. | test/ingest.test.ts |
| C-0318 | tools | save_fact | Given `value_num` is a string "12000", then it is coerced to 12000. | test/voice-tools.test.ts |
| C-0319 | tools | save_fact | Given `value_num` is negative, then refused `bad_value`. | test/voice-tools.test.ts |
| C-0320 | tools | save_fact | Given `value_text` longer than 200 chars, then truncated to 200. | test/voice-tools.test.ts |
| C-0321 | tools | save_fact | Given `per` not in (month, year, each), then `per` is nulled, fact kept. | test/voice-tools.test.ts |
| C-0322 | tools | save_fact | Given `confidence` not in (agent, confirmed), then defaults to `agent`. | test/voice-tools.test.ts |
| C-0323 | tools | save_fact | Given `rel=consent, label=recording, value_text=yes`, then a `consents` row `granted=true, kind=recording, method=voice` is written as well as the fact. | test/voice-tools.test.ts |
| C-0324 | tools | save_fact | Given `rel=consent` with `value_text=no`, then `consents.granted=false` and `sessions.outcome=declined_consent`. | test/voice-tools.test.ts |
| C-0325 | tools | save_fact | Given `rel=wants, label=funeral_cover`, then `label` is validated against the need kinds list. | test/voice-tools.test.ts |
| C-0326 | tools | save_fact | Given `value_text` contains a 13-digit run, then `{saved:false, reason:"identifier"}` and a `fact_refusals` row. | test/voice-tools.test.ts |
| C-0327 | tools | save_fact | Given `label` contains a 16-digit run, then refused `identifier`. | test/voice-tools.test.ts |
| C-0328 | tools | save_fact | Given `value_text` matches "policy number", then refused `identifier`. | test/voice-tools.test.ts |
| C-0329 | tools | save_fact | Given an identifier refusal, then `safety_events(check=identifier_offered)` is written for the session. | test/voice-tools.test.ts |
| C-0330 | tools | save_fact | Given an identifier refusal, then the raw payload is stored in `fact_refusals.raw` with the identifier digits replaced by `[redacted]`. | test/voice-tools.test.ts |
| C-0331 | tools | save_fact | Given `rel="favourite_colour"`, then `{saved:false, reason:"relation"}`. | test/voice-tools.test.ts |
| C-0332 | tools | save_fact | Given `rel="is", label="shoe_size"`, then refused `relation`. | test/voice-tools.test.ts |
| C-0333 | tools | save_fact | Given `rel="has_cover", label="life"`, then accepted (category id). | test/voice-tools.test.ts |
| C-0334 | tools | save_fact | Given `rel="has_cover", label="Life Cover"`, then label normalised to `life`. | test/voice-tools.test.ts |
| C-0335 | tools | save_fact | Given a second `save_fact` for the same `rel/label` with `confidence=confirmed`, then the first row is `superseded` and the new row active `confirmed`. | test/voice-tools.test.ts |
| C-0336 | tools | save_fact | Given a second `save_fact` for the same `rel/label` with `confidence=agent` and a different value, then the first is superseded (latest statement wins mid-call). | test/voice-tools.test.ts |
| C-0337 | tools | save_fact | Given a second `save_fact` identical in value, then no new row; `last_seen` updated. | test/voice-tools.test.ts |
| C-0338 | tools | save_fact | Given `has_cover/funeral` then `lacks_cover/funeral`, then the `has_cover` is superseded (they are the same slot). | test/voice-tools.test.ts |
| C-0339 | tools | save_fact | Given `owes/credit_card` twice with different balances, then the first is superseded: a debt kind is one slot. | test/voice-tools.test.ts |
| C-0340 | tools | check_existing_cover | Given a known client with active `has_cover/funeral` from a prior session, then `{known:"yes", detail:"funeral cover (Demo Funeral Society, R30,000)"}` without amounts the client never said. | test/voice-tools.test.ts |
| C-0341 | tools | check_existing_cover | Given no prior fact, then `{known:"no"}`. | test/voice-tools.test.ts |
| C-0342 | tools | check_existing_cover | Given the prior fact is `superseded`, then `{known:"no"}`. | test/voice-tools.test.ts |
| C-0343 | tools | check_existing_cover | Given the prior fact is `lacks_cover`, then `{known:"yes", detail:"no funeral cover"}`. | test/voice-tools.test.ts |
| C-0344 | tools | check_existing_cover | Given a forgotten client, then `{known:"no"}`. | test/voice-tools.test.ts |
| C-0345 | tools | check_existing_cover | Given an unknown category, then `{known:"no", reason:"unknown_category"}`. | test/voice-tools.test.ts |
| C-0346 | tools | check_existing_cover | Given the call, then the response contains no premium figure (prices never cross into the call). | test/voice-tools.test.ts |
| C-0347 | tools | lookup_categories | Given phrase "something for my kids' school", then `{categories:["Education saver"]}` (keyword hit). | test/voice-tools.test.ts |
| C-0348 | tools | lookup_categories | Given phrase "if I die", then includes "Life cover" and "Funeral cover". | test/voice-tools.test.ts |
| C-0349 | tools | lookup_categories | Given a phrase with no hit, then `{categories:[]}`. | test/voice-tools.test.ts |
| C-0350 | tools | lookup_categories | Given the response, then it contains no digits and no provider names (regex over the JSON). | test/voice-tools.test.ts |
| C-0351 | tools | lookup_categories | Given the broker has their own catalogue rows, then only categories present in the broker's rows (plus demo rows for categories the broker lacks) are returned. | test/voice-tools.test.ts |
| C-0352 | tools | lookup_categories | Given inactive products only in a category, then that category is not returned. | test/voice-tools.test.ts |
| C-0353 | tools | lookup_categories | Given the tool is called, then `turns.tool_calls` at ingest shows it (for the checker's offer rules). | test/ingest.test.ts |
| C-0354 | tools | request_callback | Given `{reason, preferred_time}`, then a `callbacks` row exists with the session and the text. | test/voice-tools.test.ts |
| C-0355 | tools | request_callback | Given the callback, then the broker notification at ingest includes "Callback requested: {preferred_time}". | test/journey.e2e.test.ts |
| C-0356 | tools | request_callback | Given `preferred_time` is free text, then it is stored as text (no date parsing). | test/voice-tools.test.ts |
| C-0357 | tools | request_callback | Given the callback, then `sessions.outcome` is unchanged. | test/voice-tools.test.ts |
| C-0358 | tools | mark_hardship | Given `{quote}`, then `sessions.mode="stabilising"`. | test/voice-tools.test.ts |
| C-0359 | tools | mark_hardship | Given `{quote}`, then a `hardship_notes` row holds the quote (redacted). | test/voice-tools.test.ts |
| C-0360 | tools | mark_hardship | Given `mark_hardship`, then `safety_events(check=hardship_marked, engine=rules)`. | test/voice-tools.test.ts |
| C-0361 | tools | mark_hardship | Given `mark_hardship` twice, then one note with two quotes. | test/voice-tools.test.ts |
| C-0362 | tools | mark_hardship | Given `mark_hardship`, then subsequent `save_fact` for `budget` or `beneficiaries` is accepted but flagged `after_hardship`. | test/voice-tools.test.ts |
| C-0363 | tools | mark_hardship | Given `mark_hardship`, then the pipeline later skips needs/matching (B6 C-0753). | test/journey.e2e.test.ts |
| C-0364 | tools | set_channel | Given `{channel:"email", address:"thandi@example.test"}`, then `clients.email` set, `clients.preferred_channel="email"`, `sessions.channel_chosen="email"`, `{ok:true}`. | test/voice-tools.test.ts |
| C-0365 | tools | set_channel | Given `{channel:"whatsapp", address:"0821234567"}`, then `clients.phone_e164="+27821234567"` if the client had none, else `clients.whatsapp_e164` set and `safety_events(channel_differs_from_caller)` when different. | test/voice-tools.test.ts |
| C-0366 | tools | set_channel | Given `{channel:"none"}`, then `channel_chosen="none"` and `{ok:true}`. | test/voice-tools.test.ts |
| C-0367 | tools | set_channel | Given `channel:"sms"`, then `{ok:false, reason:"invalid_channel"}`. | test/voice-tools.test.ts |
| C-0368 | tools | set_channel | Given `address:"thandi at example dot test"`, then normalised to `thandi@example.test`. | test/voice-tools.test.ts |
| C-0369 | tools | set_channel | Given `address:"THANDI@Example.Test"`, then stored lower-cased. | test/voice-tools.test.ts |
| C-0370 | tools | set_channel | Given a second `set_channel` with a different address, then the latest wins and the earlier is kept in `audit_log`. | test/voice-tools.test.ts |
| C-0371 | tools | set_channel | Given `set_channel` writes contact consent, then `consents(kind=contact, granted=true)` with the turn. | test/voice-tools.test.ts |
| C-0372 | tools | set_channel | Given the tool payload includes extra unknown fields, then they are ignored and logged once. | test/voice-tools.test.ts |
