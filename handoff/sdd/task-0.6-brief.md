### Task 0.6: Chase Intelligence core

**Files:** Create `api/_lib/intel.ts` (port of Charlie `api/_lib/intel.ts` at commit `59b6cb4`, `APP = "call"`), `api/_lib/intelredact.ts` (port; add this deployment's secrets from `.env.example`, the `/q/…?sig=` signed-link shape, and the money-key allowlist for JSON numbers), `test/intel.test.ts`, `test/intel-redact.test.ts`. Modify `api/_lib/track.ts` (trace context carries `trace_id`, `session_id`, `client_id`, `broker_id`, `channel`, `stage`; every `track()`/`trackFailure()` also captures), `api/_lib/models.ts` (capture every attempt), `api/_lib/queue.ts` (capture job lifecycle; a job's context is its session's trace), `test/_fakes.ts` (an `intel_events` table; a switch to simulate the table missing).

**Interfaces:**
- `capture(kind: IntelKind, opts: { name: string; actor?: Actor; content?: unknown; meta?: Record<string, unknown>; ok?: boolean | null; ms?: number; channel?: Channel; turnId?: string }): void` — reads the trace context; never throws; never awaits.
- `withTrace<T>(ctx: { traceId: string; sessionId?: string; clientId?: string; brokerId?: string; channel?: Channel; stage?: string; jobId?: number; contentMode?: "full"|"meta" }, fn: () => Promise<T>): Promise<T>` (AsyncLocalStorage).
- `traceForSession(sessionId): string` → `"s_" + sessionId`; `requestTraceId(): string` → `"r_" + 16 hex`; `turnIdFor(sessionId, idx)`, `turnIdForWamid(wamid)`.
- `flushIntel(): Promise<{ written: number; dropped: number }>` (batches ≤ 500 rows / 1 MB; 3 attempts; missing-table backoff 10 min).
- `readTrace(id: string): Promise<IntelRow[]>`; `forgetIntel(clientId: string): Promise<number>` (written and buffered).
- `redactText(s)`, `redactJson(v)`, `redactDeep(v)` in `intelredact.ts`.
- `Channel = "phone"|"web"|"meeting"|"dashboard"|"email"|"whatsapp"|"system"`.

- [ ] **Step 1: Failing tests** C-1700–C-1716, C-1721, C-1722, C-1732, C-1733, C-1734, C-1736–C-1743, C-1745, C-1746, C-1753, C-1754 (unit form, against the fakes), C-1758, C-1765–C-1767.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (port, adapt per `docs/INTEL-PHASE0.md` §3). **Step 4: Run** `npm test` and `npm run test:intel` → PASS, same counts.
- [ ] **Step 5: Commit** `Chase Intelligence: one id per session, every task recorded whole`

**Phase 0 gate:** `npm run typecheck && npm test && npm run test:intel` green; criteria `--count --matrix` green. Push. Create `main` if missing; open the Phase 0 PR; merge when CI is green.

---

## Phase 1 — Database and seeds

