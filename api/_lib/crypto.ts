// Call — webhook signature verification, and the HMAC helpers it is built on.
//
// Ported from Charlie `api/_lib/crypto.ts`; the why-comments are kept.
// Charlie's hashSecret / mintToken / mintNumericCode are not here: login codes
// and signed links land with auth.ts and links.ts, which bring what they use.
//
// Three vendors sign their webhooks, three different ways
// (docs/VERIFIED.md has where each shape came from):
//
//   ElevenLabs  elevenlabs-signature: t=<unix>,v0=<hex>[,v0=<hex>]
//               hex    = HMAC-SHA256(secret, `${t}.` + raw)
//   Resend      svix-id, svix-timestamp, svix-signature: v1,<b64>[ v1,<b64>]
//               b64    = HMAC-SHA256(base64-decoded whsec_ secret, `${id}.${timestamp}.` + raw)
//   Meta        X-Hub-Signature-256: sha256=<hex>
//               hex    = HMAC-SHA256(app secret, raw)
//
// The rules all three follow, and why:
//
//  1. Over the RAW bytes, never a parsed body. A body that is parsed and
//     re-serialised loses its exact whitespace, key order and escapes, so the
//     signature over the bytes that were sent no longer matches it. Each
//     verifier therefore takes the bytes and throws a TypeError on anything
//     else: a handler that hands over a platform-parsed req.body fails its
//     first test loudly, instead of answering every real delivery with a 401
//     that looks like an attack. Bytes also mean a multibyte character counts
//     as the bytes that were signed, never as a string length.
//  2. Constant-time comparison, with the length checked first. `===` on two
//     digests returns at the first differing character, which tells a forger
//     how much of a guess was right; timingSafeEqual does not, but it throws
//     when the lengths differ, so the length (public anyway) is checked first.
//  3. An empty secret never verifies. An HMAC with an empty key is one anyone
//     can compute, so an unset secret must fail closed, not open. (The handler
//     answers 503 when its secret is unset, C-0411; this is the backstop.)
//  4. A replay window. A signed delivery stays valid forever unless its
//     timestamp is checked, and the timestamp is inside the signed content, so
//     moving an old signature to a fresh timestamp breaks it.
//  5. Bad input from a request is an answer, never a throw. A malformed header
//     is a 401 with a reason; the TypeError in rule 1 is a programming error.
//
// node:crypto is used through its module object, not named imports, so that
// test/crypto.test.ts can count the timingSafeEqual calls (C-0421, C-1590):
// "it uses timingSafeEqual" is asserted, not taken on trust.

import nodeCrypto, { type Hmac } from "node:crypto";

type Bytes = Buffer | Uint8Array;

/** Why a signature was refused. The handler logs it and answers 401. */
export type SignatureReason = "missing" | "malformed" | "stale" | "future" | "mismatch";

export interface SignatureCheck {
  ok: boolean;
  reason?: SignatureReason;
  /** Which of the secrets matched (0 = current, 1 = previous during a rotation). */
  secretIndex?: number;
}

/**
 * ElevenLabs' own docs sample accepts a delivery up to 30 minutes old
 * (docs/VERIFIED.md). A tighter window would refuse genuine deliveries that the
 * vendor's own code accepts.
 */
const ELEVENLABS_MAX_AGE_SECS = 1800;
/** Ahead of our clock by more than skew can explain means the timestamp was made up. */
const ELEVENLABS_MAX_AHEAD_SECS = 300;
/** svix's own tolerance, either side of now. */
const RESEND_TOLERANCE_SECS = 300;

/** Rule 1: the bytes, or a TypeError naming the wiring bug. */
function assertBytes(raw: unknown, who: string): asserts raw is Bytes {
  if (!(raw instanceof Uint8Array)) {
    throw new TypeError(`${who} needs the raw request body as a Buffer, read from the stream before any parsing — got ${raw === null ? "null" : typeof raw}.`);
  }
}

function hmac(secret: string | Bytes, parts: Array<string | Bytes>): Hmac {
  const h = nodeCrypto.createHmac("sha256", secret);
  for (const p of parts) {
    if (typeof p === "string") h.update(p, "utf8");
    else h.update(p);
  }
  return h;
}

/** HMAC-SHA256, hex. */
export function hmacHex(secret: string | Bytes, data: string | Bytes): string {
  return hmac(secret, [data]).digest("hex");
}

/** SHA-256, hex. */
export function sha256Hex(data: string | Bytes): string {
  const h = nodeCrypto.createHash("sha256");
  if (typeof data === "string") h.update(data, "utf8");
  else h.update(data);
  return h.digest("hex");
}

/**
 * Constant-time compare of two digests, safe against length mismatch. Works on
 * the text's bytes, so it serves base64 digests as well as hex.
 *
 * Unlike Charlie's, two empty strings are NOT equal: a digest that came out
 * empty is a bug or an unset value, and must never count as a match.
 */
export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(typeof a === "string" ? a : "", "utf8");
  const bb = Buffer.from(typeof b === "string" ? b : "", "utf8");
  if (ba.length === 0 || ba.length !== bb.length) return false;
  return nodeCrypto.timingSafeEqual(ba, bb);
}

const isBlank = (s: string | null | undefined): boolean => typeof s !== "string" || s.trim() === "";
const DIGITS = /^\d+$/;
const nowSeconds = (): number => Math.floor(Date.now() / 1000);

/**
 * The ElevenLabs post-call webhook. `secrets` is [current, previous]: during a
 * rotation both verify, and `secretIndex` says which one did so the handler
 * can log it (C-0422). An empty slot is skipped but keeps its position, so the
 * index always names the same variable.
 */
export function verifyElevenLabs(
  raw: Buffer,
  header: string | null | undefined,
  secrets: string[],
  nowSecs: number = nowSeconds(),
): SignatureCheck {
  assertBytes(raw, "verifyElevenLabs");
  if (isBlank(header)) return { ok: false, reason: "missing" };

  // t=<unix>,v0=<hex>,v0=<hex>… — parts it does not know are ignored, so a
  // future v1 next to v0 does not break verification.
  const ts: string[] = [];
  const candidates: string[] = [];
  for (const part of (header as string).split(",")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "t") ts.push(value);
    else if (key === "v0" && value) candidates.push(value.toLowerCase());
  }
  // Two t values would leave it ambiguous which one was signed.
  if (ts.length !== 1 || !DIGITS.test(ts[0]) || candidates.length === 0) return { ok: false, reason: "malformed" };

  // The string as sent is what was signed; the number is only for the window.
  const t = ts[0];
  const age = nowSecs - Number(t);
  if (age > ELEVENLABS_MAX_AGE_SECS) return { ok: false, reason: "stale" };
  if (-age > ELEVENLABS_MAX_AHEAD_SECS) return { ok: false, reason: "future" };

  for (let i = 0; i < secrets.length; i++) {
    const secret = secrets[i];
    if (isBlank(secret)) continue; // rule 3
    const expected = hmac(secret, [`${t}.`, raw]).digest("hex");
    if (candidates.some((c) => safeEqualHex(c, expected))) return { ok: true, secretIndex: i };
  }
  return { ok: false, reason: "mismatch" };
}

/**
 * The Resend webhook (svix scheme). `secretB64` is the dashboard's
 * `whsec_<base64>` (the prefix is optional); the key is the decoded bytes.
 */
export function verifyResend(
  raw: Buffer,
  headers: { id: string | null | undefined; timestamp: string | null | undefined; signature: string | null | undefined },
  secretB64: string,
): boolean {
  assertBytes(raw, "verifyResend");
  const { id, timestamp, signature } = headers ?? ({} as typeof headers);
  if (isBlank(id) || isBlank(signature) || isBlank(secretB64)) return false;
  // As sent: the id and timestamp strings are part of the signed content.
  if (typeof timestamp !== "string" || !DIGITS.test(timestamp)) return false;
  if (Math.abs(nowSeconds() - Number(timestamp)) > RESEND_TOLERANCE_SECS) return false;

  const key = Buffer.from(secretB64.trim().replace(/^whsec_/, ""), "base64");
  if (key.length === 0) return false; // rule 3

  const expected = hmac(key, [`${id}.${timestamp}.`, raw]).digest("base64");
  // "v1,<b64> v1,<b64>": several during svix's own key rotation; only v1 is a scheme we know.
  return (signature as string)
    .split(" ")
    .map((s) => s.trim())
    .filter((s) => s.startsWith("v1,"))
    .some((s) => safeEqualHex(s.slice(3), expected));
}

/** Meta signs webhooks with the app secret over the RAW body bytes. */
export function verifyMeta(raw: Buffer, header: string | null | undefined, appSecret: string): boolean {
  assertBytes(raw, "verifyMeta");
  if (isBlank(header) || isBlank(appSecret)) return false; // rule 3
  const value = (header as string).trim();
  if (!value.startsWith("sha256=")) return false;
  return safeEqualHex(value.slice("sha256=".length).toLowerCase(), hmacHex(appSecret, raw));
}
