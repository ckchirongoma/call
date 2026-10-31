// Call — /api/health, the skeleton (Task 0.5): what is configured, read from
// the environment alone, and the keep-alive ping.
//
// Task 11.2 completes it: guardrails_live from the engines, the job, webhook,
// catalogue and limit counts, the database check folded into `ok`, and the
// detailed form behind WORKER_SECRET. Those criteria (C-1530 to C-1534, C-1536,
// C-1538, C-1540) are proved there, not here.

// Must be first: api/_lib/env.ts snapshots process.env when it is first imported.
import "./_env.ts";
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { TEST_ENV, setEnv } from "./_env.ts";
import { installFakeDb, type FakeDb } from "./_fakes.ts";
import { __setClient } from "../api/_lib/db.ts";
import { GET } from "../api/health.ts";

/** Call the handler the way Vercel does: a Web Request in, a Web Response out. */
async function get(path = "/api/health") {
  const res = await GET(new Request(`https://call.test${path}`));
  const text = await res.text();
  return { status: res.status, headers: res.headers, text, body: JSON.parse(text) as Record<string, any> };
}

// Which settings each service needs, written out here and not imported from the
// handler, so a wrong mapping in the handler cannot agree with itself.
const NEEDS: Record<string, string[]> = {
  supabase: ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  elevenlabs_webhook: ["ELEVENLABS_WEBHOOK_SECRET"],
  voice_tools: ["VOICE_TOOL_SECRET"],
  resend: ["RESEND_API_KEY"],
  whatsapp: ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_APP_SECRET"],
  jev: ["TYPESAFE_API_KEY"],
};
const SERVICE_NAMES = Object.keys(NEEDS).sort();
const JEV_KEY = "test-jev-key";
const SHA_BEFORE = process.env.VERCEL_GIT_COMMIT_SHA;

let fake: FakeDb | null = null;

afterEach(async () => {
  fake?.uninstall();
  fake = null;
  if (SHA_BEFORE === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
  else process.env.VERCEL_GIT_COMMIT_SHA = SHA_BEFORE;
  await setEnv(TEST_ENV);
});

describe("GET /api/health", () => {
  test("[C-1529] says ok, and whether each of the seven services is configured, from the environment alone", async () => {
    fake = installFakeDb();
    await setEnv({ TYPESAFE_API_KEY: JEV_KEY });

    const all = await get();
    assert.equal(all.status, 200);
    assert.equal(all.body.ok, true);
    assert.deepEqual(Object.keys(all.body.services).sort(), SERVICE_NAMES);
    for (const name of SERVICE_NAMES) assert.equal(all.body.services[name], "configured", name);
    assert.match(all.headers.get("content-type") ?? "", /^application\/json/);
    assert.equal(all.headers.get("cache-control"), "no-store");
    // No guardrail engine exists yet (the checkers arrive in Tasks 4.3 and 6.2): said plainly, never implied (R13).
    assert.equal(all.body.guardrails_live, false);
    assert.equal(fake.log.length, 0, "the full form reads the environment only in this task; the database is Task 11.2's");

    // Take away one setting at a time: only the service that needs it goes unconfigured.
    for (const [service, names] of Object.entries(NEEDS)) {
      for (const name of names) {
        await setEnv({ ...TEST_ENV, TYPESAFE_API_KEY: JEV_KEY, [name]: undefined });
        const { body } = await get();
        for (const other of SERVICE_NAMES) {
          assert.equal(body.services[other], other === service ? "unconfigured" : "configured", `${name} unset: services.${other}`);
        }
      }
    }

    // Nothing but the two words, whatever is set.
    await setEnv(Object.fromEntries(Object.keys(TEST_ENV).map((k) => [k, undefined])));
    const none = await get();
    for (const name of SERVICE_NAMES) assert.equal(none.body.services[name], "unconfigured", name);

    // `ok` is the required settings (the first block of .env.example); an optional service missing does not clear it.
    await setEnv({ ...TEST_ENV, ELEVENLABS_WEBHOOK_SECRET: undefined, VOICE_TOOL_SECRET: undefined, RESEND_API_KEY: undefined, WHATSAPP_ACCESS_TOKEN: undefined });
    assert.equal((await get()).body.ok, true);
    for (const name of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "OPENROUTER_API_KEY", "WORKER_SECRET", "PUBLIC_BASE_URL", "SESSION_SECRET"]) {
      await setEnv({ ...TEST_ENV, [name]: undefined });
      const missing = await get();
      assert.equal(missing.body.ok, false, `${name} unset`);
      assert.equal(missing.status, 503, `${name} unset`);
      assert.equal(missing.body.required_missing, 1, `${name} unset`);
    }
  });

  test("[C-1535] ?ping=1 runs one cheap select against the database and answers {ok:true} in under 100 ms", async (t) => {
    const warn = t.mock.method(console, "warn", () => {});
    fake = installFakeDb();
    const started = performance.now();
    const ping = await get("/api/health?ping=1");
    const elapsed = performance.now() - started;
    assert.equal(ping.status, 200);
    assert.deepEqual(ping.body, { ok: true });
    assert.ok(elapsed < 100, `ping took ${elapsed.toFixed(1)} ms`);
    assert.equal(fake.log.length, 1, "exactly one query");
    assert.equal(fake.log[0]!.op, "select");
    assert.equal(fake.log[0]!.table, "model_config");
    assert.deepEqual(fake.log[0]!.filters, [], "no filter: nothing for the database to search");

    // The keep-alive cron (Task 11.1) reads this answer, so a failed query is a failure, not a quiet 200.
    const restore = __setClient({
      from: () => ({ select: () => ({ limit: async () => ({ data: null, error: { message: "connection refused" } }) }) }),
    } as never);
    try {
      const down = await get("/api/health?ping=1");
      assert.equal(down.status, 503);
      assert.deepEqual(down.body, { ok: false });
      assert.match(String(warn.mock.calls.at(-1)?.arguments.join(" ")), /ping query failed connection refused/, "and the logs say why");
    } finally {
      restore();
    }

    // And Supabase not configured at all: db() throws; the ping answers, it does not crash.
    const noClient = __setClient(null);
    try {
      await setEnv({ SUPABASE_URL: undefined });
      const unconfigured = await get("/api/health?ping=1");
      assert.equal(unconfigured.status, 503);
      assert.deepEqual(unconfigured.body, { ok: false });
    } finally {
      noClient();
    }
  });

  test("[C-1537] never shows a secret, a setting's value, or anything that depends on its length", async () => {
    fake = installFakeDb();
    await setEnv({ TYPESAFE_API_KEY: JEV_KEY });
    const values = Object.values({ ...TEST_ENV, TYPESAFE_API_KEY: JEV_KEY }).filter((v): v is string => typeof v === "string");
    for (const path of ["/api/health", "/api/health?ping=1"]) {
      const { text } = await get(path);
      for (const value of values) assert.ok(!text.includes(value), `${path} shows the value ${JSON.stringify(value)}`);
    }

    // The same settings set to one character and to 300 characters give the
    // same answer, byte for byte: nothing in it depends on a value or its length.
    const every = (fill: (name: string) => string) =>
      Object.fromEntries(Object.keys({ ...TEST_ENV, TYPESAFE_API_KEY: JEV_KEY }).map((k) => [k, fill(k)]));
    await setEnv(every(() => "x"));
    const short = (await get()).text;
    await setEnv(every((k) => `${k.toLowerCase()}-`.padEnd(300, "y")));
    const long = (await get()).text;
    assert.equal(long, short);
    assert.doesNotMatch(long, /yyyy/);
    assert.doesNotMatch(long, /\b300\b/, "no length of a setting appears");
  });

  test("[C-1539] version is the git SHA from VERCEL_GIT_COMMIT_SHA, or \"dev\" when it is not set", async () => {
    const sha = "4f1c2e9a0b7d3c5e6f8a9b0c1d2e3f4a5b6c7d8e";
    process.env.VERCEL_GIT_COMMIT_SHA = sha;
    assert.equal((await get()).body.version, sha);
    delete process.env.VERCEL_GIT_COMMIT_SHA;
    assert.equal((await get()).body.version, "dev");
    process.env.VERCEL_GIT_COMMIT_SHA = "   ";
    assert.equal((await get()).body.version, "dev");
  });
});
