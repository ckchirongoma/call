// Call — Chase Intelligence: every task recorded whole under one id
// (api/_lib/intel.ts; docs/INTEL-CONTRACT.md, docs/INTEL-PHASE0.md §3).
//
// For any task anyone did, you can read back exactly what was asked, what was
// seen, what was decided, what was run, what was checked and how it ended, in
// order, from one id. Capture is additive: it never throws into the code it
// watches, never waits on the request path, never changes a result, and every
// row is written in a batch after the response. INTEL_CAPTURE = full | meta |
// off. A call session is one task: its trace is "s_" + the session id.
//
// What this file pins is the core every later task captures into: the switch,
// the ids, the flush (batches, retries, the missing table), forgetting,
// reading back, and the wiring into models.ts (every attempt), queue.ts (the
// job lifecycle) and track.ts (every event and failure). The end-to-end
// read-back of a whole call is Task 12.5's (test/intel-trace.e2e.test.ts).

// Must be first: api/_lib/env.ts snapshots process.env when it is first imported.
import "./_env.ts";
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { fakeClock, installFakeDb, installFakeNet, modelReply, type FakeClock, type FakeDb, type FakeNet } from "./_fakes.ts";
import { __setClient, db } from "../api/_lib/db.ts";
import { JobHoldError } from "../api/_lib/jobctx.ts";
import { __clearModelCache, askJSON, askText, transcribeAudio } from "../api/_lib/models.ts";
import * as queue from "../api/_lib/queue.ts";
import { flushTracking, setTrackContext, track, trackFailure, tracked, withTrackContext } from "../api/_lib/track.ts";
import * as intel from "../api/_lib/intel.ts";

const BROKER = "00000000-0000-4000-8000-0000000000b1";
const CLIENT = "00000000-0000-4000-8000-0000000000c1";
const OTHER_CLIENT = "00000000-0000-4000-8000-0000000000c2";
const S1 = "5e550001-0000-4000-8000-000000000001";
const S2 = "5e550002-0000-4000-8000-000000000002";
const S3 = "5e550003-0000-4000-8000-000000000003";
const S4 = "5e550004-0000-4000-8000-000000000004";
const CONVERSATION = "conv_intel_demo_0001";
const A = "test/model-a";
const B = "test/model-b";
const PROMPT = "Extract the facts from the transcript below. Client: I am 42 and want funeral cover for four people.";
const CHANNELS = ["phone", "web", "meeting", "dashboard", "email", "whatsapp", "system"];

type Row = Record<string, any>;

let fake: FakeDb;
let net: FakeNet;
let clock: FakeClock | null = null;
const envWas = { INTEL_CAPTURE: process.env.INTEL_CAPTURE, TRACKING_OFF: process.env.TRACKING_OFF };

const sessions = [S1, S2, S3, S4].map((id) => ({ id, broker_id: BROKER, client_id: CLIENT, mode: "call", provider: "elevenlabs", ...(id === S1 ? { conversation_id: CONVERSATION } : {}) }));
const configRow = (role: string, over: Row = {}): Row => ({ role, provider: "openrouter", model: A, fallbacks: [B], params: {}, enabled: true, ...over });

beforeEach(() => {
  // This file is about capture, so it is on here whatever the npm script says (C-1757).
  process.env.INTEL_CAPTURE = "full";
  intel.__resetIntel();
  __clearModelCache();
  fake = installFakeDb({ sessions, model_config: [configRow("extract"), configRow("voice", { model: "test/whisper-a", fallbacks: ["test/whisper-b"] })] });
  net = installFakeNet();
});

afterEach(async () => {
  await flushTracking();
  intel.__resetIntel();
  queue.__resetHandlers();
  net.restore();
  fake.uninstall();
  clock?.restore();
  clock = null;
  for (const [k, v] of Object.entries(envWas)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const rows = (): Row[] => fake.tables.intel_events as Row[];
const named = (name: string): Row[] => rows().filter((r) => r.name === name);
const intelInserts = () => fake.log.filter((q) => q.table === "intel_events" && q.op === "insert");
const intelQueries = () => fake.log.filter((q) => q.table === "intel_events");
const byOrder = (a: Row, b: Row): number => Date.parse(a.at) - Date.parse(b.at) || a.seq - b.seq;
/** Realistic words, n characters of them (a run of one letter would read as bytes). */
const words = (n: number): string => "The client is 42, earns about twelve thousand a month and wants funeral cover for four people. ".repeat(Math.ceil(n / 95)).slice(0, n);

/**
 * A small whole task: a request that learns its session and client, queues a
 * step and notes a handled problem; the worker then runs the step, which asks
 * a model and records an event.
 */
async function happyPath(): Promise<void> {
  net.onModel(/Extract the facts/, () => ({ age: 42 }));
  queue.registerHandler("extract_facts", async () => {
    await askJSON("extract", PROMPT);
    track("facts_extracted", { props: { count: 1 } });
  });
  const handler = tracked("intel-happy", "phone", async () => {
    setTrackContext({ sessionId: S1, clientId: CLIENT, brokerId: BROKER });
    await queue.enqueue("extract_facts", S1, { session_id: S1 });
    trackFailure("demo_problem", new Error("a handled problem"), { severity: "warn", alert: "none" });
    return new Response("ok");
  });
  const res = await handler(new Request("https://call.test/api/intel-happy", { method: "POST" }));
  assert.equal(res.status, 200);
  const report = await queue.drain({ maxJobs: 2, noHandOn: true });
  assert.equal(report.done, 1);
  await flushTracking();
}

// ── Capture ──────────────────────────────────────────────────────

describe("intel: capture is additive", () => {
  test("[C-1700] with a flush target that throws (the database down), capture returns normally and the caller's result is unchanged", async (t) => {
    t.mock.method(console, "warn", () => {});
    const broken = { from: () => { throw new Error("db down"); }, rpc: () => { throw new Error("db down"); } };
    const back = __setClient(broken as never);
    try {
      const result = await intel.withTrace({ traceId: intel.traceForSession(S1), sessionId: S1 }, async () => {
        intel.capture("track", { name: "while_down", content: { a: 1 } });
        // Content that cannot be serialised is not the caller's problem either.
        const circular: Row = { a: 1 };
        circular.self = circular;
        intel.capture("tool", { name: "circular", content: circular });
        intel.capture("tool", { name: "getter", content: { get boom() { throw new Error("getter"); } } });
        return 42;
      });
      assert.equal(result, 42);
      const flushed = await intel.flushIntel();
      assert.equal(flushed.written, 0);
      assert.equal(flushed.dropped, 3);
      await flushTracking();
    } finally {
      back();
    }
  });

  test("[C-1701] 1,000 captures each carrying a 50 KB prompt cost under 5 ms each at p95", async () => {
    const big = { messages: [{ role: "user", content: words(50_000) }], response: '{"age":42}', reasoning: null };
    const times: number[] = [];
    await intel.withTrace({ traceId: intel.traceForSession(S1), sessionId: S1, clientId: CLIENT, brokerId: BROKER, channel: "system" }, async () => {
      for (let i = 0; i < 1000; i++) {
        const started = performance.now();
        intel.capture("model", { name: "model_call:extract", content: big, meta: { model: A, role: "extract" } });
        times.push(performance.now() - started);
      }
    });
    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95)]!;
    assert.ok(p95 < 5, `p95 ${p95.toFixed(3)} ms`);
    assert.equal(intel.intelStats().buffered, 1000, "every one was kept");
    // 50 MB the flush tests below do not need written.
    intel.__resetIntel();
  });

  test("[C-1702] capture returns void synchronously and makes no database or network call itself", async () => {
    const queries = fake.log.length;
    const requests = net.calls.length;
    const out: unknown = intel.capture("ask", { name: "turn", content: { text: "hello", kind: "turn", t: 0.4 } });
    assert.equal(out, undefined);
    assert.ok(!((out as object | undefined) instanceof Promise), "not a promise");
    // Not later either: no timer writes behind the caller's back (C-1703).
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(fake.log.length, queries);
    assert.equal(net.calls.length, requests);
    assert.equal(intel.intelStats().buffered, 1);
  });

  // Fix round 1 (review m-3): the label for the one warning is read inside its own guard.
  test("[C-1700] capture never throws, even on the first failure in a process, with a name that throws, no options, or meta that cannot be read", (t) => {
    t.mock.method(console, "warn", () => {});
    intel.__resetIntel();
    assert.doesNotThrow(() => intel.capture("track", { get name(): string { throw new Error("name getter"); } } as never));
    assert.doesNotThrow(() => (intel.capture as (k: string, o?: unknown) => void)("track", undefined));
    assert.doesNotThrow(() => intel.capture("track", { name: { toString() { throw new Error("toString"); } } as never }));
    assert.doesNotThrow(() => intel.capture("track", { name: "proxy", meta: new Proxy({}, { ownKeys() { throw new Error("ownKeys"); } }) }));
    assert.doesNotThrow(() => intel.capture("track", { name: "kind getter", content: { get kind() { throw new Error("kind"); } } }));
  });

  // Fix round 1 (review I-4): big structured content is a reference at capture;
  // its serialising, cutting and redacting all happen in the flush.
  test("[C-1701] capture stays under 5 ms at p95 for big structured content: an 8,000-row catalogue, 12,000 transcript segments, a 5 MB payload; the cut and the redaction wait for the flush", async () => {
    const catalogue = { args: { rows: Array.from({ length: 8_000 }, (_, i) => ({ category: "funeral", provider: "Demo Life", product: `Plan ${i}`, cover_cents: 1_000_000 + i, premium_cents: 8_500 + i, notes: "a" })) } };
    const segments = { audio: { type: "audio/webm", size: 1 }, response: "x", segments: Array.from({ length: 12_000 }, (_, i) => ({ start: i * 3.1, end: i * 3.1 + 3, text: `segment ${i}: the client said something about cover` })) };
    const payload = { list: Array.from({ length: 200_000 }, (_, i) => `item ${i} words`), sessionToken: "Zm9vYmFyYmF6cXV4MTIzNDU2Nzg5MGFiY2RlZmdoaWo" };
    for (const [name, content] of [["catalogue_upload", catalogue], ["model_call:voice", segments], ["five_mb", payload]] as const) {
      const times: number[] = [];
      for (let i = 0; i < 40; i++) {
        const started = performance.now();
        intel.capture("tool", { name, content });
        times.push(performance.now() - started);
      }
      times.sort((a, b) => a - b);
      const p95 = times[Math.floor(times.length * 0.95)]!;
      assert.ok(p95 < 5, `${name}: p95 ${p95.toFixed(2)} ms`);
    }
    intel.__resetIntel();
    // One of each, written after: cut to the limit by its longest lists, redacted, with what was cut said.
    intel.capture("tool", { name: "catalogue_upload", content: catalogue });
    intel.capture("tool", { name: "model_call:voice", content: segments });
    intel.capture("tool", { name: "five_mb", content: payload });
    assert.deepEqual(await intel.flushIntel(), { written: 3, dropped: 0 });
    for (const r of rows()) {
      const kept = Buffer.byteLength(JSON.stringify(r.content));
      assert.ok(kept <= 1_000_000 && kept > 800_000, `${r.name}: ${kept} bytes`);
      assert.ok(r.meta.truncated_bytes > 0, r.name);
    }
    assert.doesNotMatch(JSON.stringify(rows()), /Zm9vYmFyYmF6cXV4MTIz/, "redacted in the flush");
    const cat = named("catalogue_upload")[0]!.content.args.rows;
    assert.deepEqual(cat[0], { category: "funeral", provider: "Demo Life", product: "Plan 0", cover_cents: 1_000_000, premium_cents: 8_500, notes: "a" }, "the shape and the money survive the cut");
    assert.match(String(cat[cat.length - 1]), /more items cut/);
  });

  test("[C-1703] a handler's rows are written in one batch after the response is sent, through the flush handed to waitUntil, never before", async () => {
    const REQ_CONTEXT = Symbol.for("@vercel/request-context");
    const waited: Promise<unknown>[] = [];
    (globalThis as Record<symbol, unknown>)[REQ_CONTEXT] = { get: () => ({ waitUntil: (p: Promise<unknown>) => void waited.push(p) }) };
    try {
      const handler = tracked("intel-after", "web", async () => {
        intel.capture("track", { name: "step_one" });
        intel.capture("track", { name: "step_two" });
        intel.capture("say", { name: "reply", content: { text: "Thanks", kind: "text" } });
        // Time passes inside the request: still nothing written.
        await new Promise((r) => setImmediate(r));
        await new Promise((r) => setTimeout(r, 30));
        assert.equal(intelInserts().length, 0, "nothing is written while the request is running");
        return new Response("done");
      });
      const res = await handler(new Request("https://call.test/api/intel-after", { method: "POST" }));
      assert.equal(intelInserts().length, 0, "the response comes first");
      assert.equal(await res.text(), "done");
      assert.equal(waited.length, 1, "the flush was handed to waitUntil");
      await Promise.all(waited);
      assert.equal(intelInserts().length, 1, "one batch");
      assert.deepEqual(intelInserts()[0]!.rows!.map((r) => r.name), ["step_one", "step_two", "reply", "http_request"]);
    } finally {
      delete (globalThis as Record<symbol, unknown>)[REQ_CONTEXT];
    }
  });
});

describe("intel: the switch", () => {
  test("[C-1704] INTEL_CAPTURE=off: a whole task writes zero intel_events rows (and full writes them, so the test is not empty)", async () => {
    process.env.INTEL_CAPTURE = "off";
    await happyPath();
    assert.equal(rows().length, 0);
    assert.equal(intelQueries().length, 0, "not even a query");
    assert.equal(fake.tables.jobs.length, 1, "the task itself ran");

    process.env.INTEL_CAPTURE = "full";
    await happyPath();
    assert.ok(rows().length >= 8, `full mode wrote ${rows().length} rows`);
  });

  test("[C-1705] INTEL_CAPTURE=meta: every row has content null, content_mode meta, and meta filled", async () => {
    process.env.INTEL_CAPTURE = "meta";
    await happyPath();
    assert.ok(rows().length >= 8);
    for (const r of rows()) {
      assert.equal(r.content, null, r.name);
      assert.equal(r.content_mode, "meta", r.name);
      assert.ok(r.meta && Object.keys(r.meta).length > 0, `${r.name} has meta`);
    }
    const model = rows().find((r) => r.kind === "model")!;
    assert.equal(model.meta.model, A);
    assert.equal(model.meta.role, "extract");
    assert.ok(model.meta.content_chars > PROMPT.length, "the shape: how much there was");
    assert.doesNotMatch(JSON.stringify(rows()), /funeral cover/, "no words");
  });

  test("[C-1706] INTEL_CAPTURE unset: the mode is full", async () => {
    delete process.env.INTEL_CAPTURE;
    delete process.env.TRACKING_OFF;
    assert.equal(intel.captureMode(), "full");
    intel.capture("ask", { name: "turn", content: { text: "words kept", kind: "turn", t: 1 } });
    await intel.flushIntel();
    assert.equal(rows()[0]!.content.text, "words kept");
    assert.equal(rows()[0]!.content_mode, "full");
  });

  test("[C-1707] TRACKING_OFF=1 with INTEL_CAPTURE unset is off; with INTEL_CAPTURE=full it is on: tests opt in explicitly", async () => {
    process.env.TRACKING_OFF = "1";
    delete process.env.INTEL_CAPTURE;
    assert.equal(intel.captureMode(), "off");
    intel.capture("ask", { name: "unseen", content: { text: "x", kind: "turn", t: 1 } });
    assert.equal(intel.intelStats().buffered, 0);
    process.env.INTEL_CAPTURE = "full";
    assert.equal(intel.captureMode(), "full");
    for (const [raw, mode] of [[" META ", "meta"], ["Off", "off"], ["full", "full"], ["nonsense", "off"]] as const) {
      process.env.INTEL_CAPTURE = raw;
      assert.equal(intel.captureMode(), mode, `INTEL_CAPTURE=${JSON.stringify(raw)} under TRACKING_OFF=1`);
    }
    delete process.env.TRACKING_OFF;
    process.env.INTEL_CAPTURE = "nonsense";
    assert.equal(intel.captureMode(), "full", "an unreadable value is the default");
  });
});

describe("intel: rows", () => {
  test("[C-1708] every row has app call and contract version 1", async () => {
    await happyPath();
    assert.ok(rows().length >= 8);
    for (const r of rows()) {
      assert.equal(r.app, "call");
      assert.equal(r.v, 1);
    }
    assert.equal(intel.APP, "call");
    assert.equal(intel.CONTRACT_VERSION, 1);
  });

  test("[C-1709] rows captured in the same millisecond are ordered by seq: sorting by (at, seq) reproduces capture order", async () => {
    clock = fakeClock("2026-10-31T08:00:00.000Z");
    for (let i = 0; i < 50; i++) intel.capture("track", { name: `same_ms_${i}` });
    clock.advance(1);
    intel.capture("track", { name: "next_ms" });
    await intel.flushIntel();
    const shuffled = [...rows()].sort(() => Math.random() - 0.5);
    const sorted = shuffled.sort(byOrder).map((r) => r.name);
    assert.deepEqual(sorted, [...Array.from({ length: 50 }, (_, i) => `same_ms_${i}`), "next_ms"]);
    assert.equal(new Set(rows().slice(0, 50).map((r) => r.at)).size, 1, "the same millisecond");
  });
});

// ── Ids ──────────────────────────────────────────────────────────

describe("intel: one id per task", () => {
  // Unit form: each entry point is a tracked request that learns its session
  // (setTrackContext), as Tasks 3.1–8.x will; the job runs in the worker.
  // Task 12.5 drives the real handlers end to end (test/intel-trace.e2e.test.ts).
  test("[C-1710] everything tied to a session carries s_<session_id>: init, a tool, both post-call events, every job, a dashboard action on its quote, a send, a delivery webhook, a client's WhatsApp reply", async () => {
    const entry = (fn: string, channel: "phone" | "dashboard" | "email" | "whatsapp", body: () => unknown) =>
      tracked(fn, channel, async () => {
        await body();
        return new Response("ok");
      })(new Request(`https://call.test/api/${fn}`, { method: "POST" }));
    queue.registerHandler("ingest_transcript", async () => {
      intel.capture("ask", { name: "turn", turnId: intel.turnIdFor(S1, 0), content: { text: "I am 42", kind: "turn", t: 3.2 } });
    });
    await entry("voice-init", "phone", () => {
      setTrackContext({ sessionId: S1, clientId: CLIENT, brokerId: BROKER });
      track("voice:init", { ms: 40 });
    });
    await entry("voice-tool", "phone", () => {
      setTrackContext({ sessionId: S1 });
      intel.capture("tool", { name: "save_fact", content: { args: { label: "age", value: 42 }, result: { ok: true } } });
    });
    await entry("elevenlabs-webhook", "phone", async () => {
      setTrackContext({ sessionId: S1 });
      track("webhook:post_call_transcription");
      track("webhook:post_call_audio");
      await queue.enqueue("ingest_transcript", S1, { session_id: S1 });
    });
    await queue.drain({ maxJobs: 2, noHandOn: true });
    await entry("app", "dashboard", () => {
      setTrackContext({ sessionId: S1, brokerId: BROKER });
      track("broker:approve", { channel: "dashboard", props: { before: "awaiting_broker", after: "approved", reason: null } });
      intel.capture("say", { name: "email:quote", channel: "email", content: { text: "Your quotation is attached.", kind: "quote" } });
      intel.capture("send", { name: "email:quote", channel: "email", content: { subject: "Your quotation" }, meta: { type: "email", skipped: false } });
    });
    await entry("resend-webhook", "email", () => {
      setTrackContext({ sessionId: S1 });
      track("delivery:delivered");
    });
    await entry("whatsapp-webhook", "whatsapp", () => {
      setTrackContext({ sessionId: S1 });
      intel.capture("ask", { name: "whatsapp_in", turnId: intel.turnIdForWamid("wamid.demo-0001"), content: { text: "Yes please", kind: "text" } });
    });
    await flushTracking();
    const names = rows().map((r) => r.name);
    for (const n of ["voice:init", "save_fact", "webhook:post_call_transcription", "webhook:post_call_audio", "job_enqueued", "job_started", "turn", "job_finished", "broker:approve", "email:quote", "delivery:delivered", "whatsapp_in", "http_request"]) {
      assert.ok(names.includes(n), `${n} captured`);
    }
    for (const r of rows()) assert.equal(r.trace_id, `s_${S1}`, `${r.kind} ${r.name}`);
    const approve = named("broker:approve")[0]!;
    assert.equal(approve.actor, "person", "a broker action is the person's");
    assert.equal(approve.channel, "dashboard");
    assert.deepEqual(approve.content.props, { before: "awaiting_broker", after: "approved", reason: null });
  });

  test("[C-1711] a request tied to no session: trace_id is r_ + 16 hex, the same for every row of it, and another request gets another", async () => {
    const one = tracked("settings", "dashboard", async () => {
      intel.capture("track", { name: "broker:settings_saved" });
      track("settings_saved");
      return new Response("ok");
    });
    await one(new Request("https://call.test/app/settings", { method: "POST" }));
    await one(new Request("https://call.test/app/settings", { method: "POST" }));
    await flushTracking();
    const traces = [...new Set(rows().map((r) => r.trace_id))];
    assert.equal(traces.length, 2, "one id per request");
    for (const t of traces) assert.match(t, /^r_[0-9a-f]{16}$/);
    assert.equal(rows().filter((r) => r.trace_id === traces[0]).length, 3, "every row of the first request");
    assert.match(intel.requestTraceId(), /^r_[0-9a-f]{16}$/);
    assert.notEqual(intel.requestTraceId(), intel.requestTraceId());
  });

  test("[C-1712][C-1713] a job with no session is traced job_<id>; a session's job is the session's; the enqueue is a job_enqueued row with the bigint job id, in the enqueuing trace", async () => {
    const ran: string[] = [];
    queue.registerHandler("forget_client", async () => {
      intel.capture("track", { name: "inside_forget" });
      ran.push("forget");
    });
    queue.registerHandler("notify_broker", async () => {
      intel.capture("track", { name: "inside_notify" });
      ran.push("notify");
    });
    const enqueuer = intel.requestTraceId();
    const ids = await intel.withTrace({ traceId: enqueuer, channel: "dashboard", brokerId: BROKER }, async () => ({
      // forget_client carries no session_id column (queue.ts): it outlives the session it deletes.
      forget: await queue.enqueue("forget_client", S2, { client_id: CLIENT }),
      notify: await queue.enqueue("notify_broker", S3, { session_id: S3 }),
    }));
    await queue.drain({ maxJobs: 2, noHandOn: true });
    await flushTracking();
    assert.deepEqual(ran.sort(), ["forget", "notify"]);

    const enqueued = named("job_enqueued");
    assert.equal(enqueued.length, 2);
    for (const r of enqueued) {
      assert.equal(r.kind, "job");
      assert.equal(r.trace_id, enqueuer, "in the trace that queued it");
      assert.equal(typeof r.meta.job_id, "number", "jobs.id is a bigint identity, so meta.job_id is a number");
      assert.ok(Number.isInteger(r.meta.job_id));
    }
    const forgetId = Number(ids.forget);
    const notifyId = Number(ids.notify);
    assert.deepEqual(enqueued.map((r) => r.meta.job_id).sort(), [forgetId, notifyId].sort());
    assert.deepEqual(fake.tables.jobs.map((j) => j.id).sort(), [forgetId, notifyId].sort());
    assert.equal(named("inside_forget")[0]!.trace_id, `job_${forgetId}`);
    assert.equal(named("inside_forget")[0]!.job_id, forgetId);
    assert.equal(named("inside_notify")[0]!.trace_id, `s_${S3}`, "a session's job is the session's task");
    for (const r of rows().filter((r) => r.kind === "job" && r.meta.job_id === forgetId && r.name !== "job_enqueued")) assert.equal(r.trace_id, `job_${forgetId}`, r.name);
  });

  test("[C-1714] a transcript turn's id is t_ + 16 hex of sha256(session:idx); a WhatsApp inbound's of the wamid; no turn_id ever holds a phone number", async (t) => {
    t.mock.method(console, "warn", () => {});
    const sha16 = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);
    assert.equal(intel.turnIdFor(S1, 3), `t_${sha16(`${S1}:3`)}`);
    const wamid = "wamid.HBgLMjc3OTk5MzAwMDEVAgASGBQzQTdEQjQ3QTk2RjM0M0E1RDY0RgA=";
    assert.equal(intel.turnIdForWamid(wamid), `t_${sha16(wamid)}`);
    await intel.withTrace({ traceId: intel.traceForSession(S1), sessionId: S1 }, async () => {
      intel.capture("ask", { name: "turn", turnId: intel.turnIdFor(S1, 3), content: { text: "Yes", kind: "turn", t: 9.1 } });
      intel.capture("ask", { name: "whatsapp_in", channel: "whatsapp", turnId: intel.turnIdForWamid(wamid), content: { text: "Thanks", kind: "text" } });
      // A caller that passes a raw id (a number, a wamid) by mistake gets no
      // turn id at all: an unsalted hash of a phone number is the number, to
      // anyone with a minute to try them all (review m-6).
      intel.capture("ask", { name: "raw_turn", turnId: "27799930001", content: { text: "Hi", kind: "text" } });
    });
    await intel.flushIntel();
    assert.deepEqual(rows().map((r) => r.turn_id), [intel.turnIdFor(S1, 3), intel.turnIdForWamid(wamid), null]);
    assert.ok(!JSON.stringify(rows()).includes(sha16("27799930001")), "not its hash either");
    for (const r of rows().filter((r) => r.turn_id !== null)) {
      assert.match(r.turn_id, /^t_[0-9a-f]{16}$/);
      assert.doesNotMatch(r.turn_id, /2779993/);
    }
  });

  test("[C-1715] a row about a client has business_id = the client and meta.broker_id; a broker-only row has business_id null and meta.broker_id", async () => {
    await intel.withTrace({ traceId: intel.traceForSession(S1), sessionId: S1, clientId: CLIENT, brokerId: BROKER, channel: "phone" }, async () => {
      intel.capture("ask", { name: "turn", content: { text: "I am 42", kind: "turn", t: 3 } });
    });
    await intel.withTrace({ traceId: intel.requestTraceId(), brokerId: BROKER, channel: "dashboard" }, async () => {
      intel.capture("track", { name: "broker:settings_saved", actor: "person", content: { props: { before: { auto_send: false }, after: { auto_send: true }, reason: null } } });
    });
    await intel.flushIntel();
    const [client, broker] = rows();
    assert.equal(client!.business_id, CLIENT);
    assert.equal(client!.meta.broker_id, BROKER);
    assert.equal(broker!.business_id, null);
    assert.equal(broker!.meta.broker_id, BROKER);
    assert.equal(broker!.actor, "person");
  });

  // Fix round 1 (review m-8): a drain run inside someone's context must not
  // lend its client to the jobs; each job's client is its own session's.
  test("[C-1715] a job's rows carry its own session's client and broker, never the outer context's; a declined-consent session's jobs keep the shape only", async () => {
    const OUTER_BROKER = "00000000-0000-4000-8000-0000000000b9";
    await db().from("sessions").update({ client_id: OTHER_CLIENT, outcome: "declined_consent" }).eq("id", S2);
    queue.registerHandler("extract_facts", async () => intel.capture("tool", { name: "inside", content: { text: "the client's words" } }));
    const one = Number(await queue.enqueue("extract_facts", S1, { session_id: S1 }));
    const two = Number(await queue.enqueue("extract_facts", S2, { session_id: S2 }));
    await intel.withTrace(
      { traceId: intel.requestTraceId(), clientId: "00000000-0000-4000-8000-0000000000c9", brokerId: OUTER_BROKER, stage: "outer", turnId: intel.turnIdFor(S3, 1), contentMode: "meta" },
      () => queue.drain({ maxJobs: 2, noHandOn: true }),
    );
    await flushTracking();
    const inside = (job: number) => rows().find((r) => r.name === "inside" && r.job_id === job)!;
    assert.equal(inside(one).business_id, CLIENT);
    assert.equal(inside(one).meta.broker_id, BROKER);
    assert.equal(inside(one).stage, null);
    assert.equal(inside(one).turn_id, null);
    assert.deepEqual(inside(one).content, { text: "the client's words" }, "not the outer context's meta mode");
    assert.equal(inside(two).business_id, OTHER_CLIENT);
    assert.equal(inside(two).content, null, "a declined-consent session's job keeps the shape only");
    assert.equal(inside(two).content_mode, "meta");
    assert.ok(!rows().some((r) => r.business_id === "00000000-0000-4000-8000-0000000000c9" || r.meta?.broker_id === OUTER_BROKER));
  });

  // Fix round 1 (review m-5): indexed columns take ids, not words.
  test("a bad call site cannot put free text in the trace, stage or name columns", async () => {
    await intel.withTrace({ traceId: "free text with 0799930001 in it", sessionId: "not a uuid 0799930001", stage: "readback for thandi@example.test" }, async () =>
      intel.capture("track", { name: "named for 0799930001" }),
    );
    await intel.flushIntel();
    const [row] = rows();
    assert.match(row!.trace_id, /^p_[0-9a-f]{16}$/, "an id that is not an id is not used");
    assert.equal(row!.stage, "readback for [contact]");
    assert.equal(row!.name, "named for [contact]");
  });

  test("[C-1716] every row's channel is one of phone, web, meeting, dashboard, email, whatsapp, system", async () => {
    await happyPath();
    for (const channel of CHANNELS) await intel.withTrace({ traceId: intel.requestTraceId(), channel: channel as never }, async () => intel.capture("track", { name: `on_${channel}` }));
    intel.capture("track", { name: "no_context" });
    intel.capture("send", { name: "email:quote", channel: "email" });
    await flushTracking();
    for (const r of rows()) assert.ok(CHANNELS.includes(r.channel), `${r.name}: ${r.channel}`);
    assert.equal(named("no_context")[0]!.channel, "system");
    assert.equal(named("email:quote")[0]!.channel, "email");
    assert.equal(named("on_meeting")[0]!.channel, "meeting");
    assert.ok(rows().some((r) => r.channel === "phone") && rows().some((r) => r.channel === "system"), "the request's and the job's");
    assert.equal(intel.traceForSession(S1), `s_${S1}`);
  });
});

// ── What is captured where ───────────────────────────────────────

describe("intel: models.ts, queue.ts and track.ts capture", () => {
  test("[C-1721] every askJSON/askText attempt is a model row with everything it was shown and said; a fallback or a retry is another row", async () => {
    fake.tables.model_config.length = 0;
    fake.tables.model_config.push(configRow("extract", { params: { reasoning: { enabled: false } } }));
    __clearModelCache();
    let aCalls = 0;
    net.onModel(/Extract the facts/, (_p, init) => {
      const payload = JSON.parse(String(init?.body));
      if (payload.model === A) return ++aCalls === 1 ? new Response('{"error":{"message":"rate limited"}}', { status: 429 }) : modelReply('{"age":', { finishReason: "length" });
      return modelReply({ age: 42 }, { model: B, usage: { prompt_tokens: 120, completion_tokens: 8 } });
    });
    net.onModel(/Summarise/, () => modelReply("A short summary.", { model: A }));
    await intel.withTrace({ traceId: intel.traceForSession(S1), sessionId: S1 }, async () => {
      assert.deepEqual((await askJSON("extract", PROMPT)).value, { age: 42 }, "the result is unchanged");
      assert.equal((await askJSON("extract", PROMPT)).value.age, 42);
      assert.equal((await askText("extract", "Summarise the call.")).value, "A short summary.");
    });
    await flushTracking();
    const models = rows().filter((r) => r.kind === "model");
    // 429 on A, B answers; then A cut off twice (more room each time), B answers; then askText.
    assert.deepEqual(models.map((r) => [r.meta.model, r.ok]), [[A, false], [B, true], [A, false], [A, false], [B, true], [A, true]]);
    for (const r of models) {
      assert.equal(r.name, "model_call:extract");
      assert.equal(r.actor, "model");
      assert.equal(r.trace_id, `s_${S1}`);
      for (const k of ["model", "role", "served_by", "provider", "usage", "truncated", "streamed", "first_token_ms", "error"]) assert.ok(k in r.meta, `meta.${k}`);
      assert.equal(r.meta.role, "extract");
      assert.ok(Array.isArray(r.content.messages), "everything it was shown");
      assert.ok("response" in r.content && "reasoning" in r.content);
    }
    const [rateLimited, answered, cut] = models;
    assert.deepEqual(rateLimited!.content.messages, [{ role: "user", content: PROMPT }]);
    assert.equal(rateLimited!.content.response, null);
    assert.match(rateLimited!.meta.error, /429/);
    assert.deepEqual(rateLimited!.content.reasoning, { enabled: false });
    assert.equal(answered!.content.response, '{"age":42}', "everything it said");
    assert.equal(answered!.meta.served_by, B);
    assert.deepEqual(answered!.meta.usage, { in: 120, out: 8 });
    assert.equal(answered!.meta.truncated, false);
    assert.equal(answered!.meta.error, null);
    assert.equal(cut!.meta.truncated, true);
    assert.equal(cut!.content.response, '{"age":');
    assert.ok(models[3]!.meta.max_tokens > cut!.meta.max_tokens, "the retry had more room");
    assert.deepEqual(models[5]!.content.messages, [{ role: "user", content: "Summarise the call." }]);
    assert.equal(models[5]!.content.response, "A short summary.");
  });

  test("[C-1722] a transcription's model row holds the audio as {type, size} and the transcript, never the bytes", async () => {
    const audio = new Uint8Array(4096).map((_, i) => (i * 13) % 256);
    let first = true;
    net.onFetch(/openrouter\.ai\/api\/v1\/audio\/transcriptions/, () => {
      if (first) {
        first = false;
        return new Response("upstream down", { status: 503 });
      }
      return { text: " Ja, funeral cover for four people. " };
    });
    const out = await intel.withTrace({ traceId: intel.traceForSession(S2), sessionId: S2, channel: "meeting" }, () => transcribeAudio(audio, "audio/webm;codecs=opus"));
    assert.equal(out.text, "Ja, funeral cover for four people.");
    await flushTracking();
    const models = rows().filter((r) => r.kind === "model");
    assert.equal(models.length, 2, "one row per attempt");
    const [failed, heard] = models;
    for (const r of models) {
      assert.equal(r.name, "model_call:voice");
      assert.equal(r.meta.role, "voice");
      assert.deepEqual(r.content.audio, { type: "audio/webm;codecs=opus", size: 4096 });
      assert.equal(r.trace_id, `s_${S2}`);
    }
    assert.equal(failed!.ok, false);
    assert.equal(failed!.meta.status, 503);
    assert.equal(failed!.meta.model, "test/whisper-a");
    assert.equal(heard!.ok, true);
    assert.equal(heard!.meta.model, "test/whisper-b");
    assert.equal(heard!.content.response, "Ja, funeral cover for four people.");
    const text = JSON.stringify(models);
    assert.ok(!text.includes(Buffer.from(audio).toString("base64").slice(0, 40)), "no bytes as base64");
    assert.doesNotMatch(text, /(\d+,){50}/, "no bytes as numbers");
  });

  test("[C-1732][C-1713] every job enqueued, started, finished, failed, held, skipped (and cancelled) is a job row with meta {job_id, kind, attempt} and content.payload", async () => {
    clock = fakeClock("2026-10-31T08:00:00.000Z");
    queue.registerHandler("notify_broker", async () => {});
    queue.registerHandler("match", async () => {
      throw new Error("the matcher broke");
    });
    let held = false;
    queue.registerHandler("analyse_needs", async () => {
      if (!held) {
        held = true;
        throw new JobHoldError("waiting for the facts", 5_000);
      }
    });
    const ok = Number(await queue.enqueue("notify_broker", S1, { session_id: S1, quote_id: "q1" }));
    const bad = Number(await queue.enqueue("match", S2, { session_id: S2 }));
    const hold = Number(await queue.enqueue("analyse_needs", S3, { session_id: S3 }));
    // Named only in its payload, so deleting the session leaves the job to be skipped.
    const orphan = Number(await queue.enqueue("notify_broker", null, { session_id: S4 }));
    await db().from("sessions").delete().eq("id", S4);

    await queue.drain({ maxJobs: 10, noHandOn: true });
    clock.advance(10_000);
    await queue.drain({ maxJobs: 10, noHandOn: true });
    clock.advance(60_000);
    await queue.drain({ maxJobs: 10, noHandOn: true });
    queue.captureJob("cancelled", { id: ok, kind: "notify_broker", attempts: 1, payload: { session_id: S1, quote_id: "q1" } }, { meta: { reason: "forget_client" } });
    await flushTracking();

    const of = (id: number) => rows().filter((r) => r.kind === "job" && r.meta.job_id === id).map((r) => [r.name, r.meta.attempt]);
    assert.deepEqual(of(ok), [["job_enqueued", 0], ["job_started", 1], ["job_finished", 1], ["job_cancelled", 1]]);
    assert.deepEqual(of(bad), [["job_enqueued", 0], ["job_started", 1], ["job_failed", 1], ["job_started", 2], ["job_failed", 2], ["job_started", 3], ["job_failed", 3]]);
    assert.deepEqual(of(hold), [["job_enqueued", 0], ["job_started", 1], ["job_held", 1], ["job_started", 1], ["job_finished", 1]]);
    assert.deepEqual(of(orphan), [["job_enqueued", 0], ["job_skipped", 1]]);
    for (const r of rows().filter((r) => r.kind === "job")) {
      assert.equal(r.actor, "system");
      assert.equal(typeof r.meta.job_id, "number");
      assert.equal(typeof r.meta.kind, "string");
      assert.equal(typeof r.meta.attempt, "number");
      assert.ok(r.content && typeof r.content.payload === "object", `${r.name} carries the payload`);
    }
    // track() records job_done, job_held, job_skipped too; these are the `job` rows.
    const jobRow = (name: string, id: number): Row => rows().find((r) => r.kind === "job" && r.name === name && r.meta.job_id === id)!;
    const failures = rows().filter((r) => r.name === "job_failed" && r.kind === "job");
    assert.deepEqual(failures.map((r) => r.meta.final), [false, false, true]);
    assert.equal(failures[0]!.ok, false);
    assert.equal(failures[0]!.meta.retry_in_s, 10);
    assert.match(failures[2]!.meta.error, /the matcher broke/);
    assert.equal(jobRow("job_finished", ok).ok, true);
    assert.ok(jobRow("job_finished", ok).ms >= 0);
    assert.equal(jobRow("job_held", hold).meta.reason, "hold");
    assert.equal(jobRow("job_skipped", orphan).meta.reason, "session_gone");
    assert.equal(jobRow("job_skipped", orphan).trace_id, `job_${orphan}`, "no session column: the job's own trace");
    assert.deepEqual(jobRow("job_finished", ok).content.payload, { session_id: S1, quote_id: "q1" });
    assert.equal(jobRow("job_started", bad).trace_id, `s_${S2}`, "a job's trace is its session's");
  });

  test("[C-1733] every trackFailure() is an error row with content {props, summary} and meta {category, severity}; every track() a track row", async () => {
    await intel.withTrace({ traceId: intel.traceForSession(S1), sessionId: S1, clientId: CLIENT }, async () => {
      track("quote_viewed", { props: { quote_id: "q1" }, ms: 12 });
      trackFailure("delivery_failed", new Error("Resend refused the send"), { props: { channel: "email" } });
      // A failure filed under another category is still a failure.
      trackFailure("alert_email_failed", new Error("timeout"), { category: "ops", severity: "warn", alert: "digest" });
      track("request_failed", { category: "failure", severity: "error", props: { status: 500 } });
    });
    await flushTracking();
    const viewed = named("quote_viewed")[0]!;
    assert.equal(viewed.kind, "track");
    assert.deepEqual(viewed.content, { props: { quote_id: "q1" } });
    assert.deepEqual(viewed.meta, { category: "behaviour", severity: "info" });
    assert.equal(viewed.ms, 12);
    assert.equal(viewed.business_id, CLIENT);
    const failed = named("delivery_failed")[0]!;
    assert.equal(failed.kind, "error");
    assert.equal(failed.ok, false);
    assert.equal(failed.content.props.error, "Resend refused the send");
    assert.equal(failed.content.props.channel, "email");
    assert.match(failed.content.summary, /^delivery failed: Resend refused the send/);
    assert.deepEqual(failed.meta, { category: "failure", severity: "error" });
    assert.equal(named("alert_email_failed")[0]!.kind, "error");
    assert.deepEqual(named("alert_email_failed")[0]!.meta, { category: "ops", severity: "warn" });
    assert.equal(named("request_failed")[0]!.kind, "error");
    for (const r of rows()) assert.equal(r.trace_id, `s_${S1}`);
  });
});

// ── The flush ────────────────────────────────────────────────────

describe("intel: the flush", () => {
  test("[C-1758] with intel_events absent, capture writes nothing, logs one line naming the migration, retries after 10 minutes, and nothing else is affected", async (t) => {
    clock = fakeClock("2026-10-31T08:00:00.000Z");
    const warn = t.mock.method(console, "warn", () => {});
    const lines = () => warn.mock.calls.map((c) => c.arguments.map(String).join(" ")).filter((l) => /intel_events/.test(l));
    fake.missingTable("intel_events");
    const handler = tracked("intel-missing", "web", async () => {
      intel.capture("track", { name: "before_migration" });
      trackFailure("something_else", new Error("a real problem"), { severity: "error" });
      return new Response("answered");
    });
    const res = await handler(new Request("https://call.test/api/intel-missing", { method: "POST" }));
    assert.equal(await res.text(), "answered");
    await flushTracking();
    assert.equal(rows().length, 0, "nothing written");
    assert.equal(lines().length, 1, "one line");
    assert.match(lines()[0]!, /db\/0006_platform\.sql/, "naming the migration");
    assert.equal(intel.intelStats().table_present, false);
    assert.equal(fake.tables.incidents.filter((r) => r.kind === "something_else").length, 1, "the rest of tracking is unaffected");
    assert.equal(fake.tables.incidents.filter((r) => /intel/.test(r.kind)).length, 0, "a migration not yet run is not an incident");

    // Within ten minutes it does not even try.
    const tried = intelQueries().length;
    clock.advance(9 * 60_000);
    intel.capture("track", { name: "still_missing" });
    assert.deepEqual(await intel.flushIntel(), { written: 0, dropped: 1 });
    assert.equal(intelQueries().length, tried, "no query inside the backoff");

    // After ten minutes it tries again: still missing is still one line in all.
    clock.advance(60_000 + 1);
    intel.capture("track", { name: "after_ten" });
    await intel.flushIntel();
    assert.equal(intelQueries().length, tried + 1);
    assert.equal(lines().length, 1);

    // The migration runs: the next try after the backoff writes.
    fake.failTable("intel_events", null);
    clock.advance(10 * 60_000 + 1);
    intel.capture("track", { name: "after_migration" });
    assert.deepEqual(await intel.flushIntel(), { written: 1, dropped: 0 });
    assert.equal(rows()[0]!.name, "after_migration");
    assert.equal(intel.intelStats().table_present, true);
    // 42P01 (relation does not exist) is the same as PostgREST's PGRST205.
    fake.failTable("intel_events");
    intel.capture("track", { name: "dropped_again" });
    await intel.flushIntel();
    assert.equal(intel.intelStats().table_present, false);
    assert.equal(lines().length, 1, "still one line per process");
  });

  test("[C-1765] a flush that fails three times drops its rows, counts them, files one incident, and no request fails because of it", async (t) => {
    t.mock.method(console, "warn", () => {});
    fake.failTable("intel_events", { code: "57014", message: "canceling statement due to statement timeout" });
    const handler = tracked("intel-down", "web", async () => {
      intel.capture("track", { name: "one" });
      intel.capture("track", { name: "two" });
      return new Response("fine");
    });
    const res = await handler(new Request("https://call.test/api/intel-down", { method: "POST" }));
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "fine");
    await flushTracking();
    assert.equal(intelInserts().length, 3, "three attempts");
    assert.equal(intel.intelStats().dropped, 3, "two rows and the request's http_request");
    const incident = () => fake.tables.incidents.filter((r) => r.kind === "intel_flush_failed");
    assert.equal(incident().length, 1);
    assert.equal(incident()[0]!.count, 1);

    // Still down: dropped again, but the incident is not filed twice.
    intel.capture("track", { name: "three" });
    const second = await intel.flushIntel();
    assert.equal(second.written, 0);
    assert.ok(second.dropped >= 1);
    await flushTracking();
    assert.equal(incident()[0]!.count, 1, "filed once");
    assert.equal(intelInserts().length, 6);

    // Back up: written again, and a later outage is a new incident.
    fake.failTable("intel_events", null);
    intel.capture("track", { name: "four" });
    const third = await intel.flushIntel();
    assert.ok(third.written >= 1);
    assert.ok(named("four").length === 1);
    const stats = intel.intelStats();
    assert.ok(stats.flushed >= 1 && typeof stats.last_flush_at === "string");
    assert.equal(stats.mode, "full");
    assert.equal(stats.buffered, 0);
  });

  test("[C-1766] 2,000 buffered rows are written in inserts of at most 500 rows, and no insert carries more than 1 MB", async () => {
    for (let i = 0; i < 2000; i++) intel.capture("track", { name: `bulk_${i}`, content: { props: { i } } });
    assert.equal(intel.intelStats().buffered, 2000, "held until the flush, not written as they come");
    assert.deepEqual(await intel.flushIntel(), { written: 2000, dropped: 0 });
    assert.deepEqual(intelInserts().map((q) => q.rows!.length), [500, 500, 500, 500]);
    assert.deepEqual(rows().map((r) => r.name), Array.from({ length: 2000 }, (_, i) => `bulk_${i}`));

    const before = intelInserts().length;
    for (let i = 0; i < 12; i++) intel.capture("model", { name: "model_call:writer", content: { messages: [{ role: "user", content: words(300_000) }], response: "ok" } });
    assert.deepEqual(await intel.flushIntel(), { written: 12, dropped: 0 });
    const big = intelInserts().slice(before);
    assert.ok(big.length >= 4, `${big.length} inserts`);
    for (const q of big) assert.ok(Buffer.byteLength(JSON.stringify(q.rows)) <= 1_000_000, `an insert of ${Buffer.byteLength(JSON.stringify(q.rows))} bytes`);
  });

  test("[C-1767] a 200 KB prompt is kept whole; content over 1 MB is cut to 1 MB with meta.truncated_bytes", async () => {
    const prompt = words(200_000);
    intel.capture("model", { name: "model_call:writer", content: { messages: [{ role: "user", content: prompt }], response: "drafted", reasoning: null } });
    const huge = words(1_500_000);
    intel.capture("model", { name: "model_call:writer", content: { messages: [{ role: "user", content: huge }], response: "drafted too", reasoning: null } });
    await intel.flushIntel();
    const [whole, cut] = rows();
    assert.equal(whole!.content.messages[0].content, prompt, "kept whole");
    assert.equal(whole!.meta.truncated_bytes, undefined);
    const kept = Buffer.byteLength(JSON.stringify(cut!.content));
    assert.ok(kept <= 1_000_000, `kept ${kept} bytes`);
    assert.ok(kept > 900_000, `cut to about 1 MB, not far below (${kept})`);
    assert.ok(cut!.meta.truncated_bytes >= 500_000, `meta.truncated_bytes ${cut!.meta.truncated_bytes}`);
    assert.equal(cut!.content.response, "drafted too", "the cut takes the long text, and keeps the shape");
    assert.ok(cut!.content.messages[0].content.startsWith(huge.slice(0, 10_000)));
  });
});

// ── Forgetting and reading back ──────────────────────────────────

describe("intel: forgetting wins, and a task reads back whole", () => {
  test("[C-1745] forgetIntel deletes every row about the client and every row of every trace they were in, written or still buffered", async () => {
    await intel.withTrace({ traceId: intel.traceForSession(S1), sessionId: S1, brokerId: BROKER }, async () => {
      intel.capture("track", { name: "voice:init" }); // before the client was known
      setTrackContext({ clientId: CLIENT });
      intel.capture("ask", { name: "turn", content: { text: "I am 42", kind: "turn", t: 1 } });
    });
    await intel.withTrace({ traceId: intel.traceForSession(S2), sessionId: S2, clientId: OTHER_CLIENT }, async () => intel.capture("ask", { name: "other_client", content: { text: "Not me", kind: "turn", t: 1 } }));
    await intel.withTrace({ traceId: intel.requestTraceId(), brokerId: BROKER, channel: "dashboard" }, async () => intel.capture("track", { name: "broker:settings_saved", actor: "person" }));
    await intel.flushIntel();
    assert.equal(rows().length, 4);
    // Still buffered: a new trace about the client, and a late row of the forgotten trace.
    await intel.withTrace({ traceId: intel.traceForSession(S3), sessionId: S3 }, async () => {
      intel.capture("track", { name: "s3_before_client" });
      setTrackContext({ clientId: CLIENT });
      intel.capture("ask", { name: "s3_turn", content: { text: "buffered words", kind: "turn", t: 1 } });
    });
    await intel.withTrace({ traceId: intel.traceForSession(S1), sessionId: S1 }, async () => intel.capture("track", { name: "s1_late" }));
    assert.equal(intel.intelStats().buffered, 3);

    const deleted = await intel.forgetIntel(CLIENT);
    await intel.flushIntel();
    assert.equal(deleted, 5, "two written, three buffered");
    assert.deepEqual(rows().map((r) => r.name).sort(), ["broker:settings_saved", "other_client"]);
    assert.ok(!rows().some((r) => r.business_id === CLIENT || r.trace_id === `s_${S1}` || r.trace_id === `s_${S3}`));
    assert.doesNotMatch(JSON.stringify(rows()), /I am 42|buffered words/);
  });

  // Fix round 1 (review I-5): the reviewer's probe, a delivery webhook in the
  // same process flushing while the forget reads the client's traces.
  test("[C-1745] a flush that runs while forgetIntel is reading the client's traces never lands after the deletes", async () => {
    await intel.withTrace({ traceId: intel.traceForSession(S1), sessionId: S1, clientId: CLIENT }, async () => intel.capture("ask", { name: "turn", content: { text: "I am 42", kind: "turn", t: 1 } }));
    await intel.flushIntel();
    const forgetting = intel.forgetIntel(CLIENT);
    await intel.withTrace({ traceId: intel.traceForSession(S1), sessionId: S1 }, async () => intel.capture("track", { name: "delivery:delivered", content: { props: { to_words: "Thandi's quote" } } }));
    const flushing = intel.flushIntel();
    await forgetting;
    await flushing;
    // And a flush already past its batching when the forget starts.
    await intel.withTrace({ traceId: intel.traceForSession(S2), sessionId: S2, clientId: OTHER_CLIENT }, async () => intel.capture("ask", { name: "other", content: { text: "x", kind: "turn", t: 1 } }));
    await intel.withTrace({ traceId: intel.traceForSession(S2), sessionId: S2 }, async () => intel.capture("track", { name: "s2_late" }));
    const early = intel.flushIntel();
    const second = intel.forgetIntel(OTHER_CLIENT);
    await early;
    await second;
    await intel.flushIntel();
    assert.deepEqual(rows().map((r) => `${r.trace_id}:${r.name}`), []);
  });

  // Fix round 1 (review I-6): a job queued from the client's task with no
  // session runs in its own job_<id> trace, with no client on its rows.
  test("[C-1745] forgetting follows the jobs the client's task queued, as readTrace does: a session-less job's rows go too, and an unrelated job's stay", async () => {
    queue.registerHandler("notify_broker", async (job) => {
      const payload = job.payload as { client_name?: string };
      intel.capture("say", { name: "email:broker_new_quote", content: { text: `${payload.client_name} (42) wants funeral cover for four people`, kind: "email" } });
    });
    await intel.withTrace({ traceId: intel.traceForSession(S1), sessionId: S1, clientId: CLIENT }, async () => {
      intel.capture("ask", { name: "turn", content: { text: "I am 42", kind: "turn", t: 1 } });
      await queue.enqueue("notify_broker", null, { client_name: "Thandi" });
    });
    await intel.withTrace({ traceId: intel.requestTraceId(), brokerId: BROKER }, async () => queue.enqueue("notify_broker", null, { client_name: "Sipho" }));
    await queue.drain({ maxJobs: 3, noHandOn: true });
    await flushTracking();
    const before = await intel.readTrace(`s_${S1}`);
    assert.ok(before.some((r) => r.name === "email:broker_new_quote" && r.trace_id.startsWith("job_")), "readTrace folds the job in");
    const others = rows().filter((r) => !before.some((b) => b.id === r.id));
    assert.ok(others.some((r) => /Sipho/.test(JSON.stringify(r.content))), "the unrelated job ran too");

    const removed = await intel.forgetIntel(CLIENT);
    assert.equal(removed, before.length, "every row readTrace would show");
    assert.doesNotMatch(JSON.stringify(rows()), /Thandi/);
    assert.deepEqual(rows().map((r) => r.id).sort(), others.map((r) => r.id).sort(), "nothing else");
    // A late row of the forgotten job (a retry, a delivery) is not even buffered.
    const jobTrace = before.find((r) => r.trace_id.startsWith("job_"))!.trace_id;
    await withTrackContext({ jobId: Number(jobTrace.slice(4)), traceId: jobTrace }, async () => intel.capture("track", { name: "late_in_job" }));
    assert.equal(intel.intelStats().buffered, 0);
  });

  test("[C-1746] forgetting twice: the second deletes nothing and succeeds, and so does forgetting before the table exists", async () => {
    await intel.withTrace({ traceId: intel.traceForSession(S1), sessionId: S1, clientId: CLIENT }, async () => intel.capture("ask", { name: "turn", content: { text: "x", kind: "turn", t: 1 } }));
    await intel.flushIntel();
    assert.equal(await intel.forgetIntel(CLIENT), 1);
    assert.equal(await intel.forgetIntel(CLIENT), 0);
    fake.missingTable("intel_events");
    assert.equal(await intel.forgetIntel(CLIENT), 0);
  });

  test("[C-1754] readTrace from the s_ id, the session uuid, the ElevenLabs conversation id, a turn id, job_<n> or a bare job number returns the whole task in (at, seq) order, queued jobs folded in", async () => {
    clock = fakeClock("2026-10-31T08:00:00.000Z");
    const turn = intel.turnIdFor(S1, 0);
    queue.registerHandler("ingest_transcript", async () => {
      clock!.advance(5);
      intel.capture("check", { name: "check:consent", meta: { check: "consent", engine: "rules", outcome: "pass" } });
    });
    queue.registerHandler("forget_client", async () => {
      clock!.advance(5);
      intel.capture("track", { name: "forgot_inside_its_own_trace" });
    });
    const jobs = await intel.withTrace({ traceId: intel.traceForSession(S1), sessionId: S1, clientId: CLIENT, channel: "phone" }, async () => {
      intel.capture("track", { name: "voice:init" });
      clock!.advance(5);
      intel.capture("ask", { name: "turn", turnId: turn, content: { text: "Hello", kind: "turn", t: 0.5 } });
      clock!.advance(5);
      return { ingest: Number(await queue.enqueue("ingest_transcript", S1, { session_id: S1 })), forget: Number(await queue.enqueue("forget_client", S1, { client_id: CLIENT })) };
    });
    // Unrelated work in the same minutes is never folded in.
    await intel.withTrace({ traceId: intel.traceForSession(S2), sessionId: S2 }, async () => intel.capture("track", { name: "another_call" }));
    await queue.drain({ maxJobs: 5, noHandOn: true });
    await flushTracking();

    const whole = await intel.readTrace(`s_${S1}`);
    const names = whole.map((r) => r.name);
    for (const n of ["voice:init", "turn", "job_enqueued", "job_started", "check:consent", "job_finished", "forgot_inside_its_own_trace"]) assert.ok(names.includes(n), `${n} in ${names.join(", ")}`);
    assert.ok(!names.includes("another_call"));
    assert.ok(whole.some((r) => r.trace_id === `job_${jobs.forget}`), "the forget job's own trace, folded in through job_enqueued");
    for (let i = 1; i < whole.length; i++) assert.ok(byOrder(whole[i - 1]!, whole[i]!) <= 0, `in order at ${i}`);
    const ids = whole.map((r) => r.id);
    assert.equal(new Set(ids).size, ids.length, "no row twice");
    for (const id of [S1, CONVERSATION, turn, `job_${jobs.ingest}`, String(jobs.ingest)]) {
      assert.deepEqual((await intel.readTrace(id)).map((r) => r.id), ids, `readTrace(${id})`);
    }
    // A job with no session is its own task.
    const forget = await intel.readTrace(String(jobs.forget));
    assert.ok(forget.length > 0 && forget.every((r) => r.trace_id === `job_${jobs.forget}`));
    assert.deepEqual(await intel.readTrace("no_such_trace"), []);
  });

  // Fix round 1 (review m-11): a trace that is cut says so.
  test("[C-1754] readTrace that stops following queued jobs says so, once, rather than returning part of a task in silence", async (t) => {
    const warn = t.mock.method(console, "warn", () => {});
    await intel.withTrace({ traceId: intel.traceForSession(S1), sessionId: S1 }, async () => {
      for (let i = 1; i <= 60; i++) intel.capture("job", { name: "job_enqueued", meta: { job_id: 1000 + i, kind: "notify_broker", attempt: 0 } });
    });
    await intel.flushIntel();
    const trace = await intel.readTrace(`s_${S1}`);
    assert.equal(trace.length, 60);
    const lines = warn.mock.calls.map((c) => String(c.arguments[0]));
    assert.equal(lines.filter((l) => /readTrace/.test(l)).length, 1);
    assert.match(lines.find((l) => /readTrace/.test(l))!, /cut|stopped/);
  });

  test("[C-1753] docs/INTEL-CONTRACT.md is Charlie's file, unchanged", () => {
    const sha = createHash("sha256").update(readFileSync(new URL("../docs/INTEL-CONTRACT.md", import.meta.url))).digest("hex");
    assert.equal(sha, "5060897adb1cea96918731fc9629de0ba4aad6805e807a7e12a6fb3e8f5baaf8");
  });
});

// withTrackContext is the same store as withTrace: one context, whichever opened it.
test("withTrace and withTrackContext are one context: an event inside either carries the trace", async () => {
  await withTrackContext({ sessionId: S1, channel: "phone" }, async () => {
    await intel.withTrace({ traceId: "r_0123456789abcdef", stage: "readback", contentMode: "meta" }, async () => intel.capture("say", { name: "readback", content: { text: "You are 42" } }));
  });
  await intel.flushIntel();
  const [row] = rows();
  assert.equal(row!.trace_id, `s_${S1}`, "the session wins over the request's own id");
  assert.equal(row!.stage, "readback");
  assert.equal(row!.content, null, "a context in meta mode (declined consent) keeps the shape only");
  assert.equal(row!.content_mode, "meta");
});
