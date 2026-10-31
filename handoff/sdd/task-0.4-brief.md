### Task 0.4: Queue, tracking, alerts, email (ports)

**Files:** Create `api/_lib/queue.ts`, `api/_lib/track.ts`, `api/_lib/alerts.ts`, `api/_lib/email.ts`, `api/worker.ts`, `test/queue.test.ts`, `test/alerts.test.ts`. Port from Charlie's files of the same names; `email.ts` gains `sendEmailTo(msg & { to: string[]; replyTo?: string; attachments?: {filename: string; content: Buffer}[]; idempotencyKey?: string })`.

**Interfaces:**
- `enqueue(kind: JobKind, sessionId: string | null, payload: object, opts?: { runAfter?: Date; dedupeKey?: string }): Promise<string>`.
- `JobKind = "ingest_transcript"|"store_audio"|"extract_facts"|"analyse_needs"|"match"|"write_quote"|"check_quote"|"notify_broker"|"send_quote"|"forget_client"|"transcribe_meeting"|"label_speakers"`.
- `drain(opts: DrainOptions): Promise<DrainReport>`; `registerHandler(kind, fn: (job: JobRow, ctx: JobCtx) => Promise<void>)`.
- Fencing: `lock_timeout` 120 s, `touchJob` every 30 s, `stillOwnJob`, per-session serialisation, 3 parallel sessions, backoff 10/60/300 s, 3 attempts then `failed` + incident.
- `track(event, props)`, `trackFailure(event, message, {severity, alert, fingerprint, summary})`, `runAlerts()`; `incidents` table semantics as Charlie.
- `api/worker.ts`: `POST/GET /api/worker` with `WORKER_SECRET` or `CRON_SECRET` (`?tick=1`); 240 s budget; hand-on self-call.

- [ ] **Step 1: Failing tests** `[C-0485]…[C-0499]`, `[C-1597]…[C-1610]`, `[C-1541][C-1548][C-1550][C-1552]`.
- [ ] **Step 2–4.** **Step 5: Commit** `Port the job queue, tracking, alerts and email sender`

