// Call — /api/worker: where the queue is drained.
//
// Ported from Charlie `api/worker.ts`; the why-comments are kept. Charlie's
// webhook drained the queue in its own invocation and this was the catch-up;
// Call's webhook answers ElevenLabs at once and kicks this instead (queue.ts
// kickWorker), so this is where every pipeline step runs. Charlie's watchdog
// runner (?watch=1) is not ported: claim_job's 120-second lock timeout does
// its job (queue.ts).
//
//   POST|GET /api/worker            drain now, answer the DrainReport
//   POST     /api/worker?async=1    a kick or a hand-on: 202 at once, drain in this invocation's own budget
//   GET      /api/worker?tick=1     the daily cron (vercel.json, Task 11.1): drain, the catch-up sweep
//
// Every form ends with the alert pass (alerts.ts): Call's cron runs once a
// day, so the drain that fails a job is what emails about it.
//
// Authenticated with WORKER_SECRET (the self-calls, an operator) or Vercel's
// CRON_SECRET (a schedule), as `Authorization: Bearer …`. It fails CLOSED:
// with no secret configured it refuses rather than leaving a queue-draining
// endpoint open to anyone who guesses the URL (C-0496).
//
// Each pipeline module registers its handler with registerHandler when it is
// imported, and this is the only place the queue is drained, so every handler
// module is imported here (Task 3.4 on). A kind with no handler is failed as
// unknown_kind (C-1604): loud, never dropped.

import { timingSafeEqual } from "node:crypto";
import { waitUntil } from "@vercel/functions";
import { env } from "./_lib/env.js";
import { runAlerts } from "./_lib/alerts.js";
import { WORKER_BUDGET_MS, drain, hopFrom, withHop } from "./_lib/queue.js";
import { errorText, noteRequestFailure, tracked } from "./_lib/track.js";

export function authorised(req: Request): boolean {
  const header = req.headers.get("authorization") ?? "";
  const secrets = [env.WORKER_SECRET, env.CRON_SECRET].filter(Boolean);
  if (!secrets.length) return false; // fail closed
  return secrets.some((s) => {
    const a = Buffer.from(header, "utf8");
    const b = Buffer.from(`Bearer ${s}`, "utf8");
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

const json = (body: unknown, status: number, headers: Record<string, string> = {}): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });

/** Work this invocation goes on doing after it has answered (the hand-on's drain). */
const background = new Set<Promise<unknown>>();
function afterResponse(p: Promise<unknown>): void {
  background.add(p);
  void p.finally(() => background.delete(p));
  waitUntil(p);
}

/** Tests only: wait for the work this module started after answering. */
export async function __background(): Promise<void> {
  while (background.size) await Promise.allSettled([...background]);
}

async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  if (!authorised(req)) return json({ error: "unauthorised" }, 401, { "WWW-Authenticate": "Bearer" });

  const url = new URL(req.url);
  const asked = Number(url.searchParams.get("max") ?? 10);
  const maxJobs = Math.min(50, Math.max(1, Number.isFinite(asked) ? Math.floor(asked) : 10));
  // How deep in a chain of this deployment calling itself this request is
  // (queue.ts withHop): everything below, waitUntil work included, runs at it.
  return withHop(hopFrom(url), () => route(url, maxJobs));
}

async function route(url: URL, maxJobs: number): Promise<Response> {
  // ?async=1 is a kick or a hand-on: answer at once so the caller can finish,
  // and do the work in this invocation's own time budget, waiting for work
  // that becomes runnable within a minute (a retry's 10 s or 60 s backoff).
  if (url.searchParams.get("async") === "1") {
    afterResponse(
      drain({ maxJobs, budgetMs: WORKER_BUDGET_MS, label: "handon", waitForDueMs: 60_000 })
        .then(() => runAlerts())
        .catch((err) => console.warn("hand-on drain failed", errorText(err))),
    );
    return json({ accepted: true }, 202);
  }

  const label = url.searchParams.get("tick") === "1" ? "tick" : "sweep";
  try {
    const report = await drain({ maxJobs, budgetMs: WORKER_BUDGET_MS, label });
    const alerts = await runAlerts();
    return json(label === "tick" ? { ...report, alerts } : report, 200);
  } catch (err) {
    console.log(`worker ${label} failed`, errorText(err));
    noteRequestFailure(err);
    return json({ error: errorText(err) }, 500);
  }
}

const served = tracked("worker", "system", handler);
export const GET = served;
export const POST = served;
export const OPTIONS = served;
