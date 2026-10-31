// Call — Chase Intelligence: what never leaves the process (docs/INTEL-CONTRACT.md §4).
//
// Ported from Charlie `api/_lib/intelredact.ts` (commit 59b6cb4); the
// why-comments are kept. What Call changes, each for a reason given where it
// happens:
//   - This deployment's secrets (every key, secret and token in .env.example,
//     pinned by test/intel-redact.test.ts) and the signed quotation link
//     `/q/<id>?exp=…&sig=…`.
//   - JSON is redacted as a value, not as text (redactDeep). Charlie ran the
//     text rules over the JSON text, which turned a nine-digit JSON number into
//     `[number]` unquoted: invalid JSON, and the whole row read back as
//     `{unreadable: true}`. In Call a cover of R1 500 000 is 150 000 000 cents,
//     so every quotation would have been lost that way. A long number now goes
//     only when its key is not money, a time, a size or a count (the
//     allowlist below), and it goes as the string "[number]".
//   - Contact data (email addresses, phone numbers) becomes `[contact]`, as
//     turns.text stores it (SPEC 7.2), so the ask row and the turn agree.
//   - Bytes: any base64 run longer than 200 characters becomes `[bytes]`
//     (intel.ts keeps a file as its type and size before it gets here).
//   - NUL and lone surrogates go: Postgres refuses both in jsonb, and with
//     them the whole batch of 500 rows.
//
// Every captured event and every exported line goes through here, twice:
// once before it is written, once more on export. Two kinds of thing go:
//
//   - Secrets: this deployment's own keys (matched by value, whatever they
//     look like), and anything shaped like a key, token, JWT, private key,
//     connection string, password, cookie or signed link.
//   - Identifiers (contract rule 4): ID, card, account and phone numbers,
//     email addresses, PINs, OTPs, passwords and sign-in codes. Any run of
//     nine or more digits goes, so money ("R3,000", "R12 500", "R1 500 000")
//     and dates stay.
//
// Pure: no database, no settings module, nothing that can throw outward.

/**
 * This deployment's secrets, matched by value: every variable in .env.example
 * whose name says KEY, SECRET or TOKEN (test/intel-redact.test.ts fails when
 * one is added there and not here). Read at call time so a rotated key is
 * covered at once.
 */
export const SECRET_ENV: readonly string[] = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "OPENROUTER_API_KEY",
  "WORKER_SECRET",
  "SESSION_SECRET",
  "ELEVENLABS_API_KEY",
  "ELEVENLABS_WEBHOOK_SECRET",
  // Task 3.3's rotation slot: covered before it exists, so adding it cannot leak.
  "ELEVENLABS_WEBHOOK_SECRET_PREVIOUS",
  "VOICE_TOOL_SECRET",
  "RESEND_API_KEY",
  "RESEND_WEBHOOK_SECRET",
  "WHATSAPP_APP_SECRET",
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_VERIFY_TOKEN",
  "GROQ_API_KEY",
  "OPENAI_API_KEY",
  "TYPESAFE_API_KEY",
  "CRON_SECRET",
  "ADMIN_SECRET",
];

const R = "[redacted]";

const PATTERNS: [RegExp, string][] = [
  // Private keys, whole.
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, R],
  // A database connection string is a credential whole: user, password, host and all.
  [/\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|rediss?|amqps?):\/\/[^\s"'<>\\]+/gi, R],
  // scheme://user:password@host
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s:@/"'\\]+:[^\s@/"'\\]+@/gi, `$1${R}@`],
  // Cookie headers: every name=value pair after the colon.
  [/\b((?:set-)?cookie)(\s*:\s*)(?:[^\s;=,"\\]+=[^\s;,"\\]*(?:;\s*)?)+/gi, `$1$2${R}`],
  // Authorization values.
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi, `$1 ${R}`],
  // JWTs (Supabase keys are JWTs).
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, R],
  // Vendor key shapes: OpenRouter and OpenAI (sk-), ElevenLabs (sk_, xi-), Stripe-style, Meta, AWS, GitHub, Slack, Resend, webhooks, Google.
  [/\bsk-(?:or-v1-|proj-|ant-[a-z0-9]+-)?[A-Za-z0-9_-]{16,}/g, R],
  [/\bsk_[A-Za-z0-9]{24,}/g, R],
  [/\bxi-[A-Za-z0-9_-]{24,}/g, R],
  [/\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}/g, R],
  [/\bEAA[A-Za-z0-9]{30,}/g, R],
  [/\bAKIA[0-9A-Z]{16}\b/g, R],
  [/\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}/g, R],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, R],
  [/\bre_[A-Za-z0-9_]{20,}/g, R],
  [/\bwhsec_[A-Za-z0-9+/=]{16,}/g, R],
  [/\bAIza[0-9A-Za-z_-]{35}/g, R],
  // The signed quotation link (SPEC §11): whoever holds /q/<id>?exp=…&sig=… can
  // open the quotation, so the link goes whole, its id too (a uuid is held aside
  // by redactText while these run: hence the second alternative).
  [/(\/q\/)(?:[A-Za-z0-9_-]+|\uE000[a-z]+\uE001)(?:\?[^\s"'<>\\]*)?/g, `$1${R}`],
  // Any other signed or tokened link.
  [/([?&](?:k|key|token|code|secret|sig|signature|access_token|auth)=)[^&\s"'\\#]+/gi, `$1${R}`],
  // A WhatsApp message id encodes the sender's number: it is an id, not something to keep.
  [/\bwamid\.[A-Za-z0-9+/=_-]+/g, "wamid.[id]"],
  // key=value and "key: value" in prose and logs.
  [/\b(api[_-]?key|secret|passw(?:or)?d|passcode|token|cvv|cvc)\b(\s*(?:is|was|:|=)\s*["']?)(?!\[redacted\])[^\s"',;\\]{3,}/gi, `$1$2${R}`],
  // PINs, OTPs and sign-in codes: the digits after the word.
  [/\b(pin|otp|one[- ]time (?:pin|code|password)|code)\b([^\d\n\\]{0,25}?)\d{4,8}\b/gi, `$1$2${R}`],
  // Bytes that slipped past intel.ts as text (a PDF or audio inline): no natural word is 200 characters of base64.
  [/[A-Za-z0-9+/]{201,}={0,2}/g, "[bytes]"],
  // Contact data, as turns.text stores it (SPEC 7.2): email addresses, then
  // South African and international phone numbers.
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[contact]"],
  [/(?<![\w+])(?:\+?27|0)(?:[ -]?\d){9}(?![\w])/g, "[contact]"],
  [/(?<![\w+])\+\d{1,3}(?:[ -]?\d){6,13}(?![\w])/g, "[contact]"],
  // Nine or more digits, with or without spaces and dashes inside: ID, card,
  // account and other numbers. Money and dates are shorter.
  // (Preceded by a start, a non-word character, or an escaped \n, \t or \r inside JSON text.)
  [/(?<=^|[^\w.]|\\[ntr])\+?\d(?:[ -]?\d){8,}(?![\w])/g, "[number]"],
];

/**
 * JSON keys whose values are always secret, whatever they hold (a string, a
 * number, a whole object). Matched on the whole key, any case; `prompt_tokens`
 * and `max_tokens` are counts, not secrets, and so is a `code` (a provider's
 * error code, INTEL-CONTRACT §3 `send`).
 */
const SECRET_KEY =
  /^(?:authorization|proxy-authorization|cookie|set-cookie|password|passwd|passcode|secret|token|api[-_]?key|apikey|private[-_]?key|client[-_]?secret|signature|sig|pin|otp|cvv|cvc|code_hash|token_hash)$|[-_](?:secret|token|signature|password|passcode|api[-_]?key|role[-_]?key|private[-_]?key|signing[-_]?key)$/i;

/**
 * Keys whose long numbers are kept: money (a cover of R1 500 000 is 150 000 000
 * cents), times (epoch milliseconds are thirteen digits), sizes and counts.
 * Any other number of nine or more digits is an identifier until shown
 * otherwise: an ID number or a phone number in a tool's arguments. Judged by
 * the key's last word, so `total_premium_cents` and `sentAt` keep theirs and
 * `account` (which ends in "count") does not.
 */
const KEEP_LAST_WORD: ReadonlySet<string> = new Set([
  "cents", "amount", "premium", "premiums", "cover", "budget", "income", "salary", "price", "cost", "fee", "total", "balance",
  "at", "ts", "timestamp", "time", "epoch", "ms", "secs", "seconds", "duration",
  "bytes", "size", "chars", "tokens", "count", "qty",
]);
/** facts.value_num and its range (SPEC §4): a fact's amount, in its own unit. */
const KEEP_KEY: ReadonlySet<string> = new Set(["value_num", "value_min", "value_max"]);

function keepsNumber(key: string | null): boolean {
  if (key === null) return false;
  if (KEEP_KEY.has(key.toLowerCase())) return true;
  const words = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return words.length > 0 && KEEP_LAST_WORD.has(words[words.length - 1]!);
}

function secretValues(): string[] {
  const out: string[] = [];
  for (const k of SECRET_ENV) {
    const v = process.env[k];
    if (v && v.length >= 8) out.push(v);
  }
  return out;
}

/** Postgres refuses NUL and a lone surrogate in jsonb and text, and with them the whole insert. */
const clean = (s: string): string => s.replace(/\u0000/g, "").replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "\uFFFD");

/**
 * A uuid is a row's id (a session, a quote, a client), not a person's number,
 * and the record is useless without them: but its digit groups, read across
 * the dashes, are a "run of nine or more digits" (…-4000-8000-000000000001).
 * So uuids are set aside while the rules run, and put back after.
 */
const UUID_IN_TEXT = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
/** Private-use characters around a letters-only index: nothing below matches them. */
const HOLD = (i: number): string => `\uE000${i.toString(26).replace(/[0-9]/g, (d) => "qrstuvwxyz"[Number(d)]!)}\uE001`;
const HELD = /\uE000([a-z]+)\uE001/g;
const unhold = (letters: string): number => parseInt(letters.replace(/[q-z]/g, (c) => String("qrstuvwxyz".indexOf(c))), 26);

/** Text with every secret and identifier taken out. Never throws. */
export function redactText(input: string): string {
  try {
    let s = clean(String(input));
    for (const v of secretValues()) if (s.includes(v)) s = s.split(v).join(R);
    const held: string[] = [];
    s = s.replace(HELD, "").replace(UUID_IN_TEXT, (u) => HOLD(held.push(u) - 1));
    for (const [re, to] of PATTERNS) s = s.replace(re, to);
    return held.length ? s.replace(HELD, (_m, letters: string) => held[unhold(letters)] ?? "") : s;
  } catch {
    return "[unreadable]";
  }
}

const KEY_WORTH_READING = /[\d@]|[^]{24}/;

/** Nine or more digits in the whole part. */
const longNumber = (n: number): boolean => Number.isFinite(n) && Math.abs(Math.trunc(n)) >= 100_000_000;

function walk(v: unknown, key: string | null, depth: number): unknown {
  if (typeof v === "string") return redactText(v);
  if (typeof v === "number") return longNumber(v) && !keepsNumber(key) ? "[number]" : v;
  if (v === null || typeof v !== "object") return v;
  if (depth > 64) return "[too deep]";
  // An array's items are read under the array's key (premiums: [...] is money).
  if (Array.isArray(v)) return v.map((x) => walk(x, key, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) {
    // A key can itself be an identifier (an object keyed by phone number) or a
    // secret; a short key with no digit and no @ is neither, and skips the rules.
    out[KEY_WORTH_READING.test(k) ? redactText(k) : k] = SECRET_KEY.test(k) && x !== null && x !== "" ? R : walk(x, k, depth + 1);
  }
  return out;
}

/**
 * A value with secrets and identifiers out, the same shape: values under
 * secret-named keys go whole; every string goes through redactText; a long
 * number goes unless its key is money, a time, a size or a count. Never throws.
 */
export function redactDeep<T>(value: T): T {
  try {
    return walk(value, null, 0) as T;
  } catch {
    return "[unreadable]" as T;
  }
}

/**
 * A JSON text with secrets out, still valid JSON (the export's lines, and any
 * stored jsonb read back). Text that is not JSON gets the text rules.
 */
export function redactJson(json: string): string {
  try {
    return JSON.stringify(redactDeep(JSON.parse(json))) ?? "null";
  } catch {
    try {
      return redactText(json);
    } catch {
      return "null";
    }
  }
}
