// Call — the job queue every pipeline step runs on.
//
// Ported from Charlie `api/_lib/queue.ts` and the job helpers of its
// `api/_lib/db.ts` (claimJob, finishJob, touchJob, stillOwnJob, holdJob,
// retryJob, otherJobRunningFor, queuedWorkDue) and `api/_lib/chain.ts`; the
// why-comments are kept. Charlie's queue knew its own job kinds (the WhatsApp
// engine, the plan build, its watchdog chain); Call's does not: each pipeline
// module registers its handler with registerHandler(kind, fn), and the queue
// only claims, runs, retries, holds, fences and hands on. Not ported: the
// plan-build watchdog and its runner, the slow-build notices, apologies to a
// waiting owner (a broker sees a failed job on the dashboard instead), the
// long-job deferral and the overrun guard (a job that hangs past the hard stop
// is reclaimed 120 s after its last heartbeat, by the next drain).
//
// The webhook makes the post-call event durable, answers ElevenLabs in under
// a second and kicks the worker (kickWorker). The worker is what then does the
// actual work, and it can be driven from three places, all safe to run at once:
//   1. the kick (a self-call to /api/worker?async=1), right after the webhook
//   2. a drain that leaves work behind, handing it on to a fresh worker
//   3. /api/worker?tick=1, the daily cron: the catch-up sweep
// Vercel's Hobby cron runs once a day at most (docs/VERIFIED.md), so the kick
// and the hand-on carry the queue; the tick is the safety net, never the plan.
//
// What a job is promised:
//   - One attempt at a time. claim_job hands a job to one worker, atomically,
//     and the worker heartbeats its lock every 30 s; a lock untouched for 120 s
//     is a dead worker's, and claim_job hands the job out again (C-1597).
//   - Fenced if reclaimed. A slow attempt that lost its job to another worker
//     stops at its next write or send (fenceCheck), and its finishJob is
//     refused: in Call that is the quotation going to a client twice.
//   - One session, one step at a time, in order. claim_job never hands out a
//     job behind an unfinished earlier job of its session, and the drain holds
//     one whose session is busy anyway (otherJobRunningFor). Up to three
//     sessions run side by side in one drain; a job with no session waits for
//     nothing.
//   - Three attempts, 10 s then 60 s apart, then `failed` and an incident
//     (job_failed), which alerts.ts emails at once. A hold (JobHoldError), a
//     busy session and the first out-of-time requeue (DeadlineError) do not
//     spend an attempt.
//   - Nothing half-written. A step's next step is queued only once the step has
//     returned (enqueueNext), and a job whose session was forgotten is skipped
//     without running.

import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { db } from "./db.js";
import { env } from "./env.js";
import { DeadlineError, JobFencedError, JobHoldError, jobCtx, type JobCtx } from "./jobctx.js";
import type { Job } from "./types.js";
import { cutSafe, errorText, flushTracking, since, track, trackFailure, trackingOff, withTrackContext } from "./track.js";

// ── Kinds and handlers ───────────────────────────────────────────

/** Every kind of work the pipeline queues, in pipeline order. A kind outside this list is refused at enqueue. */
export const JOB_KINDS = [
  "ingest_transcript",
  "store_audio",
  "extract_facts",
  "analyse_needs",
  "match",
  "write_quote",
  "check_quote",
  "notify_broker",
  "send_quote",
  "forget_client",
  "transcribe_meeting",
  "label_speakers",
] as const;

export type JobKind = (typeof JOB_KINDS)[number];
const KINDS: ReadonlySet<string> = new Set(JOB_KINDS);

/** A jobs row as claim_job returns it. Its kind is text in the database: a row can name a kind no handler knows (C-1604). */
export type JobRow = Job;
export type JobHandler = (job: JobRow, ctx: JobCtx) => Promise<void>;

/**
 * Kinds whose job may outlive its session: forgetting a client deletes the
 * session its request came from, and a retry of the forget must still run.
 */
const RUNS_WITHOUT_SESSION: ReadonlySet<string> = new Set<JobKind>(["forget_client"]);

const handlers = new Map<string, JobHandler>();

function requireKind(kind: string): void {
  if (!KINDS.has(kind)) throw new Error(`unknown job kind "${kind}" (queue.ts JOB_KINDS)`);
}

/**
 * The step that runs a kind of job. Each pipeline module registers its own
 * when it is imported, and api/worker.ts imports every one of them. Returns
 * the undo (tests).
 */
export function registerHandler(kind: JobKind, fn: JobHandler): () => void {
  requireKind(kind);
  handlers.set(kind, fn);
  return () => {
    if (handlers.get(kind) === fn) handlers.delete(kind);
  };
}

/** Tests only: forget every registered handler. */
export function __resetHandlers(): void {
  handlers.clear();
}

// ── The numbers ──────────────────────────────────────────────────

/** Attempts before a job is `failed` for good (C-0486). */
export const MAX_ATTEMPTS = 3;

/**
 * The wait before the next attempt, by the attempt that just failed: 10 s,
 * 60 s, then 300 s for any later one (C-0485). With MAX_ATTEMPTS at 3 a job
 * fails on its third failure, so 300 s is the ceiling, not a step every job
 * reaches. Exact, with no jitter: Charlie's jitter (round 22) spread five
 * plan-build stages failing at once; Call runs at most three sessions per
 * drain, and the criteria pin the delays.
 */
export const BACKOFF_SECONDS = [10, 60, 300] as const;
export const retryDelaySeconds = (attempt: number): number => BACKOFF_SECONDS[Math.min(Math.max(1, Math.floor(attempt)), BACKOFF_SECONDS.length) - 1]!;

/** claim_job's: a running job whose lock is older than this belongs to a worker that died (C-0489, C-1597). */
export const LOCK_TIMEOUT_MS = 120_000;

/**
 * Four beats inside the lock timeout, so one lost beat (a slow database) is
 * never a reclaim. Round 21 (Charlie): at one beat a minute, a dead worker
 * could only be noticed 150 s after its last touch.
 */
export const HEARTBEAT_MS = 30_000;
let heartbeatMs = HEARTBEAT_MS;
/** Tests only. Returns the undo. */
export function __setHeartbeatMs(ms: number): () => void {
  const was = heartbeatMs;
  heartbeatMs = ms;
  return () => {
    heartbeatMs = was;
  };
}

/** How long a job held back for its busy session waits before it is claimable again. */
export const HOLD_MS = 5_000;

/** Sessions run side by side in one drain (C-1601). Each lane runs one job at a time. */
export const PARALLEL_SESSIONS = 3;

/** A drain stops claiming within this (C-0492); job attempts must be done by it plus the margin, inside Vercel's 300 s kill. */
export const WORKER_BUDGET_MS = 240_000;
export const HARD_STOP_MARGIN_MS = 30_000;

/** How far ahead a queued job still counts as "left for us to do". */
const HAND_ON_WITHIN_MS = 60_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── Enqueueing ───────────────────────────────────────────────────

export interface EnqueueOptions {
  runAfter?: Date;
  /** Unique: a second enqueue of the same work is a no-op that returns the first job's id. */
  dedupeKey?: string;
}

/** Queue a job; returns its id. */
export async function enqueue(kind: JobKind, sessionId: string | null, payload: object, opts: EnqueueOptions = {}): Promise<string> {
  requireKind(kind);
  const runAfter = (opts.runAfter ?? new Date()).toISOString();
  const { data, error } = await db()
    .from("jobs")
    .insert({
      kind,
      session_id: sessionId,
      payload,
      run_after: runAfter,
      // Written out rather than left to the column defaults: these decide
      // whether the job is ever picked up, which is too important to be
      // invisible at the call site.
      status: "queued",
      attempts: 0,
      dedupe_key: opts.dedupeKey ?? null,
    })
    .select("id")
    .single();
  if (!error) return String((data as { id: number }).id);
  if (opts.dedupeKey && (error as { code?: string }).code === "23505") return sameWork(opts.dedupeKey, payload, runAfter);
  throw new Error(`enqueue ${kind} failed: ${errorText(error)}`);
}

/**
 * The job already queued under this dedupe key. Left as it is while it is
 * queued, running or finished; revived, once, when it had failed for good: a
 * step that gave up, asked for again by the step before it (a re-run ingest),
 * gets a fresh set of attempts (C-0488). The update is conditional on
 * `failed`, so two re-runs at once revive it once.
 */
async function sameWork(dedupeKey: string, payload: object, runAfter: string): Promise<string> {
  const { data, error } = await db().from("jobs").select("id, status").eq("dedupe_key", dedupeKey).maybeSingle();
  if (error || !data) throw new Error(`enqueue: dedupe key ${dedupeKey} is taken but its job cannot be read: ${errorText(error ?? "no row")}`);
  const row = data as { id: number; status: string };
  if (row.status === "failed") {
    const revived = await db()
      .from("jobs")
      .update({ status: "queued", attempts: 0, run_after: runAfter, payload, last_error: null, locked_by: null, locked_at: null })
      .eq("id", row.id)
      .eq("status", "failed");
    if (revived.error) throw new Error(`enqueue: could not re-queue job ${row.id}: ${errorText(revived.error)}`);
  }
  return String(row.id);
}

interface NextJob {
  kind: JobKind;
  sessionId: string | null;
  payload: object;
  opts: EnqueueOptions;
}

/** What each running attempt asked to queue next, written only once it has returned. */
const nextSteps = new WeakMap<JobCtx, NextJob[]>();

/**
 * Queue the step after this one. Inside a job attempt the job is written only
 * once the attempt has returned, which is when its own writes are committed: a
 * step whose write failed never starts the next (C-1608), whatever order the
 * step's code asked in. Outside a job it is enqueue(). Give the next step a
 * dedupe key: a step that is retried, or re-run, then queues it once.
 */
export async function enqueueNext(kind: JobKind, sessionId: string | null, payload: object, opts: EnqueueOptions = {}): Promise<void> {
  requireKind(kind);
  const ctx = jobCtx.getStore();
  const pending = ctx ? nextSteps.get(ctx) : undefined;
  if (pending) {
    pending.push({ kind, sessionId, payload, opts });
    return;
  }
  await enqueue(kind, sessionId, payload, opts);
}

// ── The jobs table ───────────────────────────────────────────────

/** Atomic: two workers waking at once can never claim the same row (C-0490). */
export async function claimJob(worker: string): Promise<JobRow | null> {
  const { data, error } = await db().rpc("claim_job", { p_worker: worker });
  if (error) throw new Error(`claim_job failed: ${errorText(error)}`);
  return ((data as JobRow[] | null) ?? [])[0] ?? null;
}

/**
 * Is another worker already running a job of this session?
 *
 * Charlie, PRIORITY 0 (live, 2026-09-22): this used to be the ONLY place that
 * enforced per-owner ordering, and it is exactly what broke it — two workers
 * could each claim a different job of the same owner within milliseconds,
 * and each hold pushed run_after into the future, so a job created second was
 * claimed last. The fix moved the ordering into claim_job itself (Charlie
 * db/0013; Call's claim_job, Task 1.1). This stays as the safety net for the
 * one case the order rule allows: an earlier job put back in the queue (an
 * operator's retry) while a later job of its session runs.
 */
export async function otherJobRunningFor(sessionId: string, exceptJobId: number): Promise<boolean> {
  const { data, error } = await db().from("jobs").select("id, locked_at").eq("session_id", sessionId).eq("status", "running");
  if (error) return false;
  const fresh = Date.now() - LOCK_TIMEOUT_MS;
  return ((data as { id: number; locked_at: string | null }[] | null) ?? []).some((r) => r.id !== exceptJobId && Date.parse(r.locked_at ?? "") > fresh);
}

/**
 * Close a job. Only the attempt that still holds it can (C-1598): a fenced-off
 * attempt must not mark done a job another worker is running. Returns whether
 * it was this attempt's to close.
 */
export async function finishJob(id: number, status: "done" | "failed" | "skipped", lastError: string | null, worker: string): Promise<boolean> {
  const { data, error } = await db()
    .from("jobs")
    .update({ status, last_error: lastError === null ? null : cutSafe(lastError, 2000) })
    .eq("id", id)
    .eq("locked_by", worker)
    .eq("status", "running")
    .select("id");
  if (error) throw new Error(`finishJob ${id} failed: ${errorText(error)}`);
  return ((data as unknown[] | null) ?? []).length > 0;
}

/** Heartbeat: a job that is still being worked on keeps its lock fresh, so it is never taken for abandoned (C-1599). */
export async function touchJob(id: number, worker: string): Promise<void> {
  await db().from("jobs").update({ locked_at: new Date().toISOString() }).eq("id", id).eq("locked_by", worker).eq("status", "running");
}

/** The fencing check: is this job still running under this worker's claim? */
export async function stillOwnJob(id: number, worker: string): Promise<boolean> {
  const { data, error } = await db().from("jobs").select("status, locked_by").eq("id", id).maybeSingle();
  // On a read failure, carry on: the heartbeat is the main defence, this is
  // the second, and the send's own idempotency key (Resend) the third.
  if (error || !data) return true;
  const row = data as { status: string; locked_by: string | null };
  return row.status === "running" && row.locked_by === worker;
}

/**
 * Put a job back without counting the attempt.
 *
 * Used when the job was not really tried: its session was busy, it is waiting
 * on other work (JobHoldError), or it ran out of time the first time
 * (DeadlineError). Counting those as failed attempts would let a busy session
 * exhaust MAX_ATTEMPTS on a job nothing was ever wrong with.
 */
export async function holdJob(id: number, attempts: number, reason: string, delayMs = HOLD_MS, worker?: string): Promise<void> {
  let q = db()
    .from("jobs")
    .update({
      status: "queued",
      attempts: Math.max(0, attempts - 1),
      run_after: new Date(Date.now() + Math.max(0, delayMs)).toISOString(),
      last_error: cutSafe(reason, 2000),
    })
    .eq("id", id);
  // Only the attempt that holds the job can put it back (see finishJob).
  if (worker) q = q.eq("locked_by", worker);
  const { error } = await q;
  if (error) throw new Error(`holdJob ${id} failed: ${errorText(error)}`);
}

/** Failed but retriable: back off rather than hammering (BACKOFF_SECONDS). */
export async function scheduleRetry(id: number, attempts: number, lastError: string, worker: string): Promise<void> {
  const { error } = await db()
    .from("jobs")
    .update({
      status: "queued",
      run_after: new Date(Date.now() + retryDelaySeconds(attempts) * 1000).toISOString(),
      last_error: cutSafe(lastError, 2000),
    })
    .eq("id", id)
    .eq("locked_by", worker);
  if (error) throw new Error(`scheduleRetry ${id} failed: ${errorText(error)}`);
}

/**
 * Work still waiting after a drain: how many queued jobs can run now, and how
 * soon the next one becomes runnable (a retry's backoff, a short hold). The
 * drain uses it to hand on to a fresh worker instead of leaving the rest of a
 * call's pipeline to whatever arrives next (Charlie, founder, 2026-09-24: "it
 * takes forever for a report to come").
 */
export async function queuedWorkDue(withinMs: number, now = Date.now()): Promise<{ ready: number; soonestMs: number | null; nextMs: number | null }> {
  const { data, error } = await db()
    .from("jobs")
    .select("run_after")
    .eq("status", "queued")
    .lt("run_after", new Date(now + withinMs).toISOString())
    .order("run_after", { ascending: true })
    .limit(50);
  if (error) throw new Error(`queuedWorkDue failed: ${errorText(error)}`);
  const due = ((data as { run_after: string }[] | null) ?? []).map((r) => Date.parse(r.run_after) - now);
  const future = due.filter((ms) => ms > 0);
  // ready counts rows claim_job may still refuse (a session's later job waits
  // behind its earlier one), so callers must not treat "ready" as
  // "claimable"; nextMs is the soonest job that is not due yet.
  return {
    ready: due.filter((ms) => ms <= 0).length,
    soonestMs: due.length ? Math.max(0, Math.min(...due)) : null,
    nextMs: future.length ? Math.min(...future) : null,
  };
}

/**
 * Throws JobFencedError if this code runs inside a job attempt that no longer
 * owns its job. Called before every write or send a stale attempt must not
 * make (Charlie round 6: one question answered twice, five minutes apart).
 * `maxAgeMs` reuses a check that recent, so a job's 2-3 sends cost one read.
 * Outside a job, it does nothing.
 */
export async function fenceCheck(opts: { maxAgeMs?: number } = {}): Promise<void> {
  const job = jobCtx.getStore();
  if (!job) return;
  if (opts.maxAgeMs && job.checkedAt && Date.now() - job.checkedAt <= opts.maxAgeMs) return;
  if (!(await stillOwnJob(job.id, job.worker))) throw new JobFencedError(job.id);
  job.checkedAt = Date.now();
}

/** A job's session (its column, or a session_id in its payload) has been deleted: "forget me" landed mid-pipeline. */
async function sessionGone(job: JobRow): Promise<boolean> {
  if (RUNS_WITHOUT_SESSION.has(job.kind)) return false;
  const payload = job.payload && typeof job.payload === "object" ? (job.payload as Record<string, unknown>) : {};
  const sessionId = job.session_id ?? (typeof payload.session_id === "string" ? payload.session_id : null);
  if (!sessionId) return false;
  const { data, error } = await db().from("sessions").select("id").eq("id", sessionId).maybeSingle();
  // A read that failed is not a deleted session: the step runs, and fails on its own if the database is down.
  if (error) return false;
  return !data;
}

// ── How deep a chain of self-calls is ────────────────────────────
// Charlie round 23, live (chain.ts): a render called from a worker that one
// worker woke, which another woke, answered 508 INFINITE_LOOP_DETECTED —
// Vercel refuses a request once a function has called its own deployment too
// many times in one chain (about the fourth nested call; it documents no
// exact limit). So every self-call carries its depth (`hop`), the worker runs
// inside it, and a worker wakes another only while that one would be at most
// MAX_WORKER_HOP deep. Past it, the next kick or the tick carries the work on.

export const MAX_WORKER_HOP = 2;
const hopStore = new AsyncLocalStorage<{ hop: number }>();

/** How many times this deployment has called itself to reach the code running now (0: an outside request). */
export const currentHop = (): number => hopStore.getStore()?.hop ?? 0;
/** Runs `fn` at a given depth: everything it calls on to (waitUntil included) inherits it. */
export const withHop = <T>(hop: number, fn: () => T): T => hopStore.run({ hop }, fn);
/** The depth a call made from here arrives at. */
export const nextHop = (): number => currentHop() + 1;
export const mayWakeWorker = (): boolean => nextHop() <= MAX_WORKER_HOP;
/** The `hop` a request carries (0 when it has none: a webhook, a cron, a person). */
export function hopFrom(url: URL): number {
  const n = Number(url.searchParams.get("hop"));
  return Number.isInteger(n) && n >= 0 && n < 100 ? n : 0;
}

// ── Waking a worker ──────────────────────────────────────────────

/** TRACKING_OFF=1 (tests, local runs) switches self-calls off, as it does alert emails (C-1552). */
const selfCallsAllowed = (): boolean => !trackingOff() && Boolean(env.PUBLIC_BASE_URL && env.WORKER_SECRET);

/**
 * Wake a fresh worker invocation, with its own time budget: the webhook's kick
 * after it stores an event, and a drain's hand-on. Returns whether one was
 * woken. Never throws: the work is durable in the queue either way, and the
 * next kick or the tick drains it (C-1605).
 */
export async function kickWorker(label = "kick"): Promise<boolean> {
  if (!selfCallsAllowed()) return false;
  if (!mayWakeWorker()) {
    track("self_call_capped", { category: "performance", props: { label, hop: currentHop() } });
    return false;
  }
  const url = `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/api/worker?async=1&max=10&hop=${nextHop()}`;
  const wake = () => fetch(url, { method: "POST", headers: { Authorization: `Bearer ${env.WORKER_SECRET}` }, signal: AbortSignal.timeout(15_000) });
  try {
    // One retry: a cold start can outlast one attempt, and a lost wake-up is
    // work left for the next trigger (Charlie round 14).
    const res = await wake().catch(() => wake());
    if (res.ok) return true;
    // Refused by the platform (a 508 when the chain was too deep): on the record, not only in the log.
    const platform = res.headers.get("x-vercel-error");
    track("self_call_refused", {
      category: "failure",
      severity: "warn",
      alert: "digest",
      props: { label, hop: currentHop(), status: res.status, ...(platform ? { platform_error: platform } : {}) },
      fingerprint: `self_call_refused:${res.status}`,
    });
    return false;
  } catch (err) {
    trackFailure("self_call_failed", err, {
      severity: "warn",
      alert: "digest",
      props: { label, hop: currentHop() },
      fingerprint: "self_call_failed",
      summary: "A worker could not wake a fresh worker: the queued work waits for the next kick or the daily tick",
    });
    return false;
  }
}

/**
 * A drain that did work and leaves work behind wakes a fresh worker and
 * returns. It hands on only after doing something, so a queue that cannot
 * move — every job waiting on a busy session — never turns into a loop of
 * empty wake-ups.
 */
async function handOn(label: string): Promise<void> {
  try {
    const due = await queuedWorkDue(HAND_ON_WITHIN_MS);
    if (due.ready === 0 && due.soonestMs === null) return;
    await kickWorker(label);
  } catch (err) {
    console.warn(`drain[${label}]: hand-on failed`, errorText(err));
  }
}

// ── Draining ─────────────────────────────────────────────────────

export interface DrainOptions {
  /** At most this many jobs claimed by this drain (default 10). */
  maxJobs?: number;
  /** Stop claiming new work once this much time has gone (default 240 s). */
  budgetMs?: number;
  /**
   * From the drain's start, when job attempts must be finished (default
   * budgetMs + 30 s: 270 s, inside the 300 s kill). Model calls will not start
   * past it (jobctx.ts jobMsLeft), so a slow job fails where the queue can see
   * it instead of being killed where nothing can.
   */
  hardStopMs?: number;
  /** Lanes: sessions run side by side (default 3). */
  parallel?: number;
  label?: string;
  /**
   * When nothing can run right now but a queued job becomes runnable within
   * this long (a retry's backoff, a short hold), wait for it inside this
   * invocation instead of ending. Only the hand-on worker sets it, at the top
   * of its own budget; without it a 10 s backoff would wait for the next
   * trigger, which on Hobby can be a day.
   */
  waitForDueMs?: number;
  /** Don't wake a fresh worker when work is left. */
  noHandOn?: boolean;
}

export interface DrainReport {
  claimed: number;
  done: number;
  /** Attempts that failed: retried with backoff, or failed for good. */
  failed: number;
  /** Put back without spending an attempt: a busy session, a JobHoldError, a first out-of-time. */
  held: number;
  /** Stopped because another worker had reclaimed the job (jobctx.ts). */
  fenced: number;
  /** Finished without running: the session was forgotten (C-0491). */
  skipped: number;
}

// Unique per drain and per lane, not per process: it is the fencing token
// (jobctx.ts), and one Vercel instance runs concurrent invocations in the same
// process — two drains, or two lanes, with the same id would share a token.
// VERCEL_REGION is the platform's (not a setting, not in .env.example), read
// where it is used, as health.ts reads VERCEL_GIT_COMMIT_SHA.
const workerId = (label: string): string => `${label}-${process.env.VERCEL_REGION ?? "local"}-${process.pid}-${randomUUID().slice(0, 8)}`;

export async function drain(opts: DrainOptions = {}): Promise<DrainReport> {
  const maxJobs = Math.max(1, Math.floor(opts.maxJobs ?? 10));
  const budgetMs = opts.budgetMs ?? WORKER_BUDGET_MS;
  const parallel = Math.max(1, Math.min(Math.floor(opts.parallel ?? PARALLEL_SESSIONS), maxJobs));
  const label = opts.label ?? "worker";
  const started = Date.now();
  const me = workerId(label);
  const report: DrainReport = { claimed: 0, done: 0, failed: 0, held: 0, fenced: 0, skipped: 0 };

  // With a way to hand on, stop STARTING jobs well before the invocation's
  // 300-second kill: a step started with a minute to live is killed mid-way,
  // and a killed drain never hands on. What is left goes to a fresh worker
  // with a full budget instead.
  const canHandOn = !opts.noHandOn && selfCallsAllowed();
  const claimUntil = canHandOn ? Math.max(budgetMs * 0.6, budgetMs - 90_000) : budgetMs;
  const hardStopAt = started + (opts.hardStopMs ?? budgetMs + HARD_STOP_MARGIN_MS);
  const mayClaim = (): boolean => Date.now() - started < claimUntil;

  // Lanes share the claim count and a "something finished" signal: a lane
  // that finds nothing claimable while another is still working waits for it,
  // because what that one finishes may be what its session's next job waits on.
  let reserved = 0;
  let busy = 0;
  let waitingForDue = false;
  let broken = false;
  let wake: () => void = () => {};
  let changed = new Promise<void>((r) => (wake = r));
  const signal = (): void => {
    const w = wake;
    changed = new Promise<void>((r) => (wake = r));
    w();
  };

  const lane = async (n: number): Promise<void> => {
    const worker = `${me}-${n}`;
    let reclaimTries = 0;
    while (!broken && reserved < maxJobs && mayClaim()) {
      reserved++;
      let job: JobRow | null;
      try {
        job = await claimJob(worker);
      } catch (err) {
        reserved--;
        console.error(`drain[${label}]: claim_job failed`, errorText(err));
        broken = true;
        signal();
        return;
      }
      if (!job) {
        reserved--;
        if (busy > 0 || waitingForDue) {
          await changed;
          continue;
        }
        // Nothing claimable now. Only the first lane of a worker that has not
        // started anything yet waits (the freshly woken hand-on worker, at the
        // top of its full budget): once a drain has done work it ends instead,
        // and handOn wakes a fresh worker for whatever becomes due.
        const wait = opts.waitForDueMs ?? 0;
        if (n === 0 && wait > 0 && report.claimed === 0) {
          waitingForDue = true;
          try {
            const due = await queuedWorkDue(wait).catch(() => ({ ready: 0, soonestMs: null, nextMs: null }));
            const left = claimUntil - (Date.now() - started);
            // Something due by now that claim_job would not hand out may have
            // become due between the two queries, or be clock skew: retry the
            // claim a couple of times before giving up on it.
            if (due.ready > 0 && reclaimTries < 2 && left > 5_000) {
              reclaimTries++;
              await sleep(1_000);
              continue;
            }
            // The soonest job that is not due yet (a retry's backoff).
            if (due.nextMs !== null && due.nextMs + 5_000 < left) {
              await sleep(due.nextMs + 250);
              continue;
            }
          } finally {
            waitingForDue = false;
            signal();
          }
        }
        return;
      }
      report.claimed++;
      busy++;
      try {
        await runAttempt(job, worker, hardStopAt, report);
      } catch (err) {
        // Only the queue's own bookkeeping can land here (a retry that could
        // not be written): the job keeps its lock, and claim_job hands it out
        // again once the lock is 120 s old. Logged, never lost.
        console.error(`drain[${label}]: job ${job.id} could not be settled`, errorText(err));
      } finally {
        busy--;
        signal();
      }
    }
  };

  await Promise.all(Array.from({ length: parallel }, (_, n) => lane(n)));

  if (report.claimed) console.log(`drain[${label}]: ${JSON.stringify(report)}`);
  // C-1610: everything the jobs recorded is written before the worker answers.
  await flushTracking();
  if (report.claimed > 0 && canHandOn) await handOn(label);
  return report;
}

/** One attempt at one claimed job, settled whatever happens: done, retried, held, skipped, fenced or failed. */
async function runAttempt(job: JobRow, worker: string, hardStopAt: number, report: DrainReport): Promise<void> {
  const facts = { kind: job.kind, attempt: job.attempts, max_attempts: MAX_ATTEMPTS };
  const sessionRef = job.session_id ? job.session_id.slice(0, 8) : null;
  const what = `The ${job.kind.replace(/_/g, " ")} job`;
  // Every event inside the job carries its session and id (track.ts); a job's trace is its session's.
  const context = { sessionId: job.session_id, jobId: job.id, channel: "system" as const, traceId: job.session_id ? `s_${job.session_id}` : `job_${job.id}` };

  await withTrackContext(context, async () => {
    // Task 0.6: capture job lifecycle
    const startedAt = Date.now();

    // claim_job reclaimed a job whose worker died on its last attempt (the
    // platform killed it, so nothing recorded a failure). Running it a fourth
    // time could repeat whatever killed the worker, for ever.
    if (job.attempts > MAX_ATTEMPTS) {
      const message = `the worker stopped during the last attempt (no heartbeat for ${LOCK_TIMEOUT_MS / 1000} s)`;
      if (await finishJob(job.id, "failed", message, worker)) {
        report.failed++;
        trackFailure("job_failed", message, {
          severity: "error",
          alert: "immediate",
          props: { ...facts, session: sessionRef },
          fingerprint: `job_failed:${job.kind}`,
          summary: `${what} failed ${MAX_ATTEMPTS} times and gave up${sessionRef ? ` (session ${sessionRef})` : ""}: ${message}`,
        });
      } else report.fenced++;
      return;
    }

    // A kind this worker cannot run is failed at once and loudly, never left
    // queued or retried: a retry cannot find a handler either (C-1604).
    const handler = handlers.get(job.kind);
    if (!handler) {
      const message = `unknown_kind: no handler for "${job.kind}" in this worker`;
      if (await finishJob(job.id, "failed", message, worker)) {
        report.failed++;
        trackFailure("unknown_kind", message, {
          severity: "error",
          alert: "immediate",
          props: facts,
          fingerprint: `unknown_kind:${job.kind}`.slice(0, 200),
          summary: `A "${job.kind}" job reached a worker with no handler for it and was marked failed (is its module imported in api/worker.ts?)`,
        });
      } else report.fenced++;
      return;
    }

    // One session, one worker at a time (see otherJobRunningFor).
    if (job.session_id && (await otherJobRunningFor(job.session_id, job.id))) {
      await holdJob(job.id, job.attempts, "another job of this session is still running", HOLD_MS, worker);
      report.held++;
      track("job_held", { category: "performance", props: { ...facts, reason: "session_busy" } });
      return;
    }

    // "Forget me" landed between two steps: the step writes nothing (C-0491).
    if (await sessionGone(job)) {
      if (await finishJob(job.id, "skipped", "the session no longer exists (forgotten or deleted)", worker)) {
        report.skipped++;
        track("job_skipped", { category: "behaviour", props: { ...facts, reason: "session_gone" } });
      } else report.fenced++;
      return;
    }

    const ctx: JobCtx = { id: job.id, worker, deadlineAt: hardStopAt, lastAttempt: job.attempts >= MAX_ATTEMPTS, attempt: job.attempts, kind: job.kind };
    nextSteps.set(ctx, []);
    // Heartbeat (jobctx.ts): refresh the lock while this attempt works, so a
    // slow model call never lets the job look abandoned.
    const beat = setInterval(() => void touchJob(job.id, worker).catch(() => {}), heartbeatMs);
    try {
      await jobCtx.run(ctx, () => handler(job, ctx));
      // The step returned, so its writes are committed: only now the steps after it.
      const queued = nextSteps.get(ctx) ?? [];
      if (queued.length && !(await stillOwnJob(job.id, worker))) {
        report.fenced++;
        return;
      }
      for (const n of queued) await enqueue(n.kind, n.sessionId, n.payload, n.opts);
      if (await finishJob(job.id, "done", null, worker)) {
        report.done++;
        track("job_done", { category: "performance", ms: since(startedAt), props: facts });
      } else report.fenced++;
    } catch (err) {
      await settleFailure(job, worker, err, report, { facts, sessionRef, what, startedAt });
    } finally {
      clearInterval(beat);
      nextSteps.delete(ctx);
    }
  });
}

async function settleFailure(
  job: JobRow,
  worker: string,
  err: unknown,
  report: DrainReport,
  about: { facts: Record<string, unknown>; sessionRef: string | null; what: string; startedAt: number },
): Promise<void> {
  if (err instanceof JobFencedError) {
    // Someone else owns the job now and will finish it: no retry, no status
    // write — this attempt simply stops.
    console.warn(err.message);
    report.fenced++;
    return;
  }
  // A stale attempt that failed some other way must not retry or fail a job another worker now owns.
  if (!(await stillOwnJob(job.id, worker).catch(() => true))) {
    report.fenced++;
    return;
  }
  // Not a failure: the job is waiting on other work (jobctx.ts JobHoldError).
  if (err instanceof JobHoldError) {
    await holdJob(job.id, job.attempts, err.message, err.delayMs, worker);
    report.held++;
    track("job_held", { category: "performance", props: { ...about.facts, ms_held: err.delayMs } });
    return;
  }
  // Out of time (jobctx.ts DeadlineError, C-0493): not a failure, the first
  // time — the attempt started too late in its worker, and goes straight back
  // for a fresh one, attempt unspent. Twice in a row is not lateness: the job
  // does not fit in a worker at all, and from then on it counts, or it would
  // be requeued for ever.
  const message = errorText(err);
  if (err instanceof DeadlineError && !/out of time/.test(job.last_error ?? "")) {
    await holdJob(job.id, job.attempts, err.message, 0, worker);
    report.held++;
    track("job_out_of_time", { category: "performance", ms: since(about.startedAt), props: about.facts });
    return;
  }

  report.failed++;
  console.log(`job ${job.id} (${job.kind}) attempt ${job.attempts} failed:`, message);
  if (job.attempts >= MAX_ATTEMPTS) {
    await finishJob(job.id, "failed", message, worker);
    // Work a broker is waiting for that will not happen by itself: the email goes at once (alerts.ts, C-1541).
    trackFailure("job_failed", err, {
      severity: "error",
      alert: "immediate",
      ms: since(about.startedAt),
      props: { ...about.facts, session: about.sessionRef },
      fingerprint: `job_failed:${job.kind}`,
      summary: `${about.what} failed ${job.attempts} times and gave up${about.sessionRef ? ` (session ${about.sessionRef})` : ""}: ${message.slice(0, 160)}`,
    });
  } else {
    await scheduleRetry(job.id, job.attempts, message, worker);
    trackFailure("job_retry", err, {
      severity: "warn",
      alert: "digest",
      ms: since(about.startedAt),
      props: { ...about.facts, retry_in_s: retryDelaySeconds(job.attempts) },
      fingerprint: `job_retry:${job.kind}`,
    });
  }
}
