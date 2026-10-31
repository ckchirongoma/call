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
//   - A secret-named key is judged by its words (accessToken, x-hub-signature-256,
//     login_code), not by exact spelling: the first version matched whole keys
//     only, and a probe kept every camelCase token (Task 0.6 review, I-1).
//   - Contact data (email addresses, phone numbers) becomes `[contact]`, as
//     turns.text stores it (SPEC 7.2), and redactContacts() is exported so
//     that redaction uses this one rule: two copies would drift, and C-1743
//     wants the two to agree exactly.
//   - Numbers are found however they are written: brackets, dots, double
//     spaces, a word glued on, read out digit by digit or in words (review
//     I-2). Rows' ids (uuids) and dates are held aside while the number rules
//     run, so `…-4000-8000-000000000001` and `2026-10-31 14:30` survive.
//   - Money is held aside too, and a spaced dash, a slash, a bracket or a
//     comma ends a number: "cover R1 000 000 - 2 000 000" was read as one
//     phone number, and turns.text (which extract_facts reads) would have
//     lost the client's cover range (Phase 0 review, I-1). A PIN, OTP or
//     code is the token right after its word, never money (review m-A).
//   - Bytes: any base64 or base64url run longer than 200 characters, or
//     line-wrapped, becomes `[bytes]` (intel.ts keeps a file as its type and
//     size before it gets here).
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
//     nine or more digits goes; money ("R3,000", "R12 500", "R1 500 000",
//     "20 000 - 25 000") and dates stay.
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

type Rule = [RegExp, string | ((match: string, ...groups: string[]) => string)];
/** A step of the identifier pass: a rule, or a shape to hold aside (and put back at the end) from here on. */
type Step = Rule | { hold: RegExp };

/** Base64 of real bytes has digits and both cases; a long run of one letter, or a slug, is not a file. */
const looksLikeBytes = (s: string): boolean => /\d/.test(s) && /[A-Z]/.test(s) && /[a-z]/.test(s);

/**
 * Secrets, by shape. These run first, on the text as it came, so a secret
 * that contains a uuid or a date (a uuid used as a token) goes whole.
 */
const SECRET_RULES: Rule[] = [
  // Private keys, whole.
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, R],
  // Bytes that slipped past intel.ts as text (a PDF or audio inline, base64 or
  // base64url, or wrapped at 76 characters): no natural word is like this.
  [/[A-Za-z0-9+/_-]{201,}={0,2}/g, (m) => (looksLikeBytes(m) ? "[bytes]" : m)],
  [/(?:[A-Za-z0-9+/_-]{40,}={0,2}[ \t]*\r?\n){2,}[A-Za-z0-9+/_-]{4,}={0,2}/g, (m) => (looksLikeBytes(m) ? "[bytes]" : m)],
  // A database connection string is a credential whole: user, password, host and all.
  [/\b(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|rediss?|amqps?):\/\/[^\s"'<>\\]+/gi, R],
  // scheme://user:password@host
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s:@/"'\\]+:[^\s@/"'\\]+@/gi, `$1${R}@`],
  // Cookie headers: every name=value pair after the colon.
  [/\b((?:set-)?cookie)(\s*:\s*)(?:[^\s;=,"\\]+=[^\s;,"\\]*(?:;\s*)?)+/gi, `$1$2${R}`],
  // An Authorization header's value, with or without a scheme.
  [/\b((?:proxy-)?authorization)(\s*[:=]\s*)(?:(?:Bearer|Basic|Token|Digest)\s+)?(?!\[redacted\])[^\s"',;\\]+/gi, `$1$2${R}`],
  // Authorization values; a short one only when written as the header writes it.
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi, `$1 ${R}`],
  [/\b(Bearer|Basic|Token)\s+(?!\[redacted\])[A-Za-z0-9._~+/=-]{6,}/g, `$1 ${R}`],
  // A signature header (x-hub-signature-256, elevenlabs-signature: t=…,v0=…), value whole.
  [/\b((?:[A-Za-z0-9]+-)*signature(?:-\d+)?)(\s*[:=]\s*)(?!\[redacted\])[^\s"']+/gi, `$1$2${R}`],
  // JWTs (Supabase's legacy keys are JWTs).
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, R],
  // Vendor key shapes: OpenRouter and OpenAI (sk-), ElevenLabs (sk_, xi-), Supabase (sb_), Stripe-style, Meta, AWS, GitHub, Slack, Resend, webhooks, Google.
  [/\bsk-(?:or-v1-|proj-|ant-[a-z0-9]+-)?[A-Za-z0-9_-]{16,}/g, R],
  [/\bsk_[A-Za-z0-9]{24,}/g, R],
  [/\bxi-[A-Za-z0-9_-]{24,}/g, R],
  [/\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{16,}/g, R],
  [/\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}/g, R],
  [/\bEAA[A-Za-z0-9]{30,}/g, R],
  [/\bAKIA[0-9A-Z]{16}\b/g, R],
  [/\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}/g, R],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/g, R],
  [/\bre_[A-Za-z0-9_]{20,}/g, R],
  [/\bwhsec_[A-Za-z0-9+/=]{16,}/g, R],
  [/\bAIza[0-9A-Za-z_-]{35}/g, R],
  // The signed quotation link (SPEC §11): whoever holds /q/<id>?exp=…&sig=…
  // can open the quotation, so the link goes whole, its id too. Escaped
  // slashes (`\/q\/`) are the same link inside someone else's JSON text.
  [/(\\?\/q\\?\/)[A-Za-z0-9_-]+(?:\?[^\s"'<>\\]*)?/g, `$1${R}`],
  // Any other signed or tokened link: a parameter whose name has a secret word
  // in it, prefixed or not (conversation_signature, X-Amz-Signature, session_token).
  // Only after ? or &: a MIME type's ;codecs=opus is not a link.
  [/([?&][\w.%[\]-]*?(?:sig|token|secret|key|code|auth|credential|passw)[\w.%[\]-]*=)[^&\s"'\\#<>]+/gi, `$1${R}`],
  // A WhatsApp message id encodes the sender's number: it is an id, not something to keep.
  [/\bwamid\.[A-Za-z0-9+/=_-]+/g, "wamid.[id]"],
  // A sign-in (magic) link with its token in the path.
  [/(\/(?:login|magic|signin|sign-in|verify|auth)\/)[A-Za-z0-9_-]{16,}/gi, `$1${R}`],
  // "token Zm9vYmFy…" with no colon: only a value that looks like one (long, letters and digits).
  [/\b(token|secret|password|api[_-]?key|signature)(\s+)(?!\[redacted\])([A-Za-z0-9._~+/=-]{20,})/gi, (m, word: string, gap: string, value: string) => (/\d/.test(value) && /[A-Za-z]/.test(value) ? `${word}${gap}${R}` : m)],
  // key=value and "key: value" in prose and logs.
  [/\b(api[_-]?key|secret|passw(?:or)?d|passcode|token|credentials?|cvv|cvc)\b(\s*(?:is|was|:|=)\s*["']?)(?!\[redacted\])[^\s"',;\\]{3,}/gi, `$1$2${R}`],
];

/**
 * Held aside while the identifier rules run, and put back after: a row's ids
 * (uuids: their digit groups, read across the dashes, are a "run of nine or
 * more digits") and dates and times (2026-10-31 14:30 is ten digits with
 * spaces and dashes), which the contract keeps.
 */
const HOLD_RULES: RegExp[] = [
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
  /(?<![\w./-])\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})?)?(?![\w/-])/g,
  /(?<![\w./-])\d{1,2}[/.]\d{1,2}[/.]\d{4}(?:,?[ T]\d{1,2}:\d{2}(?::\d{2})?)?(?![\w./-])/g,
  // An epoch time in a parameter (exp=, t=): a date too.
  /\b(?:exp|expires|iat|nbf|ts|t)=\d{10,13}\b/g,
];

/** Private-use characters around a letters-only index: no rule below matches them. */
const HOLD = (i: number): string => `\uE000${i.toString(26).replace(/[0-9]/g, (d) => "qrstuvwxyz"[Number(d)]!)}\uE001`;
const HELD = /\uE000([a-z]+)\uE001/g;
const unhold = (letters: string): number => parseInt(letters.replace(/[q-z]/g, (c) => String("qrstuvwxyz".indexOf(c))), 26);

// A digit separator inside one number as people write one: one or two
// spaces, a dash or an en dash with nothing around it (079-993-0001), or a
// dot between groups of three or four (079.993.0001, 1.500.000), never before
// a decimal's one or two digits, so R1 500 000.00 and R1 500,50 keep their
// cents. A spaced dash, a slash, a bracket or a comma is a break between two
// numbers: "R100 000 - 200 000", "R150 000/200 000" and "R150 000 (200 000
// with spouse)" are two amounts each. The first version took up to three of
// any of these as one gap, and read money ranges as phone numbers (Phase 0
// review, I-1).
const SEP = String.raw`(?:[ \t\u00a0]{1,2}|[-–](?=\d)|\.(?=\d{3,4}(?!\d)))`;
// A number that is an identifier by its shape alone (led by a 0, or in a
// card's groups of four or an ID's 6-4-3) may also be written with spaced
// dashes or slashes (0123/456/789, 4111 - 1111 - 1111 - 1111,
// 800101 / 5009 / 087): an amount never has that shape, and is held aside
// before these rules run anyway.
const WSEP = String.raw`(?:${SEP}|[ \t\u00a0]{0,2}[-–/][ \t\u00a0]{0,2})`;
// A phone number's own: spaced dashes, not slashes, so "079 993 0001 /
// 079 993 0002" is two of them. It ends where its digits stop: a number that
// goes on across one of these is something longer (an ID led by a 0).
const PSEP = String.raw`(?:${SEP}|[ \t\u00a0]{1,2}[-–][ \t\u00a0]{1,2})`;
const PHONE_END = String.raw`(?!${PSEP}?\d)(?!\w)`;
const DIGIT_WORD = "zero|oh|one|two|three|four|five|six|seven|eight|nine";

// ── Money, held aside ────────────────────────────────────────────
//
// An amount as people and formatRand ("R 1 500 000") write it. A grouped
// amount never starts with 0 (a phone number does) and its groups are three
// digits each, so a phone's, a card's or an ID's groups (079 993 0001,
// 4111 1111, 800101 5009 087) are never one: an amount does not start or end
// inside a longer run of digit groups. Unmarked, it has at most eight digits:
// nine or more is an identifier (contract rule 4), so "621 234 567" is an
// account number until a currency says otherwise.
const CURRENCY = String.raw`(?:R|ZAR|USD|EUR|GBP|US\$|\$|€|£)`;
const CENTS = String.raw`(?:[.,]\d{1,2}(?!\d))?`;
const AMOUNT_START = String.raw`(?<![\w.,+]|\d[ \t\u00a0]{1,2})`;
const AMOUNT_END = String.raw`(?!\d)(?![ \t\u00a0]{1,2}\d)(?![.,]\d)`;
/** Money with its currency (any size), and unmarked amounts of seven or eight digits: never a PIN, an OTP or a code. */
const MONEY_SURE = new RegExp(
  String.raw`${AMOUNT_START}${CURRENCY}[ \u00a0]?(?:[1-9]\d{0,2}(?:(?:[ \u00a0]\d{3}){1,4}|(?:,\d{3}){1,4})|\d{1,9})${CENTS}${AMOUNT_END}` +
    String.raw`|${AMOUNT_START}[1-9]\d?(?:[ \u00a0]\d{3}){2}${CENTS}${AMOUNT_END}`,
  "gi",
);
/** Unmarked amounts of four to six digits (4 500, 25 000): held only after the PIN rules, since a code can be written "482 913". */
const MONEY_SHORT = new RegExp(String.raw`${AMOUNT_START}[1-9]\d{0,2}[ \u00a0]\d{3}${CENTS}${AMOUNT_END}`, "gi");

/** Email addresses and phone numbers: `[contact]`, as turns.text stores them (SPEC 7.2). */
const EMAIL_RULES: Rule[] = [
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, "[contact]"],
  [/[\w.+-]+%40[\w-]+(?:\.[\w-]+)+/gi, "[contact]"],
];
const PHONE_RULES: Rule[] = [
  // South African: 0XX XXX XXXX, +27 XX XXX XXXX, 0027 …, +27 (0)XX …, (0XX) XXX XXXX, with any of the separators.
  [new RegExp(String.raw`(?<![\w+(%])(?:(?:(?:\+|00|%2B)?27${PSEP}?(?:\(0\)${PSEP}?)?|0)(?:${PSEP}?\d){9}|\(0\d{2}\)[ \t\u00a0]{0,2}(?:${PSEP}?\d){7})${PHONE_END}`, "gi"), "[contact]"],
  // Anywhere else, written with its + (and perhaps a bracketed area code: +44 (0)20 …, (+27) …).
  [new RegExp(String.raw`(?<![\w+%])(?:\+|%2B)\d{1,3}\)?(?:[ \t\u00a0]{0,2}\(\d{1,4}\))?(?:${SEP}?\d){6,13}${PHONE_END}`, "gi"), "[contact]"],
];

/** Money first, then email addresses and phone numbers: the one rule for turns.text and for capture (C-1743). */
const CONTACT_STEPS: Step[] = [{ hold: MONEY_SURE }, { hold: MONEY_SHORT }, ...EMAIL_RULES, ...PHONE_RULES];

/** Identifiers. Run with uuids and dates held aside, and money once the PIN rules have had their look. */
const IDENTIFIER_STEPS: Step[] = [
  { hold: MONEY_SURE },
  ...EMAIL_RULES,
  // PINs, OTPs and sign-in codes: the digits right after the word, across
  // spaces, a line break, punctuation, an "is" or an HTML tag (an email puts
  // the code in a <p> of its own), or just before it ("4471 is my pin"). The
  // first version crossed any sixty characters, so "the promo code applies
  // to premiums of R1 500" lost its money (Phase 0 review, m-A). A run that
  // goes on past eight digits is not a code ("area code 079 993 0001").
  [/\b(pin|otp|one[- ]time (?:pin|code|password)|code)\b((?:[\s:;,.#=*"'()[\]\-–—]|<[^>]{0,300}>|\b(?:is|was)\b){0,20}?)\d(?:[ -]?\d){3,7}(?![ -]?\d)/gi, `$1$2${R}`],
  [/(?<!\d[ -]?)\d(?:[ -]?\d){3,7}(?![ -]?\d)(?=[^\d\n]{0,15}\b(?:pin|otp)\b)/gi, R],
  { hold: MONEY_SHORT },
  ...PHONE_RULES,
  // A number read out digit by digit ("0, 7, 9, …") or in words ("zero seven nine …").
  [/(?<![\w.,])\d(?!\d)(?:(?:,\s?|\s)\d(?!\d)){8,}/g, "[number]"],
  [new RegExp(String.raw`\b(?:(?:${DIGIT_WORD}|double|triple)[\s,.-]+){8,}(?:${DIGIT_WORD})\b`, "gi"), "[number]"],
  // Thirteen or more digits in a row (an ID, a card) go even with a word glued on (x8001015009087).
  [/(?<!\d)\d{13,19}(?!\d)/g, "[number]"],
  // A card in groups of four, or an ID in its 6-4-3, spaced dashes and slashes and all.
  [new RegExp(String.raw`(?<![\w.])(?:\d{4}(?:${WSEP}\d{4}){2,3}(?:${WSEP}\d{1,3})?|\d{6}${WSEP}\d{4}${WSEP}\d{3})(?!${WSEP}?\d)(?!\w)`, "g"), "[number]"],
  // Nine or more digits, however separated: ID, card, account and other
  // numbers (one led by a 0 across slashes and spaced dashes too). Money and
  // dates are held aside above. Preceded by a start, a non-word character
  // ("no.", "ID:"), or an escaped \n, \t or \r.
  [new RegExp(String.raw`(?:(?<!\w)|(?<=\\[ntr]))(?<!\d\.)(?:\+?\d(?:${SEP}?\d){8,}|0(?:${WSEP}?\d){8,})(?!\w)`, "g"), "[number]"],
];

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

const apply = (s: string, rules: Rule[]): string => rules.reduce((t, [re, to]) => t.replace(re, to as string), s);

/**
 * Run `steps` with uuids and dates held aside, and whatever a `hold` step
 * names from that step on. Any placeholder already in the input is dropped
 * first, so none can be forged.
 */
function withHeld(s: string, steps: Step[]): string {
  const held: string[] = [];
  const hold = (t: string, re: RegExp): string => t.replace(re, (m) => HOLD(held.push(m) - 1));
  let t = s.replace(HELD, "");
  for (const re of HOLD_RULES) t = hold(t, re);
  for (const step of steps) t = "hold" in step ? hold(t, step.hold) : t.replace(step[0], step[1] as string);
  return held.length ? t.replace(HELD, (_m, letters: string) => held[unhold(letters)] ?? "") : t;
}

function textWith(input: string, secrets: readonly string[]): string {
  let s = clean(String(input));
  for (const v of secrets) if (s.includes(v)) s = s.split(v).join(R);
  return withHeld(apply(s, SECRET_RULES), IDENTIFIER_STEPS);
}

/** Text with every secret and identifier taken out. Never throws. */
export function redactText(input: string): string {
  try {
    return textWith(input, secretValues());
  } catch {
    return "[unreadable]";
  }
}

/**
 * Email addresses and phone numbers only, as `[contact]`: the rule SPEC 7.2's
 * turn redaction uses too, so a turn and its `ask` row agree exactly (C-1743).
 */
export function redactContacts(input: string): string {
  try {
    return withHeld(clean(String(input)), CONTACT_STEPS);
  } catch {
    return "[unreadable]";
  }
}

// ── Keys ─────────────────────────────────────────────────────────

/** A key's words: accessToken → access, token; x-hub-signature-256 → x, hub, signature, 256. */
const wordsOf = (key: string): string[] => key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** A key whose last word is one of these holds a secret, whatever comes before it. */
const SECRET_WORDS: ReadonlySet<string> = new Set([
  "password", "passwd", "passcode", "passphrase", "pwd", "secret", "token", "signature", "sig", "cookie", "authorization",
  "otp", "pin", "cvv", "cvc", "credential", "credentials", "bearer", "jwt", "apikey",
]);
/** …key is a secret after one of these (api_key, serviceRoleKey); a dedupe_key or a disclosure's key is not. */
const KEY_OWNERS: ReadonlySet<string> = new Set(["api", "private", "role", "secret", "access", "signing", "service", "encryption", "master", "webhook", "license", "session"]);
/** …code is a secret after one of these (login_code, signInCode, verification_code); a provider's error `code` is not (INTEL-CONTRACT §3 `send`). */
const CODE_OWNERS: ReadonlySet<string> = new Set(["login", "signin", "in", "verification", "auth", "oauth", "otp", "pin", "time", "sms", "confirmation", "security", "access"]);
/** Words that say how a secret is held, not what it is: token_value, signature_header, x-hub-signature-256. */
const TRANSPARENT: ReadonlySet<string> = new Set(["value", "hash", "raw", "b64", "base64", "hex", "header", "string", "encoded", "encrypted"]);
const WHOLE_KEYS: ReadonlySet<string> = new Set(["auth", "code_hash", "token_hash"]);

/** Whether a JSON key's value is always secret (C-1738): judged by its words, any case or separator. */
export function isSecretKey(key: string): boolean {
  const words = wordsOf(key);
  if (WHOLE_KEYS.has(words.join("_"))) return true;
  while (words.length > 1 && (/^\d+$/.test(words[words.length - 1]!) || TRANSPARENT.has(words[words.length - 1]!))) words.pop();
  const last = words[words.length - 1];
  const prev = words[words.length - 2];
  if (!last) return false;
  if (SECRET_WORDS.has(last)) return true;
  if (last === "key" && prev !== undefined && KEY_OWNERS.has(prev)) return true;
  return last === "code" && prev !== undefined && CODE_OWNERS.has(prev);
}

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
  const words = wordsOf(key);
  return words.length > 0 && KEEP_LAST_WORD.has(words[words.length - 1]!);
}

/**
 * A bare `code` (or `…_code`) holding six digits as text: the sign-in code's
 * shape (C-1100: a 6-digit code), which C-1741 says is never written. An error
 * code is not this: SQLSTATE is five characters, Meta's codes are numbers.
 */
const isSignInCode = (key: string, value: unknown): boolean => typeof value === "string" && /^\s*\d{6}\s*$/.test(value) && wordsOf(key).at(-1) === "code";

const KEY_WORTH_READING = /[\d@]|[^]{24}/;
/** Node's rawHeaders and the like: a flat list of name, value, name, value. */
const HEADER_LIST = /headers$/i;

/** Nine or more digits in the whole part. */
const longNumber = (n: number): boolean => Number.isFinite(n) && Math.abs(Math.trunc(n)) >= 100_000_000;

function walk(v: unknown, key: string | null, depth: number, secrets: readonly string[]): unknown {
  if (typeof v === "string") return textWith(v, secrets);
  if (typeof v === "number") return longNumber(v) && !keepsNumber(key) ? "[number]" : v;
  if (v === null || typeof v !== "object") return v;
  if (depth > 64) return "[too deep]";
  if (Array.isArray(v)) {
    // An array's items are read under the array's key (premiums: [...] is money).
    const pairs = key !== null && HEADER_LIST.test(key);
    return v.map((x, i) => (pairs && i % 2 === 1 && typeof v[i - 1] === "string" && isSecretKey(v[i - 1] as string) && x !== null && x !== "" ? R : walk(x, key, depth + 1, secrets)));
  }
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) {
    // A key can itself be an identifier (an object keyed by phone number) or a
    // secret; a short key with no digit and no @ is neither, and skips the rules.
    out[KEY_WORTH_READING.test(k) ? textWith(k, secrets) : k] = (isSecretKey(k) && x !== null && x !== "") || isSignInCode(k, x) ? R : walk(x, k, depth + 1, secrets);
  }
  return out;
}

/**
 * A value with secrets and identifiers out, the same shape: values under
 * secret-named keys go whole; every string goes through the text rules; a long
 * number goes unless its key is money, a time, a size or a count. The
 * deployment's secrets are read once per call, not once per string. Never throws.
 */
export function redactDeep<T>(value: T): T {
  try {
    return walk(value, null, 0, secretValues()) as T;
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
    return redactText(json);
  }
}
