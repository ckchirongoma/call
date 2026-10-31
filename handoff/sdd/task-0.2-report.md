# Task 0.2 report: webhook signature verifiers

**Status:** DONE_WITH_CONCERNS (the concerns are scoping notes for Task 3.3, not defects)
**Commit:** `01b43c6` "Verify ElevenLabs, Resend and Meta webhooks over raw bytes" (on `claude/call-phone-agent-build-f50v1t`, not pushed)

## What was built

`api/_lib/crypto.ts` is ported from Charlie `api/_lib/crypto.ts`. The header attributes it and the why-comments are kept. It exports:

- `hmacHex(secret, data)` and `sha256Hex(data)`. Each takes a string or bytes.
- `safeEqualHex(a, b)`: checks the length first, then calls `timingSafeEqual`. It works on the text's bytes, so it also compares base64 digests. **Changed from Charlie:** `("", "")` now returns `false`, because an empty digest never counts as a match.
- `verifyElevenLabs(raw, header, secrets, nowSecs?)` returns `{ ok, reason?, secretIndex? }`.
  - Header format: `t=<unix>,v0=<hex>[,v0=…]`. The HMAC-SHA256 hex covers `${t}.` followed by the raw bytes, fed incrementally with no string conversion.
  - Reasons, checked in this order: `missing` (null, undefined, blank), then `malformed`, then `stale` (age > 1800 s), then `future` (more than 300 s ahead), then `mismatch`.
  - `malformed` means: no `t`, two `t` values, a `t` that is not all digits, or no non-empty `v0`.
  - Parts it does not know are ignored. `v0` hex is matched case-insensitively.
  - The `t` string exactly as sent is what gets signed.
  - Rotation: `secretIndex` is the position of the secret that matched in the array. Empty slots are skipped but keep their position.
- `verifyResend(raw, {id, timestamp, signature}, secretB64)` returns a boolean.
  - It follows the svix scheme: a base64 HMAC-SHA256 over `${id}.${timestamp}.` followed by the raw bytes.
  - The key is the base64-decoded secret. The `whsec_` prefix is optional.
  - The timestamp must be within 300 s either side of now.
  - The signature header may hold several space-separated `v1,` entries. Only `v1` counts.
- `verifyMeta(raw, header, appSecret)` returns a boolean. The header must start with `sha256=`, followed by the hex HMAC-SHA256 of the raw bytes keyed with the app secret.
- Exported types: `SignatureReason` and `SignatureCheck`.

Rules shared by all three verifiers (each has a why-comment in the file header):

1. **Raw bytes only.** Anything that is not a `Uint8Array` gets a `TypeError` naming the wiring bug. A parsed `req.body` therefore fails a handler's first test loudly, rather than coming back as a 401 in production.
2. **`timingSafeEqual` after a length check.**
3. **An empty secret or key never verifies.** Anyone can compute an HMAC with an empty key, so these fail closed.
4. **Replay windows** as listed above.
5. **Bad input from a request is an answer, never a throw.**

`node:crypto` is imported as its module object (`import nodeCrypto from "node:crypto"`) so that the test can spy on `timingSafeEqual` and count the calls. The reason is commented in the file.

`docs/VERIFIED.md`:
- I split the old combined row "Post-call webhook current payload … and signature header format". The payload half stays unfilled (Task 4.1).
- I added three filled rows: ElevenLabs signature header, Resend (svix) signature, and Meta `X-Hub-Signature-256`. Each says "from docs search, not fetched (2026-10-31)" plus what the search said, and keeps the existing columns.
- Before writing them I ran a web search for each vendor, because `vendor-notes.md` marks the Resend and Meta shapes "from knowledge". The search found the ElevenLabs docs page with the 30 × 60 s sample tolerance. For Resend and Meta the construction details came only from third-party pages and the svix format, and each row says so.

Plan: Task 0.2's checkboxes are ticked, and a **Notes (decided while building)** paragraph was added under it. It covers the decisions below and what 3.3 owes.

## TDD evidence

**RED.** The tests were written first. Command:
`TRACKING_OFF=1 node --experimental-strip-types --import ./scripts/register-ts.mjs --test test/crypto.test.ts`
```
# Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/home/user/call/api/_lib/crypto.ts' imported from /home/user/call/test/crypto.test.ts
# tests 1
# pass 0
# fail 1
```

**GREEN.** Same command, after implementing:
```
▶ hashing helpers
  ✔ hmacHex and sha256Hex match the published test vectors, for strings and bytes alike
  ✔ [C-1590] safeEqualHex checks the length before timingSafeEqual, and an empty digest matches nothing
▶ verifyElevenLabs
  ✔ [C-1587] verifies the raw Buffer; a parsed body or a string is refused with a TypeError
  ✔ a missing header is reason missing (verifier half of C-0417)
  ✔ a header without a usable t and v0 is reason malformed (verifier half of C-0418)
  ✔ t older than 30 minutes is reason stale, even when correctly signed (verifier half of C-0414)
  ✔ t 29 minutes old, or exactly 30, still verifies (verifier half of C-0416)
  ✔ t more than 5 minutes ahead is reason future; 5 minutes ahead is clock skew and verifies (verifier half of C-0415)
  ✔ a wrong secret, a changed byte, or a signature moved to a fresh t is reason mismatch
  ✔ with two v0 values, either one matching verifies (verifier half of C-0412)
  ✔ tolerates spaces around the parts, upper-case hex, and parts it does not know
  ✔ rotation: the previous secret still verifies and says so with secretIndex 1 (verifier half of C-0422)
  ✔ an empty secret never verifies, even a header signed with the empty key
  ✔ [C-0419] the signature over the original bytes verifies; the same JSON re-serialised does not
  ✔ reads the clock when nowSecs is not given
▶ verifyResend
  ✔ [C-1588] HMAC-SHA256 over id.timestamp.body with the base64-decoded secret
  ✔ [C-1588] svix-signature may carry several space-separated v1 signatures; only v1 counts
  ✔ [C-1588] the timestamp tolerance is 5 minutes, either side of now
  ✔ a missing header, a non-numeric timestamp or an empty secret is refused, never thrown
▶ verifyMeta
  ✔ [C-1589] X-Hub-Signature-256 is sha256 HMAC over the raw bytes with the app secret
  ✔ a missing header or an empty app secret is refused, never thrown
▶ all three verifiers
  ✔ [C-1591] a UTF-8 multibyte body verifies: the bytes are signed, not the string length
  ✔ [C-0421][C-1590] every signature comparison is timingSafeEqual, after a length check
ℹ tests 23  pass 23  fail 0
```

**Whole suite:**
- `npm run typecheck`: clean.
- `npm test`: 75 tests, 75 pass, 0 fail.
- `npm run test:intel`: 75 tests, 75 pass, 0 fail (same count).
- `npm run grep-models`: "No hardcoded model slugs under api/".
- `npm run grep-doc-css`: "No document renderers yet".
- `npm run criteria -- --matrix`: all 1337 cited ids are present.

**Mutation check.** The tests are not vacuous. I applied 20 mutations to `crypto.ts` one at a time, ran `test/crypto.test.ts` against each, then restored the file and confirmed it byte-identical with `cmp`. Every mutation fails at least one test:
- `===` instead of `timingSafeEqual`; no length check; empty digests compare equal (Charlie's behaviour).
- Signing `raw.toString()` instead of the bytes.
- Window changes: stale `>=`; 3600 s age; 600 s ahead; no future check.
- Header parsing: only the first `v0`; two `t` values allowed.
- Secrets: indices shifted by filtering; empty ElevenLabs secret allowed.
- No raw-bytes guard.
- Resend: keyed with the secret text; 600 s tolerance; past-only window; any version accepted; empty key allowed.
- Meta: prefix not required; empty secret allowed.

The Meta-prefix mutation survived at first. I added a test that a same-length `sha384=` label carrying the correct digest is refused, and it now fails as it should.

## Files changed

- `/home/user/call/api/_lib/crypto.ts` (new)
- `/home/user/call/test/crypto.test.ts` (new)
- `/home/user/call/docs/VERIFIED.md` (one row split, three signature rows filled)
- `/home/user/call/docs/superpowers/plans/2026-10-31-call-build.md` (Task 0.2 checkboxes ticked, notes added)

## Criteria

**Tagged here.** The then-clause is asserted at the verifier layer:
- C-0419
- C-0421
- C-1587
- C-1588
- C-1589
- C-1590
- C-1591

`npm run criteria -- --missing` no longer lists them.

**Not tagged here; owed by Task 3.3** (`test/post-call.test.ts`). The then-clause is an HTTP answer or a log line, which needs the handler. The verifier half of each is pinned in `test/crypto.test.ts`, with the id written in plain text without the bracket tag:
- **C-0412**: "then 200". Verifier side: either of two `v0` values matching gives `ok`.
- **C-0414**: "401 `stale`". Verifier side: `reason: "stale"` above 1800 s.
- **C-0415**: "401 `future`". Verifier side: `reason: "future"` above 300 s ahead.
- **C-0416**: "then 200". Verifier side: 29 min old and exactly 1800 s both give `ok`.
- **C-0417**: "401 `missing`". Verifier side: `reason: "missing"`.
- **C-0418**: "401 `malformed`". Verifier side: `v0=` alone and other malformed headers give `reason: "malformed"`.
- **C-0422**: "either verifies for 24 h and which one is logged". Verifier side: `[current, previous]` gives `secretIndex` 1 for the previous secret. The 24 h window and the log line belong to the handler.

## Decisions

- **Compatible widenings of the interface:**
  - Header parameters also accept `undefined`, since Node's `req.headers[x]` can be `undefined`.
  - The body may be any `Uint8Array`, which is still raw bytes.
  - `SignatureReason` and `SignatureCheck` are exported for the handlers.
- `verifyResend` keeps the verbatim 3-argument signature, with no `nowSecs`. Its tests use `fakeClock`. `verifyElevenLabs` is also tested once on its default clock.
- A non-bytes body throws a `TypeError` instead of returning a reason. This is a wiring bug, and a 500 in tests is louder than a 401 that looks like an attack.
- Timestamps are checked before the HMAC, as in the ElevenLabs docs sample. Checking them first costs nothing and reveals nothing.
- Charlie's `hashSecret`, `mintToken`, `mintNumericCode` and `shortHash` were not ported. Nothing in Call uses them yet; `auth.ts` and `links.ts` will bring what they need.

## Concerns

1. `env.ts` has no `ELEVENLABS_WEBHOOK_SECRET_PREVIOUS`, which C-0422 names. I left `env.ts`, `.env.example` and `test/_env.ts` alone because they belong to Task 0.1. Task 3.3 should add the variable to all three (`test/fakes.test.ts` enforces that they agree) and pass `[env.ELEVENLABS_WEBHOOK_SECRET, env.ELEVENLABS_WEBHOOK_SECRET_PREVIOUS]`.
2. C-0422's "for 24 h" cannot be enforced by a stateless verifier, because it has no idea when a rotation began. Task 3.3 should decide whether it is a documented operator overlap window or a check in code, for example a timestamp env variable.
3. Signature checks have no `capture()` yet, because `intel.ts` arrives in Task 0.6. The handlers should capture the check together with its reason and `secretIndex`, never the header or the secret.
4. The vendor shapes are still "from docs search, not fetched". For Resend and Meta the search found only third-party descriptions, not the vendors' own pages. The verifiers follow the svix format and Meta's long-standing `sha256=` format, and the tests pin both.
5. `npm run verify` as a whole will still fail at `criteria --check`: 1330 criteria are untested across the repo, which is expected at this stage. `preview-quote` does not exist yet. I ran the other steps of verify one by one.
