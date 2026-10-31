// Call — telling a human (api/_lib/alerts.ts), the email sender it and the
// pipeline share (api/_lib/email.ts), and the incident record underneath both
// (api/_lib/track.ts).
//
// Incidents are counted rows (one per fingerprint, count, first_at, last_at)
// whatever happens to email: with ALERT_EMAIL_TO unset, or TRACKING_OFF=1,
// nothing is sent and nothing is marked sent, and the first email once alerts
// can go carries everything that waited. Task 11.3 completes the thresholds
// (the digest, the daily summary, signature failures, free-tier warnings).
//
// The suite runs with TRACKING_OFF=1, which switches alert emails and
// self-calls off; a test that needs either sets TRACKING_OFF=0 and the
// afterEach puts it back.

// Must be first: api/_lib/env.ts snapshots process.env when it is first imported.
import "./_env.ts";
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { fakeClock, installFakeDb, installFakeNet, jsonResponse, type FakeClock, type FakeDb, type FakeNet, type FetchCall } from "./_fakes.ts";
import { TEST_ENV, setEnv } from "./_env.ts";
import * as queue from "../api/_lib/queue.ts";
import { IMMEDIATE_GAP_MS, SAME_PROBLEM_COOLDOWN_MS, runAlerts } from "../api/_lib/alerts.ts";
import { SANDBOX_FROM, alertRecipients, alertsConfigured, sendEmail, sendEmailTo } from "../api/_lib/email.ts";
import { currentTrackContext, flushTracking, onTrack, setTrackContext, track, trackFailure, tracked, withTrackContext } from "../api/_lib/track.ts";
import { GET as health } from "../api/health.ts";

const BROKER = "00000000-0000-4000-8000-0000000000b1";
const S1 = "5e550001-0000-4000-8000-000000000001";
const S2 = "5e550002-0000-4000-8000-000000000002";
const MIN = 60_000;

type Row = Record<string, any>;

let fake: FakeDb;
let clock: FakeClock;
let net: FakeNet;
let emails: FetchCall[];
const trackingWas = process.env.TRACKING_OFF;

const incidents = (kind: string): Row[] => fake.tables.incidents.filter((r) => r.kind === kind);
const alertRows = (): Row[] => fake.tables.audit_log.filter((r) => r.action === "alert_email_sent");
/** Answer Resend with a 200 and keep each email. */
const acceptEmail = (): void => {
  net.onFetch("api.resend.com/emails", (call) => {
    emails.push(call);
    return jsonResponse({ id: `email-${emails.length}` });
  });
};

/** A job that fails its third and last attempt now: job_failed, as the queue raises it. */
async function failJob(kind: queue.JobKind, sessionId: string, message = "the step is broken"): Promise<void> {
  queue.registerHandler(kind, async () => {
    throw new Error(message);
  });
  const id = await queue.enqueue(kind, sessionId, {});
  const row = fake.tables.jobs.find((j) => String(j.id) === id)!;
  row.attempts = queue.MAX_ATTEMPTS - 1;
  const report = await queue.drain({ maxJobs: 1, noHandOn: true });
  assert.equal(report.failed, 1);
  assert.equal(row.status, "failed");
  await flushTracking();
}

beforeEach(() => {
  clock = fakeClock("2026-10-31T08:00:00.000Z");
  fake = installFakeDb({ sessions: [S1, S2].map((id) => ({ id, broker_id: BROKER, mode: "call", provider: "elevenlabs" })) });
  net = installFakeNet();
  emails = [];
});

afterEach(async () => {
  await flushTracking();
  queue.__resetHandlers();
  net.restore();
  fake.uninstall();
  clock.restore();
  if (trackingWas === undefined) delete process.env.TRACKING_OFF;
  else process.env.TRACKING_OFF = trackingWas;
  await setEnv(TEST_ENV);
});

// ── The immediate email ──────────────────────────────────────────

describe("alerts: the immediate email", () => {
  test("[C-1541] a job failed after 3 attempts sends an immediate alert email, at most one every 5 minutes", async () => {
    process.env.TRACKING_OFF = "0";
    acceptEmail();
    assert.equal(IMMEDIATE_GAP_MS, 5 * MIN);

    // Three real attempts through the queue, with its backoff.
    queue.registerHandler("extract_facts", async () => {
      throw new Error("the extractor is down");
    });
    await queue.enqueue("extract_facts", S1, {});
    await queue.drain({ maxJobs: 1, noHandOn: true });
    clock.advance(10_000);
    await queue.drain({ maxJobs: 1, noHandOn: true });
    clock.advance(60_000);
    await queue.drain({ maxJobs: 1, noHandOn: true });
    await flushTracking();
    assert.equal(incidents("job_failed").length, 1);

    const first = await runAlerts();
    assert.equal(first.immediate, 1);
    assert.equal(emails.length, 1);
    const sent = emails[0]!.json as Row;
    assert.deepEqual(sent.to, ["ops@example.test"], "to ALERT_EMAIL_TO, and nobody else");
    assert.match(sent.subject, /^\[Call\] Error: /);
    assert.match(sent.text, /extract facts job failed 3 times/);
    assert.match(sent.html, /<table role="presentation"/);
    assert.equal(alertRows().length, 1, "the email is on the record, with what it carried");
    assert.deepEqual(Object.keys(alertRows()[0]!.after.incidents), ["job_failed:extract_facts"]);

    // Another job fails a minute later: inside the window, so no second email yet.
    clock.advance(1 * MIN);
    await failJob("write_quote", S2);
    assert.equal((await runAlerts()).immediate, 0);
    assert.equal(emails.length, 1, "one email per 5 minutes");

    // Five minutes after the first: one email, with only what is new.
    clock.advance(4 * MIN);
    assert.equal((await runAlerts()).immediate, 1);
    assert.equal(emails.length, 2);
    const second = emails[1]!.json as Row;
    assert.match(second.text, /write quote job failed 3 times/);
    assert.doesNotMatch(second.text, /extract facts/, "a problem already sent, and not grown, is not sent again");
  });

  test("[C-1550] a repeated fingerprint adds to count and moves last_at; no new email inside the window, and the same problem not again for 30 minutes", async () => {
    process.env.TRACKING_OFF = "0";
    acceptEmail();
    assert.equal(SAME_PROBLEM_COOLDOWN_MS, 30 * MIN);
    const fail = () =>
      trackFailure("delivery_failed", new Error("Resend 422 validation_error"), { severity: "error", fingerprint: "delivery_failed:email", summary: "A quotation email was refused by Resend" });

    fail();
    await flushTracking();
    const [row] = incidents("delivery_failed");
    assert.equal(row!.count, 1);
    const firstAt = row!.first_at;
    assert.equal((await runAlerts()).immediate, 1);

    clock.advance(1 * MIN);
    fail();
    await flushTracking();
    assert.equal(incidents("delivery_failed").length, 1, "one row per fingerprint");
    assert.equal(row!.count, 2, "count increments");
    assert.equal(row!.last_at, clock.iso(), "last_at moves");
    assert.equal(row!.first_at, firstAt, "first_at stays");
    assert.equal((await runAlerts()).immediate, 0, "inside the 5-minute window");

    clock.advance(5 * MIN);
    assert.equal((await runAlerts()).immediate, 0, "the same problem is not re-sent within 30 minutes");
    assert.equal(emails.length, 1);

    clock.advance(25 * MIN);
    assert.equal((await runAlerts()).immediate, 1, "30 minutes on, and it grew since the last email: sent again");
    assert.match((emails[1]!.json as Row).text, /2 in total/);

    clock.advance(31 * MIN);
    assert.equal((await runAlerts()).immediate, 0, "not grown since: nothing to say");
    assert.equal(emails.length, 2);
  });

  test("[C-1548] with ALERT_EMAIL_TO unset, alerts are incidents only, nothing is sent, and health says alerts: unconfigured", async () => {
    process.env.TRACKING_OFF = "0";
    acceptEmail();
    await setEnv({ ALERT_EMAIL_TO: undefined });
    assert.equal(alertsConfigured(), false);

    await failJob("check_quote", S1);
    assert.equal(incidents("job_failed").length, 1, "recorded");
    const report = await runAlerts();
    assert.equal(report.immediate, 0);
    assert.match(String(report.skipped), /not configured/);
    assert.equal(net.calls.length, 0, "nothing sent");
    assert.equal(alertRows().length, 0, "nothing marked sent");

    const unconfigured = await (await health(new Request("https://call.test/api/health"))).json();
    assert.equal(unconfigured.alerts, "unconfigured");
    await setEnv({ ...TEST_ENV, RESEND_API_KEY: undefined });
    assert.equal((await (await health(new Request("https://call.test/api/health"))).json()).alerts, "unconfigured", "no Resend key: unconfigured too");

    await setEnv(TEST_ENV);
    assert.equal((await (await health(new Request("https://call.test/api/health"))).json()).alerts, "configured");
    // The first pass once alerts can go carries what waited.
    assert.equal((await runAlerts()).immediate, 1);
    assert.match((emails[0]!.json as Row).text, /check quote job failed/);
  });

  test("[C-1552] with TRACKING_OFF=1 there are no emails and no self-calls, but incidents are still rows", async () => {
    process.env.TRACKING_OFF = "1";
    // Everything an email or a self-call needs is configured: only TRACKING_OFF stops them.
    assert.equal(alertsConfigured(), true);
    queue.registerHandler("ingest_transcript", async () => {});
    queue.registerHandler("notify_broker", async () => {
      throw new Error("the step is broken");
    });
    const id = await queue.enqueue("notify_broker", S1, {});
    fake.tables.jobs.find((j) => String(j.id) === id)!.attempts = queue.MAX_ATTEMPTS - 1;
    await queue.enqueue("ingest_transcript", S2, {}, { runAfter: new Date(clock.now() + 20_000) }); // work left for a hand-on
    // A drain that did work and leaves work due within the minute: with tracking on, it would hand on.
    const report = await queue.drain({ maxJobs: 1 });
    assert.equal(report.failed, 1);
    await flushTracking();

    assert.equal(incidents("job_failed").length, 1, "the incident is a row");
    const alerts = await runAlerts();
    assert.equal(alerts.immediate, 0);
    assert.match(String(alerts.skipped), /TRACKING_OFF/);
    assert.equal(await queue.kickWorker("test"), false);
    assert.deepEqual(net.calls.map((c) => c.url), [], "no email, no self-call");
  });

  test("a failed send is not marked sent: the next pass after the window tries again", async () => {
    process.env.TRACKING_OFF = "0";
    let refuse = true;
    net.onFetch("api.resend.com/emails", (call) => {
      emails.push(call);
      return refuse ? new Response('{"message":"down"}', { status: 503 }) : jsonResponse({ id: "email-ok" });
    });
    await failJob("send_quote", S1);
    assert.equal((await runAlerts()).immediate, 0);
    assert.equal(alertRows().length, 0);
    await flushTracking();
    assert.equal(incidents("alert_email_failed").length, 1);
    assert.equal(incidents("alert_email_failed")[0]!.severity, "warn", "never an error: a failing alert must not alert about itself");
    refuse = false;
    clock.advance(1 * MIN);
    assert.equal((await runAlerts()).immediate, 1, "no window was started by an email that did not go");
  });
});

// ── email.ts: the sender ─────────────────────────────────────────

describe("email.ts: sending through Resend", () => {
  const MSG = { subject: "Your quotation from Demo Brokers", text: "Hello", html: "<p>Hello</p>" };

  test("sendEmailTo posts once to Resend with the address list, sender, reply-to, attachments as base64 and the idempotency key", async () => {
    acceptEmail();
    const res = await sendEmailTo({
      ...MSG,
      to: ["client@example.test"],
      fromName: "Demo Brokers via Call",
      replyTo: "broker@example.test",
      attachments: [{ filename: "quotation-2026-10-31.pdf", content: Buffer.from("%PDF-1.7 demo") }],
      idempotencyKey: "quote:abc:v1",
    });
    assert.deepEqual(res, { ok: true, id: "email-1", status: 200, sandbox: false });
    assert.equal(emails.length, 1);
    const call = emails[0]!;
    assert.equal(call.url, "https://api.resend.com/emails");
    assert.equal(call.method, "POST");
    assert.equal(call.headers.authorization, "Bearer test-resend-key");
    assert.equal(call.headers["idempotency-key"], "quote:abc:v1");
    assert.deepEqual(call.json, {
      from: "Demo Brokers via Call <quotes@example.test>",
      to: ["client@example.test"],
      subject: MSG.subject,
      html: MSG.html,
      text: MSG.text,
      reply_to: "broker@example.test",
      attachments: [{ filename: "quotation-2026-10-31.pdf", content: Buffer.from("%PDF-1.7 demo").toString("base64") }],
    });
  });

  test("with QUOTE_EMAIL_FROM unset the sender is Resend's sandbox address, and the result says so", async () => {
    acceptEmail();
    await setEnv({ QUOTE_EMAIL_FROM: undefined });
    const res = await sendEmailTo({ ...MSG, to: ["client@example.test"], fromName: "Demo Brokers via Call" });
    assert.equal(res.sandbox, true);
    assert.equal((emails[0]!.json as Row).from, `Demo Brokers via Call <${SANDBOX_FROM}>`);
    assert.equal(SANDBOX_FROM, "onboarding@resend.dev");
  });

  test("without RESEND_API_KEY nothing is sent: skipped, 'email not configured'; an invalid address is never sent", async () => {
    await setEnv({ RESEND_API_KEY: undefined });
    assert.deepEqual(await sendEmailTo({ ...MSG, to: ["client@example.test"] }), { ok: false, skipped: true, error: "email not configured" });
    await setEnv(TEST_ENV);
    for (const to of [[], ["not-an-address"], ["client@example.test", "two@@example.test"], ["client@example.test\r\nBcc: x@example.test"]]) {
      const res = await sendEmailTo({ ...MSG, to });
      assert.equal(res.ok, false, JSON.stringify(to));
      assert.equal(res.error, "invalid_address");
    }
    assert.equal(net.calls.length, 0);
  });

  test("a 4xx is final, a 429 / 5xx / network failure is retryable, and no address ever reaches an error or the console", async (t) => {
    const lines: string[] = [];
    for (const m of ["log", "warn", "error", "info"] as const) t.mock.method(console, m, (...args: unknown[]) => void lines.push(args.map(String).join(" ")));
    const answers: (() => Response)[] = [
      () => jsonResponse({ name: "validation_error", message: "Invalid `to` field: client@example.test is not allowed" }, 422),
      () => jsonResponse({ message: "rate limited" }, 429),
      () => jsonResponse({ message: "internal" }, 500),
      () => {
        throw new TypeError("fetch failed: getaddrinfo ENOTFOUND for client@example.test");
      },
    ];
    net.onFetch("api.resend.com/emails", () => answers.shift()!());
    const send = () => sendEmailTo({ ...MSG, to: ["client@example.test"], replyTo: "broker@example.test" });

    const refused = await send();
    assert.deepEqual({ ok: refused.ok, status: refused.status, retryable: refused.retryable }, { ok: false, status: 422, retryable: false });
    assert.match(String(refused.error), /^Resend 422: /);
    for (const status of [429, 500]) {
      const res = await send();
      assert.deepEqual({ ok: res.ok, status: res.status, retryable: res.retryable }, { ok: false, status, retryable: true });
    }
    const down = await send();
    assert.equal(down.retryable, true);
    assert.match(String(down.error), /^Resend unreachable/);
    const everything = JSON.stringify([refused, down]) + lines.join("\n");
    assert.doesNotMatch(everything, /@example\.test/, "no address in a result or a log line");
  });

  test("sendEmail is the alert email: to every valid address in ALERT_EMAIL_TO", async () => {
    acceptEmail();
    await setEnv({ ALERT_EMAIL_TO: "ops@example.test, not-an-address ,oncall@example.test" });
    assert.deepEqual(alertRecipients(), ["ops@example.test", "oncall@example.test"]);
    const res = await sendEmail({ subject: "[Call] Error: x", text: "x", html: "<p>x</p>" });
    assert.equal(res.ok, true);
    assert.deepEqual((emails[0]!.json as Row).to, ["ops@example.test", "oncall@example.test"]);
    await setEnv({ ALERT_EMAIL_TO: "nobody" });
    assert.equal(alertsConfigured(), false, "no valid address is not configured");
    assert.deepEqual(await sendEmail({ subject: "s", text: "t", html: "h" }), { ok: false, skipped: true, error: "email not configured" });
  });
});

// ── track.ts: the record underneath ──────────────────────────────

describe("track.ts: events and incidents", () => {
  test("the context an entry point opens reaches every event inside it, merged over the outer one", async () => {
    const seen: { name: string; session: unknown; job: unknown; channel: unknown }[] = [];
    onTrack((name, _opts, ctx) => {
      if (name.startsWith("ctx_test")) seen.push({ name, session: ctx.sessionId, job: ctx.jobId, channel: ctx.channel });
    });
    onTrack((name) => {
      if (name === "ctx_test_throw") throw new Error("a listener that breaks");
    });
    await withTrackContext({ sessionId: S1, channel: "phone" }, async () => {
      track("ctx_test_outer");
      await withTrackContext({ jobId: 7, channel: "system" }, async () => {
        setTrackContext({ stage: "extract" });
        assert.equal(currentTrackContext().stage, "extract");
        track("ctx_test_inner");
        track("ctx_test_throw"); // never throws into the caller
      });
    });
    assert.deepEqual(seen, [
      { name: "ctx_test_outer", session: S1, job: undefined, channel: "phone" },
      { name: "ctx_test_inner", session: S1, job: 7, channel: "system" },
      { name: "ctx_test_throw", session: S1, job: 7, channel: "system" },
    ]);
  });

  test("repeats of one problem are one incident; a different error is another; a warning with alert 'none' is not an incident, a failure always is", async () => {
    trackFailure("model_timeout", new Error("timed out after 1234ms on request 9f1c2a7b0d"));
    trackFailure("model_timeout", new Error("timed out after 87ms on request 33aa77bb1c"));
    trackFailure("model_timeout", new TypeError("fetch failed"));
    track("slow_page", { category: "performance", severity: "warn", alert: "none" });
    track("odd_failure", { category: "failure", alert: "none" });
    await flushTracking();
    const timeouts = incidents("model_timeout");
    assert.equal(timeouts.length, 2, "grouped by event name and error class or normalised message");
    assert.deepEqual(timeouts.map((r) => r.count).sort(), [1, 2]);
    assert.equal(incidents("slow_page").length, 0);
    assert.equal(incidents("odd_failure").length, 1);
  });

  test("an incident's summary never holds an email address or a phone number", async () => {
    trackFailure("delivery_failed", new Error("Resend refused client@example.test (+27 79 993 0001)"));
    await flushTracking();
    const [row] = incidents("delivery_failed");
    assert.doesNotMatch(row!.summary, /@|993/);
    assert.match(row!.summary, /\[email\]/);
  });

  test("tracked(): a 5xx answer is a request_failed incident, a crash a critical request_crashed, a health check no event at all", async () => {
    const names: string[] = [];
    onTrack((name) => void names.push(name));
    const fails = tracked("tracktest", "system", async () => new Response("no", { status: 500 }));
    assert.equal((await fails(new Request("https://call.test/api/tracktest?token=abc"))).status, 500);
    const crashes = tracked("tracktest2", "system", async () => {
      throw new Error("handler blew up");
    });
    await assert.rejects(crashes(new Request("https://call.test/api/tracktest2")), /handler blew up/);
    await tracked("health", "system", async () => new Response("ok"))(new Request("https://call.test/api/health"));
    await flushTracking();
    assert.equal(incidents("request_failed")[0]!.fingerprint, "request_failed:tracktest:500");
    assert.equal(incidents("request_crashed")[0]!.severity, "critical");
    assert.equal(names.filter((n) => n === "http_request").length, 2, "health checks are not traffic");
  });
});
