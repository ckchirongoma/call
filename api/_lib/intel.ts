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
//   - A missing table (db/0006_platform.sql not applied yet) is one console
//     line and a ten-minute pause, not three attempts on every flush (C-1758).
//   - Content over 1 MB is cut by its longest strings, keeping its shape, and
//     says so in meta.truncated_bytes (C-1767). Bytes anywhere in content
//     (Uint8Array, Buffer, ArrayBuffer, Blob, a data: URL, bare base64) are
//     kept as {type, size} (C-1734).
//   - A sign-in code is kept as its kind only (C-1741), and a context opened
//     with contentMode "meta" (a declined-consent session) keeps the shape
//     only, whatever the switch says (INTEL-PHASE0 §3).
//   - forgetIntel() waits for writes already on their way, deletes, and
//     says how many rows went; rows about the client captured after it in
//     this process are never buffered (C-1745).
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
//     the request path: capture() serialises and buffers (well under 5 ms at
//     p95, pinned in test/intel.test.ts); the write happens in a batch, after
//     the response, through flushTracking().
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
  /** The words and payloads: dropped in meta mode, redacted always. */
  content?: unknown;
  /** Small facts that are never words: model, role, sizes, ids, statuses. */
  meta?: Record<string, unknown>;
  /** Overrides the context's channel (an email sent from inside a job). */
  channel?: Channel;
  /** A transcript turn (turnIdFor) or a WhatsApp message (turnIdForWamid). Anything else is hashed. */
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
/** Kinds of message kept as their kind only, in every mode: they are credentials (C-1741). */
const KIND_ONLY: ReadonlySet<string> = new Set(["login_code"]);

// ── State ────────────────────────────────────────────────────────

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
  content_mode: "full" | "meta";
  /** Serialised at capture, so later changes to the object cannot leak in; redacted at write. */
  contentJson: string | null;
  metaJson: string;
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
/** One intel_flush_failed incident per outage: set when filed, cleared by the next write that lands. */
let incidentFiled = false;
/** Clients and traces forgotten in this process: a late row about them is never buffered. */
const forgotten = { clients: new Set<string>(), traces: new Set<string>() };
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

/** The one id of everything a session did. */
export const traceForSession = (sessionId: string): string => `s_${sessionId}`;
/** A request tied to no session (login, settings, a catalogue upload). */
export const requestTraceId = (): string => `r_${randomBytes(8).toString("hex")}`;
/** A transcript turn: a hash, the same at ingest and wherever the turn is referred to later. */
export const turnIdFor = (sessionId: string, idx: number): string => `t_${sha16(`${sessionId}:${idx}`)}`;
/** A WhatsApp message: a hash of its wamid, which encodes the sender's number, so never the wamid itself. */
export const turnIdForWamid = (wamid: string): string => `t_${sha16(wamid)}`;

/** A turn id as the column holds it: one of ours, or anything else hashed (a raw wamid or number is never stored). */
const turnIdOf = (v: string | null | undefined): string | null => (v === null || v === undefined || v === "" ? null : TURN_ID.test(v) ? v : turnIdForWamid(String(v)));

/** The session, else the job, else the request's own id (INTEL-PHASE0 §3). */
export function traceOf(ctx: TrackContext): string {
  if (ctx.sessionId) return traceForSession(ctx.sessionId);
  if (ctx.jobId !== null && ctx.jobId !== undefined) return `job_${ctx.jobId}`;
  return ctx.traceId || processTrace;
}

/**
 * Runs `fn` with these facts on every capture inside it, merged over any outer
 * context. The same store as track.ts withTrackContext: one context, whichever
 * opened it.
 */
export function withTrace<T>(ctx: TraceContext, fn: () => Promise<T>): Promise<T> {
  return withTrackContext(ctx, fn);
}

// ── Serialising (at capture, on the caller's time: cheap) ────────

const DATA_URL = /^data:([\w.+-]+\/[\w.+-]+)?(?:;[\w=.+-]+)*?(;base64)?,/i;
const BASE64_WHOLE = /^[A-Za-z0-9+/\r\n]+={0,2}\s*$/;
const base64Size = (b: string): number => Math.floor((b.replace(/[\s=]/g, "").length * 3) / 4);

/** A string that is a file: a data: URL, or nothing but base64. */
function fileOf(s: string): { type: string; size: number } | null {
  if (s.startsWith("data:")) {
    const m = DATA_URL.exec(s.slice(0, 256));
    if (m) return { type: m[1] || "bytes", size: m[2] ? base64Size(s.slice(m[0].length)) : s.length - m[0].length };
  }
  return BASE64_WHOLE.test(s) ? { type: "base64", size: base64Size(s) } : null;
}

/**
 * Files and bytes become their type and size (INTEL-CONTRACT §4 rule 4). The
 * holder's own value is checked, not `value`: JSON.stringify has already
 * turned a Buffer into {type: "Buffer", data: [...every byte...]} by then.
 */
function replacer(this: unknown, key: string, value: unknown): unknown {
  const raw = (this as Record<string, unknown> | null)?.[key];
  if (raw instanceof ArrayBuffer || ArrayBuffer.isView(raw)) return { type: "bytes", size: (raw as ArrayBuffer).byteLength };
  if (typeof Blob !== "undefined" && raw instanceof Blob) return { type: raw.type || "bytes", size: raw.size };
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string" && value.length > 200) return fileOf(value) ?? value;
  return value;
}

const UNSERIALISABLE = '{"unserialisable":true}';

interface Serialised {
  json: string | null;
  bytes: number;
  truncatedBytes?: number;
}

function serialise(content: unknown, limit: number): Serialised {
  if (content === undefined || content === null) return { json: null, bytes: 0 };
  let s: string | undefined;
  try {
    s = JSON.stringify(content, replacer);
  } catch {
    return { json: UNSERIALISABLE, bytes: UNSERIALISABLE.length };
  }
  if (s === undefined) return { json: null, bytes: 0 };
  const bytes = Buffer.byteLength(s);
  if (bytes <= limit) return { json: s, bytes };
  const cut = shrink(JSON.parse(s) as unknown, limit);
  return { json: cut.json, bytes: cut.bytes, truncatedBytes: bytes - cut.bytes };
}

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

/**
 * Content over the limit, cut to it. The longest strings are cut first (a
 * prompt with a transcript in it), so the shape survives — keys, the model's
 * answer, the numbers — and the flush can still redact by key. Content that is
 * mostly structure falls back to its redacted JSON text, cut.
 */
function shrink(value: unknown, limit: number): { json: string; bytes: number } {
  const lengths = stringLengths(value, []);
  const total = Buffer.byteLength(JSON.stringify(value));
  let target = limit;
  for (let i = 0; i < 6 && lengths.length; i++) {
    // The cut markers add a few bytes each: an overshoot lowers the target, and the next pass cuts again.
    const json = JSON.stringify(capStrings(value, capFor(lengths, total - target + 1024)));
    const bytes = Buffer.byteLength(json);
    if (bytes <= limit) return { json, bytes };
    target -= bytes - limit + 1024;
  }
  // Structure is about to be lost, so the key rules run now rather than at the flush.
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

function serialiseMeta(meta: Record<string, unknown>): string {
  const s = serialise(meta, MAX_META_BYTES);
  // Meta is small facts; past its cap it is a bug at the call site, and the row still goes.
  if (s.json === null) return "{}";
  return s.truncatedBytes ? JSON.stringify({ truncated_meta_bytes: s.truncatedBytes }) : s.json;
}

const clampMs = (ms: number | null | undefined): number | null => (typeof ms === "number" && Number.isFinite(ms) ? Math.min(Math.max(Math.round(ms), 0), 2_147_483_647) : null);

function defaultActor(kind: IntelKind): Actor {
  // A tool call is the voice agent's LLM choosing it (INTEL-PHASE0 §3), not the person's own AI.
  if (kind === "ask") return "person";
  if (kind === "model" || kind === "tool") return "model";
  if (kind === "say" || kind === "send") return "app";
  return "system";
}

// ── Capture ──────────────────────────────────────────────────────

/** Record one thing that happened. Never throws, never waits, never writes. */
export function capture(kind: IntelKind, opts: CaptureOptions): void {
  try {
    const mode = captureMode();
    if (mode === "off") return;
    const ctx = currentTrackContext();
    const trace = traceOf(ctx);
    // A uuid column: anything else would fail the whole batch of 500 (22P02).
    const business = typeof ctx.clientId === "string" && UUID.test(ctx.clientId) ? ctx.clientId : null;
    if ((business && forgotten.clients.has(business)) || forgotten.traces.has(trace)) return;

    const kindOnly = KIND_ONLY.has(String(opts.meta?.kind ?? ""));
    const shapeOnly = mode === "meta" || ctx.contentMode === "meta" || kindOnly;
    const content = serialise(opts.content, MAX_CONTENT_BYTES);
    const meta: Record<string, unknown> = { ...(opts.meta ?? {}) };
    if (ctx.brokerId && meta.broker_id === undefined) meta.broker_id = ctx.brokerId;
    if (content.truncatedBytes) meta.truncated_bytes = content.truncatedBytes;
    if (shapeOnly && !kindOnly && content.json !== null) meta.content_chars = content.json.length;
    const metaJson = serialiseMeta(meta);
    const contentJson = shapeOnly ? null : content.json;
    const bytes = (contentJson === null ? 0 : content.bytes) + metaJson.length + 400;

    if (buffer.length >= MAX_BUFFER_ROWS || bufferedBytes + bytes > MAX_BUFFER_BYTES) {
      stats.dropped++;
      if (!warnedFull) {
        warnedFull = true;
        console.warn(`intel: the buffer is full (${buffer.length} rows), so new events are dropped until the next flush; is flushTracking() called after this work?`);
      }
      return;
    }
    const channel = opts.channel ?? ctx.channel;
    buffer.push({
      at: new Date().toISOString(),
      seq: ++seq,
      trace_id: trace,
      turn_id: turnIdOf(opts.turnId ?? ctx.turnId),
      job_id: typeof ctx.jobId === "number" && Number.isInteger(ctx.jobId) ? ctx.jobId : null,
      business_id: business,
      channel: channel && CHANNEL_SET.has(channel) ? channel : "system",
      stage: opts.stage ?? ctx.stage ?? null,
      kind,
      name: String(opts.name).slice(0, 120),
      actor: opts.actor ?? defaultActor(kind),
      ok: typeof opts.ok === "boolean" ? opts.ok : null,
      ms: clampMs(opts.ms),
      content_mode: shapeOnly ? "meta" : "full",
      contentJson,
      metaJson,
      bytes,
    });
    bufferedBytes += bytes;
  } catch (err) {
    if (!warnedCapture) {
      warnedCapture = true;
      console.warn(`intel: ${String(opts?.name).slice(0, 60)} not captured (${errorText(err)})`);
    }
  }
}

// ── The flush (after the response, off the request path) ─────────

function parse(json: string | null): unknown {
  if (json === null) return null;
  try {
    return redactDeep(JSON.parse(json) as unknown);
  } catch {
    return { unreadable: true };
  }
}

// Redaction happens here, off the request path. Every row has the same keys:
// PostgREST writes NULL, not the default, into a key one row of a batch lacks.
function toRow(p: Pending): Record<string, unknown> {
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
    stage: p.stage,
    kind: p.kind,
    name: redactText(p.name),
    actor: p.actor,
    ok: p.ok,
    ms: p.ms,
    content_mode: p.content_mode,
    content: parse(p.contentJson),
    meta: parse(p.metaJson) ?? {},
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
    // moment before the platform sends the answer, so the redaction and the
    // insert wait for the next turn of the event loop.
    await new Promise<void>((r) => setImmediate(r));
    if (Date.now() < missingUntil) {
      dropped = pending.length;
      return { written, dropped };
    }
    const groups = batches(pending.map(toRow));
    for (let i = 0; i < groups.length; i++) {
      const outcome = await insert(groups[i]!);
      if (outcome.ok) {
        written += groups[i]!.length;
        continue;
      }
      // The database will not take this batch: the rest of this flush goes too.
      const lost = groups.slice(i).reduce((n, g) => n + g.length, 0);
      dropped += lost;
      if (outcome.missing) noteMissing();
      else noteFailure(outcome.error, lost);
      break;
    }
  } catch (err) {
    // Only a bug in this file lands here; the rows are lost, on the record.
    dropped = pending.length - written;
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

/** Every row where `column` is `value`, page by page. Throws on a read error. */
async function rowsWhere(column: "trace_id" | "job_id" | "turn_id", value: string | number): Promise<IntelRow[]> {
  const out: IntelRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db().from("intel_events").select("*").eq(column, value).order("id", { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error(`readTrace: ${errorText(error)}`);
    const page = (data as IntelRow[] | null) ?? [];
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
  while ((traces.length || jobs.length) && seenTraces.size + seenJobs.size < MAX_LINKS) {
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
function remember(set: Set<string>, value: string): void {
  set.add(value);
  if (set.size > 10_000) set.delete(set.values().next().value as string);
}

/**
 * Every row about a client, written or still buffered, and every row of every
 * trace they were in (C-1745). Returns how many rows went. Throws when the
 * database refuses (the forget job retries it); a table that does not exist
 * yet holds nothing to forget. Running it twice deletes nothing the second
 * time (C-1746).
 */
export async function forgetIntel(clientId: string): Promise<number> {
  let removed = 0;
  const traces = new Set<string>();
  remember(forgotten.clients, clientId);
  const dropBuffered = (): void => {
    for (const r of buffer) if (r.business_id === clientId && r.trace_id !== processTrace) traces.add(r.trace_id);
    for (let i = buffer.length - 1; i >= 0; i--) {
      const r = buffer[i]!;
      if (r.business_id === clientId || traces.has(r.trace_id)) {
        bufferedBytes -= r.bytes;
        buffer.splice(i, 1);
        removed++;
      }
    }
  };
  dropBuffered();
  // Rows already on their way land first, so the deletes below reach them.
  while (writing.size) await Promise.allSettled([...writing]);

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db().from("intel_events").select("trace_id").eq("business_id", clientId).order("id", { ascending: true }).range(from, from + PAGE - 1);
    if (error) {
      if (isMissingTable(error)) return removed;
      throw new Error(`forgetIntel: ${errorText(error)}`);
    }
    const page = (data as { trace_id: string }[] | null) ?? [];
    for (const r of page) if (!r.trace_id.startsWith("p_")) traces.add(r.trace_id);
    if (page.length < PAGE) break;
  }
  for (const t of traces) remember(forgotten.traces, t);
  // A row of a forgotten trace captured before the client was known (voice:init) is still buffered.
  dropBuffered();

  const own = await db().from("intel_events").delete().eq("business_id", clientId).select("id");
  if (own.error) throw new Error(`forgetIntel: ${errorText(own.error)}`);
  removed += ((own.data as unknown[] | null) ?? []).length;
  const list = [...traces];
  for (let i = 0; i < list.length; i += 200) {
    const res = await db().from("intel_events").delete().in("trace_id", list.slice(i, i + 200)).select("id");
    if (res.error) throw new Error(`forgetIntel: ${errorText(res.error)}`);
    removed += ((res.data as unknown[] | null) ?? []).length;
  }
  return removed;
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
  incidentFiled = false;
  forgotten.clients.clear();
  forgotten.traces.clear();
}
