# Task 0.6 re-review, fix round 1 (0721dc1..f3d5566)

Read: the brief, the previous review, the report's "Fix round 1", and the diff once. HEAD is `5c8af24`, which is `f3d5566` amended. The only change is in `test/intel-redact.test.ts`: the two `sb_` literals are now built at runtime, for push protection. `api/` is byte-identical, so every line number below is HEAD's.

I ran these myself from `/tmp/claude-0/-home-user/ad36b136-336a-55d6-81b9-100e21138cdd/scratchpad/rr06/`:
- The previous reviewer's probes (`scratchpad/probe/{redact,redact2,capture,capture2,forget}.ts`), unchanged.
- New probes: `redact3.ts`, `capture3.ts`, `flushblock.ts`, `forget2.ts`, `misc.ts`, `buf_base.ts`.
- The new tests against the pre-fix code: a `git archive 0721dc1` copy with HEAD's two test files, plus stub exports, as the implementer did.

**Red/green confirmed.** On 0721dc1 the new tests fail 14 of 52: 6 in redact and 8 in intel. The failing names and counts match the report's RED block. On HEAD:
- `npm test` 263/263, `npm run test:intel` 263/263
- `typecheck` clean
- `criteria --check --matrix` reports 0 unknown tags and 1337 cited
- `grep-models` and `grep-doc-css` clean
- INTEL-CONTRACT sha256 is `5060897a…baaf8`

## Finding Verdicts

| # | Verdict | Where | Evidence |
|---|---|---|---|
| I-1 secret keys / prefixed link params | **ADDRESSED** | intelredact.ts:265 (`isSecretKey` by words), :127 (link rule), :104 (signature headers), :321 (rawHeaders) | Probe: `accessToken`, `sessionToken`, `authToken`, `refreshToken`, `idToken`, `webhookSecret`, `appSecret`, `serviceRoleKey`, `x-hub-signature-256` and `X-Hub-Signature` are all `[redacted]`. So are `&conversation_signature=…` and `X-Amz-Signature/Credential=`. `code: "23505"`, `token_count`, `prompt_tokens` and `session_id` stay. Pinned by `[C-1738]` and `[C-1737]` (redact test), both red on base. |
| I-2 phone/ID/card variants | **ADDRESSED** | intelredact.ts:161-193 | Probe: each of these becomes `[contact]`/`[number]`: `(079) 993 0000`, `079.993.0000`, `+27 (0)82 …`, `ID no.8001015009087`, `x8001015009087`, `id_8001015009087`, a double-space card, a spaced-dash card, `0, 8, 2, 1, …`, `8 0 0 1 …` and spoken digits. `redactContacts` is exported (:238). Pinned by the second `[C-1739]`, red on base. |
| I-3 login code | **ADDRESSED** | intel.ts:483-486 (kind from meta, content or name; content not even held), intelredact.ts:182 (crosses `\n` and tags), :305 (bare `code` with 6 digits) | Probe: `content.kind` alone gives a row with content `null`, `meta.kind` set and `content_mode` meta. The newline layout, the `<p style>` HTML, `{login_code}`, `{code:"482913"}` and `482 913` are all redacted. Pinned by the second `[C-1741]`, red on base. One residual (N-6) is outside what I-3 named. |
| I-4 big structured content on the request path | **ADDRESSED** for the reported shapes | intel.ts:308-352 (`sizeUp`/`hold`), :555-580 (`toRow` cuts and redacts at the flush) | Probe on the caller: 8,000-row catalogue 3 ms (was 716 ms); 12,000 segments 8 ms on a cold first call, and the test's p95 is < 5; 5 MB list and 20 MB string < 1 ms. Flush output is cut to ≤ 1 MB, `truncated_bytes` is set and the `sessionToken` is redacted. Pinned by the second `[C-1701]` (red on base: "catalogue_upload: p95 987 ms"). Residual shapes are in N-4. |
| I-5 flush racing forget | **ADDRESSED** | intel.ts:899-1004 (tombstone before any wait, `settle()` before reading and before deleting), :627 / :702-705 (`unforgotten` before batching and before each insert) | Probe (the reviewer's): `left in s_S1: []`. Extra probes all leave nothing: a client row a flush had already spliced when forget started (the trace was learnt through `forgetting`); a flush past its batching; a forget during a running job. Pinned by `[C-1745] a flush that runs while…`, red on base. |
| I-6 forget follows `job_enqueued` | **ADDRESSED** | intel.ts:921-960 | Probe (the reviewer's): removed 6, left `[]`. Extra probes: two levels of sessionless jobs are both removed and an unrelated job's row stays; a link row still buffered while the job's rows are in the table gives removed 3, left `[]`. Pinned by `[C-1745] forgetting follows the jobs…`, red on base (2 !== 6). |
| m-1 date-times | **ADDRESSED** | intelredact.ts:144-150 | These stay whole: `2026-10-31 14:30`, `2026-10-31T14:30:00+02:00`, `31.10.2026 at 14:30`, `exp=1761900000`. Pinned by `[C-1740]`, red on base. |
| m-2 base64url / wrapped | **ADDRESSED** | intel.ts:283-296; intelredact.ts:97-98 | 4,000 characters of base64url: 17 characters kept. Wrapped base64 becomes `[bytes]`. A 20,000-character `note` stays a string. Pinned by the second `[C-1734]`. |
| m-3 capture never throws | **ADDRESSED** | intel.ts:524-533 | Probe: "name getter first failure: ok". Pinned by the second `[C-1700]`, red on base. |
| m-4 capture after the try | **ADDRESSED** | models.ts:422-428; queue.ts:251 (`captureJob` guarded) | |
| m-5 ids validated, stage redacted | **ADDRESSED** (small residual) | intel.ts:223, :251-256, toRow `stage` | Free text gives a `p_` trace, and `stage`/`name` are redacted (the test is red on base). Residual: `TRACE_ID` accepts `wa_27821234567`, so a prefixed phone number would reach `trace_id`. No call site does this today. |
| m-6 raw turn id refused | **ADDRESSED** | intel.ts:240-248 | The turn id is null, one warning is logged, and no hash is written. |
| m-7 shape gaps | **ADDRESSED** | intelredact.ts:100-104, :107 (`sb_`), CONTACT `%40`, HEADER_LIST | `sb_secret_`, a schemeless `Authorization:`, a short `Bearer`, `rawHeaders` and `%40` are all covered. Residual: `session_token=…` at the very start of a text (no `?`/`&` before it) is kept. |
| m-8 job context isolation | **ADDRESSED** | queue.ts:966-976, :1036-1040 | The job context clears client, broker, turn, stage and contentMode. `sessionOf` sets the session's client and broker, and `meta` for `declined_consent`. Pinned by the second `[C-1715]`, red on base. |
| m-9 secrets read once | **ADDRESSED** | intelredact.ts `redactDeep` → `walk(…, secretValues())` | |
| m-10 meta cut by values | **ADDRESSED** | intel.ts toRow (`shrink(meta, MAX_META_BYTES)`) | Probe: 20 KB of meta keeps `model`, `role`, `kind` and `broker_id`. |
| m-11 readTrace says when cut | **ADDRESSED** | intel.ts:858-863 | Pinned by the second `[C-1754]`. |

### The accepted trade-offs

**Big content held by reference: acceptable, with two conditions (Minor).**

What the probe shows: content bigger than 2,000 values or 256 K characters, mutated after capture, is written in its later state (`big_then_mutated -> "SIPHO changed after capture"`). Small content stays as it was at capture.

This departs from the letter of contract rule 1: "Rows are serialised at capture". The same rule also requires "under 5 ms at p95" and "never waits on the request path". For big content those two halves cannot both hold, and the old code broke the second by 0.7–4.5 s. So the bound wins, and I accept that choice.

Compatibility:
- **Redaction:** unaffected. The rules run on whatever is serialised at the flush, so a later change cannot get past them. Credential kind-only and shape-only are decided at capture from the kind and the context.
- **Forgetting:** unaffected. `trace_id`, `business_id` and `job_id` are fixed at capture, and `dropBuffered` removes the Pending together with its reference. The one hole is contrived: an object that later gathers another client's words would be filed under the first client.
- **"Every task recorded whole":** this is where it can bite. An accumulator would record its final state N times. The likely case is a meeting's growing segments array, captured once per chunk. No in-repo caller mutates today; `models.ts` builds `messages` fresh for every attempt.

The two conditions:
- **(a)** Say it where call sites will read it. `CaptureOptions.content` (intel.ts:87) should state that content over the inline bound is read at the flush, so the caller must not change it afterwards.
- **(b)** Name it in the plan Notes as a deviation from INTEL-CONTRACT rule 1, so that the meeting and catalogue tasks pass values they have finished with.

**Over-redaction of "postal code 2196" and nine single digits: acceptable.** A 4-digit postal code is mildly identifying, and nine single digits in a row is almost always a read-out. However, the same rules over-redact money in ways the report does not acknowledge. That is N-1 and N-2, and those two are regressions.

## New Breakage

None at Critical or Important level. Minor:

- **N-1. Money ranges are now removed, a regression against contract rule 4 ("Money and dates stay"). Minor.** intelredact.ts:161 (`SEP` allows up to three of space, dash, en-dash, slash or bracket) and :193; the phone rule at :170 uses `PSEP`.
  - Probe, HEAD against 0721dc1:
    - `R100 000 - 200 000` → `R100 [number]` (was kept)
    - `R150 000 – 250 000` → `R150 [number]`
    - `R150 000/200 000` → `R150 [number]`
    - `R150 000 (200 000 with spouse)` → `R150 [number] with spouse)`
    - `options 1 500 000 – 2 000 000` → `1 500 [contact]`, misread as a phone number
  - These shapes are common in typed budgets and in catalogue text. C-1740 passes only because each pinned amount has its own `R`.
  - Fix: treat a spaced dash, en-dash, slash or bracket as a break unless the groups on both sides are card or phone shaped (4-digit groups, or a leading `0`/`+`). Add these five strings to `[C-1740]`.
- **N-2. The PIN/code rule now eats money that follows the word. Minor.** intelredact.ts:182.
  - The window is 60 characters and spaced digits are accepted. `the promo code applies to premiums of R1 500 per month` → `R[redacted]` (kept on base).
  - Fix: require the digits to be the next token after the word, its line break or tags, or after `is`/`:`. Or stop at `R`/a currency sign.
- **N-3. The flush blocks the event loop for 0.4–0.7 s for each big row. Minor.** intel.ts:702: `unforgotten(pending).map(toRow)` runs in one synchronous pass.
  - `flushblock.ts`, the longest gap in a 1 ms interval: catalogue 508 ms, 5 MB list 694 ms, 20 MB string 360 ms.
  - This is off this request's path. But in a process that serves several requests at once (Vercel fluid compute, or the drain's parallel lanes), it stalls them: for example, a voice tool call next to a catalogue upload's flush.
  - Fix: `await setImmediate` between rows (or every ~10 ms) in `write()`.
- **N-4. Capture is still O(n) for two shapes, despite the header's "bounded work whatever it is given". Minor.** intel.ts:324, :343. Neither is a regression: base was 7.6 ms and 4.5 s.
  - A Node `Buffer`: `JSON.stringify` calls `Buffer.toJSON` before the replacer. Measured: 1 MB PDF attachment 13 ms p95; 5 MB audio 57 ms p95.
  - An object with very many keys: `Object.keys` runs before the bound check. 200 k keys: 108 ms p95.
  - The quote email's `send` row is a likely place for a PDF Buffer (C-1734's own test passes one).
  - Fix: in `sizeUp`, flag Buffers and hold such content by reference, or map bytes to `{type, size}` in a bounded copy before stringify. Count keys with a capped `for…in`.
- **N-5. `MAX_BUFFER_BYTES` no longer bounds memory for content held by reference. Minor.** intel.ts:315/320/325: anything over the bound is counted as 256 K. Probe: 400 captures of ~4 MB each leaves 249 buffered, about 1 GB held, where 64 MB was meant.
  - Fix: count a reference by a cheap estimate (the `chars` reached, times the remaining length ratio), or cap the number of references.
- **N-6. The text backstop misses a code that comes after another number. Minor.** This was already the case on base and is outside I-3 as worded. intelredact.ts:182.
  - `Your code (valid 10 minutes): 482913` and `Your sign-in code for 31 October: 482913` are kept.
  - Kind-only is the primary guard (C-1741), so this matters only if the auth task forgets to set the kind or name.
  - Fix: let the window step over a short number that is not a code, or have Task 2.x/auth assert the kind.
- Also minor: query parameters whose name merely contains a secret word now go: `?monkey=`, `&keyword=funeral`, `&author=`, `&barcode=`. That is noise in URLs only, not a leak.

## Out-of-Scope Observations

- queue.ts:991, :1010 and :1026: the reclaimed-after-worker-died `failed` row, the unknown-kind `failed` row and the session-busy `held` row are captured before `sessionOf()`. So they carry no client and are captured in full even for a declined-consent session. They sit in `s_<session>`, so the forget reaches them, and their payload is ids. Worth naming in Task 3.4's C-1744 test.
- `forgetIntel`'s returned count leaves out rows the flush drops by tombstone. In probe A it returned 1 while 2 more were dropped. This affects the count only.
- Following `job_enqueued` links also follows dedupe hits (`meta.existing`). If such a job is shared, its rows go with this client. That is consistent with readTrace and errs on the side of privacy.
- HEAD differs from the reviewed head: the `5c8af24` amend (test literals only).

## Verdict

**Fix round 1: all six Important findings and all eleven Minors ADDRESSED**, each with a covering test shown red on the pre-fix code and green on HEAD (263/263 in both modes). No new Critical or Important finding.

**Task quality: Approved.** Merge as is, or fold in the cheap ones first:
- N-1 and N-2 are regressions against "money stays", and a few strings in `[C-1740]` fix and pin them.
- Condition (a) is a one-line doc on `CaptureOptions.content`.
- N-3, N-4 and N-5 can go to Task 11.x (ops/health) or the first task that captures a Buffer.
