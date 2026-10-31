# 09 — The broker dashboard (`api/app.ts`, `auth.ts`, `roa.ts`, `forget.ts`, `catalogue.ts`)

Owner: `test/auth.test.ts`, `test/app.test.ts`, `test/roa.test.ts`, `test/forget.test.ts`, `test/catalogue.test.ts`. Pages are tested by calling the handler with a fake request and asserting on the HTML/JSON.

| id | area | journey | criterion | owner |
|---|---|---|---|---|
| C-1100 | auth | login | Given `POST /app/login` with a known broker user email, then a `login_codes` row with `code_hash` (sha256 + `SESSION_SECRET`), `expires_at = now + 15 min`, and one email with the 6-digit code and a magic link. | test/auth.test.ts |
| C-1101 | auth | login | Given the code entered within 15 min, then `sessions_auth` row and `Set-Cookie: call_session=…; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`. | test/auth.test.ts |
| C-1102 | auth | login | Given the magic link clicked, then same as entering the code. | test/auth.test.ts |
| C-1103 | auth | login | Given the code after 15 min, then 401 "expired" and no session. | test/auth.test.ts |
| C-1104 | auth | login | Given the code used twice, then the second is 401 "used". | test/auth.test.ts |
| C-1105 | auth | login | Given the cookie, then `/app` renders the broker's list. | test/auth.test.ts |
| C-1106 | auth | login | Given no cookie, then `/app` redirects to `/app/login`. | test/auth.test.ts |
| C-1107 | auth | login | Given a tampered cookie, then redirect and the tamper is logged. | test/auth.test.ts |
| C-1108 | auth | login | Given logout, then `sessions_auth` row deleted and cookie cleared. | test/auth.test.ts |
| C-1109 | auth | login | Given the code email, then it contains no other personal data. | test/auth.test.ts |
| C-1110 | auth | login | Given `broker_users.last_login_at`, then updated on login. | test/auth.test.ts |
| C-1111 | auth | login | Given 30 days pass, then the session expires and `/app` redirects. | test/auth.test.ts |
| C-1112 | auth | login | Given the email differs only in case, then matched. | test/auth.test.ts |
| C-1113 | auth | login | Given Resend is down at login, then the page says "could not send the code, try again in a minute" and no code row is left usable. | test/auth.test.ts |
| C-1114 | auth | login | Given the code is 6 digits from `crypto.randomInt`, then never from `Math.random`. | test/auth.test.ts |
| C-1115 | auth | login | Given an unknown email, then the same response text as for a known one and no email sent. | test/auth.test.ts |
| C-1116 | auth | login | Given 6 wrong codes for one email within 15 min, then the 7th attempt is 429 even if correct, for 15 min. | test/auth.test.ts |
| C-1117 | auth | login | Given 10 login requests for one email within an hour, then 429. | test/auth.test.ts |
| C-1118 | auth | login | Given the lockout, then `audit_log(action=login_lockout)`. | test/auth.test.ts |
| C-1119 | auth | login | Given a request with an `X-Forwarded-For` of many IPs, then the rate key is the email, not the IP. | test/auth.test.ts |
| C-1120 | auth | login | Given a broker user `role=user`, then `/app/settings` is 403. | test/auth.test.ts |
| C-1121 | app | list | Given 3 sessions for this broker and 2 for another, then `/app` lists 3. | test/app.test.ts |
| C-1122 | app | list | Given the list, then columns: time (SAST), client first name or "Unknown caller", mode icon, duration, status pill, unconfirmed count, cost. | test/app.test.ts |
| C-1123 | app | list | Given a `declined_consent` session, then pill "Declined" and no client name. | test/app.test.ts |
| C-1124 | app | list | Given a stabilising session, then pill "Hardship" in amber. | test/app.test.ts |
| C-1125 | app | list | Given a `held` quote, then pill "Held — review". | test/app.test.ts |
| C-1126 | app | list | Given `awaiting_broker`, then pill "Ready to approve". | test/app.test.ts |
| C-1127 | app | list | Given `sent/delivered/read`, then the pill reflects the latest delivery status. | test/app.test.ts |
| C-1128 | app | list | Given `/app/calls.json`, then the same rows as JSON for polling, broker-scoped. | test/app.test.ts |
| C-1129 | app | list | Given the page, then it polls `/app/calls.json` every 20 s (script present, interval 20000). | test/app.test.ts |
| C-1130 | app | list | Given 200 sessions, then paginated 50 per page with "older" link. | test/app.test.ts |
| C-1131 | app | list | Given a search box, then filters by client first name or phone suffix (last 4). | test/app.test.ts |
| C-1132 | app | list | Given the cost column, then the sum of `usage_ledger.cost_cents` for the session shown in both currencies, "R 14 ($0.78)", converted with `USD_ZAR` (env, default 18). | test/app.test.ts |
| C-1133 | app | list | Given a session in progress (init done, no transcript yet), then pill "On the call…" with a live duration counter. | test/app.test.ts |
| C-1134 | app | list | Given a failed pipeline, then pill "Failed — retry" linking to the retry action. | test/app.test.ts |
| C-1135 | app | scope | Given `/app/calls/{id}` for another broker's session, then 404. | test/app.test.ts |
| C-1136 | app | scope | Given `/app/clients/{id}` for another broker, then 404. | test/app.test.ts |
| C-1137 | app | scope | Given an action POST referencing another broker's quote id, then 404 and nothing changes. | test/app.test.ts |
| C-1138 | app | scope | Given any query in `app.ts`, then `broker_id` comes from the session, never from the request (static grep test over `app.ts` for `req.*broker_id`). | test/app.test.ts |
| C-1139 | app | detail | Given a session with turns, then the page lists every turn with role, `mm:ss` timestamp and text. | test/app.test.ts |
| C-1140 | app | detail | Given a recording, then an `<audio>` element with a signed URL (72 h). | test/app.test.ts |
| C-1141 | app | detail | Given a turn, then clicking its timestamp seeks the player (`data-t` attribute + script). | test/app.test.ts |
| C-1142 | app | detail | Given the recording was deleted by retention, then "Recording deleted after {n} days" and no player. | test/app.test.ts |
| C-1143 | app | detail | Given no recording yet (audio event pending), then "Recording arriving…". | test/app.test.ts |
| C-1144 | app | detail | Given redacted text, then `[redacted]` is shown as such with a tooltip. | test/app.test.ts |
| C-1145 | app | detail | Given `provider_summary`, then shown in a box labelled "ElevenLabs summary (not checked)". | test/app.test.ts |
| C-1146 | app | detail | Given a tool call on a turn, then a small chip "saved: earns/monthly_income". | test/app.test.ts |
| C-1147 | app | detail | Given the session is a meeting, then turns show `broker`/`client`/`unknown` labels with a toggle to relabel `unknown`. | test/app.test.ts |
| C-1148 | app | detail | Given the page, then every ▶ link in the facts panel points to the right `data-t`. | test/app.test.ts |
| C-1149 | app | facts | Given the facts panel, then grouped by rel with status, confidence badge, value, "▶ mm:ss". | test/app.test.ts |
| C-1150 | app | facts | Given action `tick` on an `agent` fact, then `confidence=broker`, `audit_log` with user. | test/app.test.ts |
| C-1151 | app | facts | Given action `untick` on a `confirmed` fact, then a reason is required; the fact becomes `status=superseded` with `supersedes_id=null` and a `broker` note. | test/app.test.ts |
| C-1152 | app | facts | Given action `edit` with a new value, then a new fact `source=broker, confidence=broker` superseding the old; `turn_id` = the old fact's turn. | test/app.test.ts |
| C-1153 | app | facts | Given action `add` with rel/label/value and a reason, then a `broker` fact with `turn_id` = a synthetic `broker_note` turn appended to the session. | test/app.test.ts |
| C-1154 | app | facts | Given `add` with an identifier, then 422 `identifier` (brokers are bound by R11 too). | test/app.test.ts |
| C-1155 | app | facts | Given any fact change, then `analyse_needs → match → write → check` re-run and a new quote version is created if anything changed. | test/app.test.ts |
| C-1156 | app | facts | Given no material change (tick only), then no new version. | test/app.test.ts |
| C-1157 | app | facts | Given a refused fact, then shown collapsed under "Not used (why)" with the reason. | test/app.test.ts |
| C-1158 | app | facts | Given an ElevenLabs DC value that disagrees, then shown beside ours as "ElevenLabs heard: …". | test/app.test.ts |
| C-1159 | app | facts | Given `add` by a `role=user`, then allowed (facts are not settings). | test/app.test.ts |
| C-1160 | app | facts | Given the panel, then superseded facts are shown struck through under a toggle. | test/app.test.ts |
| C-1161 | app | facts | Given the tick action payload is missing CSRF, then 403. | test/app.test.ts |
| C-1162 | app | facts | Given a fact edit on a session whose quote is already `sent`, then allowed and the new version is "not sent" with a clear label. | test/app.test.ts |
| C-1163 | app | facts | Given `edit` of a money value "12 000", then parsed to 12000. | test/app.test.ts |
| C-1164 | app | facts | Given `edit` with a non-number for a numeric label, then 422. | test/app.test.ts |
| C-1165 | app | facts | Given the facts panel, then `approx` facts show "about". | test/app.test.ts |
| C-1166 | app | facts | Given a `consent` fact, then it is shown in the header, not the panel. | test/app.test.ts |
| C-1167 | app | facts | Given the facts panel for a meeting, then every `transcript` fact has an untick/tick pair and a count "7 to confirm". | test/app.test.ts |
| C-1168 | app | facts | Given all cited facts ticked, then the approve button is enabled (server-side check still applies). | test/app.test.ts |
| C-1169 | app | recs | Given a recommendation, then a "Swap" control listing only `considered` products that qualified (reason "more expensive" etc.), never products excluded by eligibility. | test/app.test.ts |
| C-1170 | app | recs | Given swap, then a new version with the chosen product, premium recomputed by `premiumFor`, `audit_log`. | test/app.test.ts |
| C-1171 | app | recs | Given swap to an excluded product via a forged id, then 422 `not_eligible`. | test/app.test.ts |
| C-1172 | app | recs | Given "Edit cover", then within product min/max; else 422. | test/app.test.ts |
| C-1173 | app | recs | Given edit cover, then premium recomputed and the writer re-run for that block only. | test/app.test.ts |
| C-1174 | app | recs | Given "Remove" with a reason, then `status=removed`, moved to `considered` in the document with the broker's reason. | test/app.test.ts |
| C-1175 | app | recs | Given "Restore", then back to draft and a new version. | test/app.test.ts |
| C-1176 | app | recs | Given "Re-match", then `match` re-runs against the current catalogue and facts; version n+1. | test/app.test.ts |
| C-1177 | app | recs | Given any recs change, then the checker re-runs and the status reflects it. | test/app.test.ts |
| C-1178 | app | recs | Given the broker types a new `why`, then it is checked (numbers, claims) before save. | test/app.test.ts |
| C-1179 | app | recs | Given a null-product recommendation, then the control is "Pick a product" from qualified ones, or "Leave unmatched". | test/app.test.ts |
| C-1180 | app | recs | Given a recommendation block, then it shows `premium_basis` on hover (band, rate, verified_on). | test/app.test.ts |
| C-1181 | app | status | Given "Hold" with a note, then `status=held`, `checker_report.broker_note`. | test/app.test.ts |
| C-1182 | app | status | Given "Decline" with a reason, then `status=declined`, no delivery ever. | test/app.test.ts |
| C-1183 | app | status | Given outcome "accepted", then `quotes.outcome`, `outcome_at`. | test/app.test.ts |
| C-1184 | app | status | Given outcome "replaced", then a link to the new quote id is required. | test/app.test.ts |
| C-1185 | app | status | Given outcome set, then the list shows it. | test/app.test.ts |
| C-1186 | app | status | Given "Decline" after `sent`, then 409 (cannot decline what was sent; use outcome). | test/app.test.ts |
| C-1187 | app | status | Given every status action, then `audit_log` before/after. | test/app.test.ts |
| C-1188 | app | status | Given a `callbacks` row, then a "Callback requested" banner with the preferred time and a "Done" tick. | test/app.test.ts |
| C-1189 | app | status | Given a hardship session, then the page shows the client's words, the suggested next step, and a "Called the client" tick that writes `hardship_notes.called_at`. | test/app.test.ts |
| C-1190 | app | status | Given the `/app/costs` month total, then it matches the ledger sum (test with 3 sessions). | test/app.test.ts |
| C-1191 | roa | export | Given "Export record of advice", then an HTML document (R8) with title "Record of advice", broker, FSP, broker user name, date/time, client first name. | test/roa.test.ts |
| C-1192 | roa | export | Given the ROA, then section "Information the advice was based on" lists every active fact with its confidence and `mm:ss` turn reference (s9(a)). | test/roa.test.ts |
| C-1193 | roa | export | Given the ROA, then "Products considered" lists every considered product with reason (s9(b)). | test/roa.test.ts |
| C-1194 | roa | export | Given the ROA, then "Products recommended and why" with the `why` and the need basis (s9(c)). | test/roa.test.ts |
| C-1195 | roa | export | Given a replacement, then "Replacement disclosure" section (s9(d)); else a line "No existing product is replaced". | test/roa.test.ts |
| C-1196 | roa | export | Given the ROA, then "Consent" section with the recording consent turn and the contact consent. | test/roa.test.ts |
| C-1197 | roa | export | Given the ROA, then "Checks" section listing `safety_events` outcomes for the session. | test/roa.test.ts |
| C-1198 | roa | export | Given the ROA, then broker edits are listed with user and time (audit rows for the session). | test/roa.test.ts |
| C-1199 | roa | export | Given the ROA HTML, then no grid/flex/var()/external CSS (same grep as the quote). | test/roa.test.ts |
| C-1200 | roa | export | Given the ROA, then a PDF variant via `/api/render-pdf` on request. | test/roa.test.ts |
| C-1201 | roa | export | Given the export, then `audit_log(action=export_roa)`. | test/roa.test.ts |
| C-1202 | roa | export | Given a hardship session, then the ROA says "No advice given — hardship" and includes the note. | test/roa.test.ts |
| C-1203 | roa | export | Given a declined-consent session, then export is 404. | test/roa.test.ts |
| C-1204 | roa | export | Given the ROA, then the demo notice if demo products. | test/roa.test.ts |
| C-1205 | forget | client | Given "Forget this client" then a confirm page naming counts (sessions, facts, recordings). | test/forget.test.ts |
| C-1206 | forget | client | Given confirm, then a `forget_client` job. | test/forget.test.ts |
| C-1207 | forget | client | Given the job, then Storage files under every session are deleted first. | test/forget.test.ts |
| C-1208 | forget | client | Given the job, then rows in turns, facts, fact_refusals, needs, recommendations, quotes, deliveries, consents, hardship_notes, callbacks, client_messages, recordings, sessions are deleted for the client. | test/forget.test.ts |
| C-1209 | forget | client | Given the job, then `clients.phone_e164`, `email`, `first_name`, `last_name` are nulled and `forgotten_at` set; the row remains. | test/forget.test.ts |
| C-1210 | forget | client | Given the job, then `audit_log(action=forget_client, after={counts})` with no personal data. | test/forget.test.ts |
| C-1211 | forget | client | Given the job, then `usage_ledger` rows remain but with `session_id` nulled (cost history without identity). | test/forget.test.ts |
| C-1212 | forget | client | Given the job, then `safety_events` rows for the sessions are deleted. | test/forget.test.ts |
| C-1213 | forget | client | Given the job, then `webhook_events.raw` for those conversations is nulled. | test/forget.test.ts |
| C-1214 | forget | client | Given a job step fails midway, then retry resumes idempotently (deleting what is left). | test/forget.test.ts |
| C-1215 | forget | client | Given completion, then `/app/clients/{id}` shows "Forgotten on {date}". | test/forget.test.ts |
| C-1216 | forget | client | Given the same phone calls again, then a new client row is created (unique index excludes forgotten rows because `phone_e164` is null). | test/forget.test.ts |
| C-1217 | catalogue | csv | Given a CSV with the documented columns, then rows are validated and inserted with `broker_id` = this broker, `is_demo=false`. | test/catalogue.test.ts |
| C-1218 | catalogue | csv | Given one bad row, then nothing is inserted and the response lists row numbers and errors. | test/catalogue.test.ts |
| C-1219 | catalogue | csv | Given a missing `verified_on`, then error "verified_on required". | test/catalogue.test.ts |
| C-1220 | catalogue | csv | Given `verified_on` in the future, then error. | test/catalogue.test.ts |
| C-1221 | catalogue | csv | Given an unknown `category_id`, then error listing valid ids. | test/catalogue.test.ts |
| C-1222 | catalogue | csv | Given `min_age > max_age`, then error. | test/catalogue.test.ts |
| C-1223 | catalogue | csv | Given a pricing row with overlapping bands for one product, then error. | test/catalogue.test.ts |
| C-1224 | catalogue | csv | Given `eligibility` JSON that does not parse, then error with the position. | test/catalogue.test.ts |
| C-1225 | catalogue | csv | Given `eligibility` referencing an unknown fact path, then error listing valid paths. | test/catalogue.test.ts |
| C-1226 | catalogue | csv | Given a re-upload with the same `external_id`, then the row is updated in place (upsert), `verified_on` refreshed. | test/catalogue.test.ts |
| C-1227 | catalogue | csv | Given a product in the CSV marked `active=false`, then deactivated, not deleted. | test/catalogue.test.ts |
| C-1228 | catalogue | csv | Given the upload, then demo rows (`broker_id IS NULL`) are untouched. | test/catalogue.test.ts |
| C-1229 | catalogue | csv | Given the upload, then `audit_log(action=catalogue_upload, after={inserted, updated, deactivated})`. | test/catalogue.test.ts |
| C-1230 | catalogue | csv | Given a 5 MB CSV, then rejected "too large" (limit 2 MB). | test/catalogue.test.ts |
| C-1231 | catalogue | csv | Given any provider name in a broker upload, then it is accepted and the row is `is_demo=false` (no blocklist; the broker is responsible for their own catalogue). | test/catalogue.test.ts |
| C-1232 | catalogue | csv | Given a `summary` over 60 words, then error. | test/catalogue.test.ts |
| C-1233 | catalogue | csv | Given a `summary` containing a number, then warning "numbers in summaries are shown as-is and must be in the pricing table" and the row is accepted only if the number appears in that product's pricing or cover limits. | test/catalogue.test.ts |
| C-1234 | catalogue | csv | Given the settings page, then a downloadable CSV template with headers and one example row. | test/app.test.ts |
| C-1235 | catalogue | csv | Given the upload by `role=user`, then 403. | test/catalogue.test.ts |
| C-1236 | catalogue | csv | Given the upload succeeds, then `/api/health.catalogue` counts update. | test/health.test.ts |
| C-1237 | settings | auto_send | Given the toggle, then the label "Demo only — sends without broker approval" is present. | test/app.test.ts |
| C-1238 | settings | auto_send | Given turning it on, then the form requires the broker name typed exactly. | test/app.test.ts |
| C-1239 | settings | auto_send | Given on, then `audit_log(action=auto_send_on)`. | test/app.test.ts |
| C-1240 | settings | auto_send | Given `role=user`, then 403. | test/app.test.ts |
| C-1241 | costs | page | Given `/app/costs`, then a table per session: minutes, LLM tokens, telephony, email, WhatsApp, transcription, total. | test/app.test.ts |
| C-1242 | costs | page | Given the page, then month totals and an average per completed call. | test/app.test.ts |
| C-1243 | costs | page | Given the page, then an "assumptions" box listing `ELEVENLABS_CENTS_PER_MINUTE`, `TELEPHONY_CENTS_PER_MINUTE`, `WHATSAPP_UTILITY_CENTS`, `USD_ZAR`. | test/app.test.ts |
| C-1244 | costs | page | Given `sessions.provider_cost` exists, then shown beside the estimate. | test/app.test.ts |
| C-1245 | costs | page | Given a CSV export link, then the ledger as CSV. | test/app.test.ts |
| C-1246 | costs | page | Given free-tier usage, then a line "Agent minutes this month: 11 of 15". | test/app.test.ts |
| C-1247 | costs | page | Given 80% of included minutes, then the line is amber; 100% red. | test/app.test.ts |
| C-1248 | costs | page | Given a forgotten client, then their costs appear as "Forgotten client". | test/app.test.ts |
| C-1249 | costs | page | Given the page, then broker-scoped. | test/app.test.ts |
| C-1250 | costs | page | Given the page, then no model slugs or provider ids shown (operator detail is on /admin). | test/app.test.ts |
| C-1251 | csrf | actions | Given a POST to `/app/actions` without the token, then 403. | test/app.test.ts |
| C-1252 | csrf | actions | Given a token from another session, then 403. | test/app.test.ts |
| C-1253 | csrf | actions | Given the right token, then the action runs. | test/app.test.ts |
| C-1254 | csrf | actions | Given a GET to `/app/actions`, then 405. | test/app.test.ts |
