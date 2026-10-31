### Task 0.2: Webhook signature verifiers

**Files:** Create `api/_lib/crypto.ts`, `test/crypto.test.ts`. Port the HMAC helpers from `../charlie/api/_lib/crypto.ts`.

**Interfaces:**
- `verifyElevenLabs(raw: Buffer, header: string | null, secrets: string[], nowSecs?: number): { ok: boolean; reason?: "missing"|"malformed"|"stale"|"future"|"mismatch"; secretIndex?: number }` — header `t=<unix>,v0=<hex>[,v0=<hex>]`, HMAC-SHA256 hex over `${t}.${raw}`, reject `t` older than 1800 s or more than 300 s ahead.
- `verifyResend(raw: Buffer, headers: {id, timestamp, signature}, secretB64: string): boolean` — svix scheme, 300 s tolerance.
- `verifyMeta(raw: Buffer, header: string | null, appSecret: string): boolean` — `sha256=<hex>`.
- `safeEqualHex(a: string, b: string): boolean` — length check then `timingSafeEqual`.
- `hmacHex(secret, data)`, `sha256Hex(data)`.

- [ ] **Step 1: Write failing tests** tagged `[C-0412][C-0414][C-0415][C-0416][C-0417][C-0418][C-0419][C-0421][C-0422][C-1587][C-1588][C-1589][C-1590][C-1591]`: build a signed body with a known secret; assert each reason; multibyte body; two `v0=` values; two secrets (rotation) returns `secretIndex: 1`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `Verify ElevenLabs, Resend and Meta webhooks over raw bytes`

