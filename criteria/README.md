# Acceptance criteria

One criterion per table row. The id is the contract: a test proves a
criterion by carrying `[C-NNNN]` in its name, and `npm run criteria -- --check`
fails until every row here has one and every tag names a row.

Columns: `id | area | journey | criterion (given / when / then) | owning test file`.

| File | Area | Ids |
|---|---|---|
| `01-init.md` | Before the call connects | C-0001–C-0030 |
| `02-conversation.md` | The conversation (prompt rules, checked post-hoc) | C-0100–C-0300 |
| `03-tools.md` | Server tools during the call | C-0301–C-0372 |
| `04-ingest.md` | Post-call ingestion | C-0400–C-0499 |
| `05-facts.md` | Facts: extraction, refusals, figures, read-back | C-0500–C-0620 |
| `06-matching.md` | Needs, product selection, price, budget | C-0700–C-0850 |
| `07-quote.md` | Writing, checking, rendering the quotation | C-0900–C-0999 |
| `08-delivery.md` | Approve, email, WhatsApp, replies, auto-send | C-1000–C-1090 |
| `09-dashboard.md` | Login, lists, call detail, actions, settings, costs | C-1100–C-1254 |
| `10-meeting.md` | In-person mode | C-1300–C-1360 |
| `11-compliance.md` | Retention, forget, consent, minimality, record of advice, safety events | C-1400–C-1470 |
| `12-ops-security.md` | Model layer, health, alerts, limits, cron, RLS, links, webhooks, jobs | C-1500–C-1610 |

Writing a new criterion: pick the next free id in the file's range (ranges
have gaps on purpose), one observable behaviour per row, phrased so a test
can fail it. Never renumber.
