# 01 — Before the call connects (`POST /api/voice/init`)

Owning test: `test/voice-init.test.ts` unless stated.

| id | area | journey | criterion | owner |
|---|---|---|---|---|
| C-0001 | init | call-in | Given a known client (same broker, same E.164 phone), when init arrives with that `caller_id`, then the response is HTTP 200 JSON with `dynamic_variables.known_client = "yes"`. | test/voice-init.test.ts |
| C-0002 | init | call-in | Given a known client with `first_name`, when init arrives, then `dynamic_variables.client_first_name` equals that first name. | test/voice-init.test.ts |
| C-0003 | init | call-in | Given any init, then `dynamic_variables.agent_name`, `broker_name`, `fsp_number` equal the broker row's values. | test/voice-init.test.ts |
| C-0004 | init | call-in | Given any init, then `dynamic_variables.categories` is the comma-separated names of this broker's active product categories (shared demo rows included when the broker has none). | test/voice-init.test.ts |
| C-0005 | init | call-in | Given any valid init, then a `sessions` row exists with `mode = "call"`, `provider = "elevenlabs"`, `conversation_id` from the request, `caller_id_raw` as received. | test/voice-init.test.ts |
| C-0006 | init | call-in | Given init, then the handler answers in under 1,000 ms against the fake DB (measured in test with a 50 ms simulated DB latency). | test/voice-init.test.ts |
| C-0007 | init | call-in | Given `caller_id` in national format (`0821234567`), then it is normalised to `+27821234567` before lookup. | test/voice-init.test.ts |
| C-0008 | init | call-in | Given `caller_id` with spaces or dashes, then normalisation strips them. | test/voice-init.test.ts |
| C-0009 | init | call-in | Given a known client who is `forgotten_at IS NOT NULL`, then `known_client = "no"` and `client_first_name = ""`. | test/voice-init.test.ts |
| C-0010 | init | call-in | Given init, then the response contains no field other than `type`, `dynamic_variables` and `conversation_config_override`. | test/voice-init.test.ts |
| C-0011 | init | call-in | Given init, then `conversation_config_override` contains only `agent.first_message` (never prompt or language). | test/voice-init.test.ts |
| C-0012 | init | call-in | Given init for a known client, then `first_message` begins "Hi {first name}, this is {agent name}". | test/voice-init.test.ts |
| C-0013 | init | call-in | Given an unknown caller, then `known_client = "no"`. | test/voice-init.test.ts |
| C-0014 | init | call-in | Given an unknown caller, then a `clients` row is created with `phone_e164` normalised and `broker_id` from the agent id. | test/voice-init.test.ts |
| C-0015 | init | call-in | Given two inits from the same unknown caller 1 s apart, then exactly one `clients` row exists. | test/voice-init.test.ts |
| C-0016 | init | call-in | Given an unknown caller, then `first_message` is the generic §1 wording with no name. | test/voice-init.test.ts |
| C-0017 | init | web | Given init with empty `caller_id` and no dynamic variables, then the session is `mode = "web"` and `known_client = "no"`. | test/voice-init.test.ts |
| C-0018 | init | web | Given the demo page passed `client_name` and `client_phone` as dynamic variables, then a client row is upserted from them and `known_client` reflects it. | test/voice-init.test.ts |
| C-0019 | init | web | Given `client_phone` from the demo page is not a valid ZA number, then no client row is created and the session still starts. | test/voice-init.test.ts |
| C-0020 | init | web | Given a web init, then `caller_id_raw` is null and `sessions.provider = "elevenlabs"`. | test/voice-init.test.ts |
| C-0021 | init | web | Given a web init with `client_name` longer than 60 chars, then it is truncated to 60. | test/voice-init.test.ts |
| C-0022 | init | failure | Given the DB throws on lookup, then the response is still 200 with `known_client = "no"` and the broker defaults from env. | test/voice-init.test.ts |
| C-0023 | init | failure | Given the DB throws, then a `safety_events` row `check = "init_degraded"` is written when the DB recovers, else an incident is tracked in memory and flushed later. | test/voice-init.test.ts |
| C-0024 | init | failure | Given a malformed JSON body, then 200 with defaults (never 4xx, because a non-200 can stop the call). | test/voice-init.test.ts |
| C-0025 | init | failure | Given a missing `agent_id`, then 200 with defaults and incident `init_no_agent`. | test/voice-init.test.ts |
| C-0026 | init | failure | Given a GET request, then 405. | test/voice-init.test.ts |
| C-0027 | init | failure | Given the response would exceed 200 KB (pathological categories list), then categories are truncated to fit under 256 KB. | test/voice-init.test.ts |
| C-0028 | init | failure | Given init takes longer than 2 s internally, then the handler returns defaults at 2 s and finishes the DB write in the background. | test/voice-init.test.ts |
| C-0029 | init | failure | Given `agent_id` matches no broker, then defaults from env and incident `agent_mismatch`. | test/voice-init.test.ts |
| C-0030 | init | failure | Given `agent_id` matches a broker but the called number differs from `brokers.phone_number_e164`, then the broker's variables are still used and `safety_events` `number_mismatch` is written. | test/voice-init.test.ts |
