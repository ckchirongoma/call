# Task 0.6 review: Chase Intelligence core (7222606..9e0ad8c)

Read: brief, report, executor context, criteria rows, INTEL-CONTRACT (sha256 checked against Charlie's,
identical), INTEL-PHASE0 §3, SPEC §7.2 / §16, the diff once, `api/_lib/intel.ts`, `intelredact.ts`,
both test files, Charlie's `intel.ts` / `intelredact.ts`. Suite not re-run (report: 245/245 in both
modes). Focused probes run from the scratchpad against the real modules and the fake DB
(`/tmp/claude-0/-home-user/ad36b136-336a-55d6-81b9-100e21138cdd/scratchpad/probe/*.ts`); every
"survives" below is a probe result, not a guess.

### Spec Compliance

| Item | | Where |
|---|---|---|
| C-1700 capture never throws, result unchanged (DB down, circular, throwing getter) | ✅ | intel.ts:350-406; test:113 |
| C-1701 p95 < 5 ms for 50 KB prompts | ✅ for the pinned case; ⚠️ cliff on large structured content (I-4) | intel.ts:257-328 |
| C-1702 void, no DB/net | ✅ | intel.ts:350 |
| C-1703 one batch after the response via waitUntil | ✅ | track.ts:395, intel.ts:518 |
| C-1704/05/06/07 the switch, TRACKING_OFF default | ✅ | intel.ts:182-186 |
| C-1708 `app = "call"`, `v = 1` | ✅ | intel.ts:62-63, 425-426 |
| C-1709 seq | ✅ | intel.ts:382 |
| C-1710 (unit form), C-1711 `r_`+16 hex, C-1712 `job_<id>`, C-1713 `job_enqueued` + numeric `meta.job_id` | ✅ | intel.ts:205-209; queue.ts:240-260, 941 |
| C-1714 turn ids hashed, never a raw number | ✅ | intel.ts:197-202 |
| C-1715 business_id = client, meta.broker_id | ✅ | intel.ts:357, 364 |
| C-1716 channel set | ✅ | intel.ts:387 |
| C-1721 a `model` row per attempt, whole prompt and response, meta keys | ✅ | models.ts:420-460 |
| C-1722 transcription audio as {type, size} | ✅ | models.ts:1140-1170 |
| C-1732 job lifecycle rows with {job_id, kind, attempt} + payload | ✅ | queue.ts:240-260, 940-1095 |
| C-1733 trackFailure → `error` row {props, summary} / {category, severity} | ✅ | intel.ts:583-596; track.ts:247-302 |
| C-1734 no base64 run > 200 | ✅ standard base64; ⚠️ base64url / line-wrapped base64 pass (m-2) | intel.ts:223; intelredact.ts:104 |
| C-1736 every deployment secret by value, `.env.example` pinned | ✅ | intelredact.ts:42-62 |
| C-1737 bearer, JWT, sk-/xi-, PEM, postgres://, Cookie:, signed `/q/` | ✅ | intelredact.ts:66-98 |
| C-1738 secret-named keys "any case, nested" | ⚠️ camelCase and suffixed names survive (I-1) | intelredact.ts:122-123 |
| C-1739 9+ digit runs "with or without spaces/dashes" | ✅ as pinned; ⚠️ other common written forms survive (I-2) | intelredact.ts:108-113 |
| C-1740 money and dates survive | ✅ as pinned; ⚠️ "2026-10-31 14:30" is mangled (m-1) | intelredact.ts:113 |
| C-1741 login code kind-only | ✅ as pinned; ⚠️ only when `meta.kind` is set (I-3) | intel.ts:360 |
| C-1742 PIN/OTP | ✅ | intelredact.ts:102 |
| C-1743 `[contact]` | ✅ | intelredact.ts:107-109 |
| C-1745 forget: client rows, trace closure, buffered rows | ✅ as pinned; ❌ an in-flight flush survives (I-5); ⚠️ jobs that readTrace folds in are not forgotten (I-6) | intel.ts:703-746 |
| C-1746 forget twice / table missing | ✅ | intel.ts:725 |
| C-1753 contract byte-identical | ✅ sha256 5060897a…baaf8 both repos | test:810 |
| C-1754 (unit form) readTrace from every id, (at, seq), jobs folded in | ✅ | intel.ts:637-688 |
| C-1758 missing table: one line, 10 min backoff, nothing else affected | ✅ | intel.ts:463-496, 519 |
| C-1765 three attempts, dropped, one incident | ✅ | intel.ts:473-509 |
| C-1766 ≤ 500 rows / 1 MB per insert | ✅ | intel.ts:445-461 |
| C-1767 200 KB whole, > 1 MB cut + truncated_bytes | ✅ | intel.ts:257-328 |
| Declined-consent shape-only path for later tasks | ✅ `contentMode: "meta"` on the context (intel.ts:361; track.ts:66); see m-8 for jobs | |
| Never changes a result / flush failure never fails a request | ✅ | models.ts:420-428; intel.ts:511-570 |
| Ports carry the attribution header; imports end in `.js`; no model slug in api/ | ✅ | |
| Plan: ticks + Notes under Task 0.6 only | ✅ | |
| `test/queue.test.ts` change outside the file list | ✅ justified: the assertion is "no step wrote anything"; `intel_events` rows are the drain's own record of the skip, and excluding them keeps that intent exactly. The change is the smallest that does it. | queue.test.ts:497 |

### Strengths

- A real improvement on Charlie, not a copy. Redacting JSON structurally (`redactDeep`) instead of running text rules over JSON text fixes a real Charlie bug: a nine-digit JSON number became bare `[number]`, the row was invalid JSON, and the whole row read back as `{unreadable:true}`. In Call that would have lost every quotation, because a cover of R1 500 000 is 150 000 000 cents. The money/time/size/count allowlist by the key's last word is a sound way to keep the numbers.
- Holding uuids aside while the 9+ digit rule runs (intelredact.ts:166-180) is a correct fix for a failure the implementer found themselves: uuid digit groups read across the dashes as a nine-digit run.
- Serialising at capture time means a later change to the object cannot leak into the row. Bytes become `{type, size}` from the holder's own value, before `toJSON` turns a Buffer into a list of numbers. Lone surrogates and NUL are removed so one bad row cannot fail a 500-row batch. Non-uuid `business_id` values are dropped for the same reason.
- There is no timer and no size trigger, so nothing is ever written mid-request. Writing only happens in `flushIntel()`, which runs off `tracked()`'s `waitUntil`. The missing-table handling is exactly what C-1758 describes: one line, no incident, a 10-minute pause.
- `forgetIntel` goes well beyond Charlie: it tombstones the client and its traces in-process, drops buffered rows twice (before and after the DB read), pages the DB read, counts what it removed, and throws so the forget job retries.
- `readTrace` resolves every id shape C-1754 names and pages its reads.
- The tests assert written rows in the fake DB, not just what the pure functions return. C-1721's fallback/retry sequence and C-1732's whole job lifecycle are pinned row by row.

### Issues

#### Critical

None.

#### Important

**I-1. Secret-named keys: camelCase and suffixed names survive, and so do signed-URL params with a prefix.** intelredact.ts:123 and :96.
- What: the key rule needs a whole-key match or a `[-_]` separator before the suffix. Probe: `{accessToken, sessionToken, authToken, refreshToken, idToken, webhookSecret, appSecret}` all keep their values. So do `x-hub-signature-256`, `login_code` and `code` (see I-3). The link rule only knows exact param names, so `…&conversation_signature=…` (ElevenLabs' signed widget URL, which `/demo` will handle) and `X-Amz-Signature=` survive.
- Why: C-1738 says "any case, nested", and contract rule 3 says "any value under a secret-named JSON key". This deployment's own keys are still caught by value. What is not caught: per-broker session tokens and signed widget URLs, which are not env values and which no shape rule recognises (a 43-character base64url token matches no pattern).
- Fix: test `k.replace(/([a-z0-9])([A-Z])/g, "$1_$2")` as `keepsNumber` already does, and let the suffix take a trailing `[-_]?\d*` (`signature-256`). In the link rule, use `[?&](?:[\w-]*?[-_])?(?:sig|signature|token|secret|key|code|auth)=` so prefixed names are caught. Add the probe keys to the C-1738 test.

**I-2. Common written forms of phone, ID and card numbers survive the identifier rules.** intelredact.ts:108-113.
- What: probe results, each unchanged:
  - `(079) 993 0000` and `079.993.0000` (phone)
  - `ID no.8001015009087`, `x8001015009087`, `id_8001015009087` (the lookbehind `[^\w.]` excludes a preceding `.`, letter or `_`)
  - `4111 1111  1111 1111` (double space) and `4111 - 1111 - 1111 - 1111` (only one separator character is allowed)
  - an STT read-out like `0, 8, 2, 1, 2, 3, 4, 5, 6, 7`
- Why: contract rule 4 removes ID, card, account and phone numbers. `no.8001015009087` is literally a 13-digit run, so C-1739's own then-clause fails for it. These forms come from typed WhatsApp/email text and transcripts.
- Fix:
  - Allow a preceding `.` unless a digit precedes it (`(?<!\d)\.`), so decimals survive. Allow a preceding letter or `_` for runs of 13 or more.
  - Accept `[ .\-–]{1,3}` (and `, `) between digits.
  - Add an SA pattern with an optional `(0xx)` and dots.
  - Pin each probe string in C-1739.
- Also export the contact rule so SPEC §7.2's `redact()` can reuse it. C-1743 says the ask row must match `turns.text` "exactly", and two separate implementations will drift.

**I-3. The sign-in code is kept as kind-only only when the call site puts `kind` in `meta`, and the text rule misses the code when a line break or markup comes between the word and the digits.** intel.ts:360; intelredact.ts:102.
- What: contract §3 puts `kind` in `content` for `ask`/`say`. Probe: `capture("say", {content: {text: "Your Call sign-in code:\n\n482913…", kind: "login_code"}})` writes a full row containing `482913`. `[^\d\n\\]{0,25}?` stops at the newline. The HTML body that the `send` row of the same email will carry (`…code is</p><p style="…">482913</p>`) also keeps it, and so do `{login_code: "482913"}` and `{code: "482913"}`.
- Why: contract rule 4 and C-1741 say sign-in codes are never kept. The auth task's `send` row, not only its `say` row, will hold this email.
- Fix: make `KIND_ONLY` trigger on `meta.kind ?? content.kind`, and on any row whose `name` ends `:login_code`. Let the code rule cross whitespace, newlines and tags within a short window, or redact a bare 4-8 digit token on a line or in a tag of its own when the text mentions "code". Add `login_code|sign_in_code|verification_code` to the key rule.

**I-4. Content over ~968 KB that is mostly structure is shrunk and redacted synchronously on the caller's path: hundreds of ms to seconds per capture.** intel.ts:268 → 307-328, called from capture at 362.
- What: `shrink()` makes up to six stringify passes, then falls back to `redactDeep(value)`, which runs every text rule plus 18 env reads per string, all inside `capture()`. Probe timings on the caller:
  - 8,000 catalogue rows (0.99 MB): **716 ms**
  - 200,000 short strings (5 MB): **4.1 s**
  - 12,000 transcript segments (1.16 MB): 119 ms
  - one 20 MB string: 238 ms
- Why: contract rule 1 says capture never waits on the request path and adds under 5 ms. C-1711 itself names the catalogue upload as a traced request, and a whole long meeting's segments are a `model` row (C-1722). C-1701 only pins the easy shape (one long string), which `capStrings` cuts cheaply.
- Fix: keep the parsed or raw value in `Pending` and do the shrink, fallback included, in `write()` after the response. Memory is already bounded by `MAX_BUFFER_BYTES`. Hoist `secretValues()` to once per flush. Add a C-1701 variant with ~1.2 MB of small objects.

**I-5. A row of a forgotten trace that is flushed while `forgetIntel` is reading the client's traces survives the forget.** intel.ts:720-744.
- What: in-flight writes are awaited once, at :720, before the traces are known. A flush that starts during the paged select (:722-731) inserts after the deletes at :736-744.
- Probe: write a client row in `s_S1`, then start `forgetIntel`. Meanwhile, in the same process, capture `delivery:delivered` in `s_S1` (no clientId in that context, as a delivery webhook has none) and call `flushIntel()`. Result: forget removed 1, and **`delivery:delivered` is left in `s_S1`**. The drain runs lanes in parallel, and alerts.ts/queue.ts call `flushTracking()` mid-run, so this can happen in one process.
- Why: contract rule 5 ("forgetting wins"), C-1745, and the function's own doc comment ("waits for writes already on their way").
- Fix: after the trace tombstones are set and the buffer is dropped again (:732-734), `while (writing.size) await Promise.allSettled([...writing])` again before deleting. Also filter tombstoned business ids and traces in `write()` just before each insert, which covers rows spliced from the buffer before the tombstone. Pin the probe as a C-1745 case.

**I-6. `forgetIntel` does not follow `job_enqueued` links, but `readTrace` does, so rows of jobs the client's task queued survive.** intel.ts:722-744 vs :660-688.
- What: a job without a `session_id` column runs in `job_<id>`, and its context carries no clientId (queue.ts:941), so its rows have `business_id = null`. Probe: a `notify_broker` job enqueued with a null session from the client's `s_S1` trace captures `say {text: "Thandi (42) wants funeral cover for four people"}`. `readTrace("s_S1")` folds it in. After `forgetIntel(CLIENT)`, **`job_started`, the `say` row with the client's words, `job_finished` and `job_done` all remain**, and only the link row was deleted.
- Why: contract rule 5 says every trace they were in is deleted, and `readTrace` defines the task to include queued jobs. Today only `forget_client` runs sessionless (its own trace keeps `content.payload.client_id`), but `enqueue()` accepts a null session for every kind, as queue.test does.
- Fix: in `forgetIntel`, read the `job_enqueued` rows of the collected traces, collect `meta.job_id`, and add `job_<id>` traces and `.in("job_id", ids)` deletes, recursively like `readTrace`'s MAX_LINKS. Alternatively, have `runAttempt` carry the client through the job context. Pin the probe.

#### Minor

1. Date-times in text are mangled: `2026-10-31 14:30` becomes `[number]:30`, and 10-digit epoch seconds (`exp=1761900000`, `t=…` in signature headers) become `[number]`. Contract rule 4 says dates stay. Hold `\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}` aside the way uuids are held. intelredact.ts:113.
2. Bytes in base64url (`-`/`_`) or in MIME line-wrapped base64 (76-character lines inside a larger text) pass both `BASE64_WHOLE` and the `[bytes]` rule. Probe: 4,000 characters of base64url were kept whole. The same rule over-matches the other way: any string over 200 characters without spaces becomes `{type: "base64"}` (a 20,000-character `note` did). Add `_-` to both classes and allow wrapped runs. intel.ts:223, 245; intelredact.ts:104.
3. Capture can throw: on the first failure in a process, the catch re-reads `opts?.name`, so a throwing `name` getter rethrows (probe: "THREW Error: x"). Contrived, but "never throws" is absolute. Compute the label inside its own try. intel.ts:403.
4. `captureCall` for the success path sits inside the `try` whose `catch` turns errors into a failed call (models.ts:422). Today nothing in it can throw, but a later field that throws would turn a good answer into a failure and capture it twice. Capture after the `try`. `captureJob("started")` before the handler's `try` (queue.ts:1052) has the same shape.
5. `stage`, and `trace_id` built from `ctx.traceId`/`sessionId`, are written as given: not redacted, not validated (intel.ts:383, 388). One bad call site puts free text or a non-uuid in an indexed column. Validate `sessionId` as a uuid and run `stage` through `redactText`.
6. `turnIdOf` hashes "anything else", so a raw phone passed by mistake becomes an unsalted 64-bit sha256 prefix (intel.ts:202). SA mobile numbers (~10^9) brute-force in seconds, so the fallback gives false assurance. Refuse it (null plus one warning), or salt it.
7. Shape gaps not covered by value: Supabase `sb_secret_…`/`sb_publishable_…` keys; `Authorization: <token>` with no scheme; `Bearer` tokens under 12 characters; rawHeaders arrays `["Cookie", "call_session=…"]`; URL-encoded emails `x%40example.test`. intelredact.ts:66-114.
8. The job context resets only `sessionId/jobId/channel/traceId` (queue.ts:941), so an outer `clientId`, `brokerId`, `turnId`, `stage` or `contentMode` carries into every job a drain runs inside that context. Today `worker.ts` drains inside a client-less `tracked()`, so this is latent. Set them to null in the job context. Relatedly, the declined-consent switch lives only on the context, so the jobs of a declined session capture full content unless each handler sets it. Note this for Task 3.4 so C-1744's test covers the pipeline jobs, not just the request.
9. `secretValues()` reads 18 env vars for every string redacted (intelredact.ts:148-155, 176). This is most of the ~20 MB/s the report measured, and a flush redacts its whole batch before the first insert, within `tracked()`'s 2.5 s bound. Hoist it to once per flush.
10. Meta over 16 KB is replaced wholesale by `{truncated_meta_bytes}`, dropping `broker_id`, `model`, `role` and `kind` (intel.ts:334). Cut the long values instead, as content does.
11. `readTrace` stops following links at 50 with no signal, returning a partial trace silently (intel.ts:673). Return or log that it was cut.

### Assessment

Spec: met for every criterion as pinned. C-1745's guarantee breaks under a concurrent flush (I-5) and for queued jobs (I-6). C-1738, C-1739 and C-1741 hold for the pinned inputs but miss common neighbours (I-1–I-3).

The core design is sound and clearly better than Charlie's: structural redaction, writing only after the response, the missing-table handling and the tombstones. The six Important items are each small, local fixes, and each should come with its probe pinned as a test, because every later task captures into this layer and its rows are the training dataset.

**Task quality: Needs fixes** (I-1 to I-6; the Minors at the implementer's discretion, with m-1, m-3 and m-8 recommended).
