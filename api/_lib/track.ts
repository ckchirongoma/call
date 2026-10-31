// Call — tracking: what happened, how the platform performs, what goes wrong.
//
// Ported from Charlie `api/_lib/track.ts`; the why-comments are kept. Trimmed
// to what Call uses, and the differences are on purpose:
//   - Call has no `events` table (SPEC §4). An event reaches the record through
//     the listeners (Chase Intelligence, intel.ts, Task 0.6, writes every one
//     whole), and a problem is counted in `incidents`. So there is no event
//     buffer here; "the batched flush" is flushTracking() waiting for every
//     write in flight, its own and every registered flusher's.
//   - TRACKING_OFF=1 (the test suite, local runs) does NOT stop incidents:
//     they are still rows (C-1552). What it switches off is the noise around
//     them — alert emails and self-calls (alerts.ts and queue.ts, Task 0.4) —
//     and intel.ts reads it for its own default (C-1706, C-1707).
//   - No owner excerpts, no console capture, no forget buffer: Task 0.4 brings
//     the console capture back with alerts.ts if it wants it; nothing here holds
//     a client's words.
//   - Channels are Call's: phone, web, meeting, dashboard, email, whatsapp,
//     system.
//
// Charlie, founder, 2026-10: "We want to know what our users are trying to
// do, also how our system fails… in-depth." Before this, failures lived only in
// Vercel's logs, which nobody reads until something is already on fire.
//
// Rules this file keeps, so no call site has to remember them:
//   - It never throws and never blocks. Writes are started and held;
//     flushTracking() at the end of a job or request waits for them. A tracking
//     outage is one console line, never a client or a broker left waiting.
//   - No phone number or email is ever stored in an incident: errors are
//     masked (errorText) and so is every summary (C-1437).
//   - Who and where come from the context: an entry point opens one
//     (withTrackContext), and every event inside it — however deep, a model
//     call's included — carries the same session, channel and trace id
//     without anyone passing them.

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { waitUntil } from "@vercel/functions";
import { db } from "./db.js";

export type EventCategory = "behaviour" | "funnel" | "performance" | "failure" | "security" | "ops";
export type Severity = "info" | "warn" | "error" | "critical";
export type Channel = "phone" | "web" | "meeting" | "dashboard" | "email" | "whatsapp" | "system";
export type AlertLevel = "none" | "digest" | "immediate";

export interface TrackContext {
  /** The call, widget session or meeting this work is for. */
  sessionId?: string | null;
  clientId?: string | null;
  brokerId?: string | null;
  channel?: Channel;
  stage?: string | null;
  jobId?: number | null;
  /** One id for everything a request did (intel.ts: `s_<session>`, `job_<id>`, or `r_` + 16 hex). */
  traceId?: string | null;
  /** Shared by everything under one tracked() request: why it failed, for request_failed. */
  request?: { failure?: string };
}

export interface TrackOptions {
  category?: EventCategory;
  severity?: Severity;
  stage?: string | null;
  channel?: Channel;
  ms?: number | null;
  /** Small, structured, never secret, never a phone number. */
  props?: Record<string, unknown>;
  /** Failures: how loudly to tell a human. Defaults by severity. */
  alert?: AlertLevel;
  /** Groups repeats of the same problem into one incident. Defaults to the event name (+ error class). */
  fingerprint?: string;
  /** One line a human reads in the alert email. */
  summary?: string;
}

const ctxStore = new AsyncLocalStorage<TrackContext>();

/** Runs `fn` with these facts attached to every event inside it, merged over any outer context. */
export function withTrackContext<T>(ctx: TrackContext, fn: () => Promise<T>): Promise<T> {
  const outer = ctxStore.getStore() ?? {};
  return ctxStore.run({ ...outer, ...ctx }, fn);
}

/** Fills in a fact learned mid-request (the session found, the stage it is in). */
export function setTrackContext(patch: TrackContext): void {
  const store = ctxStore.getStore();
  if (store) Object.assign(store, patch);
}

export function currentTrackContext(): TrackContext {
  return { ...(ctxStore.getStore() ?? {}) };
}

/**
 * Whether TRACKING_OFF=1. Read at call time (not from the env snapshot) so a
 * test can flip it. In Call it never stops an incident row; see the header.
 */
export function trackingOff(): boolean {
  return process.env.TRACKING_OFF === "1";
}

// ── Scrubbing ────────────────────────────────────────────────────

/**
 * Cut to n UTF-16 units without leaving half an emoji: Postgres rejects a
 * lone surrogate in jsonb/text, and with it the whole write.
 */
export const cutSafe = (s: string, n: number): string => s.slice(0, n).replace(/[\uD800-\uDBFF]$/, "");

/** Text for a fingerprint or an email: digits, ids and quoted values flattened, so repeats group. */
export function normaliseForFingerprint(text: string): string {
  return String(text ?? "")
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<id>")
    .replace(/"[^"]{0,200}"|'[^']{0,200}'/g, "<v>")
    // Trace ids, message ids, tokens: anything long that mixes letters and digits.
    .replace(/\b(?=[a-z0-9_-]*\d)(?=[a-z0-9_-]*[a-z])[a-z0-9_-]{9,}\b/g, "<id>")
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

/** No email address and no phone-shaped number in text that outlives "forget me" (an incident does). */
const maskContacts = (s: string): string => s.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]").replace(/\+?\d[\d\s-]{7,}\d/g, "[number]");

/** An error's message, safe for an email or a fingerprint: numbers masked, cut short. */
export function errorText(err: unknown): string {
  let raw: string;
  try {
    // A model provider's error body can echo the request (the client's words):
    // only its status and kind are kept (models.ts ModelError). A
    // ModelBadRequest carries that body in its message on purpose, for the
    // caller (C-1512); the record gets the status, model and role, never the body.
    if (err instanceof Error && err.name === "ModelError") raw = `ModelError: ${(err as { status?: unknown }).status ?? ""} ${(err as { kind?: unknown }).kind ?? ""} ${err.message.split(":")[0]}`.trim();
    else if (err instanceof Error && err.name === "ModelBadRequest") {
      const e = err as { status?: unknown; model?: unknown; role?: unknown };
      raw = `ModelBadRequest: ${e.status ?? ""} (${e.model ?? ""}) for ${e.role ?? ""}`;
    } else if (err instanceof Error) raw = `${err.name === "Error" ? "" : `${err.name}: `}${err.message}`;
    else if (typeof err === "string") raw = err;
    else if (err && typeof err === "object") {
      // A Supabase/PostgREST error is a plain object whose `details` and
      // `hint` can quote the failing row — a client's words. Only its code
      // and message are kept.
      const o = err as { code?: unknown; message?: unknown; status?: unknown };
      raw = [o.code, o.status, o.message].filter((x) => x !== undefined && x !== null && x !== "").map(String).join(" ") || Object.prototype.toString.call(err);
    } else raw = String(err);
  } catch {
    raw = "unreadable error";
  }
  return maskContacts(raw.replace(/Failing row contains \(.*?\)/gi, "Failing row contains (…)").replace(/\bwamid\.[A-Za-z0-9+/=_-]+/g, "wamid.<id>")).slice(0, 400);
}

// ── Writing ──────────────────────────────────────────────────────

const inflight = new Set<Promise<unknown>>();
/** One "tracking is down" console line per process, not one per event. */
let warnedDown = false;

/**
 * For a write that must not hold up the caller: flushTracking() waits for it.
 * then(del, del), not finally(del): the promise finally() returns rejects when
 * `p` does, and nothing would catch it — an unhandled rejection, which ends a
 * Node process by default.
 */
export function holdForFlush(p: Promise<unknown>): void {
  inflight.add(p);
  const del = (): void => {
    inflight.delete(p);
  };
  void p.then(del, del);
}

/**
 * Counted in `incidents`, one row per fingerprint, by one atomic call
 * (bump_incident), so two workers reporting the same problem in the same
 * second add up instead of overwriting each other (Charlie db/0024). The row
 * carries how loudly to tell a human (alert_level, Charlie's `alert`): what
 * alerts.ts reads to decide between the immediate email, the daily digest and
 * neither. Before Task 0.4's fix round it was dropped here and severity alone
 * decided, so every transient model failure (error, "digest") was paged at once.
 */
function bump(fingerprint: string, kind: string, severity: Severity, summary: string, alert: AlertLevel): void {
  holdForFlush(
    (async () => {
      try {
        const { error } = await db().rpc("bump_incident", {
          p_fingerprint: fingerprint,
          p_kind: kind,
          p_severity: severity,
          p_summary: cutSafe(maskContacts(summary), 500),
          p_alert_level: alert,
        });
        if (error) throw error;
      } catch (err) {
        if (!warnedDown) {
          warnedDown = true;
          console.warn(`track: incident could not be counted (${errorText(err)}) — is db/0006 applied? Further failures are not logged.`);
        }
      }
    })(),
  );
}

const RANK: Record<Severity, number> = { info: 0, warn: 1, error: 2, critical: 3 };

// ── Listeners and flushers (Chase Intelligence, intel.ts) ────────
// Every event is also handed to whoever listens (intel.ts records it in full,
// for good), and flushTracking() waits for their writes too. Neither can throw
// into track() or hold it up.

type TrackListener = (name: string, opts: TrackOptions, ctx: TrackContext) => void;
type Flusher = { flush: () => Promise<unknown> | void; pending: () => boolean };

// Held on globalThis, reached through a hoisted function: a listener can
// register while this module is still loading (an import cycle through
// intel.ts), when a module-level const would not exist yet.
function registry(): { listeners: TrackListener[]; flushers: Flusher[] } {
  const g = globalThis as { __callTrackRegistry?: { listeners: TrackListener[]; flushers: Flusher[] } };
  return (g.__callTrackRegistry ??= { listeners: [], flushers: [] });
}

export function onTrack(fn: TrackListener): void {
  registry().listeners.push(fn);
}

export function registerFlusher(f: Flusher): void {
  registry().flushers.push(f);
}

const pendingElsewhere = (): boolean =>
  registry().flushers.some((f) => {
    try {
      return f.pending();
    } catch {
      return false;
    }
  });

/** Something happened. Never throws, never waits. */
export function track(name: string, opts: TrackOptions = {}): void {
  const ctx = ctxStore.getStore() ?? {};
  for (const l of registry().listeners) {
    try {
      l(name, opts, ctx);
    } catch {
      // A listener is never the reason an event, or a job, fails.
    }
  }
  try {
    const category = opts.category ?? "behaviour";
    const severity = opts.severity ?? (category === "failure" ? "error" : "info");
    const isProblem = category === "failure" || RANK[severity] >= RANK.warn;
    if (!isProblem) return;
    const alert: AlertLevel = opts.alert ?? (RANK[severity] >= RANK.error ? "immediate" : "digest");
    // A warning nobody need hear about is not an incident; a failure always is.
    if (alert === "none" && category !== "failure") return;
    bump((opts.fingerprint ?? name).slice(0, 200), name.slice(0, 80), severity, opts.summary ?? name.replace(/_/g, " "), alert);
  } catch (err) {
    // Tracking must never be the reason a job fails.
    if (!warnedDown) {
      warnedDown = true;
      console.warn(`track: ${name} not recorded (${errorText(err)})`);
    }
  }
}

/**
 * Something broke. `err` becomes a masked message in props and, with the
 * event name, the incident fingerprint — so "OpenRouter 402" and "OpenRouter
 * timeout" are two incidents, but the same timeout a hundred times is one.
 */
export function trackFailure(name: string, err: unknown, opts: TrackOptions = {}): void {
  const message = errorText(err);
  const kind = err instanceof Error && err.name && err.name !== "Error" ? err.name : "";
  track(name, {
    ...opts,
    category: opts.category ?? "failure",
    severity: opts.severity ?? "error",
    props: { error: message, ...(kind ? { error_kind: kind } : {}), ...(opts.props ?? {}) },
    fingerprint: opts.fingerprint ?? `${name}:${normaliseForFingerprint(kind || message).slice(0, 120)}`,
    summary: opts.summary ?? `${name.replace(/_/g, " ")}: ${message.slice(0, 200)}`,
  });
}

/** flushTracking()'s bound: queue.ts counts it in the worker's tail after its hard stop. */
export const FLUSH_TIMEOUT_MS = 4000;

/** Wait for every write in flight (end of a job, a request, a cron). Bounded. */
export async function flushTracking(timeoutMs = FLUSH_TIMEOUT_MS): Promise<void> {
  for (const f of registry().flushers) {
    try {
      const p = f.flush();
      if (p) holdForFlush(p);
    } catch {
      // never
    }
  }
  if (!inflight.size) return;
  let done = false;
  const all = (async () => {
    while (inflight.size) await Promise.allSettled([...inflight]);
    done = true;
  })();
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([all, new Promise((r) => (timer = setTimeout(r, timeoutMs)))]);
  clearTimeout(timer);
  if (!done) console.warn(`track: ${inflight.size} write(s) still pending after ${timeoutMs}ms`);
}

/** Milliseconds since `started`, for `ms`. */
export const since = (started: number): number => Date.now() - started;

// ── Entry points ─────────────────────────────────────────────────

/**
 * Why this request is about to answer 500, for its request_failed event. An
 * endpoint's catch-all logs with console.log (request_failed is the record),
 * so without this the email said only "voice answered 500".
 */
export function noteRequestFailure(err: unknown): void {
  const request = ctxStore.getStore()?.request;
  if (request) request.failure = errorText(err).slice(0, 300);
}

/**
 * Every Vercel function's handler goes through this: a channel for its events,
 * one http_request event (not for health checks or CORS preflights), a crash or
 * a 5xx as a failure, and the writes in flight finished before the function
 * can be frozen.
 */
export function tracked(fn: string, channel: Channel, handler: (req: Request) => Promise<Response>): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    const started = Date.now();
    // Health checks, preflights and the queue's own self-calls (the tick,
    // hand-ons) are not traffic worth an event each.
    const quiet = req.method === "OPTIONS" || fn === "health" || /[?&](tick|async)=1\b/.test(req.url);
    // One object, shared by reference with every context nested inside.
    const request: { failure?: string } = {};
    return withTrackContext({ channel, request, traceId: `r_${randomUUID().replace(/-/g, "").slice(0, 16)}` }, async () => {
      let status = 0;
      try {
        const res = await handler(req);
        status = res.status;
        return res;
      } catch (err) {
        status = 500;
        trackFailure("request_crashed", err, { severity: "critical", alert: "immediate", props: { fn, method: req.method }, fingerprint: `request_crashed:${fn}` });
        throw err;
      } finally {
        const path = (() => {
          try {
            const u = new URL(req.url);
            // Which view or action, never a token or a signature in the query string.
            const q = ["action", "view", "tick", "async"].filter((k) => u.searchParams.has(k)).map((k) => `${k}=${(u.searchParams.get(k) ?? "").slice(0, 20)}`);
            const pathname = u.pathname.replace(/\/[A-Za-z0-9_-]{20,}(?=\/|$)/g, "/<token>");
            return `${pathname}${q.length ? `?${q.join("&")}` : ""}`;
          } catch {
            return "";
          }
        })();
        if (!quiet) track("http_request", { category: "performance", ms: Date.now() - started, props: { fn, method: req.method, status, path } });
        if (status >= 500 && status !== 503) {
          track("request_failed", {
            category: "failure",
            severity: "error",
            alert: "immediate",
            props: { fn, method: req.method, status, path, ...(request.failure ? { error: request.failure } : {}) },
            fingerprint: `request_failed:${fn}:${status}`,
            summary: `${fn} answered ${status} (${path})${request.failure ? `: ${request.failure.slice(0, 160)}` : ""}`,
          });
        }
        // Written after the response, not before it: a webhook wants its 200
        // fast, and a broker's page should not wait on our bookkeeping.
        if (inflight.size || pendingElsewhere()) waitUntil(flushTracking(2500));
      }
    });
  };
}
