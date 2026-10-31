### Task 2.3: Facts — `factUpdates()` and the slot rules

**Files:** Create `api/_lib/facts.ts`, `api/_lib/factkinds.ts` (the relation/label table from SPEC §7.3 with aliases: "funeral policy"→funeral, "own business"→self_employed, "bond"→home_loan, "RA"→retirement, "gap cover"→medical_gap, …), `test/facts.test.ts`, `test/_facts.ts` (helpers `fact(rel,label,value,opts)`, `clientTurn(idx,text)`).

**Interfaces:**
- `factUpdates(raw: unknown, turns: Turn[], opts: { source: "extract"|"tool"|"readback"|"broker"; today: string; sessionMode: SessionMode }): { kept: FactDraft[]; refused: { label: string; reason: RefusalReason; raw: unknown }[] }` implementing SPEC §7.3 rules 1–7; `RefusalReason = "relation"|"not_said"|"no_turn"|"ambiguous_turn"|"figure_not_said"|"negated"|"hypothetical"|"past"|"someone_else"|"identifier"|"not_a_kind"|"over_cap"|"bad_value"`.
- `slotOf(rel, label): string` (has_cover/lacks_cover share a slot per category; owes per kind; is per label).
- `applyFacts(sessionId, clientId, drafts: FactDraft[]): Promise<{ inserted: number; superseded: number }>` — supersede-by-slot, `supersedes_id`, idempotent on identical value (`last_seen` only).
- `confirmReadback(sessionId, readbackTurn: Turn, clientReply: Turn): Promise<{ confirmed: number; incomplete: string[] }>` (C-0595, C-0596, C-0599).
- `applyCorrection(sessionId, correctionTurn: Turn, proposals: FactDraft[])` (C-0591–C-0600).

- [ ] **Step 1: Failing tests** every row C-0500…C-0562, C-0591…C-0600, C-0615, C-0226, C-0261, C-0262, C-0267–C-0269, C-0271, C-0274–C-0276, C-0335–C-0339 (slot semantics; the HTTP side is Task 3.2), C-1346, C-1435.
- [ ] **Step 2–4.** **Step 5: Commit** `Facts: keep only what the client said, with the turn that says it`

