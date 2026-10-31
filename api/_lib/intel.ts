// Call — Chase Intelligence: record everything a task did, in order, from one id.
// The contract every Chase repository writes is docs/INTEL-CONTRACT.md (copied
// unchanged from Charlie); what Call adds on top is docs/INTEL-PHASE0.md §3.
//
// Ported from Charlie `api/_lib/intel.ts` (commit 59b6cb4); the why-comments
// are kept. What Call changes, each for a reason given where it happens:
//   - The task is the SESSION (a call, a widget session, a meeting), so its
//     trace is `s_<session_id>`: init, every tool call, both post-call events,
//     every job, every broker action on its quotes, every send and delivery.
//     Else `job_<id>`, else the request's own `r_` + 16 hex (traceOf).
//   - No timer and no size trigger. Charlie wrote every 250 ms or every 50
//     rows, which is in the middle of a request; here rows are written only by
//     flushIntel(), which tracked() hands to waitUntil after the response and
//     the worker runs after its jobs (C-1703). Batches of at most 500 rows and
//     1 MB, three attempts, then dropped, counted, and one incident per outage
//     (C-1765, C-1766).
//   - capture() does a bounded amount of work, whatever it is given: small
//     content is serialised at once (so a later change to the object cannot
//     leak in); big content is held by reference, and serialising, cutting and
//     redacting it all happen in the flush. The first version cut and redacted
//     big structured content inside capture(): 0.7–4 s on the request path
//     for a catalogue upload (Task 0.6 review, I-4).
//   - A missing table (db/0006_platform.sql not applied yet) is one console
//     line and a ten-minute pause, not three attempts on every flush (C-1758).
//   - Content over 1 MB is cut by its longest strings, then its longest lists,
//     keeping its shape, and says so in meta.truncated_bytes (C-1767). Bytes
//     anywhere in content (Uint8Array, Buffer, ArrayBuffer, Blob, a data: URL,
//     bare base64) are kept as {type, size} (C-1734).
//   - A sign-in code is never written (C-1741): a row whose kind (in meta or
//     content) or name says login_code keeps its kind only. A context opened
//     with contentMode "meta" (a declined-consent session) keeps the shape
//     only, whatever the switch says (INTEL-PHASE0 §3).
//   - forgetIntel() deletes every row about the client and every row readTrace
//     would show for their traces, the jobs those traces queued included; it
//     tombstones what it forgets before it waits for writes in flight, and the
//     flush drops tombstoned rows before each insert, so a flush racing it
//     cannot land after the deletes (C-1745; review I-5, I-6).
//   - readTrace() starts from any id a person might have: the s_ id, the
//     session uuid, the ElevenLabs conversation id, a turn id, job_<n> or n.
//
// One table (intel_events, db/0006_platform.sql) and one call:
//   capture(kind, { name, content, meta, ok, ms })
// Kinds: ask (what a person said or sent), say (what Call said or sent),
// model (a model call: everything it was shown, everything it answered),
// check (a guardrail), tool (the voice agent's server tool calls), send (an
// email or WhatsApp delivery), job (a queued job), track (every product event
// track() records, kept here for good), error (every failure).
//
// Rules this file keeps, so no call site has to remember them:
//   - Additive. It never throws into the code it watches and never waits on
//     the request path: capture() buffers (well under 5 ms at p95, pinned in
//     test/intel.test.ts for small and big content); the write happens in a
//     batch, after the response, through flushTracking().
//   - Nothing secret leaves the process: every row goes through
//     intelredact.ts before it is written, and again on export.
//   - No phone number is stored. Files and audio are kept as their type and
//     size, never their bytes.
//   - One id per task (above); track.ts withTrackContext carries it everywhere.
//   - INTEL_CAPTURE = full (default) | meta (the shape, no words) | off.
//     TRACKING_OFF=1 turns it off too unless INTEL_CAPTURE says otherwise.
//   - "Forget me" deletes every row about the client and every trace they
//     were in (forgetIntel).

import { createHash, randomBytes } from "node:crypto";
import { db } from "./db.js";
import { redactDeep, redactText } from "./intelredact.js";
import { currentTrackContext, cutSafe, errorText, onTrack, registerFlusher, trackFailure, withTrackContext, type Channel, type TrackContext } from "./track.js";

export type { Channel } from "./track.js";

export const APP = "call";
export const CONTRACT_VERSION = 1;

export type IntelKind = "ask" | "say" | "model" | "check" | "tool" | "send" | "job" | "track" | "error";
export type Actor = "person" | "app" | "model" | "system" | "their_ai";
export type CaptureMode = "full" | "meta" | "off";

/** The channel column's values (INTEL-PHASE0 §3); anything else is recorded as "system" (C-1716). */
export const CHANNELS: readonly Channel[] = ["phone", "web", "meeting", "dashboard", "email", "whatsapp", "system"];
const CHANNEL_SET: ReadonlySet<string> = new Set(CHANNELS);

export interface CaptureOptions {
  name: string;
  actor?: Actor;
  ok?: boolean | null;
  ms?: number | null;
  /**
   * The words and payloads: dropped in meta mode, redacted always. Content
   * over the inline bound (more than 2,000 values or 256 K characters) is held
   * by reference and read at the flush, not at capture(): pass a finished
   * value and do not change it afterwards, or the row records the changed
   * one. This departs from INTEL-CONTRACT §4 rule 1 ("serialised at
   * capture"), so capture stays bounded work (INTEL-PHASE0 §3).
   */
  content?: unknown;
  /** Small facts that are never words: model, role, sizes, ids, statuses. */
  meta?: Record<string, unknown>;
  /** Overrides the context's channel (an email sent from inside a job). */
  channel?: Channel;
  /** A transcript turn (turnIdFor) or a WhatsApp message (turnIdForWamid). Anything else is refused. */
  turnId?: string | null;
  /** Overrides the context's stage. */
  stage?: string | null;
}

/** What withTrace() opens: every capture inside it, however deep, carries these. */
export interface TraceContext {
  traceId: string;
  sessionId?: string | null;
  clientId?: string | null;
  brokerId?: string | null;
  channel?: Channel;
  stage?: string | null;
  jobId?: number | null;
  turnId?: string | null;
  /** "meta": the shape only, whatever INTEL_CAPTURE says (a session whose consent was declined). */
  contentMode?: "full" | "meta";
}

// ── The numbers ──────────────────────────────────────────────────

/** One insert holds at most this many rows (C-1766). */
export const BATCH_ROWS = 500;
/** And at most this many bytes of JSON (C-1766). */
export const BATCH_BYTES = 1_000_000;
/**
 * The most one event's content keeps (C-1767): 1 MB less room for the rest of
 * the row (meta is capped at MAX_META_BYTES), so the largest row there can be
 * still fits one insert.
 */
export const MAX_CONTENT_BYTES = BATCH_BYTES - 32_000;
const MAX_META_BYTES = 16_000;
/**
 * capture() serialises content at once only when a bounded look says it is
 * small: at most this many values and characters. Anything bigger is held by
 * reference until the flush, so capture's cost does not grow with the content.
 */
const INLINE_VALUES = 2_000;
const INLINE_CHARS = 256_000;
/** Attempts per batch before its rows are dropped (C-1765). */
export const FLUSH_ATTEMPTS = 3;
/** The waits before the second and the third attempt: short, because the flush is bounded (track.ts FLUSH_TIMEOUT_MS). */
const RETRY_DELAYS_MS = [100, 400];
/** A missing table is not tried again for this long (C-1758). */
export const MISSING_TABLE_RETRY_MS = 10 * 60_000;
/**
 * A process that is never flushed must not grow without bound. Past these a
 * new row is dropped (and counted) rather than written early, which would be
 * in the middle of a request.
 */
const MAX_BUFFER_ROWS = 20_000;
const MAX_BUFFER_BYTES = 64_000_000;
/** PostgREST answers at most 1000 rows a request (Supabase's default max rows): reads page by this. */
const PAGE = 1000;
/** How far readTrace follows job_enqueued links. */
const MAX_LINKS = 50;
/** How far forgetIntel follows them: everything, unless something is very wrong. */
const MAX_FORGET_LINKS = 10_000;
/** Kinds of message kept as their kind only, in every mode: they are credentials (C-1741). */
const KIND_ONLY: ReadonlySet<string> = new Set(["login_code", "sign_in_code", "verification_code", "otp"]);
/** A row named for one (`email:login_code`) is one, whatever its kind says. */
const KIND_ONLY_NAME = /(?:^|[:_.\s-])(login_code|sign_in_code|verification_code|otp)$/i;

// ── State ────────────────────────────────────────────────────────

/** Content as capture() left it: serialised when it was small, the value itself when it was not, or nothing. */
type Held = { json: string } | { ref: unknown } | null;

interface Pending {
  at: string;
  seq: number;
  trace_id: string;
  turn_id: string | null;
  job_id: number | null;
  business_id: string | null;
  channel: Channel;
  stage: string | null;
  kind: IntelKind;
  name: string;
  actor: Actor;
  ok: boolean | null;
  ms: number | null;
  /** Content dropped at the flush, keeping only its size: meta mode, or a declined-consent context. */
  shapeOnly: boolean;
  /** A credential's kind (login_code): content never held at all, and meta.kind says which. */
  kindOnly: string | null;
  content: Held;
  meta: Held;
  brokerId: string | null;
  /** A job_enqueued row's meta.job_id: the link forgetIntel follows for buffered rows. */
  link: number | null;
  /** About what this row costs in memory and on the wire. */
  bytes: number;
}

const buffer: Pending[] = [];
let bufferedBytes = 0;
let seq = 0;
/** Writes on their way: forgetIntel() waits for them before it deletes. */
const writing = new Set<Promise<unknown>>();
const stats = { flushed: 0, dropped: 0, lastFlushAt: null as string | null, tablePresent: null as boolean | null };
/** Epoch ms before which a missing table is not tried again. */
let missingUntil = 0;
let warnedMissing = false;
let warnedCapture = false;
let warnedFull = false;
let warnedTurn = false;
/** One intel_flush_failed incident per outage: set when filed, cleared by the next write that lands. */
let incidentFiled = false;
/** Clients, traces and jobs forgotten in this process: a late row about them is never buffered, and never written. */
const forgotten = { clients: new Set<string>(), traces: new Set<string>(), jobs: new Set<number>() };
/** Forgets in progress, by client: the traces a flush found about that client while the forget ran. */
const forgetting = new Map<string, Set<string>>();
/** The trace of a capture outside any context (a script, module load). Never forgotten whole: it is everyone's. */
const processTrace = `p_${randomBytes(8).toString("hex")}`;

// ── The switch and the ids ───────────────────────────────────────

/** The effective mode, read at call time so a test (or an operator) can flip it. */
export function captureMode(): CaptureMode {
  const m = (process.env.INTEL_CAPTURE ?? "").trim().toLowerCase();
  if (m === "off" || m === "meta" || m === "full") return m;
  return process.env.TRACKING_OFF === "1" ? "off" : "full";
}

const sha16 = (s: string): string => createHash("sha256").update(s).digest("hex").slice(0, 16);
const TURN_ID = /^t_[0-9a-f]{16}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * A trace id exactly as this code makes them (INTEL-PHASE0 §3, the contract
 * §2): s_<uuid>, job_<n>, r_ + 16 hex, t_ + 16 hex. trace_id is never
 * redacted (toRow passes it through), so anything else is not used: the first
 * version took any short prefix and id-ish text, and `wa_27799930001` would
 * have stored a phone number raw (Phase 0 review, m-B). A job number has at
 * most eight digits for the same reason (nine is a phone number's length);
 * a job traced by its jobId (traceOf) is not limited.
 */
const TRACE_ID = /^(?:s_[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}|job_[1-9]\d{0,7}|[rt]_[0-9a-f]{16})$/;

/** The one id of everything a session did. */
export const traceForSession = (sessionId: string): string => `s_${sessionId}`;
/** A request tied to no session (login, settings, a catalogue upload). */
export const requestTraceId = (): string => `r_${randomBytes(8).toString("hex")}`;
/** A transcript turn: a hash, the same at ingest and wherever the turn is referred to later. */
export const turnIdFor = (sessionId: string, idx: number): string => `t_${sha16(`${sessionId}:${idx}`)}`;
/** A WhatsApp message: a hash of its wamid (a long random id that also encodes the sender's number), so never the wamid itself. */
export const turnIdForWamid = (wamid: string): string => `t_${sha16(wamid)}`;

/**
 * A turn id as the column holds it: one of ours, or none. Anything else (a raw
 * wamid, a phone number passed by mistake) is refused, not hashed: an unsalted
 * 64-bit hash of a phone number is the number to anyone who tries the
 * billion SA mobile numbers (Task 0.6 review, m-6).
 */
function turnIdOf(v: string | null | undefined): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (TURN_ID.test(v)) return v;
  if (!warnedTurn) {
    warnedTurn = true;
    console.warn("intel: a turn id that is not one of turnIdFor()/turnIdForWamid()'s was not recorded (the row has none)");
  }
  return null;
}

/** The session, else the job, else the request's own id (INTEL-PHASE0 §3). An id that is not one is not used. */
export function traceOf(ctx: TrackContext): string {
  if (typeof ctx.sessionId === "string" && UUID.test(ctx.sessionId)) return traceForSession(ctx.sessionId);
  if (typeof ctx.jobId === "number" && Number.isInteger(ctx.jobId)) return `job_${ctx.jobId}`;
  return typeof ctx.traceId === "string" && TRACE_ID.test(ctx.traceId) ? ctx.traceId : processTrace;
}

/**
 * Runs `fn` with these facts on every capture inside it, merged over any outer
 * context. The same store as track.ts withTrackContext: one context, whichever
 * opened it.
 */
export function withTrace<T>(ctx: TraceContext, fn: () => Promise<T>): Promise<T> {
  return withTrackContext(ctx, fn);
}

// ── Holding content (at capture: bounded work) ───────────────────

const DATA_URL = /^data:([\w.+-]+\/[\w.+-]+)?(?:;[\w=.+-]+)*?(;base64)?,/i;
const BASE64_WHOLE = /^[A-Za-z0-9+/_\-\r\n]+={0,2}\s*$/;
const base64Size = (b: string): number => Math.floor((b.replace(/[\s=]/g, "").length * 3) / 4);
/** Base64 of real bytes has digits and both cases: twenty thousand x's are not a file. */
const looksLikeBytes = (s: string): boolean => /\d/.test(s) && /[A-Z]/.test(s) && /[a-z]/.test(s);

/** A string that is a file: a data: URL, or nothing but base64 or base64url. */
function fileOf(s: string): { type: string; size: number } | null {
  if (s.startsWith("data:")) {
    const m = DATA_URL.exec(s.slice(0, 256));
    if (m) return { type: m[1] || "bytes", size: m[2] ? base64Size(s.slice(m[0].length)) : s.length - m[0].length };
  }
  return BASE64_WHOLE.test(s) && looksLikeBytes(s) ? { type: "base64", size: base64Size(s) } : null;
}

const isBytes = (x: unknown): x is ArrayBuffer | ArrayBufferView => x instanceof ArrayBuffer || ArrayBuffer.isView(x);
const isBlob = (x: unknown): x is Blob => typeof Blob !== "undefined" && x instanceof Blob;

/**
 * Files and bytes become their type and size (INTEL-CONTRACT §4 rule 4). The
 * holder's own value is checked, not `value`: JSON.stringify has already
 * turned a Buffer into {type: "Buffer", data: [...every byte...]} by then.
 */
function replacer(this: unknown, key: string, value: unknown): unknown {
  const raw = (this as Record<string, unknown> | null)?.[key];
  if (isBytes(raw)) return { type: "bytes", size: raw.byteLength };
  if (isBlob(raw)) return { type: raw.type || "bytes", size: raw.size };
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string" && value.length > 200) return fileOf(value) ?? value;
  return value;
}

const UNSERIALISABLE = '{"unserialisable":true}';

/**
 * A bounded look at a value: whether it is small enough to serialise now, and
 * about how big it is. At most INLINE_VALUES values are visited, so this costs
 * the same for a catalogue of 8,000 rows as for one of 8. Null when reading it
 * throws (a getter, a proxy): the value cannot be serialised.
 */
function sizeUp(v: unknown): { small: boolean; chars: number } | null {
  let values = 0;
  let chars = 0;
  const stack: unknown[] = [v];
  try {
    while (stack.length) {
      const x = stack.pop();
      if (++values > INLINE_VALUES || chars > INLINE_CHARS) return { small: false, chars: Math.max(chars, INLINE_CHARS) };
      if (typeof x === "string") chars += x.length + 2;
      else if (x === null || typeof x !== "object") chars += 8;
      else if (isBytes(x) || isBlob(x)) chars += 32;
      else if (Array.isArray(x)) {
        if (values + x.length > INLINE_VALUES) return { small: false, chars: Math.max(chars, INLINE_CHARS) };
        chars += 2;
        for (const item of x) stack.push(item);
      } else {
        const keys = Object.keys(x);
        if (values + keys.length > INLINE_VALUES) return { small: false, chars: Math.max(chars, INLINE_CHARS) };
        for (const k of keys) {
          chars += k.length + 4;
          stack.push((x as Record<string, unknown>)[k]);
        }
      }
    }
  } catch {
    return null;
  }
  return { small: chars <= INLINE_CHARS, chars };
}

/** Content as capture keeps it, and about what it costs. */
function hold(v: unknown): { held: Held; bytes: number } {
  if (v === undefined || v === null) return { held: null, bytes: 0 };
  const size = sizeUp(v);
  if (size === null) return { held: { json: UNSERIALISABLE }, bytes: UNSERIALISABLE.length };
  // A big string is held too: it cannot change, and Buffer.byteLength of 20 MB is not free.
  if (!size.small) return { held: { ref: v }, bytes: size.chars };
  try {
    const json = JSON.stringify(v, replacer);
    return json === undefined ? { held: null, bytes: 0 } : { held: { json }, bytes: json.length };
  } catch {
    return { held: { json: UNSERIALISABLE }, bytes: UNSERIALISABLE.length };
  }
}

/** The JSON text of held content (serialising it now when capture held a reference), or null. */
function resolve(h: Held): string | null {
  if (h === null) return null;
  if ("json" in h) return h.json;
  try {
    return JSON.stringify(h.ref, replacer) ?? null;
  } catch {
    return UNSERIALISABLE;
  }
}

// ── Cutting (at the flush) ───────────────────────────────────────

const CUT = (n: number): string => ` …[${n} characters cut]`;

function stringLengths(v: unknown, out: number[]): number[] {
  if (typeof v === "string") out.push(v.length);
  else if (Array.isArray(v)) for (const x of v) stringLengths(x, out);
  else if (v !== null && typeof v === "object") for (const x of Object.values(v)) stringLengths(x, out);
  return out;
}

function capStrings(v: unknown, cap: number): unknown {
  if (typeof v === "string") return v.length > cap ? cutSafe(v, cap) + CUT(v.length - cap) : v;
  if (Array.isArray(v)) return v.map((x) => capStrings(x, cap));
  if (v !== null && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, capStrings(x, cap)]));
  return v;
}

/** Every list longer than 20 keeps its head, in proportion, and says how many items it lost. */
function capLists(v: unknown, ratio: number): unknown {
  if (Array.isArray(v)) {
    const keep = v.length > 20 ? Math.max(20, Math.floor(v.length * ratio)) : v.length;
    const head = v.slice(0, keep).map((x) => capLists(x, ratio));
    return keep < v.length ? [...head, `…[${v.length - keep} more items cut]`] : head;
  }
  if (v !== null && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, capLists(x, ratio)]));
  return v;
}

/** The highest cap that removes at least `excess` characters across these strings (cutting the longest first). */
function capFor(lengths: number[], excess: number): number {
  const sorted = [...lengths].sort((a, b) => b - a);
  let removed = 0;
  for (let i = 0; i < sorted.length; i++) {
    const next = sorted[i + 1] ?? 0;
    const step = (i + 1) * (sorted[i]! - next);
    if (removed + step >= excess) return Math.max(0, Math.floor(sorted[i]! - (excess - removed) / (i + 1)));
    removed += step;
  }
  return 0;
}

/** A cut that keeps a string's head this long is still worth reading; below it, the bulk is not in long strings. */
const MIN_STRING_CAP = 256;

/**
 * Content over the limit, cut to it, at the flush. The longest strings are cut
 * first (a prompt with a transcript in it); when the bulk is many small values
 * (a catalogue, a meeting's segments), the longest lists keep their head. The
 * shape survives — keys, the model's answer, the numbers — so the flush can
 * still redact by key. Content that is neither falls back to its redacted
 * JSON text, cut.
 */
function shrink(value: unknown, limit: number): { json: string; bytes: number } {
  const total = Buffer.byteLength(JSON.stringify(value));
  const lengths = stringLengths(value, []);
  let target = limit;
  for (let i = 0; i < 6 && lengths.length; i++) {
    const cap = capFor(lengths, total - target + 1024);
    if (cap < MIN_STRING_CAP) break;
    // The cut markers add a few bytes each: an overshoot lowers the target, and the next pass cuts again.
    const json = JSON.stringify(capStrings(value, cap));
    const bytes = Buffer.byteLength(json);
    if (bytes <= limit) return { json, bytes };
    target -= bytes - limit + 1024;
  }
  let ratio = limit / total;
  for (let i = 0; i < 8; i++) {
    const json = JSON.stringify(capLists(capStrings(value, Math.max(MIN_STRING_CAP, Math.floor(limit / 8))), ratio));
    const bytes = Buffer.byteLength(json);
    if (bytes <= limit) return { json, bytes };
    ratio *= (limit / bytes) * 0.97;
  }
  const text = JSON.stringify(redactDeep(value));
  let n = limit;
  for (let i = 0; i < 8; i++) {
    const json = JSON.stringify({ truncated: true, start: cutSafe(text, n) });
    const bytes = Buffer.byteLength(json);
    if (bytes <= limit) return { json, bytes };
    n = Math.max(0, Math.floor((n * limit) / bytes) - 64);
  }
  return { json: '{"truncated":true}', bytes: 18 };
}

const clampMs = (ms: number | null | undefined): number | null => (typeof ms === "number" && Number.isFinite(ms) ? Math.min(Math.max(Math.round(ms), 0), 2_147_483_647) : null);

function defaultActor(kind: IntelKind): Actor {
  // A tool call is the voice agent's LLM choosing it (INTEL-PHASE0 §3), not the person's own AI.
  if (kind === "ask") return "person";
  if (kind === "model" || kind === "tool") return "model";
  if (kind === "say" || kind === "send") return "app";
  return "system";
}

/** The kind field of a payload, read without trusting it (a getter could throw). */
function kindIn(v: unknown): string {
  try {
    return v !== null && typeof v === "object" && !Array.isArray(v) ? String((v as { kind?: unknown }).kind ?? "") : "";
  } catch {
    return "";
  }
}

// ── Capture ──────────────────────────────────────────────────────

/** Record one thing that happened. Never throws, never waits, never writes; bounded work whatever it is given. */
export function capture(kind: IntelKind, opts: CaptureOptions): void {
  try {
    const mode = captureMode();
    if (mode === "off") return;
    const ctx = currentTrackContext();
    const trace = traceOf(ctx);
    // A uuid column: anything else would fail the whole batch of 500 (22P02).
    const business = typeof ctx.clientId === "string" && UUID.test(ctx.clientId) ? ctx.clientId : null;
    const jobId = typeof ctx.jobId === "number" && Number.isInteger(ctx.jobId) ? ctx.jobId : null;
    if ((business && forgotten.clients.has(business)) || forgotten.traces.has(trace) || (jobId !== null && forgotten.jobs.has(jobId))) return;

    const name = String(opts.name).slice(0, 120);
    const metaKind = kindIn(opts.meta);
    const credential = [metaKind, kindIn(opts.content)].find((k) => KIND_ONLY.has(k)) ?? KIND_ONLY_NAME.exec(name)?.[1]?.toLowerCase() ?? null;
    const shapeOnly = mode === "meta" || ctx.contentMode === "meta";
    // A credential's words are not even held until the flush.
    const content = credential ? { held: null, bytes: 0 } : hold(opts.content);
    const meta = hold(opts.meta);
    const bytes = content.bytes + meta.bytes + 400;

    if (buffer.length >= MAX_BUFFER_ROWS || bufferedBytes + bytes > MAX_BUFFER_BYTES) {
      stats.dropped++;
      if (!warnedFull) {
        warnedFull = true;
        console.warn(`intel: the buffer is full (${buffer.length} rows), so new events are dropped until the next flush; is flushTracking() called after this work?`);
      }
      return;
    }
    const linked = kind === "job" && name === "job_enqueued" ? Number((opts.meta as { job_id?: unknown } | undefined)?.job_id) : NaN;
    const channel = opts.channel ?? ctx.channel;
    buffer.push({
      at: new Date().toISOString(),
      seq: ++seq,
      trace_id: trace,
      turn_id: turnIdOf(opts.turnId ?? ctx.turnId),
      job_id: jobId,
      business_id: business,
      channel: channel && CHANNEL_SET.has(channel) ? channel : "system",
      stage: opts.stage ?? ctx.stage ?? null,
      kind,
      name,
      actor: opts.actor ?? defaultActor(kind),
      ok: typeof opts.ok === "boolean" ? opts.ok : null,
      ms: clampMs(opts.ms),
      shapeOnly,
      kindOnly: credential,
      content: content.held,
      meta: meta.held,
      brokerId: typeof ctx.brokerId === "string" && ctx.brokerId ? ctx.brokerId : null,
      link: Number.isInteger(linked) ? linked : null,
      bytes,
    });
    bufferedBytes += bytes;
  } catch (err) {
    if (warnedCapture) return;
    warnedCapture = true;
    // The label is read in its own guard: a name that throws must not throw twice.
    let label = "an event";
    try {
      label = String(opts?.name).slice(0, 60);
    } catch {
      // keep "an event"
    }
    console.warn(`intel: ${label} not captured (${errorText(err)})`);
  }
}

// ── The flush (after the response, off the request path) ─────────

const asObject = (json: string | null): Record<string, unknown> => {
  if (json === null) return {};
  try {
    const v = JSON.parse(json) as unknown;
    return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : { value: v };
  } catch {
    return { unreadable: true };
  }
};

/**
 * One row as written: serialised (if capture held a reference), cut to size,
 * then redacted. All of it here, off the request path. Every row has the same
 * keys: PostgREST writes NULL, not the default, into a key one row of a batch
 * lacks. Never throws: a row that cannot be built is written as unreadable.
 */
function toRow(p: Pending): Record<string, unknown> {
  let content: unknown = null;
  let meta: Record<string, unknown>;
  try {
    meta = asObject(resolve(p.meta));
    if (p.brokerId && meta.broker_id === undefined) meta.broker_id = p.brokerId;
    if (p.kindOnly) meta.kind = p.kindOnly;
    const json = resolve(p.content);
    if (json !== null && p.shapeOnly) meta.content_chars = json.length;
    if (json !== null && !p.shapeOnly) {
      const bytes = Buffer.byteLength(json);
      if (bytes > MAX_CONTENT_BYTES) {
        const cut = shrink(JSON.parse(json) as unknown, MAX_CONTENT_BYTES);
        content = JSON.parse(cut.json) as unknown;
        meta.truncated_bytes = bytes - cut.bytes;
      } else content = JSON.parse(json) as unknown;
    }
    // Meta is small facts; past its cap its long values are cut, its keys kept.
    const metaJson = JSON.stringify(meta);
    if (Buffer.byteLength(metaJson) > MAX_META_BYTES) meta = JSON.parse(shrink(meta, MAX_META_BYTES).json) as Record<string, unknown>;
    content = content === null ? null : redactDeep(content);
    meta = redactDeep(meta);
  } catch {
    content = { unreadable: true };
    meta = { unreadable: true };
  }
  return {
    at: p.at,
    seq: p.seq,
    app: APP,
    v: CONTRACT_VERSION,
    trace_id: p.trace_id,
    turn_id: p.turn_id,
    job_id: p.job_id,
    business_id: p.business_id,
    channel: p.channel,
    stage: p.stage === null ? null : redactText(p.stage).slice(0, 80),
    kind: p.kind,
    name: redactText(p.name),
    actor: p.actor,
    ok: p.ok,
    ms: p.ms,
    content_mode: p.shapeOnly || p.kindOnly ? "meta" : "full",
    content,
    meta,
  };
}

/** Rows into inserts of at most BATCH_ROWS rows and BATCH_BYTES of JSON, measured as sent. A row too big alone goes alone. */
function batches(rows: Record<string, unknown>[]): Record<string, unknown>[][] {
  const out: Record<string, unknown>[][] = [];
  let current: Record<string, unknown>[] = [];
  let size = 2;
  for (const row of rows) {
    const bytes = Buffer.byteLength(JSON.stringify(row)) + 1;
    if (current.length && (current.length >= BATCH_ROWS || size + bytes > BATCH_BYTES)) {
      out.push(current);
      current = [];
      size = 2;
    }
    current.push(row);
    size += bytes;
  }
  if (current.length) out.push(current);
  return out;
}

/**
 * The rows a forget has claimed, taken out just before they are sent. A row
 * about a forgotten client takes its whole trace with it (and tells the forget
 * in progress, which may not have seen that trace yet).
 */
function unforgotten<T extends object>(rows: T[]): T[] {
  const ids = (r: T) => r as unknown as { trace_id: string; business_id: string | null; job_id: number | null };
  for (const row of rows) {
    const r = ids(row);
    if (r.business_id && forgotten.clients.has(r.business_id) && r.trace_id !== processTrace) {
      remember(forgotten.traces, r.trace_id);
      forgetting.get(r.business_id)?.add(r.trace_id);
    }
  }
  return rows.filter((row) => {
    const r = ids(row);
    return !(r.business_id && forgotten.clients.has(r.business_id)) && !forgotten.traces.has(r.trace_id) && !(typeof r.job_id === "number" && forgotten.jobs.has(r.job_id));
  });
}

/** Postgres' "relation does not exist", or PostgREST's own "not in the schema cache". */
function isMissingTable(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === "42P01" || code === "PGRST205";
}

const pause = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

type Outcome = { ok: true } | { ok: false; missing: boolean; error: unknown };

async function insert(rows: Record<string, unknown>[]): Promise<Outcome> {
  let last: unknown = null;
  for (let attempt = 1; attempt <= FLUSH_ATTEMPTS; attempt++) {
    if (attempt > 1) await pause(RETRY_DELAYS_MS[attempt - 2] ?? 400);
    try {
      const { error } = await db().from("intel_events").insert(rows);
      if (!error) return { ok: true };
      if (isMissingTable(error)) return { ok: false, missing: true, error };
      last = error;
    } catch (err) {
      last = err;
    }
  }
  return { ok: false, missing: false, error: last };
}

function noteMissing(): void {
  missingUntil = Date.now() + MISSING_TABLE_RETRY_MS;
  stats.tablePresent = false;
  if (warnedMissing) return;
  warnedMissing = true;
  // The line names what creates the table (C-1758).
  console.warn(`intel: intel_events is missing (run db/0006_platform.sql; docs/SUPABASE-PROMPT.md). Capture writes nothing and tries again every 10 minutes; nothing else is affected.`);
}

function noteFailure(err: unknown, lost: number): void {
  if (incidentFiled) return;
  incidentFiled = true;
  console.warn(`intel: ${lost} captured rows could not be written after ${FLUSH_ATTEMPTS} attempts and were dropped (${errorText(err)})`);
  trackFailure("intel_flush_failed", err, {
    severity: "error",
    alert: "digest",
    props: { rows: lost, attempts: FLUSH_ATTEMPTS },
    fingerprint: "intel_flush_failed",
    summary: `Chase Intelligence could not write ${lost} captured rows after ${FLUSH_ATTEMPTS} attempts (${errorText(err).slice(0, 120)}): they were dropped, and nothing else was affected`,
  });
}

async function write(pending: Pending[]): Promise<{ written: number; dropped: number }> {
  let written = 0;
  let dropped = 0;
  try {
    // Off the response path: tracked() starts this flush in its finally, a
    // moment before the platform sends the answer, so the serialising, the
    // cutting, the redaction and the insert wait for the next turn of the event loop.
    await new Promise<void>((r) => setImmediate(r));
    if (Date.now() < missingUntil) {
      dropped = pending.length;
      return { written, dropped };
    }
    const groups = batches(unforgotten(pending).map(toRow));
    for (let i = 0; i < groups.length; i++) {
      // A forget may have started while the earlier batches were on their way.
      const rows = unforgotten(groups[i]!);
      if (!rows.length) continue;
      const outcome = await insert(rows);
      if (outcome.ok) {
        written += rows.length;
        continue;
      }
      // The database will not take this batch: the rest of this flush goes too.
      const lost = rows.length + groups.slice(i + 1).reduce((n, g) => n + g.length, 0);
      dropped += lost;
      if (outcome.missing) noteMissing();
      else noteFailure(outcome.error, lost);
      break;
    }
  } catch (err) {
    // Only a bug in this file lands here; the rows are lost, on the record.
    dropped = Math.max(0, pending.length - written);
    noteFailure(err, dropped);
  } finally {
    stats.flushed += written;
    stats.dropped += dropped;
    if (written > 0) {
      stats.lastFlushAt = new Date().toISOString();
      stats.tablePresent = true;
      missingUntil = 0;
      incidentFiled = false;
    }
  }
  return { written, dropped };
}

/**
 * Write everything buffered, in batches. Never rejects. track.ts calls it from
 * flushTracking() (registered below), so a request's rows go after its
 * response (tracked()'s waitUntil) and a worker's after its jobs.
 */
export function flushIntel(): Promise<{ written: number; dropped: number }> {
  if (!buffer.length) return Promise.resolve({ written: 0, dropped: 0 });
  const pending = buffer.splice(0, buffer.length);
  bufferedBytes = 0;
  const p = write(pending);
  writing.add(p);
  const done = (): void => {
    writing.delete(p);
  };
  void p.then(done, done);
  return p;
}

registerFlusher({ flush: flushIntel, pending: () => buffer.length > 0 });

/** For /api/health and /admin (Tasks 11.2, 8.8; C-1763, C-1764). `table_present` is null until a flush has tried. */
export function intelStats(): { mode: CaptureMode; table_present: boolean | null; buffered: number; flushed: number; dropped: number; last_flush_at: string | null } {
  return { mode: captureMode(), table_present: stats.tablePresent, buffered: buffer.length, flushed: stats.flushed, dropped: stats.dropped, last_flush_at: stats.lastFlushAt };
}

// Every product event and every failure, kept for good (track.ts): a
// trackFailure() is an error row whatever category it was filed under
// (C-1733). A broker's dashboard action (`broker:<action>`) is the person's
// (INTEL-PHASE0 §3), and its props carry {before, after, reason}.
onTrack((name, opts, _ctx, failure) => {
  const isError = failure === true || opts.category === "failure";
  const category = opts.category ?? (isError ? "failure" : "behaviour");
  capture(isError ? "error" : "track", {
    name,
    actor: name.startsWith("broker:") ? "person" : "system",
    ok: isError ? false : null,
    ms: opts.ms ?? null,
    ...(opts.channel ? { channel: opts.channel } : {}),
    ...(opts.stage ? { stage: opts.stage } : {}),
    content: { props: opts.props ?? {}, ...(opts.summary ? { summary: opts.summary } : {}) },
    meta: { category, severity: opts.severity ?? (category === "failure" ? "error" : "info") },
  });
});

// ── Reading back and forgetting ──────────────────────────────────

export interface IntelRow {
  id: number;
  at: string;
  seq: number;
  app: string;
  v: number;
  trace_id: string;
  turn_id: string | null;
  job_id: number | null;
  business_id: string | null;
  channel: string | null;
  stage: string | null;
  kind: IntelKind;
  name: string;
  actor: Actor;
  ok: boolean | null;
  ms: number | null;
  content_mode: "full" | "meta";
  content: any;
  meta: any;
}

/** By time, then the order within one process; the row number last, so the order is the same on every read. */
const byOrder = (a: IntelRow, b: IntelRow): number => Date.parse(a.at) - Date.parse(b.at) || a.seq - b.seq || a.id - b.id;

/** Every row where `column` is `value` (or one of `values`), page by page, these columns. Throws on a read error. */
async function rowsWhere<T = IntelRow>(column: "trace_id" | "job_id" | "turn_id" | "business_id", value: string | number | (string | number)[], columns = "*", onlyName?: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = db().from("intel_events").select(columns);
    q = Array.isArray(value) ? q.in(column, value) : q.eq(column, value);
    if (onlyName) q = q.eq("name", onlyName);
    const { data, error } = await q.order("id", { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw Object.assign(new Error(`intel_events: ${errorText(error)}`), { code: (error as { code?: unknown }).code });
    const page = (data as T[] | null) ?? [];
    out.push(...page);
    if (page.length < PAGE) return out;
  }
}

/** The traces an id names (C-1754): a trace id as it is, or the task it points into. */
async function tracesFor(id: string): Promise<string[]> {
  const job = /^(?:job_)?(\d+)$/.exec(id);
  if (job) {
    // A job runs in its session's trace when it has one: the task is the session.
    const n = Number(job[1]);
    return [`job_${n}`, ...(await rowsWhere("job_id", n)).map((r) => r.trace_id)];
  }
  if (TURN_ID.test(id)) return (await rowsWhere("turn_id", id)).map((r) => r.trace_id);
  if (/^[srp]_/.test(id)) return [id];
  if (UUID.test(id)) return [traceForSession(id)];
  // Anything else: an ElevenLabs conversation id, or a trace id of another shape.
  const { data } = await db().from("sessions").select("id").eq("conversation_id", id).maybeSingle();
  const session = (data as { id?: string } | null)?.id;
  return [session ? traceForSession(session) : id];
}

/**
 * Everything one task did, in (at, seq) order, from any one of its ids: the
 * `s_` id, the session uuid, the ElevenLabs conversation id, a turn id,
 * `job_<n>` or a bare job number (C-1754). Jobs the task queued (its
 * job_enqueued rows) are followed and folded in, however they were traced.
 * Past MAX_LINKS links it stops, and says so in one console line.
 */
export async function readTrace(id: string): Promise<IntelRow[]> {
  const found = new Map<number | string, IntelRow>();
  const traces = await tracesFor(String(id).trim());
  const jobs: number[] = [];
  const seenTraces = new Set<string>();
  const seenJobs = new Set<number>();
  const add = (rows: IntelRow[]): void => {
    for (const r of rows) {
      found.set(r.id ?? `${r.trace_id}:${r.at}:${r.seq}`, r);
      const queued = Number(r.meta?.job_id);
      if (r.kind === "job" && r.name === "job_enqueued" && Number.isInteger(queued)) jobs.push(queued);
    }
  };
  while (traces.length || jobs.length) {
    if (seenTraces.size + seenJobs.size >= MAX_LINKS) {
      const left = new Set([...traces.filter((t) => !seenTraces.has(t)), ...jobs.filter((j) => !seenJobs.has(j)).map(String)]).size;
      if (left) console.warn(`intel: readTrace(${String(id).slice(0, 60)}) stopped after ${MAX_LINKS} linked traces and jobs; ${left} more not read, so the task is cut`);
      break;
    }
    const t = traces.shift();
    if (t !== undefined) {
      if (seenTraces.has(t)) continue;
      seenTraces.add(t);
      add(await rowsWhere("trace_id", t));
      continue;
    }
    const j = jobs.shift()!;
    if (seenJobs.has(j)) continue;
    seenJobs.add(j);
    // What the queued job did, wherever it was traced (its own job_<n>, or another session's).
    add(await rowsWhere("job_id", j));
  }
  return [...found.values()].sort(byOrder);
}

/** Bounded: a long-lived process forgets the oldest tombstones first. */
function remember<T>(set: Set<T>, value: T): void {
  set.add(value);
  if (set.size > 10_000) set.delete(set.values().next().value as T);
}

const jobOfTrace = (t: string): number | null => (/^job_\d+$/.test(t) ? Number(t.slice(4)) : null);

/**
 * Every row about a client, written or still buffered, and every row readTrace
 * would show for every trace they were in: the traces themselves and every
 * job those traces queued, followed as readTrace follows them (C-1745). Returns
 * how many rows went. What it forgets is tombstoned first, then writes in
 * flight are waited for, then the deletes run; a flush racing it drops
 * tombstoned rows before each insert. Throws when the database refuses (the
 * forget job retries it); a table that does not exist yet holds nothing to
 * forget. Running it twice deletes nothing the second time (C-1746).
 */
export async function forgetIntel(clientId: string): Promise<number> {
  let removed = 0;
  const traces = new Set<string>();
  const jobs = new Set<number>();
  const found = new Set<string>();
  forgetting.set(clientId, found);
  remember(forgotten.clients, clientId);
  const addTrace = (t: string): boolean => {
    if (t === processTrace || t.startsWith("p_") || traces.has(t)) return false;
    traces.add(t);
    remember(forgotten.traces, t);
    const j = jobOfTrace(t);
    if (j !== null) addJob(j);
    return true;
  };
  const addJob = (j: number): boolean => {
    if (jobs.has(j)) return false;
    jobs.add(j);
    remember(forgotten.jobs, j);
    addTrace(`job_${j}`);
    return true;
  };
  const dropBuffered = (): void => {
    // The client's buffered rows name traces; those traces' link rows name jobs; and so on.
    for (let changed = true; changed; ) {
      changed = false;
      for (const r of buffer) {
        if (r.business_id === clientId) changed = addTrace(r.trace_id) || changed;
        if (r.link !== null && (traces.has(r.trace_id) || (r.job_id !== null && jobs.has(r.job_id)))) changed = addJob(r.link) || changed;
      }
    }
    for (let i = buffer.length - 1; i >= 0; i--) {
      const r = buffer[i]!;
      if (r.business_id === clientId || traces.has(r.trace_id) || (r.job_id !== null && jobs.has(r.job_id))) {
        bufferedBytes -= r.bytes;
        buffer.splice(i, 1);
        removed++;
      }
    }
  };
  const settle = async (): Promise<void> => {
    while (writing.size) await Promise.allSettled([...writing]);
    for (const t of found) addTrace(t);
    dropBuffered();
  };

  try {
    dropBuffered();
    await settle();
    // The client's traces, then every job they queued (and the jobs those queued), from the table.
    for (const r of await rowsWhere<{ trace_id: string }>("business_id", clientId, "trace_id")) addTrace(r.trace_id);
    let newTraces = [...traces];
    let newJobs = [...jobs];
    while ((newTraces.length || newJobs.length) && jobs.size < MAX_FORGET_LINKS) {
      const linked: number[] = [];
      for (let i = 0; i < newTraces.length; i += 200) linked.push(...(await rowsWhere<{ meta: { job_id?: unknown } }>("trace_id", newTraces.slice(i, i + 200), "meta", "job_enqueued")).map((r) => Number(r.meta?.job_id)));
      for (let i = 0; i < newJobs.length; i += 200) linked.push(...(await rowsWhere<{ meta: { job_id?: unknown } }>("job_id", newJobs.slice(i, i + 200), "meta", "job_enqueued")).map((r) => Number(r.meta?.job_id)));
      const before = new Set(traces);
      newJobs = [...new Set(linked.filter((j) => Number.isInteger(j) && addJob(j)))];
      newTraces = [...traces].filter((t) => !before.has(t));
    }
    // Rows captured while the reads ran, and writes started meanwhile, land
    // (or are dropped by the tombstones) before anything is deleted.
    await settle();

    const own = await db().from("intel_events").delete().eq("business_id", clientId).select("id");
    if (own.error) throw own.error;
    removed += ((own.data as unknown[] | null) ?? []).length;
    const list = [...traces];
    for (let i = 0; i < list.length; i += 200) {
      const res = await db().from("intel_events").delete().in("trace_id", list.slice(i, i + 200)).select("id");
      if (res.error) throw res.error;
      removed += ((res.data as unknown[] | null) ?? []).length;
    }
    const ids = [...jobs];
    for (let i = 0; i < ids.length; i += 200) {
      const res = await db().from("intel_events").delete().in("job_id", ids.slice(i, i + 200)).select("id");
      if (res.error) throw res.error;
      removed += ((res.data as unknown[] | null) ?? []).length;
    }
    return removed;
  } catch (err) {
    if (isMissingTable(err)) return removed;
    throw new Error(`forgetIntel: ${errorText(err)}`);
  } finally {
    forgetting.delete(clientId);
  }
}

/** Tests only: drop everything buffered and every counter, switch and tombstone. */
export function __resetIntel(): void {
  buffer.length = 0;
  bufferedBytes = 0;
  stats.flushed = 0;
  stats.dropped = 0;
  stats.lastFlushAt = null;
  stats.tablePresent = null;
  missingUntil = 0;
  warnedMissing = false;
  warnedCapture = false;
  warnedFull = false;
  warnedTurn = false;
  incidentFiled = false;
  forgotten.clients.clear();
  forgotten.traces.clear();
  forgotten.jobs.clear();
  forgetting.clear();
}
