// Call — the job queue every pipeline step runs on (api/_lib/queue.ts) and the
// worker that drains it (api/worker.ts).
//
// The pipeline's handlers do not exist yet (Task 3.4 on); each test registers
// small stand-ins with registerHandler, so what is pinned here is the queue's
// own behaviour: claiming, fencing, per-session order, retries, holds, the
// time budget and the hand-on. The fakes (test/_fakes.ts) carry claim_job's
// semantics — the oldest runnable job, a lock older than 120 s reclaimable, and
// never a job behind an unfinished earlier job of the same session — which
// Task 1.1's SQL must match (plan notes, Task 0.4).
//
// Two halves of two model-layer criteria are proved here, not in
// models.test.ts: C-1505's "the job requeued" and C-1511's "the job retries
// with backoff". models.test.ts proves the error reaches the job unchanged.

// Must be first: api/_lib/env.ts snapshots process.env when it is first imported.
import "./_env.ts";
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { fakeClock, installFakeDb, installFakeNet, jsonResponse, type FakeClock, type FakeDb, type FakeNet } from "./_fakes.ts";
import { TEST_ENV, setEnv } from "./_env.ts";
import { db } from "../api/_lib/db.ts";
import { DeadlineError, JobHoldError, type JobCtx } from "../api/_lib/jobctx.ts";
import { __clearModelCache, askJSON } from "../api/_lib/models.ts";
import { flushTracking } from "../api/_lib/track.ts";
import { sendEmailTo } from "../api/_lib/email.ts";
import * as queue from "../api/_lib/queue.ts";
import { GET, POST, __background } from "../api/worker.ts";

const BROKER = "00000000-0000-4000-8000-0000000000b1";
const S1 = "5e550001-0000-4000-8000-000000000001";
const S2 = "5e550002-0000-4000-8000-000000000002";
const S3 = "5e550003-0000-4000-8000-000000000003";
const S4 = "5e550004-0000-4000-8000-000000000004";
const S5 = "5e550005-0000-4000-8000-000000000005";
const SESSIONS = [S1, S2, S3, S4, S5];
const session = (id: string) => ({ id, broker_id: BROKER, mode: "call", provider: "elevenlabs" });

type Row = Record<string, any>;

let fake: FakeDb;
let clock: FakeClock;
let net: FakeNet;
const trackingWas = process.env.TRACKING_OFF;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jobRow = (id: string | number): Row => {
  const row = fake.tables.jobs.find((j) => String(j.id) === String(id));
  assert.ok(row, `job ${id} exists`);
  return row;
};
const jobsOf = (kind: string): Row[] => fake.tables.jobs.filter((j) => j.kind === kind);
const incidents = (kind: string): Row[] => fake.tables.incidents.filter((r) => r.kind === kind);
const secondsAhead = (iso: string): number => Math.round((Date.parse(iso) - clock.now()) / 1000);
/** A promise and the function that settles it, for holding a handler open. */
function gate(): { wait: Promise<void>; open: () => void } {
  let open!: () => void;
  const wait = new Promise<void>((r) => (open = r));
  return { wait, open };
}
/** Polls a condition on the real clock (heartbeats and lanes run on real timers). */
async function until(cond: () => boolean, what: string, ms = 2000): Promise<void> {
  const end = performance.now() + ms;
  while (!cond()) {
    if (performance.now() > end) assert.fail(`timed out waiting for ${what}`);
    await sleep(2);
  }
}
const worker = (path: string, secret: string | null, method: "GET" | "POST" = "POST") =>
  (method === "GET" ? GET : POST)(
    new Request(`https://call.test${path}`, { method, headers: secret === null ? {} : { authorization: `Bearer ${secret}` } }),
  );

beforeEach(() => {
  clock = fakeClock("2026-10-31T08:00:00.000Z");
  fake = installFakeDb({ sessions: SESSIONS.map(session) });
  net = installFakeNet();
  __clearModelCache();
});

afterEach(async () => {
  // Written before the fakes come out: a bump that landed after uninstall would reach a real client.
  await flushTracking();
  queue.__resetHandlers();
  net.restore();
  fake.uninstall();
  clock.restore();
  if (trackingWas === undefined) delete process.env.TRACKING_OFF;
  else process.env.TRACKING_OFF = trackingWas;
  await setEnv(TEST_ENV);
});

// ── Enqueueing and the pipeline's order ──────────────────────────

describe("queue: enqueue and the pipeline", () => {
  test("enqueue writes a queued job with its session, payload and run_after, and refuses a kind the queue does not know", async () => {
    const id = await queue.enqueue("extract_facts", S1, { conversation_id: "conv_1" }, { runAfter: new Date(clock.now() + 30_000) });
    assert.equal(typeof id, "string");
    const row = jobRow(id);
    assert.equal(row.kind, "extract_facts");
    assert.equal(row.session_id, S1);
    assert.deepEqual(row.payload, { conversation_id: "conv_1" });
    assert.equal(row.status, "queued");
    assert.equal(row.attempts, 0);
    assert.equal(secondsAhead(row.run_after), 30);
    await assert.rejects(queue.enqueue("send_fax" as queue.JobKind, S1, {}), /unknown job kind "send_fax"/);
    assert.throws(() => queue.registerHandler("send_fax" as queue.JobKind, async () => {}), /unknown job kind "send_fax"/);
  });

  test("[C-0494] the pipeline's steps run in order, each job carries session_id, and running the chain twice yields the same rows", async () => {
    const STEPS: queue.JobKind[] = ["ingest_transcript", "extract_facts", "analyse_needs", "match", "write_quote", "check_quote", "notify_broker"];
    const ran: { kind: string; session: string | null }[] = [];
    STEPS.forEach((kind, i) =>
      queue.registerHandler(kind, async (job) => {
        ran.push({ kind: job.kind, session: job.session_id });
        // Each stand-in step writes its row idempotently (an upsert on a unique key), as every real step must.
        const { error } = await db().from("turns").upsert({ session_id: job.session_id, idx: i, role: "agent", text: kind }, { onConflict: "session_id,idx" });
        if (error) throw error;
        const next = STEPS[i + 1];
        if (next) await queue.enqueueNext(next, job.session_id, {}, { dedupeKey: `${next}:${job.session_id}` });
      }),
    );

    await queue.enqueue("ingest_transcript", S1, {}, { dedupeKey: `ingest_transcript:${S1}` });
    const first = await queue.drain({ maxJobs: 20 });
    assert.equal(first.done, 7);
    assert.deepEqual(ran.map((r) => r.kind), STEPS, "ingest → extract → needs → match → write → check → notify");
    assert.ok(ran.every((r) => r.session === S1), "every step's job carries the session");
    assert.ok(fake.tables.jobs.every((j) => j.session_id === S1 && j.status === "done"));
    const rowsAfterFirst = structuredClone(fake.tables.turns).map(({ id: _id, created_at: _c, ...rest }) => rest);

    // The same transcript delivered again: the duplicate ingest is a no-op (dedupe), and a fresh run of
    // it rewrites the same rows and queues nothing new, because every next step is already done.
    assert.equal(await queue.enqueue("ingest_transcript", S1, {}, { dedupeKey: `ingest_transcript:${S1}` }), String(jobsOf("ingest_transcript")[0]!.id));
    await queue.enqueue("ingest_transcript", S1, {});
    const second = await queue.drain({ maxJobs: 20 });
    assert.equal(second.done, 1);
    assert.equal(fake.tables.turns.length, 7);
    assert.deepEqual(structuredClone(fake.tables.turns).map(({ id: _id, created_at: _c, ...rest }) => rest), rowsAfterFirst, "running twice yields the same rows");
    assert.equal(fake.tables.jobs.length, 8, "one extra ingest job, and no second copy of any later step");
  });

  test("[C-0488] ingest succeeded and extract_facts failed: re-running ingest_transcript duplicates no turn and re-enqueues extract_facts once", async () => {
    queue.registerHandler("ingest_transcript", async (job) => {
      const turns = [0, 1, 2].map((idx) => ({ session_id: job.session_id, idx, role: idx % 2 ? "client" : "agent", text: `turn ${idx}` }));
      const { error } = await db().from("turns").upsert(turns, { onConflict: "session_id,idx" });
      if (error) throw error;
      await queue.enqueueNext("extract_facts", job.session_id, {}, { dedupeKey: `extract_facts:${job.session_id}` });
    });
    let extractRuns = 0;
    queue.registerHandler("extract_facts", async () => {
      extractRuns++;
      throw new Error("the extractor is down");
    });

    await queue.enqueue("ingest_transcript", S1, {});
    await queue.drain({ maxJobs: 2 }); // ingest done, extract attempt 1
    clock.advance(10_000);
    await queue.drain({ maxJobs: 1 }); // attempt 2
    clock.advance(60_000);
    await queue.drain({ maxJobs: 1 }); // attempt 3: failed
    assert.equal(extractRuns, 3);
    const [extract] = jobsOf("extract_facts");
    assert.equal(extract!.status, "failed");

    // The broker (or the operator) re-runs the ingest.
    await queue.enqueue("ingest_transcript", S1, {});
    assert.equal((await queue.drain({ maxJobs: 1 })).done, 1);
    assert.equal(fake.tables.turns.length, 3, "no turn is written twice");
    assert.equal(jobsOf("extract_facts").length, 1, "the same extract_facts job, not a second one");
    const revived = jobsOf("extract_facts")[0]!;
    assert.equal(revived.id, extract!.id);
    assert.equal(revived.status, "queued");
    assert.equal(revived.attempts, 0, "a fresh set of attempts");
    assert.equal(revived.last_error, null);
    assert.ok(Date.parse(revived.run_after) <= clock.now(), "due now");

    // Asked for again while it waits (another re-run of the ingest): left as it is.
    await queue.enqueue("extract_facts", S1, {}, { dedupeKey: `extract_facts:${S1}` });
    const revivals = fake.log.filter((q) => q.table === "jobs" && q.op === "update" && (q.rows?.[0] as Row)?.status === "queued" && (q.rows?.[0] as Row)?.last_error === null);
    assert.equal(revivals.length, 1, "re-enqueued exactly once");
    assert.equal(jobsOf("extract_facts").length, 1);

    // It runs as a fresh job: three attempts again.
    await queue.drain({ maxJobs: 1 });
    assert.equal(extractRuns, 4);
    assert.equal(jobsOf("extract_facts")[0]!.attempts, 1);
  });

  test("[C-1608] a step queues the next only after its own writes commit: a failing write leaves no next job, and the retry queues it once", async () => {
    queue.registerHandler("analyse_needs", async (job) => {
      // Asked for first, on purpose: the queue holds it until the step has returned.
      await queue.enqueueNext("match", job.session_id, {}, { dedupeKey: `match:${job.session_id}` });
      const { error } = await db().from("needs").insert({ session_id: job.session_id, kind: "life_cover", priority: 1, basis: [] });
      if (error) throw error;
    });
    queue.registerHandler("match", async () => {});

    fake.failTable("needs", { code: "57014", message: "canceling statement due to statement timeout" });
    await queue.enqueue("analyse_needs", S1, {});
    const failed = await queue.drain({ maxJobs: 1 });
    assert.equal(failed.failed, 1);
    assert.equal(jobsOf("match").length, 0, "the write failed, so the next step was never queued");
    assert.equal(jobsOf("analyse_needs")[0]!.status, "queued", "the step itself is retried");

    fake.failTable("needs", null);
    clock.advance(10_000);
    const ok = await queue.drain({ maxJobs: 1 });
    assert.equal(ok.done, 1);
    assert.equal(fake.tables.needs.length, 1);
    assert.equal(jobsOf("match").length, 1, "queued once the write committed");
    // The write that committed is in the log before the next step's insert.
    const writeAt = fake.log.findLastIndex((q) => q.table === "needs" && q.op === "insert");
    const nextAt = fake.log.findIndex((q) => q.table === "jobs" && q.op === "insert" && (q.rows?.[0] as Row)?.kind === "match");
    assert.ok(writeAt >= 0 && nextAt > writeAt, `the next step was inserted after the write (write ${writeAt}, next ${nextAt})`);
  });
});

// ── Claiming, fencing and per-session order ──────────────────────

describe("queue: claiming and fencing", () => {
  test("[C-0490] two workers claiming at once: exactly one gets the job", async () => {
    const id = await queue.enqueue("ingest_transcript", S1, {});
    const claims = await Promise.all([queue.claimJob("worker-a"), queue.claimJob("worker-b"), queue.claimJob("worker-c")]);
    const got = claims.filter((j) => j !== null);
    assert.equal(got.length, 1, "one job, one worker");
    assert.equal(String(got[0]!.id), id);
    assert.equal(got[0]!.status, "running");
    assert.equal(got[0]!.attempts, 1);
    assert.equal(jobRow(id).locked_by, got[0]!.locked_by);
    assert.ok(fake.log.some((q) => q.op === "rpc" && q.fn === "claim_job"), "through the claim_job RPC");
  });

  test("[C-1602] a job whose run_after is in the future is not claimable until it is due", async () => {
    const id = await queue.enqueue("extract_facts", S1, {}, { runAfter: new Date(clock.now() + 60_000) });
    assert.equal(await queue.claimJob("w1"), null);
    clock.advance(59_000);
    assert.equal(await queue.claimJob("w1"), null);
    clock.advance(1_000);
    assert.equal(String((await queue.claimJob("w1"))?.id), id);
  });

  test("[C-1603] a cancelled job is never claimed, however old", async () => {
    const id = await queue.enqueue("send_quote", S1, {});
    Object.assign(jobRow(id), { status: "cancelled", locked_at: new Date(clock.now() - 3_600_000).toISOString(), locked_by: "gone" });
    clock.advance(24 * 3_600_000);
    assert.equal(await queue.claimJob("w1"), null);
    const report = await queue.drain({ maxJobs: 5 });
    assert.equal(report.claimed, 0);
    assert.equal(jobRow(id).status, "cancelled");
  });

  test("[C-1597][C-0489] a job claimed by A at t cannot be claimed by B before t+120 s; once A's lock is that old (A died), B reclaims it", async () => {
    assert.equal(queue.LOCK_TIMEOUT_MS, 120_000);
    const id = await queue.enqueue("extract_facts", S1, {});
    const a = await queue.claimJob("worker-a");
    assert.equal(a?.locked_by, "worker-a");
    clock.advance(119_000);
    assert.equal(await queue.claimJob("worker-b"), null, "inside the lock timeout");
    clock.advance(2_000);
    const b = await queue.claimJob("worker-b");
    assert.equal(String(b?.id), id, "work is not lost when a worker dies");
    assert.equal(b!.locked_by, "worker-b");
    assert.equal(b!.attempts, 2);
  });

  test("[C-1598] after t+120 s B owns the job: A's finishJob is rejected, stillOwnJob is false for A, and A's writes are not applied", async () => {
    const undoBeat = queue.__setHeartbeatMs(3_600_000); // A's heartbeat never runs: its lock ages, as when A hangs
    const held = gate();
    const started = gate();
    let calls = 0;
    queue.registerHandler("write_quote", async (job, ctx) => {
      calls++;
      if (calls === 1) {
        started.open();
        await held.wait;
        // A, long after B took over, about to write: the fence stops it.
        await queue.fenceCheck();
        await db().from("quotes").insert({ session_id: job.session_id, broker_id: BROKER, status: "draft", html: `written by ${ctx.worker}` });
        return;
      }
      await db().from("quotes").insert({ session_id: job.session_id, broker_id: BROKER, status: "draft", html: "written by B" });
    });
    try {
      const id = await queue.enqueue("write_quote", S1, {});
      const attemptA = queue.drain({ label: "a", maxJobs: 1 });
      await started.wait;
      const workerA = String(jobRow(id).locked_by);

      clock.advance(121_000);
      const b = await queue.drain({ label: "b", maxJobs: 1 });
      assert.equal(b.done, 1, "B re-ran the job and finished it");
      const workerB = String(jobRow(id).locked_by);
      assert.notEqual(workerB, workerA);

      assert.equal(await queue.stillOwnJob(Number(id), workerA), false, "A no longer owns the job");
      assert.equal(await queue.finishJob(Number(id), "done", null, workerA), false, "A's finishJob is rejected");

      held.open();
      const a = await attemptA;
      assert.equal(a.fenced, 1, "A stopped at the fence");
      assert.equal(a.done, 0);
      assert.deepEqual(fake.tables.quotes.map((q) => q.html), ["written by B"], "A's write was not applied");
      assert.equal(jobRow(id).status, "done");
      assert.equal(jobRow(id).locked_by, workerB, "the job belongs to the attempt that finished it");
    } finally {
      // Opened whatever happened above: a handler left waiting would hold the drain, and its heartbeat the process, for ever.
      held.open();
      undoBeat();
    }
  });

  test("[C-1599] A touches its job every 30 s while working, so B never claims it", async () => {
    assert.equal(queue.HEARTBEAT_MS, 30_000, "the production beat");
    assert.ok(queue.LOCK_TIMEOUT_MS / queue.HEARTBEAT_MS >= 4, "four beats inside the lock timeout: one lost beat is not a reclaim");
    const undoBeat = queue.__setHeartbeatMs(10);
    const held = gate();
    const started = gate();
    queue.registerHandler("match", async () => {
      started.open();
      await held.wait;
    });
    try {
      const id = await queue.enqueue("match", S1, {});
      const attemptA = queue.drain({ label: "a", maxJobs: 1 });
      await started.wait;
      for (let minute = 1; minute <= 6; minute++) {
        const before = jobRow(id).locked_at;
        clock.advance(100_000); // 100 s of work between looks: past the timeout, had nothing touched the lock
        await until(() => jobRow(id).locked_at !== before, "a heartbeat");
        assert.equal(await queue.claimJob("worker-b"), null, `B claims nothing after ${minute * 100} s`);
      }
      held.open();
      const a = await attemptA;
      assert.equal(a.done, 1);
      assert.equal(jobRow(id).attempts, 1, "never reclaimed");
    } finally {
      // Opened whatever happened above: a handler left waiting would hold the drain, and its heartbeat the process, for ever.
      held.open();
      undoBeat();
    }
  });

  test("[C-1600] while a job for session S runs, another job for S is never run beside it: claim_job holds it back, and the queue's own check (otherJobRunningFor) holds it", async () => {
    // claim_job: a later job for S waits behind the earlier one.
    const first = await queue.enqueue("ingest_transcript", S1, {});
    const second = await queue.enqueue("store_audio", S1, {});
    const other = await queue.enqueue("ingest_transcript", S2, {});
    const a = await queue.claimJob("w-a");
    assert.equal(String(a?.id), first);
    assert.equal(await queue.otherJobRunningFor(S1, Number(second)), true);
    assert.equal(await queue.otherJobRunningFor(S2, Number(other)), false);
    const b = await queue.claimJob("w-b");
    assert.equal(String(b?.id), other, "S's second job is skipped over; another session's job is not");
    assert.equal(await queue.claimJob("w-c"), null);
    await queue.finishJob(Number(first), "done", null, "w-a");
    assert.equal(String((await queue.claimJob("w-c"))?.id), second, "claimable once the first is done");

    // The queue's check: an earlier job for S put back in the queue while a later one runs (an
    // operator's retry, say) is claimable by claim_job's order rule, so the drain holds it.
    const early = await queue.enqueue("extract_facts", S3, {});
    const late = await queue.enqueue("notify_broker", S3, {});
    Object.assign(jobRow(late), { status: "running", locked_by: "someone-else", locked_at: clock.iso(), attempts: 1 });
    let ran = 0;
    queue.registerHandler("extract_facts", async () => void ran++);
    const report = await queue.drain({ maxJobs: 1 });
    assert.equal(ran, 0, "not run beside the session's running job");
    assert.equal(report.held, 1);
    const row = jobRow(early);
    assert.equal(row.status, "queued");
    assert.equal(row.attempts, 0, "a hold does not spend an attempt");
    assert.equal(secondsAhead(row.run_after), queue.HOLD_MS / 1000);
  });

  test("[C-0499][C-1601] 20 queued jobs for 5 sessions: each session's jobs run in order, one at a time, and sessions run in parallel up to 3", async () => {
    assert.equal(queue.PARALLEL_SESSIONS, 3);
    const KINDS: queue.JobKind[] = ["ingest_transcript", "extract_facts", "analyse_needs", "match"];
    const order = new Map<string, string[]>();
    const running = new Set<string>();
    let now = 0;
    let peak = 0;
    const overlaps: string[] = [];
    for (const kind of KINDS) {
      queue.registerHandler(kind, async (job) => {
        const s = String(job.session_id);
        if (running.has(s)) overlaps.push(`${kind} of ${s}`);
        running.add(s);
        now++;
        peak = Math.max(peak, now);
        await sleep(3 + (Number(job.id) % 4) * 3);
        order.set(s, [...(order.get(s) ?? []), kind]);
        running.delete(s);
        now--;
      });
    }
    // Session by session, so the oldest jobs are all one session's: only claim_job's order rule keeps
    // them off the three lanes at once (the queue's own check would hold them, and they would not finish).
    for (const s of SESSIONS) for (const kind of KINDS) await queue.enqueue(kind, s, {});

    const report = await queue.drain({ maxJobs: 50 });
    assert.equal(report.claimed, 20);
    assert.equal(report.done, 20);
    assert.deepEqual(overlaps, [], "two jobs of one session never ran at once");
    assert.equal(peak, 3, "three sessions at a time, no more and no fewer");
    for (const s of SESSIONS) assert.deepEqual(order.get(s), KINDS, `session ${s.slice(-4)} ran in order`);
  });

  test("jobs with no session run independently of each other and of every session", async () => {
    let now = 0;
    let peak = 0;
    queue.registerHandler("forget_client", async () => {
      now++;
      peak = Math.max(peak, now);
      await sleep(10);
      now--;
    });
    for (let i = 0; i < 4; i++) await queue.enqueue("forget_client", null, { client_id: `c${i}` });
    const report = await queue.drain({ maxJobs: 10 });
    assert.equal(report.done, 4);
    assert.equal(peak, 3);
  });

  test("[C-1604] a job kind the worker has no handler for is marked failed with unknown_kind and an incident, never dropped or retried", async () => {
    const known = await queue.enqueue("label_speakers", S1, {}); // a real kind, with no handler registered in this worker
    const { data } = await db().from("jobs").insert({ kind: "send_fax", session_id: S2, payload: {} }).select("id").single();
    const report = await queue.drain({ maxJobs: 5 });
    assert.equal(report.failed, 2);
    for (const id of [known, String(data!.id)]) {
      const row = jobRow(id);
      assert.equal(row.status, "failed");
      assert.match(String(row.last_error), /^unknown_kind/);
      assert.equal(row.attempts, 1, "failed at once: a retry cannot find a handler either");
    }
    await flushTracking();
    const rows = incidents("unknown_kind");
    assert.deepEqual(rows.map((r) => r.fingerprint).sort(), ["unknown_kind:label_speakers", "unknown_kind:send_fax"]);
    assert.ok(rows.every((r) => r.severity === "error"));
  });

  test("[C-0491][C-1606] a job whose session was forgotten mid-pipeline finishes as skipped, writing nothing; so does one whose payload names a deleted session", async () => {
    queue.registerHandler("ingest_transcript", async (job) => {
      await db().from("turns").insert({ session_id: job.session_id, idx: 0, role: "agent", text: "hello" });
      await queue.enqueueNext("extract_facts", job.session_id, {});
    });
    let extracted = 0;
    queue.registerHandler("extract_facts", async () => void extracted++);
    queue.registerHandler("notify_broker", async () => void extracted++);
    let forgot = 0;
    queue.registerHandler("forget_client", async () => void forgot++);

    await queue.enqueue("ingest_transcript", S1, {});
    await queue.drain({ maxJobs: 1 });
    assert.equal(jobsOf("extract_facts")[0]!.status, "queued");

    // "Forget me" lands between two steps: the session and everything under it are deleted.
    await db().from("turns").delete().eq("session_id", S1);
    await db().from("sessions").delete().eq("id", S1);
    await db().from("sessions").delete().eq("id", S2);
    const viaPayload = await queue.enqueue("notify_broker", null, { session_id: S2 });
    // The forget job itself names the session it came from, and must still run.
    await queue.enqueue("forget_client", S1, { client_id: "00000000-0000-4000-8000-0000000000c1" });
    const writesBefore = fake.log.filter((q) => q.op !== "select" && q.table !== "jobs" && q.op !== "rpc").length;

    const report = await queue.drain({ maxJobs: 5 });
    assert.equal(extracted, 0, "the step never ran");
    assert.equal(report.skipped, 2);
    for (const row of [jobsOf("extract_facts")[0]!, jobRow(viaPayload)]) {
      assert.equal(row.status, "skipped");
      assert.match(String(row.last_error), /session/);
    }
    assert.equal(fake.log.filter((q) => q.op !== "select" && q.table !== "jobs" && q.op !== "rpc").length, writesBefore, "nothing written but the jobs' own status");
    assert.equal(fake.tables.turns.length, 0);
    assert.equal(forgot, 1, "forget_client runs whatever is left of the session");
  });

  test("a job reclaimed after its worker died on its last attempt is failed, not run a fourth time", async () => {
    let ran = 0;
    queue.registerHandler("write_quote", async () => void ran++);
    const id = await queue.enqueue("write_quote", S1, {});
    Object.assign(jobRow(id), { status: "running", attempts: queue.MAX_ATTEMPTS, locked_by: "dead", locked_at: new Date(clock.now() - 200_000).toISOString() });
    const report = await queue.drain({ maxJobs: 1 });
    assert.equal(ran, 0);
    assert.equal(report.failed, 1);
    assert.equal(jobRow(id).status, "failed");
    assert.match(String(jobRow(id).last_error), /stopped/);
    await flushTracking();
    assert.equal(incidents("job_failed").length, 1);
  });

  test("worker ids are unique per lane and per drain, so no two attempts share a fencing token", async () => {
    queue.registerHandler("ingest_transcript", async () => {
      await sleep(5);
    });
    for (const s of SESSIONS) await queue.enqueue("ingest_transcript", s, {});
    await queue.drain({ maxJobs: 3 });
    await queue.drain({ maxJobs: 2 });
    assert.equal(new Set(fake.tables.jobs.map((j) => j.locked_by)).size, 5);
  });
});

// ── Retries, holds and the time budget ───────────────────────────

describe("queue: retries", () => {
  const extractRow = () => ({ role: "extract", provider: "openrouter", model: "test/extract-a", fallbacks: [], params: {}, enabled: true });

  test("[C-0485][C-1511] extract_facts throws (every model fails, ModelUnavailable): attempts increments and run_after backs off 10 s, then 60 s", async () => {
    assert.deepEqual([...queue.BACKOFF_SECONDS], [10, 60, 300]);
    assert.deepEqual([1, 2, 3, 4].map(queue.retryDelaySeconds), [10, 60, 300, 300]);
    fake.tables.model_config.push(extractRow());
    net.onModel(/[\s\S]*/, () => new Response('{"error":{"message":"overloaded"}}', { status: 503 }));
    queue.registerHandler("extract_facts", async () => {
      await askJSON("extract", "Extract the facts from the transcript below.", { label: "extract_facts" });
    });

    const id = await queue.enqueue("extract_facts", S1, {});
    const first = await queue.drain({ maxJobs: 1 });
    assert.equal(first.failed, 1);
    assert.equal(jobRow(id).attempts, 1);
    assert.equal(jobRow(id).status, "queued");
    assert.equal(secondsAhead(jobRow(id).run_after), 10);
    assert.match(String(jobRow(id).last_error), /ModelUnavailable/);
    assert.ok(net.modelCalls.length >= 2, "the model layer tried its chain before giving up");

    clock.advance(9_000);
    assert.equal((await queue.drain({ maxJobs: 1 })).claimed, 0, "not before the backoff");
    clock.advance(1_000);
    await queue.drain({ maxJobs: 1 });
    assert.equal(jobRow(id).attempts, 2);
    assert.equal(secondsAhead(jobRow(id).run_after), 60);
    await flushTracking();
    assert.ok(incidents("job_retry").length >= 1, "each retry is on the record (warn, digest)");
    assert.ok(incidents("job_retry").every((r) => r.severity === "warn"));
  });

  test("[C-0486] after 3 failures the job is failed, last_error set, and an incident job_failed names the kind and the session", async () => {
    queue.registerHandler("extract_facts", async () => {
      throw new Error("the extractor is down");
    });
    const id = await queue.enqueue("extract_facts", S1, {});
    await queue.drain({ maxJobs: 1 });
    clock.advance(10_000);
    await queue.drain({ maxJobs: 1 });
    clock.advance(60_000);
    const last = await queue.drain({ maxJobs: 1 });
    assert.equal(last.failed, 1);
    const row = jobRow(id);
    assert.equal(row.status, "failed");
    assert.equal(row.attempts, 3);
    assert.match(String(row.last_error), /the extractor is down/);
    clock.advance(3_600_000);
    assert.equal((await queue.drain({ maxJobs: 1 })).claimed, 0, "failed is final");

    await flushTracking();
    const [incident, ...more] = incidents("job_failed");
    assert.equal(more.length, 0);
    assert.equal(incident!.fingerprint, "job_failed:extract_facts");
    assert.equal(incident!.severity, "error");
    assert.match(incident!.summary, /extract facts/);
    assert.match(incident!.summary, new RegExp(`session ${S1.slice(0, 8)}`), "the session, by its first 8 characters");
  });

  test("[C-0493][C-1505] a DeadlineError inside a model call requeues the job for a fresh worker without counting a failure; a second one in a row counts", async () => {
    fake.tables.model_config.push(extractRow());
    queue.registerHandler("extract_facts", async () => {
      await askJSON("extract", "Extract the facts from the transcript below.", { label: "extract_facts" });
    });
    const id = await queue.enqueue("extract_facts", S1, {});

    // A drain whose hard stop is already behind it: the model layer refuses to start the call.
    const first = await queue.drain({ maxJobs: 1, hardStopMs: 1 });
    assert.deepEqual({ failed: first.failed, held: first.held }, { failed: 0, held: 1 });
    assert.equal(net.modelCalls.length, 0, "no model request was started without time to finish it");
    let row = jobRow(id);
    assert.equal(row.status, "queued");
    assert.equal(row.attempts, 0, "the attempt is given back");
    assert.ok(Date.parse(row.run_after) <= clock.now(), "runnable at once, by the next worker");
    assert.match(String(row.last_error), /out of time/);
    await flushTracking();
    assert.equal(incidents("job_retry").length, 0, "not a failure");

    // The fresh worker runs out of time too: now it counts, or a job that can never fit would loop forever.
    const second = await queue.drain({ maxJobs: 1, hardStopMs: 1 });
    assert.equal(second.failed, 1);
    row = jobRow(id);
    assert.equal(row.attempts, 1);
    assert.equal(secondsAhead(row.run_after), 10);
  });

  test("a JobHoldError puts the job back after its delay without spending an attempt", async () => {
    queue.registerHandler("send_quote", async () => {
      throw new JobHoldError("the PDF is still rendering", 15_000);
    });
    const id = await queue.enqueue("send_quote", S1, {});
    const report = await queue.drain({ maxJobs: 1 });
    assert.equal(report.held, 1);
    assert.equal(jobRow(id).attempts, 0);
    assert.equal(secondsAhead(jobRow(id).run_after), 15);
    assert.equal(jobRow(id).last_error, "the PDF is still rendering");
  });

  test("[C-0495] notify_broker fails because Resend is down: the job is retried and the quote's status is untouched", async () => {
    fake.tables.quotes.push({ id: "00000000-0000-4000-8000-0000000000d1", session_id: S1, broker_id: BROKER, version: 1, status: "awaiting_broker", flags: [], created_at: clock.iso() });
    net.onFetch("api.resend.com/emails", () => new Response('{"message":"service unavailable"}', { status: 503 }));
    queue.registerHandler("notify_broker", async (job) => {
      const res = await sendEmailTo({ to: ["broker@example.test"], subject: "A call has landed", text: "See the dashboard.", html: "<p>See the dashboard.</p>", idempotencyKey: `notify:${job.session_id}` });
      if (!res.ok) throw new Error(res.error ?? "email failed");
    });
    const id = await queue.enqueue("notify_broker", S1, {});
    const report = await queue.drain({ maxJobs: 1 });
    assert.equal(report.failed, 1);
    assert.equal(jobRow(id).status, "queued", "retried");
    assert.equal(secondsAhead(jobRow(id).run_after), 10);
    assert.match(String(jobRow(id).last_error), /Resend 503/);
    assert.equal(fake.tables.quotes[0]!.status, "awaiting_broker", "the quote status is unaffected");
    assert.equal(net.calls.filter((c) => c.url.includes("resend")).length, 1);
  });
});

// ── The worker: auth, the tick, the budget and the hand-on ───────

describe("worker: /api/worker", () => {
  test("[C-0496] without WORKER_SECRET (or CRON_SECRET) the worker answers 401, and with neither configured it fails closed", async () => {
    let ran = 0;
    queue.registerHandler("ingest_transcript", async () => void ran++);
    await queue.enqueue("ingest_transcript", S1, {});
    for (const [path, secret, method] of [
      ["/api/worker", null, "POST"],
      ["/api/worker", "wrong-secret", "POST"],
      ["/api/worker", "test-worker-secretx", "GET"],
      ["/api/worker?tick=1", null, "GET"],
      ["/api/worker?async=1", "test-worker-secre", "POST"],
    ] as const) {
      const res = await worker(path, secret, method);
      assert.equal(res.status, 401, `${method} ${path} with ${secret ?? "no secret"}`);
    }
    await setEnv({ WORKER_SECRET: undefined, CRON_SECRET: undefined });
    assert.equal((await worker("/api/worker", "", "POST")).status, 401, "no secret configured: closed, not open");
    const empty = await POST(new Request("https://call.test/api/worker", { method: "POST", headers: { authorization: "Bearer " } }));
    assert.equal(empty.status, 401);
    assert.equal(ran, 0);
    assert.equal(jobsOf("ingest_transcript")[0]!.status, "queued");
  });

  test("[C-0497] /api/worker?tick=1 from the cron, with CRON_SECRET, drains the queue", async () => {
    let ran = 0;
    queue.registerHandler("ingest_transcript", async () => void ran++);
    await queue.enqueue("ingest_transcript", S1, {});
    await queue.enqueue("ingest_transcript", S2, {});
    const res = await worker("/api/worker?tick=1", "test-cron-secret", "GET");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.claimed, 2);
    assert.equal(body.done, 2);
    assert.equal(ran, 2);
    assert.ok(fake.tables.jobs.every((j) => j.status === "done"));
  });

  test("[C-0498] with the queue empty the worker answers {claimed: 0} in under 200 ms", async () => {
    const started = performance.now();
    const res = await worker("/api/worker", "test-worker-secret", "POST");
    const ms = performance.now() - started;
    assert.equal(res.status, 200);
    assert.equal((await res.json()).claimed, 0);
    assert.ok(ms < 200, `${ms.toFixed(1)} ms`);
  });

  test("[C-1610] the worker flushes tracking before it answers, and returns a DrainReport {claimed, done, failed, held, fenced}", async () => {
    queue.registerHandler("ingest_transcript", async () => {});
    queue.registerHandler("extract_facts", async () => {
      throw new Error("boom");
    });
    queue.registerHandler("analyse_needs", async () => {
      throw new JobHoldError("waiting on the facts", 5_000);
    });
    await queue.enqueue("ingest_transcript", S1, {});
    await queue.enqueue("extract_facts", S2, {});
    await queue.enqueue("analyse_needs", S3, {});
    const res = await worker("/api/worker?max=10", "test-worker-secret", "POST");
    const body = await res.json();
    for (const key of ["claimed", "done", "failed", "held", "fenced"]) assert.equal(typeof body[key], "number", key);
    assert.deepEqual({ claimed: body.claimed, done: body.done, failed: body.failed, held: body.held, fenced: body.fenced }, { claimed: 3, done: 1, failed: 1, held: 1, fenced: 0 });
    // No flushTracking() here: the incident is a row because the worker waited for it.
    assert.equal(incidents("job_retry").length, 1, "the failure's incident was written before the answer");
  });

  test("[C-0492] with the 240 s budget nearly spent the worker stops claiming and hands the rest on to a fresh worker (a self-call)", async () => {
    process.env.TRACKING_OFF = "0";
    assert.equal(queue.WORKER_BUDGET_MS, 240_000);
    const wakes: string[] = [];
    net.onFetch("call.test/api/worker", (call) => {
      wakes.push(`${call.method} ${call.url} ${call.headers.authorization}`);
      return jsonResponse({ accepted: true }, 202);
    });
    let ran = 0;
    queue.registerHandler("ingest_transcript", async () => {
      ran++;
      clock.advance(151_000); // a slow first job: the drain is now past the point where it starts new work
    });
    for (const s of [S1, S2, S3]) await queue.enqueue("ingest_transcript", s, {});

    const report = await queue.drain({ maxJobs: 10, parallel: 1, label: "sweep" });
    assert.equal(ran, 1, "stopped claiming");
    assert.equal(report.claimed, 1);
    assert.equal(jobsOf("ingest_transcript").filter((j) => j.status === "queued").length, 2, "the rest is still queued");
    assert.deepEqual(wakes, ["POST https://call.test/api/worker?async=1&max=10&hop=1 Bearer test-worker-secret"], "one hand-on");
  });

  test("[C-1605] when the hand-on self-call fails, the work stays queued and the next cron tick picks it up", async () => {
    process.env.TRACKING_OFF = "0";
    let wakes = 0;
    net.onFetch("call.test/api/worker", () => {
      wakes++;
      throw new TypeError("fetch failed");
    });
    net.onFetch("api.resend.com/emails", () => jsonResponse({ id: "email-1" }));
    let ran = 0;
    queue.registerHandler("ingest_transcript", async () => {
      ran++;
      if (ran === 1) clock.advance(151_000);
    });
    for (const s of [S1, S2, S3]) await queue.enqueue("ingest_transcript", s, {});

    await queue.drain({ maxJobs: 10, parallel: 1 });
    assert.equal(wakes, 2, "tried, and tried once more");
    assert.equal(jobsOf("ingest_transcript").filter((j) => j.status === "queued").length, 2, "no job lost");
    await flushTracking();
    assert.equal(incidents("self_call_failed").length, 1, "the lost wake-up is on the record");

    clock.advance(3_600_000);
    const res = await worker("/api/worker?tick=1", "test-cron-secret", "GET");
    assert.equal(res.status, 200);
    assert.equal(ran, 3);
    assert.ok(jobsOf("ingest_transcript").every((j) => j.status === "done"), "the tick did the rest");
  });

  test("?async=1 (a hand-on) answers 202 at once and drains in the background", async () => {
    let ran = 0;
    queue.registerHandler("ingest_transcript", async () => void ran++);
    await queue.enqueue("ingest_transcript", S1, {});
    const res = await worker("/api/worker?async=1&hop=1", "test-worker-secret", "POST");
    assert.equal(res.status, 202);
    assert.deepEqual(await res.json(), { accepted: true });
    await __background();
    assert.equal(ran, 1);
  });

  test("a chain of self-calls stops at MAX_WORKER_HOP: the deepest worker leaves the rest to the next tick", async () => {
    process.env.TRACKING_OFF = "0";
    assert.equal(queue.MAX_WORKER_HOP, 2);
    const wakes: string[] = [];
    net.onFetch("call.test/api/worker", (call) => {
      wakes.push(call.url);
      return jsonResponse({ accepted: true }, 202);
    });
    assert.equal(await queue.withHop(1, () => queue.kickWorker("t")), true);
    assert.equal(await queue.withHop(2, () => queue.kickWorker("t")), false);
    assert.deepEqual(wakes, ["https://call.test/api/worker?async=1&max=10&hop=2"]);
    assert.equal(queue.hopFrom(new URL("https://call.test/api/worker?hop=2")), 2);
    assert.equal(queue.hopFrom(new URL("https://call.test/api/worker?hop=-1")), 0);
    assert.equal(queue.hopFrom(new URL("https://call.test/api/worker")), 0);
  });
});
