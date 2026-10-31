### Task 0.1: Environment, database client, and the in-memory fakes

**Files:**
- Create: `api/_lib/env.ts`, `api/_lib/db.ts`, `api/_lib/types.ts`, `test/_fakes.ts`, `test/_env.ts`, `test/fakes.test.ts`
- Port from: `../charlie/api/_lib/env.ts`, `../charlie/api/_lib/db.ts` (client creation only), `../charlie/test/_fakes.ts`

**Interfaces:**
- Produces: `env` (frozen snapshot of every variable in `.env.example`, with defaults as listed there); `db(): SupabaseClient` (service role); `installFakeDb(seed?)` returning `FakeDb { client, tables, log, reset() }` with tables for every table in SPEC §4; `installFakeNet()` returning `FakeNet { onModel(re, fn), onFetch(urlRe, fn), calls }` intercepting `fetch`; `fakeStorage()` with `upload/download/remove/list` and `files: Map<string, Uint8Array>`; `fakeClock(iso)` controlling `Date.now()`; `test/_env.ts` setting the fake env before any import (as Charlie's e2e tests do).
- Fake DB supports: `from().select().eq/is/in/gte/lt/order/limit/single/maybeSingle`, `insert`, `upsert` (with `onConflict`), `update().eq`, `delete().eq/in`, `rpc("claim_job")`, `storage.from(bucket)`; anything else throws `FakeDbUnsupported` naming the shape.

- [ ] **Step 1: Write the failing test** `test/fakes.test.ts`: `[C-1580]`-adjacent smoke — insert a `brokers` row, select it back, `upsert` with `onConflict: "broker_id,phone_e164"` twice yields one `clients` row; an unsupported shape (`.textSearch`) throws `FakeDbUnsupported`.
- [ ] **Step 2: Run** `npm test -- test/fakes.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement** `env.ts` (snapshot at import; `required(name)` helper), `db.ts` `db()`, `types.ts` (row types for SPEC §4 tables as TypeScript interfaces), `_fakes.ts` (port; add Storage and clock).
- [ ] **Step 4: Run** → PASS. `npm run typecheck` → clean.
- [ ] **Step 5: Commit** `Scaffold: env snapshot, db client, in-memory fakes`

