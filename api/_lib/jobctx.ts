// Call — which queue job, and which attempt of it, is running right now.
//
// Ported from Charlie `api/_lib/jobctx.ts`; the why-comments are kept. Trimmed
// to what Call uses: Charlie's plan-build job kinds (retriesOnDeadline,
// rethrowGuardrailDeadline) have no counterpart here, and fenceCheck() comes
// back with the queue (Task 0.4), which owns stillOwnJob().
//
// Charlie, live, round 6 (2026-09-24): one "How am I doing?" was answered
// TWICE, about five minutes apart. Its first attempt waited ~127s on a slow
// model call; the job's lock was never refreshed, so after 5 minutes a sweep
// reclaimed it and ran it again — while the first attempt was still alive
// underneath, and also replied. Two answers, double the model cost.
//
// Two defences, both keyed on this context:
//   - the drain heartbeats a running job's lock (queue.ts), so a job that is
//     alive is never reclaimed in the first place;
//   - every send checks the job is still this attempt's. A reclaimed attempt is
//     fenced off: it stops, and sends nothing. In Call that is the quotation
//     going to a client twice, which is worse than a chat reply twice.

import { AsyncLocalStorage } from "node:async_hooks";

export interface JobCtx {
  id: number;
  /** The worker id this attempt claimed the job with: the fencing token. */
  worker: string;
  /** Last time ownership was confirmed, so a job's 2–3 sends cost one read, not three. */
  checkedAt?: number;
  /**
   * Epoch ms by which this attempt must be finished: the drain's hard stop,
   * safely inside Vercel's 300-second kill. See jobMsLeft.
   */
  deadlineAt?: number;
  /** True when a failure now makes the job dead rather than retried. */
  lastAttempt?: boolean;
  /** Which attempt this is, from 1. */
  attempt?: number;
  /** The job's kind (jobs.kind): see jobKind. */
  kind?: string;
}

export const jobCtx = new AsyncLocalStorage<JobCtx>();

/**
 * The least time worth starting a model call with inside a job attempt. The
 * slowest calls that succeed take 60-75s; a call started with less than this
 * left is more likely to be cut off by the platform than to finish.
 */
export const MIN_CALL_MS = 20_000;

/** A model request's timeout leaves this much for the job to record the result. */
export const WRAP_UP_MS = 5_000;

/**
 * The refusal point: with less than this left before the attempt's deadline,
 * models.ts refuses to start a model call (DeadlineError). Here, beside the
 * deadline, because the queue must stop claiming before it (queue.ts
 * CLAIM_CUTOFF_MS): a job claimed past it can only be refused.
 */
export const MODEL_REFUSAL_MS = MIN_CALL_MS + WRAP_UP_MS;

/** Thrown at a send when this attempt no longer owns its job. Never retried: the job is someone else's now. */
export class JobFencedError extends Error {
  constructor(id: number) {
    super(`job ${id} was reclaimed by another worker; this attempt stops without sending`);
    this.name = "JobFencedError";
  }
}

/**
 * How long this job attempt has left, or null outside a job.
 *
 * Charlie, live test, round 10 (2026-09-26): a plan build's strategy call spent
 * 66% of its output on hidden reasoning, came back cut off, and was retried —
 * and the retry pushed the invocation past Vercel's 300-second limit. The
 * platform killed the function mid-call, so nothing recorded a failure: the job
 * sat "running" with last_error null for 26 minutes until the owner happened to
 * write again. A retry that cannot finish must not start. Model calls read this
 * (models.ts) and refuse to start a call there is no time for, which turns a
 * silent platform kill into an ordinary job failure: recorded, retried by a
 * fresh worker with a full budget, and visible in the queue.
 */
export function jobMsLeft(): number | null {
  const at = jobCtx.getStore()?.deadlineAt;
  return typeof at === "number" ? at - Date.now() : null;
}

/** Whether a failure in this attempt is final (the job will not be retried). */
export function onLastAttempt(): boolean {
  return jobCtx.getStore()?.lastAttempt === true;
}

/** The kind of job this code runs inside ("extract_facts", "write_quote", …), or null outside one. */
export function jobKind(): string | null {
  return jobCtx.getStore()?.kind ?? null;
}

/**
 * Thrown by a job that must wait for other work to finish first. The queue
 * puts it back without counting the attempt, to run again after `delayMs`.
 */
export class JobHoldError extends Error {
  readonly delayMs: number;
  constructor(reason: string, delayMs: number) {
    super(reason);
    this.name = "JobHoldError";
    this.delayMs = delayMs;
  }
}

/**
 * Thrown instead of starting work the job attempt has no time left to finish.
 * It reaches the queue unchanged (models.ts never turns it into a fallback or
 * a ModelUnavailable), and the queue requeues the job for a fresh worker.
 */
export class DeadlineError extends Error {
  constructor(what: string, leftMs: number) {
    super(`out of time: ${what} needs more than the ${Math.max(0, Math.round(leftMs / 1000))}s this attempt has left; a fresh worker will retry`);
    this.name = "DeadlineError";
  }
}

/**
 * For a catch that would otherwise settle for a weaker result: when the only
 * thing wrong is that this attempt ran out of time, and the job will be
 * retried, rethrow so a fresh worker does it properly. On the last attempt, let
 * the caller degrade as before: a quotation with a gap the broker can see
 * beats no quotation.
 */
export function rethrowIfRetryable(err: unknown): void {
  if (err instanceof DeadlineError && !onLastAttempt()) throw err;
}
