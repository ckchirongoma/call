# Task 0.2 review: webhook signature verifiers (0160f15..01b43c6)

Reviewed: the brief, criteria rows C-0412, C-0414–C-0419, C-0421, C-0422 (`criteria/04-ingest.md:19-29`) and C-1587–C-1591 (`criteria/12-ops-security.md:94-98`), `vendor-notes.md`, `executor-context.md`, Charlie `api/_lib/crypto.ts`, the report and the diff. Outside the diff I checked only these: `scripts/criteria.ts`, which matches `[C-dddd]` anywhere in a test file, so a plain-text id is not counted as a tag; `api/_lib/env.ts:27`, which trims every env value; `test/_fakes.ts:1146` (`fakeClock` patches `Date.now`); and plan Task 3.3 (`docs/superpowers/plans/2026-10-31-call-build.md:285-289`), which owns C-0400…C-0428. I used one git command to read the commit message, which the diff does not include. The suite was not re-run.

### Spec Compliance

- ✅ **Files and interfaces.** `api/_lib/crypto.ts` and `test/crypto.test.ts` were created. `hmacHex` is at `crypto.ts:86`, `sha256Hex` at `:91`, `safeEqualHex` at `:105`, `verifyElevenLabs` at `:122`, `verifyResend` at `:165` and `verifyMeta` at `:190`. Two compatible widenings:
  - Headers also accept `undefined`.
  - The body may be any `Uint8Array`.

  The brief's 3-argument `verifyResend` is kept exactly.
- ✅ **HMAC over raw bytes.** `hmac()` (`crypto.ts:76-83`) feeds the string prefix as UTF-8 and then the Buffer itself. Nothing is converted to a string.
  - `assertBytes` (`:70`) throws a named `TypeError` on an object or a string.
  - The multibyte fixture (`test/crypto.test.ts:30-42`) holds an em dash, an e-acute and an emoji.
  - The truncated-emoji case (`test:372-374`) is the real discriminator: a `raw.toString()` mutation fails on it.
- ✅ **`safeEqualHex`** (`crypto.ts:105-110`).
  - It checks the length before calling `timingSafeEqual`.
  - It compares the UTF-8 bytes of the text, not decoded hex, so odd-length or non-hex input cannot throw. `test:179-180` covers `zz` and a length+1 value.
  - Non-strings become `""`.
  - `("", "")` now returns `false`. This differs from Charlie, and the change is documented (`:99-103`).
- ✅ **Replay window matches the brief exactly** (`crypto.ts:149-150`).
  - An age over 1800 s is `stale`. More than 300 s ahead is `future`.
  - Boundaries are pinned at `test:146-166`: 1800 s and 300 s ahead verify; 1801 s and 301 s ahead are refused.
  - A millisecond timestamp reads as `future`.
  - The `t` string exactly as sent is what gets signed.
- ✅ **Multiple `v0=` values and rotation.** Every `v0` is collected (`crypto.ts:133-142`).
  - `secretIndex` is the position in the array, and empty slots keep their positions (`:152-157`).
  - Tests: `test:184-190` covers either order of two `v0` values; `test:199-207` returns index 1 for the previous secret, including the `["", previous]` case.
- ✅ **svix (Resend).**
  - The `whsec_` prefix is stripped and the rest is base64-decoded (`crypto.ts:177`). An empty key fails closed (`:178`).
  - The signed content is `${id}.${timestamp}.` followed by the raw bytes (`:180`).
  - The signature header is split on spaces, and only `v1,` entries count (`:182-186`).
  - The window is `Math.abs(...) > 300` (`:175`), which matches svix's own too-old/too-new checks.
  - Tests at `test:242-303`:
    - A key used as text instead of decoded bytes is refused.
    - Signing the body alone, or swapping id and timestamp, is refused.
    - A changed id is refused.
    - `v2,` and a bare signature are refused.
    - Boundaries hold: ±300 s verifies, ±301 s is refused.
- ✅ **Meta.** The `sha256=` prefix is required (`crypto.ts:194`), and the digest is the HMAC of the raw bytes with the app secret. The same-length `sha384=` label case (`test:343`) catches a skipped prefix check.
- ✅ **Tagged here, each asserting its then-clause.**

  | Criterion | Test | What the test asserts |
  |---|---|---|
  | C-1587 | `test:106` | The verifier refuses a parsed object or a string with a `TypeError`, so a caller cannot use anything but the raw Buffer. This is the strongest form a verifier-level test can take. |
  | C-1588 | `test:242`, `:269`, `:284` | The svix construction and the 300 s tolerance. |
  | C-1589 | `test:327` | The Meta digest over raw bytes with the app secret. |
  | C-1590 | `test:85`, `:377` | All three verifiers reach `timingSafeEqual` through a spy, it only ever sees equal-length inputs, and short signatures never reach it. |
  | C-1591 | `test:356` | A multibyte body verifies for all three. |
  | C-0421 | `test:377` | `timingSafeEqual` is used, shown by the spy. |
- ⚠️ **C-0419** (`test:216`). The verifier half is asserted correctly: the pretty-printed original verifies, and the same JSON re-serialised does not.
  - The parenthetical in the row, "(we never re-serialise before verifying)", is a property of the handler, and the row's owning file is `test/post-call.test.ts`.
  - The plan note's "Owed by Task 3.3" list (`plan:128`) leaves C-0419 out, so Task 3.3 may treat it as done. See Minor 1.
- ✅ **Correctly left untagged:** C-0412, C-0414, C-0415, C-0416, C-0417, C-0418 and C-0422. Their then-clauses are an HTTP answer (200 or 401 with a reason), or for C-0422 "for 24 h" plus a log line, so they need the handler.
  - The verifier half of each is pinned under a plain-text id (`test:120`, `:126`, `:146`, `:153`, `:160`, `:184`, `:199`), which `scripts/criteria.ts` does not count as a tag.
  - Task 3.3 owns C-0400…C-0428 (`plan:289`), so none of them is orphaned.
- ✅ **No secret-shaped literals.** The fakes are `test-secret`, `test-secret-previous`, `test-whatsapp-app-secret` and `not-the-secret`.
  - The Resend `whsec_` value is built at runtime from `test-resend-signing-key-…`.
  - The 64-hex literals are the published RFC 4231 and FIPS 180-2 test vectors.
- ✅ **Commit `01b43c6`.**
  - The subject matches the brief exactly.
  - The body is 3 lines.
  - It ends with the two attribution lines, and no model is named anywhere else.
  - Only the task's 4 files changed.
- ✅ **VERIFIED.md** (`docs/VERIFIED.md:11-13`).
  - Each of the three rows says "from docs search, not fetched (2026-10-31)" and keeps the existing columns.
  - The combined payload/signature row was split, and the payload half stays open for Task 4.1.
  - The Unblocks pointers are correct: 7.1 is Email delivery and 7.2 is WhatsApp.
  - Each row says which details are our own tolerance (ElevenLabs) or came from third-party sources (Resend, Meta).
- ✅ **Porting.** The header carries the attribution line exactly as required (`crypto.ts:3`). Charlie's Meta comment is kept (`:189`). Each new rule has its own why-comment (`:17-42`). There are no relative imports, and no model slug appears in `api/`.
- ✅ **Plan.** The Task 0.2 checkboxes are ticked, and the Notes paragraph records every decision made while building.

### Strengths

- The tests compute expected signatures with `node:crypto` directly, never with the module's own helpers. A bug in `hmacHex` therefore cannot sign and then verify its own mistake.
- The `timingSafeEqual` spy works because both the module and the test go through the `node:crypto` default object, which is the only way the spy can observe the calls; the comment at `crypto.ts:39-42` explains it. C-0421 and C-1590 are therefore asserted, not taken on trust.
- **Fails closed.** An empty or blank secret never verifies (`test:209-214`), the same holds for `whsec_` alone and an empty Meta app secret, and blank slots keep their index so `secretIndex` always names the same env variable.
- The boundaries are pinned on both sides of every window, and the clock is exercised both through the injected `nowSecs` and through the default, using `fakeClock` with `advance`.
- **Request input never throws.** Headers that are null, missing or garbage, and `headers` itself being null, all return an answer. Only a wiring bug throws, with a message that names it.
- The ElevenLabs construction matches the vendor's own sample: a UTF-8 secret key, a hex digest over `t.` followed by the body, and a 30-minute age limit.
- The implementer ran mutation testing and found a gap (the Meta prefix check), then closed it with a test.

### Issues

**Critical:** none.

**Important:** none.

**Minor**

1. **C-0419's handler half is not handed to Task 3.3.**
   - Where: `test/crypto.test.ts:216` and `docs/superpowers/plans/2026-10-31-call-build.md:128`.
   - What: the tag asserts that the verifier verifies over the bytes it is given. The row also promises "we never re-serialise before verifying", which only a handler test can show. A handler that runs `Buffer.from(JSON.stringify(req.body))` would pass every test here, and would also pass a 3.3 test whose factory signs compact `JSON.stringify` output. Since C-0419 already counts as tagged, nothing forces 3.3 to look at it.
   - Why it is not worse: `assertBytes` and the C-1592 static test catch the common case (a parsed object handed over).
   - Fix: add C-0419 to the plan note's "Owed by Task 3.3" list. In 3.3, tag the handler test as well: sign a pretty-printed or otherwise non-canonical body and assert 200. Keep the verifier tag.
2. **The header comment's list of what was not ported is incomplete.**
   - Where: `api/_lib/crypto.ts:4`.
   - What: the comment names `hashSecret`, `mintToken` and `mintNumericCode` as not ported, but the report says Charlie's `shortHash` was not ported either.
   - Fix: add `shortHash` to the list, or note that `sha256Hex` covers its use.

### Assessment

Every requirement in the brief is met, and the focus points all check out:
- HMAC over raw bytes, including multibyte bodies.
- A length check before `timingSafeEqual`, with no throw on odd-length or non-hex input.
- The replay window exactly as the brief says.
- Multiple `v0=` values and `secretIndex`.
- The svix base64 key, signed content, multiple `v1,` signatures and the 300 s window.
- The Meta `sha256=` prefix.

The tags are honest, and the ids whose then-clauses need the handler are correctly left for Task 3.3. The two Minor items are a hand-off note and a comment fix, and neither blocks the task.

**Task quality: Approved**
