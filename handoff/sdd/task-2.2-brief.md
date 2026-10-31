### Task 2.2: Redaction

**Files:** Create `api/_lib/redact.ts`, `test/redact.test.ts`.

**Interfaces:** `redact(text: string): { text: string; found: RedactionKind[] }` with `RedactionKind = "id_number"|"card"|"account"|"password"|"policy"`; `IDENTIFIER: RegExp` exported for `facts.ts`; `MEDICAL_TERMS: string[]`.

- [ ] **Step 1: Failing tests** `[C-0175]…[C-0182]`, `[C-1429][C-1430]` (the fixture sweep part is wired in Task 4.4; here, unit cases).
- [ ] **Step 2–4.** **Step 5: Commit** `Redact identifiers before anything is stored`

