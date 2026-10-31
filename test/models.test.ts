// Call — the model layer (api/_lib/models.ts): every post-call model call goes
// through askJSON/askText, and which model does which job is model_config.
//
// The gateway is the fake network (test/_fakes.ts): each test scripts the
// replies per model slug, in order, and reads back exactly what was sent —
// which model, with what max_tokens, temperature and response_format. The
// slugs here are obviously fake (test/model-a); only HARD_FALLBACKS are real,
// because the order of that list is what C-1510 is about.
//
// Two halves of two criteria live in the queue, not here: C-1505's "the job
// requeued" and C-1511's "the job retries with backoff". What this file pins is
// the model layer's side of both — the error is thrown, it is the class the
// queue retries on, and it reaches the job unchanged from inside a job context.
// Task 0.4's queue tests pin the requeue and the backoff.

// Must be first: api/_lib/env.ts snapshots process.env when it is first imported.
import "./_env.ts";
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { fakeClock, installFakeDb, installFakeNet, jsonResponse, modelReply, type FakeClock, type FakeDb, type FakeNet } from "./_fakes.ts";
import { TEST_ENV, setEnv } from "./_env.ts";
import {
  DeadlineError,
  HARD_FALLBACKS,
  JSON_ONLY,
  MAX_MAX_TOKENS,
  MIN_MAX_TOKENS,
  ModelBadRequest,
  ModelUnavailable,
  __clearModelCache,
  askJSON,
  askText,
  extractJSON,
  loadModelConfig,
  transcribeAudio,
} from "../api/_lib/models.ts";
import { jobCtx } from "../api/_lib/jobctx.ts";
import { errorText, flushTracking, holdForFlush, trackFailure, tracked } from "../api/_lib/track.ts";

const A = "test/model-a";
const B = "test/model-b";
const C = "test/model-c";
const SESSION = "00000000-0000-4000-8000-0000000000aa";
const PROMPT = "Extract the facts from the transcript below.";

type Row = Record<string, unknown>;
const configRow = (over: Row = {}): Row => ({ role: "extract", provider: "openrouter", model: A, fallbacks: [B, C], params: {}, enabled: true, ...over });

/** A scripted reply: the message content, a Response as-is, or a function of the request payload. */
type Reply = unknown;

let fake: FakeDb;
let net: FakeNet;
let clock: FakeClock;
let replies: Map<string, Reply[]>;
let unscripted: string[];
/** What a model with nothing scripted answers. Null: record it as a test bug and answer 599. */
let otherwise: (() => Reply) | null;

/** Script the next replies for one model slug, in order. */
const say = (model: string, ...r: Reply[]): void => {
  replies.set(model, [...(replies.get(model) ?? []), ...r]);
};
const models = (): string[] => net.modelCalls.map((c) => c.model);
const budgets = (): number[] => net.modelCalls.map((c) => c.payload.max_tokens);
const status = (code: number, body = `{"error":{"message":"status ${code}"}}`): Response =>
  new Response(body, { status: code, headers: { "Content-Type": "application/json" } });
/** A reply cut off at the length limit: a size problem, whatever the text. */
const cut = (text: string, usage?: { prompt_tokens: number; completion_tokens: number }): Response => modelReply(text, { finishReason: "length", usage });

function setup(seed: Row[] = [configRow()]): void {
  __clearModelCache();
  clock = fakeClock("2026-10-31T08:00:00.000Z");
  fake = installFakeDb({ model_config: seed });
  net = installFakeNet();
  replies = new Map();
  unscripted = [];
  otherwise = null;
  net.onModel(/[\s\S]*/, (_prompt, init) => {
    const payload = JSON.parse(String(init?.body ?? "{}"));
    const queue = replies.get(payload.model);
    const next = queue && queue.length ? queue.shift() : undefined;
    if (next === undefined) {
      if (otherwise) return otherwise();
      unscripted.push(payload.model);
      return status(599, "unscripted");
    }
    return typeof next === "function" ? (next as (p: unknown) => unknown)(payload) : next;
  });
}

async function teardown(): Promise<void> {
  // Written before the fakes come out: a bump that landed after uninstall would reach a real client.
  await flushTracking();
  net.restore();
  fake.uninstall();
  clock.restore();
  assert.deepEqual(unscripted, [], "a model was called that the test did not script");
}

/** A different seed mid-test: the old fakes come out first (two fake clocks must never nest). */
async function reseed(seed: Row[] = [configRow()]): Promise<void> {
  await teardown();
  setup(seed);
}

const incidents = (kind: string) => fake.tables.incidents.filter((r) => r.kind === kind);

describe("models: truncation is a size problem", () => {
  beforeEach(() => setup());
  afterEach(teardown);

  test("[C-1500] a reply cut off at finish_reason=length is retried on the same model with max_tokens doubled, capped at 8000", async () => {
    say(A, cut('{"need": "fun'), { need: "funeral" });
    const out = await askJSON("extract", PROMPT, { sessionId: SESSION });
    assert.deepEqual(out.value, { need: "funeral" });
    assert.equal(out.model, A);
    assert.deepEqual(models(), [A, A]);
    assert.deepEqual(budgets(), [MIN_MAX_TOKENS, MIN_MAX_TOKENS * 2]);

    // The cap: 5000 doubles to 8000, never 10 000.
    say(A, cut("{"), { need: "life" });
    await askJSON("extract", PROMPT, { maxTokens: 5000 });
    assert.equal(MAX_MAX_TOKENS, 8000);
    assert.deepEqual(budgets().slice(-2), [5000, 8000]);
  });

  test("[C-1500] askText retries a cut-off answer the same way (Charlie returned it silently short)", async () => {
    await reseed([configRow({ role: "summary" })]);
    say(A, cut("The client asked about funeral cov"), "The client asked about funeral cover for four people.");
    const out = await askText("summary", "Summarise the call.");
    assert.equal(out.value, "The client asked about funeral cover for four people.");
    assert.deepEqual(budgets(), [1200, 2400]);
  });

  test("[C-1501] JSON that parses is still retried when finish_reason=length: what arrived may be only part of it", async () => {
    say(A, cut('{"age": 42}'), { age: 42, smoker: false });
    const out = await askJSON("extract", PROMPT);
    assert.deepEqual(out.value, { age: 42, smoker: false });
    assert.deepEqual(models(), [A, A]);
  });

  test("[C-1502] two truncations on one model move to the next fallback, which starts with the larger budget", async () => {
    say(A, cut("{"), cut('{"a":'));
    say(B, { a: 1 });
    const out = await askJSON("extract", PROMPT);
    assert.deepEqual(out.value, { a: 1 });
    assert.equal(out.model, B);
    assert.deepEqual(models(), [A, A, B]);
    assert.deepEqual(budgets(), [1200, 2400, 4800]);
  });

  test("[C-1503] no request ever carries fewer than MIN_MAX_TOKENS (1200), whatever the caller or the row asked for", async () => {
    await reseed([configRow({ params: { max_tokens: 300 } }), configRow({ role: "summary", params: { max_tokens: 40 } })]);
    say(A, { a: 1 }, { a: 2 }, "short", { a: 3 });
    await askJSON("extract", PROMPT);
    await askJSON("extract", PROMPT, { maxTokens: 64 });
    await askText("summary", "Summarise.", { maxTokens: 10 });
    await askJSON("extract", PROMPT, { maxTokens: 0 });
    assert.equal(MIN_MAX_TOKENS, 1200);
    assert.deepEqual(budgets(), [1200, 1200, 1200, 1200]);
    assert.ok(net.modelCalls.every((c) => c.payload.max_tokens >= 1200));
  });

  test("[C-1504] usage_ledger gets one llm_tokens row for every attempt that spent tokens, the cut-off one included", async () => {
    await reseed([configRow({ params: { cost_per_mtok_in: 50, cost_per_mtok_out: 150 } })]);
    say(A, cut('{"a":', { prompt_tokens: 500, completion_tokens: 1200 }), modelReply('{"a": 1}', { usage: { prompt_tokens: 500, completion_tokens: 40 } }));
    const out = await askJSON("extract", PROMPT, { sessionId: SESSION });
    assert.deepEqual(out.usage, { in: 1000, out: 1240 });
    await flushTracking();
    const rows = fake.tables.usage_ledger;
    assert.equal(rows.length, 2);
    assert.deepEqual(
      rows.map((r) => ({ item: r.item, qty: r.qty, unit: r.unit, session_id: r.session_id, provider_ref: r.provider_ref })),
      [
        { item: "llm_tokens", qty: 1700, unit: "tokens", session_id: SESSION, provider_ref: A },
        { item: "llm_tokens", qty: 540, unit: "tokens", session_id: SESSION, provider_ref: A },
      ],
    );
    // Cents per million tokens from the row: 500 x 50 + 1200 x 150 = 0.205 cents, rounded up so a paid call is never free.
    assert.deepEqual(
      rows.map((r) => r.cost_cents),
      [1, 1],
    );

    // A :free slug costs nothing, whatever the role's rates.
    await reseed([configRow({ fallbacks: [], params: { cost_per_mtok_in: 50, cost_per_mtok_out: 150 } })]);
    say(A, status(503));
    say(HARD_FALLBACKS[0]!, status(503));
    say(HARD_FALLBACKS[1]!, modelReply('{"a": 1}', { usage: { prompt_tokens: 900, completion_tokens: 900 } }));
    await askJSON("extract", PROMPT);
    await flushTracking();
    assert.match(HARD_FALLBACKS[1]!, /:free$/);
    assert.deepEqual(
      fake.tables.usage_ledger.map((r) => [r.provider_ref, r.qty, r.cost_cents]),
      [[HARD_FALLBACKS[1], 1800, 0]],
    );
  });

  test("[C-1500] an object that opens and never closes is cut off whatever finish_reason says: more room on the same model, not a JSON-only retry", async () => {
    say(A, modelReply('{"need": "funeral", "people": ', { finishReason: "stop" }), { need: "funeral", people: 4 });
    const out = await askJSON("extract", PROMPT);
    assert.deepEqual(out.value, { need: "funeral", people: 4 });
    assert.deepEqual(models(), [A, A]);
    assert.deepEqual(budgets(), [1200, 2400]);
    assert.doesNotMatch(net.modelCalls[1]!.prompt, /Return JSON only/, "a size problem, not a format problem");

    // A list cut off part-way under the same misreported "stop" is a size problem too.
    say(A, modelReply('[{"f": "age 42"}, {"f": ', { finishReason: "stop" }), { facts: [{ f: "age 42" }, { f: "smoker" }] });
    assert.deepEqual((await askJSON("extract", PROMPT)).value, { facts: [{ f: "age 42" }, { f: "smoker" }] });
    assert.deepEqual(budgets().slice(-2), [1200, 2400]);
  });

  test("[C-1505] a deadline nearer than the retry needs throws DeadlineError before the retry is sent, and it reaches the job unchanged", async () => {
    // Inside a job attempt: 40 s left, the first call takes 20 s and comes back cut off.
    say(A, () => {
      clock.advance(20_000);
      return cut("{");
    });
    const job = { id: 7, worker: "w-test", deadlineAt: Date.now() + 40_000, attempt: 1 };
    await assert.rejects(
      jobCtx.run(job, () => askJSON("extract", PROMPT)),
      (e: unknown) => e instanceof DeadlineError && /out of time/.test((e as Error).message),
    );
    assert.deepEqual(models(), [A], "the retry that could not finish was never started");

    // The caller's own deadlineMs does the same outside a job.
    say(A, () => {
      clock.advance(20_000);
      return cut("{");
    });
    await assert.rejects(askJSON("extract", PROMPT, { deadlineMs: 40_000 }), DeadlineError);
    assert.deepEqual(models(), [A, A]);

    // And a deadline too near for even the first call sends nothing at all.
    await assert.rejects(askJSON("extract", PROMPT, { deadlineMs: 10_000 }), DeadlineError);
    assert.equal(net.modelCalls.length, 2);
  });

  test("[C-1506] the answer names the model that gave it, and so does its usage_ledger row", async () => {
    say(A, status(429));
    say(B, { a: 1 });
    const out = await askJSON("extract", PROMPT, { sessionId: SESSION });
    assert.equal(out.model, B);
    await flushTracking();
    // The 429 spent no tokens, so the one row is the answering call's.
    assert.deepEqual(
      fake.tables.usage_ledger.map((r) => r.provider_ref),
      [B],
    );
  });
});

describe("models: a different model, not a wait", () => {
  beforeEach(() => setup());
  afterEach(teardown);

  test("[C-1507] a 429 from the primary goes to the first fallbacks entry immediately: no sleep", async () => {
    say(A, status(429, '{"error":{"message":"rate limited upstream"}}'));
    say(B, { a: 1 });
    const before = clock.now();
    const t0 = performance.now();
    const out = await askJSON("extract", PROMPT);
    assert.ok(performance.now() - t0 < 250, "no backoff between the primary and the fallback");
    assert.equal(clock.now(), before);
    assert.deepEqual(models(), [A, B]);
    assert.equal(out.model, B);
  });

  test("[C-1508] a 5xx goes to the first fallbacks entry immediately", async () => {
    for (const code of [500, 502, 503, 504]) {
      net.modelCalls.length = 0;
      say(A, status(code));
      say(B, { code });
      const t0 = performance.now();
      const out = await askJSON("extract", PROMPT);
      assert.ok(performance.now() - t0 < 250);
      assert.deepEqual(models(), [A, B], `after ${code}`);
      assert.deepEqual(out.value, { code });
    }
  });

  test("[C-1509] a network error goes to the first fallbacks entry immediately", async () => {
    say(A, () => {
      throw new TypeError("fetch failed");
    });
    say(B, { a: 1 });
    const t0 = performance.now();
    const out = await askJSON("extract", PROMPT);
    assert.ok(performance.now() - t0 < 250);
    assert.deepEqual(models(), [A, B]);
    assert.equal(out.model, B);
    // OpenRouter's HTTP 200 with an error object inside is the same as a 5xx.
    say(A, jsonResponse({ error: { message: "provider returned error", code: 502 } }));
    say(B, { a: 2 });
    assert.deepEqual((await askJSON("extract", PROMPT)).value, { a: 2 });
  });

  test("[C-1509] a bug in our own request code keeps its words and goes to no other model; a provider's unreadable answer still moves on", async (t) => {
    const logged = t.mock.method(console, "log", () => {});
    // A value JSON cannot carry, in the request we build: our bug, before anything is sent.
    const cfg = await loadModelConfig("extract");
    cfg.params.reasoning = { budget: 10n };
    try {
      await assert.rejects(askJSON("extract", PROMPT), (e: unknown) => e instanceof TypeError && /BigInt/.test(e.message));
    } finally {
      delete cfg.params.reasoning;
    }
    assert.equal(net.modelCalls.length, 0, "nothing sent, and no fallback asked to hide it");
    assert.ok(
      logged.mock.calls.some((c) => /model bug \[extract\].*BigInt/.test(c.arguments.join(" "))),
      "the log line says what went wrong",
    );
    await flushTracking();
    const [incident] = incidents("model_call_failed");
    assert.ok(incident, "the failure is on the record");
    assert.match(String(incident.summary), /BigInt/, "with its words, not relabelled network");

    // HTTP 200 whose body is not an object: the provider failed, and another model may not.
    say(A, new Response("null", { status: 200, headers: { "Content-Type": "application/json" } }));
    say(B, { a: 3 });
    assert.deepEqual((await askJSON("extract", PROMPT)).value, { a: 3 });
    assert.deepEqual(models(), [A, B]);
  });

  test("[C-1510] when the row's own model and every configured fallback fail, HARD_FALLBACKS are tried in order", async () => {
    say(A, status(429));
    say(B, status(503));
    say(C, status(429));
    say(HARD_FALLBACKS[0]!, status(502));
    say(HARD_FALLBACKS[1]!, { a: 1 });
    const out = await askJSON("extract", PROMPT);
    assert.deepEqual(models(), [A, B, C, HARD_FALLBACKS[0], HARD_FALLBACKS[1]]);
    assert.equal(out.model, HARD_FALLBACKS[1]);
    // A model named twice (the row repeats a last resort) is tried once.
    await reseed([configRow({ fallbacks: [HARD_FALLBACKS[0], B] })]);
    otherwise = () => status(503);
    await assert.rejects(askJSON("extract", PROMPT), ModelUnavailable);
    assert.deepEqual(models(), [A, HARD_FALLBACKS[0], B, ...HARD_FALLBACKS.slice(1)]);
  });

  test("[C-1510] a 402 from a paid model skips the paid models left and runs on the :free last resorts, with no credit incident when one answers", async () => {
    // The free stack on a congested day: the row's model and its fallbacks are
    // rate-limited, the first last resort is paid, and the account has no credit.
    assert.doesNotMatch(HARD_FALLBACKS[0]!, /:free$/);
    assert.match(HARD_FALLBACKS[1]!, /:free$/);
    say(A, status(429));
    say(B, status(429));
    say(C, status(429));
    say(HARD_FALLBACKS[0]!, status(402, '{"error":{"message":"Insufficient credits"}}'));
    say(HARD_FALLBACKS[1]!, { a: 1 });
    const out = await askJSON("extract", PROMPT, { sessionId: SESSION });
    assert.deepEqual(out.value, { a: 1 });
    assert.equal(out.model, HARD_FALLBACKS[1]);
    assert.deepEqual(models(), [A, B, C, HARD_FALLBACKS[0], HARD_FALLBACKS[1]]);
    await flushTracking();
    assert.equal(incidents("openrouter_credit").length, 0, "a free model answered: nobody needs paging");
    assert.equal(fake.tables.safety_events.at(-1)!.detail.reason, "credit");

    // A 402 from the row's own paid model: B, C and the paid last resort would
    // be refused the same way, so they are not sent; the free ones are.
    say(A, status(402));
    say(HARD_FALLBACKS[1]!, { a: 2 });
    net.modelCalls.length = 0;
    assert.deepEqual((await askJSON("extract", PROMPT)).value, { a: 2 });
    assert.deepEqual(models(), [A, HARD_FALLBACKS[1]]);
  });

  test("[C-1510] after a 402, when no free model answers either, the critical openrouter_credit incident is raised; a 402 on a :free model stops the chain", async () => {
    say(A, status(402));
    otherwise = () => status(503);
    await assert.rejects(askJSON("extract", PROMPT), (e: unknown) => e instanceof ModelUnavailable && e.kind === "credit");
    assert.deepEqual(models(), [A, ...HARD_FALLBACKS.filter((m) => m.endsWith(":free"))]);
    await flushTracking();
    const [incident, ...rest] = incidents("openrouter_credit");
    assert.equal(rest.length, 0);
    assert.equal(incident!.severity, "critical");
    assert.equal(incident!.count, 1);

    // A 402 for a :free model means the balance is below zero: every model on the account is refused.
    const FREE = "test/model-a:free";
    await reseed([configRow({ model: FREE })]);
    say(FREE, status(402));
    await assert.rejects(askJSON("extract", PROMPT), (e: unknown) => e instanceof ModelUnavailable && e.kind === "credit");
    assert.deepEqual(models(), [FREE]);
    await flushTracking();
    assert.equal(incidents("openrouter_credit").length, 1);
  });

  test("[C-1511] when every model fails, ModelUnavailable is thrown out of the job, so the queue retries it", async () => {
    otherwise = () => status(503);
    const job = { id: 8, worker: "w-test", deadlineAt: Date.now() + 240_000, attempt: 1 };
    await assert.rejects(jobCtx.run(job, () => askJSON("extract", PROMPT)), (e: unknown) => {
      assert.ok(e instanceof ModelUnavailable);
      assert.equal(e.role, "extract");
      assert.equal(e.tries, 3 + HARD_FALLBACKS.length);
      assert.deepEqual(e.models, [A, B, C, ...HARD_FALLBACKS]);
      return true;
    });
    assert.deepEqual(models(), [A, B, C, ...HARD_FALLBACKS]);
  });

  test("[C-1512] a 400 is our bug: no fallback, and ModelBadRequest carries the body excerpt", async () => {
    say(A, status(400, '{"error":{"message":"messages[0].content must be a string"}}'));
    await assert.rejects(askJSON("extract", PROMPT), (e: unknown) => {
      assert.ok(e instanceof ModelBadRequest);
      assert.equal(e.status, 400);
      assert.equal(e.model, A);
      assert.match(e.message, /messages\[0\]\.content must be a string/);
      return true;
    });
    assert.deepEqual(models(), [A]);
  });

  test("[C-1513] a 401 raises the critical incident openrouter_credential and tries no fallback", async () => {
    say(A, status(401, '{"error":{"message":"No auth credentials found"}}'));
    await assert.rejects(askJSON("extract", PROMPT), (e: unknown) => e instanceof ModelUnavailable && e.kind === "auth");
    assert.deepEqual(models(), [A]);
    await flushTracking();
    const [incident, ...rest] = incidents("openrouter_credential");
    assert.equal(rest.length, 0);
    assert.equal(incident!.severity, "critical");
    assert.equal(incident!.fingerprint, "openrouter_credential");
    // The provider's body can echo the request; the incident keeps only the status.
    assert.doesNotMatch(String(incident!.summary), /No auth credentials/);

    // No key at all is the same incident, and nothing is sent.
    await setEnv({ OPENROUTER_API_KEY: undefined });
    try {
      await assert.rejects(askJSON("extract", PROMPT), ModelUnavailable);
      assert.equal(net.modelCalls.length, 1);
      await flushTracking();
      assert.equal(incidents("openrouter_credential")[0]!.count, 2);
    } finally {
      await setEnv(TEST_ENV);
    }
  });

  test("[C-1514] a fallback that answers leaves safety_events(check=model_fallback) with detail.from and detail.to", async () => {
    say(A, { a: 1 });
    await askJSON("extract", PROMPT, { sessionId: SESSION });
    await flushTracking();
    assert.equal(fake.tables.safety_events.length, 0, "the configured model answered: nothing to note");

    say(A, status(503));
    say(B, { a: 2 });
    await askJSON("extract", PROMPT, { sessionId: SESSION });
    await flushTracking();
    assert.equal(fake.tables.safety_events.length, 1);
    const [ev] = fake.tables.safety_events;
    assert.equal(ev!.check, "model_fallback");
    assert.equal(ev!.session_id, SESSION);
    assert.equal(ev!.engine, "rules");
    assert.equal(ev!.outcome, "flag");
    assert.equal(ev!.detail.from, A);
    assert.equal(ev!.detail.to, B);
    assert.equal(ev!.detail.role, "extract");
    assert.equal(ev!.detail.reason, "upstream");
  });
});

describe("models: JSON that arrives untidy", () => {
  beforeEach(() => setup());
  afterEach(teardown);

  test("[C-1515] a reply wrapped in ```json fences is unwrapped", async () => {
    say(A, '```json\n{"need": "funeral", "people": 4}\n```');
    assert.deepEqual((await askJSON("extract", PROMPT)).value, { need: "funeral", people: 4 });
    assert.deepEqual(extractJSON("```\n{\"a\": 1}\n```"), { a: 1 });
    assert.equal(net.modelCalls.length, 1);
  });

  test("[C-1516] trailing commas are repaired, and a comma inside a string is left alone", async () => {
    say(A, '{"needs": ["life", "funeral",], "note": "R 1,}",}');
    assert.deepEqual((await askJSON("extract", PROMPT)).value, { needs: ["life", "funeral"], note: "R 1,}" });
    assert.deepEqual(extractJSON('{"a": {"b": 1,},}'), { a: { b: 1 } });
    assert.equal(net.modelCalls.length, 1);
  });

  test("[C-1517] prose before the JSON: the first balanced object is extracted, braces inside strings included", async () => {
    say(A, 'Sure! Here are the facts: {"a": {"b": "a } in a string"}} — and a second thought {"c": 2}');
    assert.deepEqual((await askJSON("extract", PROMPT)).value, { a: { b: "a } in a string" } });
    assert.deepEqual(extractJSON('noise {not json} then {"ok": true}'), { ok: true });
    assert.equal(extractJSON("no object here"), null);
    assert.equal(extractJSON('{"never": "closed"'), null);
  });

  test("[C-1517] a top-level list is rejected, as Charlie's extractJSON did, never cut down to its first object", async () => {
    assert.equal(extractJSON('[{"fact": "age 42"}, {"fact": "smoker"}]'), null);
    assert.equal(extractJSON('```json\n[{"fact": "age 42"}, {"fact": "smoker"}]\n```'), null);
    assert.equal(extractJSON('Here are the facts: [{"fact": "age 42"}, {"fact": "smoker"}]'), null);
    // A bracket in the prose that closes before the object is prose.
    assert.deepEqual(extractJSON('See note [1]: {"a": 1}'), { a: 1 });
    // An object that holds lists is what the layer is for.
    assert.deepEqual(extractJSON('{"facts": [{"f": 1}, {"f": 2}]}'), { facts: [{ f: 1 }, { f: 2 }] });

    // Through askJSON: unreadable, so the JSON-only retry, then the step fails. Never half the facts.
    const list = '[{"fact": "age 42"}, {"fact": "smoker"}]';
    say(A, list, list);
    await assert.rejects(askJSON("extract", PROMPT), (e: unknown) => e instanceof ModelUnavailable && e.kind === "bad_output");
    assert.deepEqual(models(), [A, A]);
    assert.ok(net.modelCalls[1]!.prompt.endsWith(JSON_ONLY));
  });

  test("[C-1515] only a fence that opens or closes the reply is removed: a fence inside a quoted string is left as the client said it", () => {
    assert.deepEqual(extractJSON('{"quote": "he typed ```js here"}'), { quote: "he typed ```js here" });
    assert.deepEqual(extractJSON('```json\n{"quote": "a ``` b"}\n```'), { quote: "a ``` b" });
    assert.deepEqual(extractJSON('```\n{"a": 1}\n```'), { a: 1 });
    assert.deepEqual(extractJSON('Sure:\n```json\n{"a": 1}\n```\nAnything else?'), { a: 1 });
  });

  test(`[C-1518] unrepairable output gets one retry with "Return JSON only" appended, then fails without a fallback`, async () => {
    say(A, "I'm sorry, I can't produce that.", "Still not JSON.");
    await assert.rejects(askJSON("extract", PROMPT), (e: unknown) => e instanceof ModelUnavailable && e.kind === "bad_output");
    assert.deepEqual(models(), [A, A]);
    const [first, second] = net.modelCalls;
    assert.doesNotMatch(first!.prompt, /Return JSON only/);
    assert.ok(second!.prompt.startsWith(PROMPT));
    assert.ok(second!.prompt.endsWith(JSON_ONLY));
    assert.match(JSON_ONLY, /^Return JSON only/);

    // The retry that does return JSON is the answer.
    say(A, "nope", { a: 1 });
    assert.deepEqual((await askJSON("extract", PROMPT)).value, { a: 1 });
    assert.deepEqual(models(), [A, A, A, A]);
  });

  test("[C-1519] response_format json_object is sent when the row's params.json_mode is true, and otherwise not", async () => {
    await reseed([configRow({ params: { json_mode: true } }), configRow({ role: "needs" })]);
    say(A, { a: 1 }, { a: 2 });
    await askJSON("extract", PROMPT);
    await askJSON("needs", PROMPT);
    const [withMode, without] = net.modelCalls;
    assert.deepEqual(withMode!.payload.response_format, { type: "json_object" });
    assert.equal("response_format" in without!.payload, false);
  });

  test("[C-1519][C-1512] a 400 that names response_format is retried once on the same model without it; any other 400 is still our bug", async () => {
    await reseed([configRow({ params: { json_mode: true } })]);
    const refused = () => status(400, '{"error":{"message":"response_format json_object is not supported by this model"}}');
    const rf = (i: number) => net.modelCalls[i]!.payload.response_format;
    say(A, refused(), { a: 1 });
    const out = await askJSON("extract", PROMPT);
    assert.deepEqual(out.value, { a: 1 });
    assert.equal(out.model, A);
    assert.deepEqual(models(), [A, A], "the same model again, not a fallback");
    assert.deepEqual(rf(0), { type: "json_object" });
    assert.equal(rf(1), undefined);

    // Dropped for that model only: the next one in the chain is asked with it again.
    net.modelCalls.length = 0;
    say(A, refused(), status(503));
    say(B, { a: 2 });
    assert.deepEqual((await askJSON("extract", PROMPT)).value, { a: 2 });
    assert.deepEqual(models(), [A, A, B]);
    assert.deepEqual([rf(0), rf(1), rf(2)], [{ type: "json_object" }, undefined, { type: "json_object" }]);

    // Once only, and only for a 400 about response_format.
    net.modelCalls.length = 0;
    say(A, refused(), refused());
    await assert.rejects(askJSON("extract", PROMPT), ModelBadRequest);
    assert.deepEqual(models(), [A, A]);
    net.modelCalls.length = 0;
    say(A, status(400, '{"error":{"message":"messages[0].content must be a string"}}'));
    await assert.rejects(askJSON("extract", PROMPT), ModelBadRequest);
    assert.deepEqual(models(), [A]);
  });

  test("[C-1520] a reply the schema rejects (a required key missing) is unrepairable: one retry, then failure", async () => {
    const hasAge = (x: unknown): x is { age: number } => typeof (x as { age?: unknown } | null)?.age === "number";
    say(A, { name: "Thandi" }, { age: 42 });
    const out = await askJSON("extract", PROMPT, { schema: hasAge });
    assert.equal(out.value.age, 42);
    assert.ok(net.modelCalls[1]!.prompt.endsWith(JSON_ONLY));

    say(A, { name: "Thandi" }, { still: "no age" });
    await assert.rejects(askJSON("extract", PROMPT, { schema: hasAge }), (e: unknown) => e instanceof ModelUnavailable && e.kind === "bad_output");
    assert.deepEqual(models(), [A, A, A, A]);
  });
});

describe("models: model_config decides, never code", () => {
  afterEach(teardown);

  test("[C-1521] a row with enabled=false goes straight to its fallbacks, with a role_disabled incident once a day", async () => {
    setup([configRow({ role: "writer", model: A, fallbacks: [B], enabled: false }), configRow({ role: "checker", model: A, fallbacks: [], enabled: false })]);
    say(B, { a: 1 }, { a: 2 }, { a: 3 });
    await askJSON("writer", PROMPT);
    await askJSON("writer", PROMPT);
    assert.deepEqual(models(), [B, B], "the disabled row's own model is never called");
    await flushTracking();
    assert.equal(incidents("role_disabled").length, 1);
    assert.equal(incidents("role_disabled")[0]!.count, 1, "the second call the same day raises nothing");
    assert.equal(incidents("role_disabled")[0]!.fingerprint, "role_disabled:writer");

    clock.advance(24 * 60 * 60_000);
    await askJSON("writer", PROMPT);
    await flushTracking();
    assert.equal(incidents("role_disabled")[0]!.count, 2, "a day later it is raised again");

    // A disabled row with no fallbacks of its own goes to the last resorts.
    say(HARD_FALLBACKS[0]!, { a: 4 });
    await askJSON("checker", PROMPT);
    assert.equal(models().at(-1), HARD_FALLBACKS[0]);
  });

  test("[C-1522] a missing row runs on HARD_FALLBACKS and raises role_missing", async () => {
    setup([configRow()]);
    say(HARD_FALLBACKS[0]!, "A short summary.");
    const out = await askText("summary", "Summarise the call.");
    assert.equal(out.value, "A short summary.");
    assert.deepEqual(models(), [HARD_FALLBACKS[0]]);
    await flushTracking();
    const [incident] = incidents("role_missing");
    assert.ok(incident, "role_missing raised");
    assert.equal(incident.fingerprint, "role_missing:summary");
    // And the safety note says the role ran on a last resort.
    assert.equal(fake.tables.safety_events[0]!.detail.reason, "role_missing");
    assert.equal(fake.tables.safety_events[0]!.detail.from, null);
  });

  test("[C-1523] an unreadable model_config runs on HARD_FALLBACKS and raises a critical incident; the failure is not cached", async () => {
    setup([configRow()]);
    fake.failTable("model_config");
    say(HARD_FALLBACKS[0]!, { a: 1 });
    await askJSON("extract", PROMPT);
    assert.deepEqual(models(), [HARD_FALLBACKS[0]]);
    await flushTracking();
    const [incident] = incidents("model_config_unreadable");
    assert.ok(incident, "the incident is raised");
    assert.equal(incident.severity, "critical");

    // The table comes back: the very next call reads it.
    fake.failTable("model_config", null);
    say(A, { a: 2 });
    await askJSON("extract", PROMPT);
    assert.equal(models().at(-1), A);
  });

  test("[C-1524] params.temperature is passed through; without it the temperature is 0.2", async () => {
    setup([configRow({ params: { temperature: 0.7 } }), configRow({ role: "needs" })]);
    say(A, { a: 1 }, { a: 2 });
    await askJSON("extract", PROMPT);
    await askJSON("needs", PROMPT);
    assert.deepEqual(
      net.modelCalls.map((c) => c.payload.temperature),
      [0.7, 0.2],
    );
  });

  test("[C-1525] the config is cached for at most 60 s, so an UPDATE is live within a minute", async () => {
    setup([configRow()]);
    say(A, { a: 1 }, { a: 2 });
    say(B, { a: 3 });
    const reads = () => fake.log.filter((q) => q.table === "model_config" && q.op === "select").length;

    await askJSON("extract", PROMPT);
    assert.equal((await loadModelConfig("extract")).model, A);
    assert.equal(reads(), 1);

    fake.tables.model_config[0]!.model = B;
    clock.advance(59_999);
    await askJSON("extract", PROMPT);
    assert.equal(models().at(-1), A, "still the cached row");
    assert.equal(reads(), 1);

    clock.advance(1);
    await askJSON("extract", PROMPT);
    assert.equal(models().at(-1), B, "60 s after the read, the UPDATE is live");
    assert.equal(reads(), 2);
  });
});

describe("models: what reaches the record (track.ts, as the model layer uses it)", () => {
  beforeEach(() => setup());
  afterEach(teardown);

  test("[C-1512] a provider's 400 body is surfaced in the error and nowhere else: not in errorText, a failed job's incident, or a crashed request's", async () => {
    // A provider's error can echo the request, and in Call the request is a client's health and money.
    const ECHO = "the client said her daughter Thandi has epilepsy";
    say(A, status(400, JSON.stringify({ error: { message: `invalid content: ${ECHO}` } })));
    const err = await askJSON("extract", PROMPT).catch((e: unknown) => e);
    assert.ok(err instanceof ModelBadRequest);
    assert.match(err.message, /Thandi/, "the caller still sees the provider's words (C-1512)");

    assert.equal(errorText(err), `ModelBadRequest: 400 (${A}) for extract`);
    // The queue's failed-job incident and last_error (Task 0.4) go through errorText, as does any trackFailure.
    trackFailure("job_failed", err);
    const crash = tracked("worker", "system", async () => {
      throw err;
    });
    await assert.rejects(crash(new Request("https://call.test/api/worker")), ModelBadRequest);
    await flushTracking();
    assert.ok(incidents("job_failed")[0], "the failed job is on the record");
    assert.ok(incidents("request_crashed")[0], "so is the crashed request");
    assert.doesNotMatch(JSON.stringify(fake.tables.incidents), /Thandi|epilepsy|invalid content/);
  });

  // No criterion of its own: what keeps a failed held write (intel.ts registers
  // its flusher's promise here from Task 0.6) from crashing the process.
  test("a held write that rejects is never an unhandled rejection, and the flush still finishes", async () => {
    const seen: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      seen.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    try {
      holdForFlush(Promise.reject(new Error("held write failed")));
      await flushTracking();
      await new Promise((r) => setImmediate(r));
      assert.deepEqual(seen, []);
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});

// Transcription for in-person meetings. C-1327 (owned by test/transcribe.test.ts,
// Task 10.x) is the job's half; these pin the routing the job relies on, untagged.
describe("models: transcribeAudio routes on the voice row's provider", () => {
  beforeEach(() => setup());
  afterEach(teardown);
  const AUDIO = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3]);
  const field = (form: { name: string }[] | null, name: string) => form?.find((e) => e.name === name) as { value?: string; bytes?: Uint8Array; type?: string } | undefined;

  test("provider openrouter: the OpenRouter audio endpoint, the namespaced slug, the same key as every model call", async () => {
    await reseed([configRow({ role: "voice", provider: "openrouter", model: "test/whisper-a", fallbacks: [] })]);
    net.onFetch(/openrouter\.ai\/api\/v1\/audio\/transcriptions/, () => ({ text: "  Ja, I want funeral cover for four people. " }));
    const out = await transcribeAudio(AUDIO, "audio/webm;codecs=opus");
    assert.equal(out.text, "Ja, I want funeral cover for four people.");
    assert.equal(out.model, "test/whisper-a");
    const [call] = net.calls;
    assert.equal(call!.url, "https://openrouter.ai/api/v1/audio/transcriptions");
    assert.equal(call!.headers.authorization, "Bearer test-openrouter-key");
    assert.equal(field(call!.form, "model")!.value, "test/whisper-a");
    assert.deepEqual(field(call!.form, "file")!.bytes, AUDIO);
    assert.equal(field(call!.form, "file")!.type, "audio/webm;codecs=opus");
    assert.equal(net.modelCalls.length, 0, "no chat call");
  });

  test("provider groq or openai: routed direct, bare model id, verbose_json segments and language back", async () => {
    for (const [provider, url, key] of [
      ["groq", "https://api.groq.com/openai/v1/audio/transcriptions", "Bearer test-groq-key"],
      ["openai", "https://api.openai.com/v1/audio/transcriptions", "Bearer test-openai-key"],
    ] as const) {
      await reseed([configRow({ role: "voice", provider, model: "test/whisper-b", fallbacks: [] })]);
      net.onFetch(/audio\/transcriptions/, () => ({
        text: "Hello. I am forty two.",
        language: "english",
        duration: 3.2,
        segments: [
          { start: 0, end: 1.1, text: " Hello." },
          { start: 1.1, end: 3.2, text: " I am forty two." },
        ],
      }));
      const out = await transcribeAudio(AUDIO, "audio/webm");
      assert.equal(net.calls[0]!.url, url);
      assert.equal(net.calls[0]!.headers.authorization, key);
      assert.equal(field(net.calls[0]!.form, "model")!.value, "whisper-b");
      assert.equal(field(net.calls[0]!.form, "response_format")!.value, "verbose_json");
      assert.deepEqual(out.segments, [
        { start: 0, end: 1.1, text: "Hello." },
        { start: 1.1, end: 3.2, text: "I am forty two." },
      ]);
      assert.equal(out.language, "english");
    }
  });

  test("a 400 on verbose_json is retried plain; a disabled or missing voice row sends nothing and throws ModelUnavailable", async () => {
    await reseed([configRow({ role: "voice", provider: "groq", model: "whisper-c", fallbacks: [] })]);
    let n = 0;
    net.onFetch(/api\.groq\.com/, () => (++n === 1 ? new Response('{"error":"response_format"}', { status: 400 }) : { text: "plain" }));
    assert.equal((await transcribeAudio(AUDIO, "audio/webm")).text, "plain");
    assert.equal(field(net.calls[1]!.form, "response_format"), undefined);

    await reseed([configRow({ role: "voice", provider: "openrouter", model: "test/whisper-a", fallbacks: [], enabled: false })]);
    await assert.rejects(transcribeAudio(AUDIO, "audio/webm"), (e: unknown) => e instanceof ModelUnavailable && e.kind === "role_disabled");
    assert.equal(net.calls.length, 0);

    // HARD_FALLBACKS are chat models: a missing voice row has no last resort that can hear.
    await reseed([configRow()]);
    await assert.rejects(transcribeAudio(AUDIO, "audio/webm"), (e: unknown) => e instanceof ModelUnavailable && e.kind === "role_missing");
    assert.equal(net.calls.length, 0);
  });
});
