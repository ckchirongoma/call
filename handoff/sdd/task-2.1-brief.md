### Task 2.1: Figures

**Files:** Create `api/_lib/figures.ts`, `test/figures.test.ts`.

**Interfaces:**
- `figuresFrom(text: string, ctx?: { moneyContext?: boolean }): Set<number>` — every way of saying money in C-0563–C-0580; bare small numbers ("about ten") scaled ×1000 only when `moneyContext`.
- `ageFrom(text: string, today: Date): { age?: number; band?: AgeBand; approx: boolean } | null` (C-0581–C-0586).
- `countsFrom(text: string): { dependants?: number; children?: number; children_under_18?: number; parents?: number }` (C-0587–C-0590).
- `isApprox(text: string): boolean`; `rangeFrom(text): {min, max, mid} | null`; `bandFor(age): AgeBand`; `AgeBand = "18-24"|"25-34"|"35-44"|"45-54"|"55-64"|"65+"`.
- `formatRand(cents: number): string`; `parseMoneyInput(s: string): number | null` (dashboard inputs, C-1163).

- [ ] **Step 1: Failing tests** one `test()` per criterion C-0563…C-0590, C-0525, C-0526, C-0531, C-0532.
- [ ] **Step 2–4.** **Step 5: Commit** `Parse money, ages and counts the way South Africans say them`

