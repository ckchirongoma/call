// Call — the fakes are infrastructure, so this file carries NO criteria tag.
// (C-1580, "created_at on every table", is a migrations criterion and belongs to
// Task 1.1's test/rls.test.ts.) What it pins is the contract every later test
// leans on: the fake database answers like Supabase for the shapes we use and
// REFUSES the shapes it does not know, because a fake that quietly accepts a
// query it cannot really run makes a broken test pass.

// Must be first: api/_lib/env.ts snapshots process.env when it is first imported.
import "./_env.ts";
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FakeDbUnsupported,
  fakeClock,
  fakeStorage,
  installFakeDb,
  installFakeNet,
  modelReply,
  type FakeDb,
  type FakeNet,
} from "./_fakes.ts";
import { TEST_ENV, setEnv } from "./_env.ts";
import { env, reloadEnv, required } from "../api/_lib/env.ts";
import { __setClient, db } from "../api/_lib/db.ts";

/** The rows of a successful list query. */
const rowsOf = (res: { data: unknown; error: unknown }): any[] => {
  assert.equal(res.error, null);
  assert.ok(Array.isArray(res.data), "expected a list of rows");
  return res.data as any[];
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** The call throws FakeDbUnsupported, and the message names the shape (matches `re`). */
const refused = (fn: () => unknown, re: RegExp): void => {
  assert.throws(fn, (e: unknown) => {
    assert.ok(e instanceof FakeDbUnsupported, `expected FakeDbUnsupported, got ${String(e)}`);
    assert.match(e.message, re);
    return true;
  });
};

describe("fake database", () => {
  let fake: FakeDb;
  beforeEach(() => {
    fake = installFakeDb();
  });
  afterEach(() => fake.uninstall());

  const addBroker = async (name = "Demo Broker"): Promise<string> => {
    const { data, error } = await db().from("brokers").insert({ name, fsp_number: "FSP 00000" }).select().single();
    assert.equal(error, null);
    return data.id;
  };

  test("db() returns the fake client while installed, and not after", () => {
    assert.equal(db(), fake.client);
    fake.uninstall();
    assert.notEqual(db(), fake.client);
  });

  test("a brokers row is inserted with its defaults and selected back", async () => {
    const { data: inserted, error } = await db().from("brokers").insert({ name: "Demo Broker", fsp_number: "FSP 00000" }).select().single();
    assert.equal(error, null);
    assert.match(inserted.id, UUID);
    assert.ok(inserted.created_at);
    // R12: the human stays in the loop unless the broker switches auto_send on.
    assert.equal(inserted.auto_send, false);
    assert.equal(inserted.country, "ZA");
    assert.equal(inserted.retention_days, 30);

    const { data, error: readError } = await db().from("brokers").select("*").eq("id", inserted.id).single();
    assert.equal(readError, null);
    assert.equal(data.name, "Demo Broker");
    assert.equal(fake.tables.brokers!.length, 1);
  });

  test("a write without .select() returns no data, as supabase-js does", async () => {
    const res = await db().from("brokers").insert({ name: "Demo Broker" });
    assert.equal(res.error, null);
    assert.equal(res.data, null);
  });

  test("upsert with onConflict broker_id,phone_e164 twice yields one clients row", async () => {
    const broker_id = await addBroker();
    const row = { broker_id, phone_e164: "+27799930001", first_name: "Thandi" };
    const a = await db().from("clients").upsert(row, { onConflict: "broker_id,phone_e164" }).select().single();
    const b = await db().from("clients").upsert({ ...row, first_name: "Thandi M" }, { onConflict: "broker_id,phone_e164" }).select().single();
    assert.equal(a.error, null);
    assert.equal(b.error, null);
    assert.equal(fake.tables.clients!.length, 1);
    assert.equal(a.data.id, b.data.id);
    assert.equal(fake.tables.clients![0]!.first_name, "Thandi M");
  });

  test("upsert on columns with no unique constraint is refused, as Postgres refuses it", async () => {
    assert.throws(
      () => db().from("clients").upsert({ first_name: "x" }, { onConflict: "first_name" }),
      (e: unknown) => e instanceof FakeDbUnsupported && /first_name/.test((e as Error).message),
    );
  });

  test("walk-in clients with no phone number never conflict with each other", async () => {
    const broker_id = await addBroker();
    await db().from("clients").insert({ broker_id, phone_e164: null, first_name: "Walk-in one" });
    const second = await db().from("clients").insert({ broker_id, phone_e164: null, first_name: "Walk-in two" });
    assert.equal(second.error, null);
    assert.equal(fake.tables.clients!.length, 2);
  });

  test("a duplicate on a unique key is a 23505 error and writes nothing (webhook dedupe)", async () => {
    const event = { provider: "elevenlabs", event_type: "post_call_transcription", external_id: "conv_demo_1", signature_ok: true, raw: {} };
    const first = await db().from("webhook_events").insert(event);
    const second = await db().from("webhook_events").insert(event);
    assert.equal(first.error, null);
    assert.equal(second.error?.code, "23505");
    assert.equal(fake.tables.webhook_events!.length, 1);
    // A different event type for the same conversation is a different event.
    const audio = await db().from("webhook_events").insert({ ...event, event_type: "post_call_audio" });
    assert.equal(audio.error, null);
    assert.equal(fake.tables.webhook_events!.length, 2);
  });

  test("unsupported shapes throw FakeDbUnsupported naming the shape", () => {
    assert.throws(
      () => db().from("clients").select("*").textSearch("first_name", "thandi"),
      (e: unknown) => e instanceof FakeDbUnsupported && /textSearch/.test((e as Error).message) && /clients/.test((e as Error).message),
    );
    assert.throws(() => db().from("clients").select("*").ilike("first_name", "%t%"), FakeDbUnsupported);
    assert.throws(() => db().from("clients").select("*").or("a.eq.1,b.eq.2"), FakeDbUnsupported);
    // Embedded resources are a join the fake does not do.
    assert.throws(() => db().from("sessions").select("*, turns(*)"), (e: unknown) => e instanceof FakeDbUnsupported && /sessions/.test((e as Error).message));
    assert.throws(() => db().from("not_a_table"), (e: unknown) => e instanceof FakeDbUnsupported && /not_a_table/.test((e as Error).message));
    assert.throws(() => db().rpc("no_such_function", {}), (e: unknown) => e instanceof FakeDbUnsupported && /no_such_function/.test((e as Error).message));
    assert.throws(() => (db() as any).auth, (e: unknown) => e instanceof FakeDbUnsupported && /auth/.test((e as Error).message));
  });

  test("an unfiltered update or delete is refused rather than run on every row", async () => {
    await db().from("brokers").insert({ name: "Demo Broker" });
    await assert.rejects(async () => {
      await db().from("brokers").update({ name: "x" });
    }, FakeDbUnsupported);
    await assert.rejects(async () => {
      await db().from("brokers").delete();
    }, FakeDbUnsupported);
    assert.equal(fake.tables.brokers![0]!.name, "Demo Broker");
  });

  test("filters, ordering, limit, single and maybeSingle behave like PostgREST", async () => {
    const session_id = "00000000-0000-4000-8000-0000000000aa";
    for (let idx = 0; idx < 5; idx++) {
      await db().from("turns").insert({ session_id, idx, role: idx % 2 ? "client" : "agent", text: `line ${idx}`, t_start_secs: idx * 10 });
    }
    await db().from("turns").insert({ session_id: "00000000-0000-4000-8000-0000000000bb", idx: 0, role: "agent", text: "other session" });

    const mine = await db().from("turns").select("idx,text").eq("session_id", session_id).order("idx", { ascending: false }).limit(3);
    assert.deepEqual(rowsOf(mine).map((r) => r.idx), [4, 3, 2]);
    // select("idx,text") projects: columns not asked for are not there.
    assert.deepEqual(Object.keys(rowsOf(mine)[0]).sort(), ["idx", "text"]);

    const range = await db().from("turns").select("idx").eq("session_id", session_id).gte("t_start_secs", 10).lt("t_start_secs", 40).order("idx");
    assert.deepEqual(rowsOf(range).map((r) => r.idx), [1, 2, 3]);

    const inSet = await db().from("turns").select("idx").eq("session_id", session_id).in("role", ["client"]).order("idx");
    assert.deepEqual(rowsOf(inSet).map((r) => r.idx), [1, 3]);

    const nulls = await db().from("turns").select("idx").eq("session_id", "00000000-0000-4000-8000-0000000000bb").is("t_start_secs", null);
    assert.equal(rowsOf(nulls).length, 1);

    const one = await db().from("turns").select("*").eq("session_id", session_id).eq("idx", 2).single();
    assert.equal(one.data.text, "line 2");
    const none = await db().from("turns").select("*").eq("session_id", session_id).eq("idx", 99).maybeSingle();
    assert.deepEqual({ data: none.data, error: none.error }, { data: null, error: null });
    const missing = await db().from("turns").select("*").eq("session_id", session_id).eq("idx", 99).single();
    assert.equal(missing.error?.code, "PGRST116");
    const many = await db().from("turns").select("*").eq("session_id", session_id).maybeSingle();
    assert.equal(many.error?.code, "PGRST116");
  });

  test("update().eq and delete().eq/in change only the matching rows", async () => {
    const ids: string[] = [];
    for (const name of ["A", "B", "C"]) {
      const { data } = await db().from("brokers").insert({ name }).select().single();
      ids.push(data.id);
    }
    const upd = await db().from("brokers").update({ auto_send: true }).eq("id", ids[0]!).select();
    assert.equal(rowsOf(upd).length, 1);
    assert.deepEqual(fake.tables.brokers!.map((b) => b.auto_send), [true, false, false]);

    await db().from("brokers").delete().in("id", [ids[1]!, ids[2]!]);
    assert.deepEqual(fake.tables.brokers!.map((b) => b.name), ["A"]);
    await db().from("brokers").delete().eq("id", ids[0]!);
    assert.equal(fake.tables.brokers!.length, 0);
  });

  test("log records each executed query's table, op, filters and written rows", async () => {
    const broker_id = await addBroker();
    await db().from("clients").insert({ broker_id, phone_e164: "+27799930002", first_name: "Sipho" });
    await db().from("clients").select("*").eq("broker_id", broker_id).is("forgotten_at", null);
    await db().from("clients").update({ first_name: "Sipho M" }).eq("phone_e164", "+27799930002");

    const clientQueries = fake.log.filter((q) => q.table === "clients");
    assert.deepEqual(clientQueries.map((q) => q.op), ["insert", "select", "update"]);
    assert.equal(clientQueries[0]!.rows![0]!.first_name, "Sipho");
    assert.deepEqual(clientQueries[1]!.filters, [
      { kind: "eq", column: "broker_id", value: broker_id },
      { kind: "is", column: "forgotten_at", value: null },
    ]);
    assert.deepEqual(clientQueries[2]!.rows, [{ first_name: "Sipho M" }]);
    assert.deepEqual(clientQueries[2]!.filters, [{ kind: "eq", column: "phone_e164", value: "+27799930002" }]);

    fake.reset();
    assert.equal(fake.log.length, 0);
    assert.equal(fake.tables.clients!.length, 0);
  });

  test("seed rows are copied in, so a test cannot mutate its own fixture", async () => {
    const seed = { brokers: [{ id: "00000000-0000-4000-8000-000000000001", name: "Seeded" }] };
    fake.uninstall();
    fake = installFakeDb(seed);
    await db().from("brokers").update({ name: "Changed" }).eq("id", seed.brokers[0]!.id);
    assert.equal(seed.brokers[0]!.name, "Seeded");
    assert.equal(fake.tables.brokers![0]!.name, "Changed");
    assert.throws(() => installFakeDb({ nope: [{}] }), FakeDbUnsupported);
  });

  test("the client can be returned from an async function (awaiting it must not trip the unsupported-shape guard)", async () => {
    const viaAsync = async () => db();
    assert.equal(await viaAsync(), fake.client);
  });

  test("neq and not() leave out NULLs, as SQL does; other not() operators are refused", async () => {
    const broker_id = await addBroker();
    for (const [i, first_name] of ["Thandi", "Sipho", null].entries()) {
      await db().from("clients").insert({ broker_id, phone_e164: `+2779993010${i}`, first_name });
    }
    const names = async (q: PromiseLike<{ data: unknown; error: unknown }>) => rowsOf(await q).map((r) => r.first_name).sort();
    assert.deepEqual(await names(db().from("clients").select("first_name").neq("first_name", "Thandi")), ["Sipho"]);
    assert.deepEqual(await names(db().from("clients").select("first_name").not("first_name", "eq", "Thandi")), ["Sipho"]);
    assert.deepEqual(await names(db().from("clients").select("first_name").not("first_name", "is", null)), ["Sipho", "Thandi"]);
    assert.throws(() => db().from("clients").select("*").not("first_name", "like", "T%"), FakeDbUnsupported);
  });

  test("gt, lte, range, count/head and NULL ordering", async () => {
    const session_id = "00000000-0000-4000-8000-0000000000cc";
    for (let idx = 0; idx < 5; idx++) {
      await db().from("turns").insert({ session_id, idx, role: "client", text: `t${idx}`, t_start_secs: idx === 2 ? null : idx });
    }
    const idxs = (res: { data: unknown; error: unknown }) => rowsOf(res).map((r) => r.idx);
    assert.deepEqual(idxs(await db().from("turns").select("idx").eq("session_id", session_id).gt("idx", 3)), [4]);
    assert.deepEqual(idxs(await db().from("turns").select("idx").eq("session_id", session_id).lte("idx", 1).order("idx")), [0, 1]);
    assert.deepEqual(idxs(await db().from("turns").select("idx").eq("session_id", session_id).order("idx").range(1, 2)), [1, 2]);

    // Ascending puts NULLs last, descending puts them first (the Postgres default).
    assert.deepEqual(idxs(await db().from("turns").select("idx").eq("session_id", session_id).order("t_start_secs")), [0, 1, 3, 4, 2]);
    assert.deepEqual(idxs(await db().from("turns").select("idx").eq("session_id", session_id).order("t_start_secs", { ascending: false })), [2, 4, 3, 1, 0]);

    const counted = await db().from("turns").select("*", { count: "exact", head: true }).eq("session_id", session_id);
    assert.equal(counted.error, null);
    assert.equal(counted.count, 5);
    assert.equal(counted.data, null);
    const countedWithLimit = await db().from("turns").select("idx", { count: "exact" }).eq("session_id", session_id).limit(2);
    assert.equal(countedWithLimit.count, 5);
    assert.equal(rowsOf(countedWithLimit).length, 2);
  });

  test("a jsonb path filter (col->>key) matches the value as text", async () => {
    await db().from("jobs").insert([
      { kind: "send_quote", payload: { quote_id: "q1", attempt: 2 } },
      { kind: "send_quote", payload: { quote_id: "q2" } },
    ]);
    assert.equal(rowsOf(await db().from("jobs").select("id").eq("payload->>quote_id", "q1")).length, 1);
    assert.equal(rowsOf(await db().from("jobs").select("id").eq("payload->>attempt", "2")).length, 1);
    assert.equal(rowsOf(await db().from("jobs").select("id").is("payload->>attempt", null)).length, 1);
  });

  test("timestamps compare as instants, whatever offset they are written in", async () => {
    const clock = fakeClock("2026-10-31T08:00:00.000Z");
    try {
      await db().from("brokers").insert({ name: "Demo Broker" });
    } finally {
      clock.restore();
    }
    // 10:00 at +02:00 is 08:00Z, the instant the row was created.
    assert.equal(rowsOf(await db().from("brokers").select("id").gte("created_at", "2026-10-31T10:00:00+02:00")).length, 1);
    assert.equal(rowsOf(await db().from("brokers").select("id").lt("created_at", "2026-10-31T10:00:00+02:00")).length, 0);
  });

  test("upsert with ignoreDuplicates leaves the first row alone (webhook dedupe)", async () => {
    const event = { provider: "meta", event_type: "message", external_id: "wamid.demo1", signature_ok: true, raw: { n: 1 } };
    const onConflict = "provider,external_id,event_type";
    const first = await db().from("webhook_events").upsert(event, { onConflict, ignoreDuplicates: true }).select();
    const again = await db().from("webhook_events").upsert({ ...event, raw: { n: 2 } }, { onConflict, ignoreDuplicates: true }).select();
    assert.equal(rowsOf(first).length, 1);
    assert.equal(rowsOf(again).length, 0);
    assert.deepEqual(fake.tables.webhook_events![0]!.raw, { n: 1 });
  });

  test("a multi-row insert is all-or-nothing, and an update that breaks a unique key changes nothing", async () => {
    const broker_id = await addBroker();
    await db().from("clients").insert({ broker_id, phone_e164: "+27799930201" });
    const batch = await db().from("clients").insert([
      { broker_id, phone_e164: "+27799930202" },
      { broker_id, phone_e164: "+27799930201" }, // clashes with the existing row
    ]);
    assert.equal(batch.error?.code, "23505");
    assert.equal(fake.tables.clients!.length, 1);
    const sameBatch = await db().from("clients").insert([
      { broker_id, phone_e164: "+27799930203" },
      { broker_id, phone_e164: "+27799930203" }, // clashes with the row just before it
    ]);
    assert.equal(sameBatch.error?.code, "23505");
    assert.equal(fake.tables.clients!.length, 1);

    await db().from("sessions").insert([{ broker_id, conversation_id: "conv_a" }, { broker_id, conversation_id: "conv_b" }]);
    const clash = await db().from("sessions").update({ conversation_id: "conv_a" }).eq("conversation_id", "conv_b");
    assert.equal(clash.error?.code, "23505");
    assert.deepEqual(fake.tables.sessions!.map((r) => r.conversation_id), ["conv_a", "conv_b"]);
  });

  test("results are copies: changing one does not change the table", async () => {
    const { data } = await db().from("brokers").insert({ name: "Demo Broker" }).select().single();
    data.name = "Tampered";
    const again = await db().from("brokers").select("name").single();
    assert.equal(again.data?.name, "Demo Broker");
  });

  describe('rpc("claim_job")', () => {
    const job = (over: Record<string, unknown>) => ({ kind: "ingest_transcript", payload: {}, ...over });

    test("claims the oldest queued runnable job, marks it running, and returns nothing when none is left", async () => {
      const clock = fakeClock("2026-10-31T08:00:00.000Z");
      try {
        // Every row has the same keys: supabase-js sends a batch's union of keys, and PostgREST fills a gap with NULL.
        await db().from("jobs").insert([
          job({ dedupe_key: "later", run_after: "2026-10-31T08:01:30.000Z", status: "queued" }), // not runnable yet
          job({ dedupe_key: "second", run_after: "2026-10-31T07:30:00.000Z", status: "queued" }),
          job({ dedupe_key: "first", run_after: "2026-10-31T07:00:00.000Z", status: "queued" }),
          job({ dedupe_key: "done", run_after: "2026-10-31T06:00:00.000Z", status: "done" }),
        ]);

        const a = await db().rpc("claim_job", { p_worker: "w1" });
        assert.equal(a.error, null);
        assert.equal(a.data.length, 1);
        assert.equal(a.data[0].dedupe_key, "first");
        assert.equal(a.data[0].status, "running");
        assert.equal(a.data[0].attempts, 1);
        assert.equal(a.data[0].locked_by, "w1");
        assert.equal(typeof a.data[0].id, "number"); // bigint identity, not a uuid

        const b = await db().rpc("claim_job", { p_worker: "w2" });
        assert.equal(b.data[0].dedupe_key, "second");
        const c = await db().rpc("claim_job", { p_worker: "w3" });
        assert.deepEqual(c.data, []);

        // Time passing makes the future job runnable (the two running jobs are only 100 s into their lock).
        clock.advance(100_000);
        const d = await db().rpc("claim_job", { p_worker: "w4" });
        assert.equal(d.data[0].dedupe_key, "later");

        // A job whose worker died more than 120 s ago (queue.ts LOCK_TIMEOUT_MS) is claimable again, oldest first.
        clock.advance(20_000);
        assert.deepEqual((await db().rpc("claim_job", { p_worker: "w5" })).data, [], "exactly 120 s is not yet stale");
        clock.advance(1);
        const e = await db().rpc("claim_job", { p_worker: "w5" });
        assert.equal(e.data.length, 1);
        assert.equal(e.data[0].dedupe_key, "first");
        assert.equal(e.data[0].attempts, 2);
      } finally {
        clock.restore();
      }
    });

    test("never hands out a job ahead of an earlier queued or running job of its own session; other sessions and session-less jobs are not held", async () => {
      const clock = fakeClock("2026-10-31T08:00:00.000Z");
      try {
        const s1 = "00000000-0000-4000-8000-0000000000a1";
        const s2 = "00000000-0000-4000-8000-0000000000a2";
        await db().from("jobs").insert([
          job({ dedupe_key: "s1-first", session_id: s1, run_after: "2026-10-31T08:00:30.000Z" }), // not due yet, still first in line
          job({ dedupe_key: "s1-second", session_id: s1, run_after: "2026-10-31T07:00:00.000Z" }),
          job({ dedupe_key: "s2-first", session_id: s2, run_after: "2026-10-31T07:30:00.000Z" }),
          job({ dedupe_key: "s2-second", session_id: s2, run_after: "2026-10-31T07:00:00.000Z" }),
          job({ dedupe_key: "none", session_id: null, run_after: "2026-10-31T07:45:00.000Z" }),
        ]);
        const claim = async (w: string) => ((await db().rpc("claim_job", { p_worker: w })).data as any[]).map((r) => r.dedupe_key);
        assert.deepEqual(await claim("w1"), ["s2-first"], "s1-second and s2-second are behind their sessions' first jobs");
        assert.deepEqual(await claim("w2"), ["none"]);
        assert.deepEqual(await claim("w3"), [], "s2-second waits while s2-first runs");
        clock.advance(30_000);
        assert.deepEqual(await claim("w4"), ["s1-first"]);
        assert.deepEqual(await claim("w5"), []);
        // A finished (or failed, skipped, cancelled) earlier job holds nothing back.
        await db().from("jobs").update({ status: "failed" }).eq("dedupe_key", "s1-first");
        await db().from("jobs").update({ status: "done" }).eq("dedupe_key", "s2-first");
        assert.deepEqual((await claim("w6")).concat(await claim("w7")).sort(), ["s1-second", "s2-second"]);
      } finally {
        clock.restore();
      }
    });

    test("a job with the same dedupe_key is refused by the unique index", async () => {
      await db().from("jobs").insert(job({ dedupe_key: "ingest:conv_1" }));
      const again = await db().from("jobs").insert(job({ dedupe_key: "ingest:conv_1" }));
      assert.equal(again.error?.code, "23505");
      // No key, no conflict.
      assert.equal((await db().from("jobs").insert(job({}))).error, null);
      assert.equal((await db().from("jobs").insert(job({}))).error, null);
    });
  });

  describe('rpc("bump_incident")', () => {
    const bump = (p_fingerprint: string, p_severity: string, p_summary: string, p_kind = "model_call_failed") =>
      db().rpc("bump_incident", { p_fingerprint, p_kind, p_severity, p_summary });

    test("one row per fingerprint: a repeat counts, moves last_at, keeps the worst severity and the latest summary", async () => {
      const clock = fakeClock("2026-10-31T08:00:00.000Z");
      try {
        const first = await bump("model_call_failed:extract:rate", "warn", "first");
        assert.deepEqual({ data: first.data, error: first.error }, { data: null, error: null });
        clock.advance(60_000);
        await bump("model_call_failed:extract:rate", "error", "second");
        await bump("model_call_failed:extract:rate", "info", "third");
        await bump("openrouter_credential", "critical", "the key was refused", "openrouter_credential");

        const [one, two] = fake.tables.incidents;
        assert.equal(fake.tables.incidents.length, 2);
        assert.equal(one!.kind, "model_call_failed");
        assert.equal(one!.count, 3);
        assert.equal(one!.severity, "error", "an info repeat never downgrades an error");
        assert.equal(one!.summary, "third");
        assert.equal(one!.first_at, "2026-10-31T08:00:00.000Z");
        assert.equal(one!.last_at, "2026-10-31T08:01:00.000Z");
        assert.equal(two!.count, 1);
        assert.equal(two!.severity, "critical");
        assert.deepEqual(fake.log.filter((q) => q.op === "rpc").map((q) => q.fn), ["bump_incident", "bump_incident", "bump_incident", "bump_incident"]);
      } finally {
        clock.restore();
      }
    });

    test("it takes exactly its four text arguments, a severity outside the four is a check violation, and fingerprint is unique", async () => {
      // A misspelt or missing argument is PGRST202 in production.
      refused(() => db().rpc("bump_incident", { p_fingerprint: "x", p_kind: "k", p_severity: "warn" }), /p_fingerprint, p_kind, p_severity, p_summary/);
      refused(() => db().rpc("bump_incident", { p_fingerprint: "x", p_kind: "k", p_severity: "warn", p_summary: "s", p_alert: "digest" }), /p_alert/);
      refused(() => db().rpc("bump_incident", { p_fingerprint: null, p_kind: "k", p_severity: "warn", p_summary: "s" }), /text/);
      const loud = await bump("x", "loud", "s");
      assert.equal(loud.error?.code, "23514");
      assert.equal(fake.tables.incidents.length, 0);
      // A summary is cut to 500 characters, as the SQL's left(p_summary, 500).
      await bump("long", "warn", "y".repeat(600));
      assert.equal(String(fake.tables.incidents[0]!.summary).length, 500);
      // The fingerprint is the arbiter, so a direct insert of a second row for it is refused.
      const dup = await db().from("incidents").insert({ kind: "k", severity: "warn", summary: "", fingerprint: "long" });
      assert.equal(dup.error?.code, "23505");
    });
  });

  test("failTable(name) makes every query on that table answer with an error until failTable(name, null)", async () => {
    await addBroker();
    fake.failTable("model_config");
    const read = await db().from("model_config").select("role, model").eq("role", "extract").maybeSingle();
    assert.equal(read.data, null);
    assert.equal(read.error?.code, "42P01");
    assert.match(read.error!.message, /model_config/);
    const write = await db().from("model_config").insert({ role: "extract", provider: "openrouter", model: "demo/model" });
    assert.equal(write.error?.code, "42P01");
    assert.equal(fake.tables.model_config.length, 0, "nothing was written");
    // Other tables are untouched, and the query is still logged.
    assert.equal(rowsOf(await db().from("brokers").select("id")).length, 1);
    assert.equal(fake.log.filter((q) => q.table === "model_config").length, 2);

    fake.failTable("brokers", { code: "57014", message: "canceling statement due to statement timeout" });
    assert.equal((await db().from("brokers").select("id")).error?.code, "57014");

    fake.failTable("model_config", null);
    assert.equal((await db().from("model_config").select("role")).error, null);
    // reset() clears every switch.
    fake.reset();
    assert.equal((await db().from("brokers").select("id")).error, null);
  });
});

// Each test below is a query the fake used to answer when the real client
// would have refused it or answered differently, so a broken call site passed.
describe("fake database: refuses what Supabase would refuse", () => {
  let fake: FakeDb;
  beforeEach(() => {
    fake = installFakeDb();
  });
  afterEach(() => fake.uninstall());

  const addBroker = async (): Promise<string> => {
    const { data, error } = await db().from("brokers").insert({ name: "Demo Broker" }).select().single();
    assert.equal(error, null);
    return data.id;
  };

  test("a filter or order column is a known column or col->>key on a jsonb column; any other shape, or a typo, throws", async () => {
    await db().from("jobs").insert([
      { kind: "send_quote", payload: { quoteId: "q1" } },
      { kind: "send_quote", payload: { quoteId: "q2" } },
    ]);
    // JSON keys are case-sensitive, and camelCase is a legal key.
    assert.equal(rowsOf(await db().from("jobs").select("id").eq("payload->>quoteId", "q1")).length, 1);
    const ordered = await db().from("jobs").select("payload").order("payload->>quoteId", { ascending: false });
    assert.deepEqual(rowsOf(ordered).map((r) => r.payload.quoteId), ["q2", "q1"]);

    // `->` yields jsonb, not text: `is("payload->quote_id", null)` is true only where the key is absent. Not faked.
    refused(() => db().from("jobs").select("id").is("payload->quote_id", null), /payload->quote_id/);
    refused(() => db().from("jobs").select("id").order("payload->quote_id"), /payload->quote_id/);
    refused(() => db().from("jobs").select("id").eq("payload->a->>b", "x"), /payload->a->>b/);
    refused(() => db().from("jobs").select("id").eq("id::text", "1"), /id::text/);
    // ->> on a text column is an operator error in Postgres (42883), not "no rows".
    refused(() => db().from("jobs").select("id").eq("kind->>x", "y"), /kind->>x/);
    refused(() => db().from("jobs").select("id").eq("nope->>x", "y"), /nope/);

    // A typo is loud (PostgREST: 42703 / PGRST204), never "a missing column matches nothing".
    refused(() => db().from("jobs").select("id").is("lockd_at", null), /"lockd_at" is not a column of jobs/);
    refused(() => db().from("jobs").select("id").order("run_afer"), /run_afer/);
    refused(() => db().from("jobs").select("id").in("staus", ["queued"]), /staus/);
    refused(() => db().from("jobs").select("id").not("lockd_at", "is", null), /lockd_at/);
    refused(() => db().from("jobs").select("id,lockd_at"), /lockd_at/);
    refused(() => db().from("jobs").insert({ kind: "x", payload: {}, lockd_at: null }), /lockd_at/);
    refused(() => db().from("jobs").update({ lockd_at: null }).eq("id", 1), /lockd_at/);
    refused(() => db().from("jobs").upsert({ kind: "x", payload: {}, lockd_at: null }), /lockd_at/);
    // intel_events has `at`, never created_at (INTEL-CONTRACT §1 is exact).
    refused(() => db().from("intel_events").select("id").order("created_at"), /created_at/);
    refused(() => installFakeDb({ brokers: [{ nmae: "Demo Broker" }] }), /nmae/);
  });

  test("builder options the fake does not implement throw; nullsFirst is honoured", async () => {
    const session_id = "00000000-0000-4000-8000-0000000000dd";
    for (let idx = 0; idx < 4; idx++) {
      await db().from("turns").insert({ session_id, idx, role: "client", text: `t${idx}`, t_start_secs: idx === 1 ? null : idx });
    }
    const idxs = (res: { data: unknown; error: unknown }) => rowsOf(res).map((r) => r.idx);
    const turns = () => db().from("turns").select("idx").eq("session_id", session_id);
    assert.deepEqual(idxs(await turns().order("t_start_secs", { nullsFirst: true })), [1, 0, 2, 3]);
    assert.deepEqual(idxs(await turns().order("t_start_secs", { ascending: false, nullsFirst: false })), [3, 2, 0, 1]);
    // undefined means the Postgres default: NULLS LAST ascending, NULLS FIRST descending.
    assert.deepEqual(idxs(await turns().order("t_start_secs", { nullsFirst: undefined })), [0, 2, 3, 1]);

    refused(() => turns().order("idx", { referencedTable: "sessions" } as any), /referencedTable/);
    refused(() => turns().order("idx", { foreignTable: "sessions" } as any), /foreignTable/);
    refused(() => turns().limit(1, { referencedTable: "sessions" }), /referencedTable/);
    refused(() => turns().range(0, 1, { referencedTable: "sessions" }), /referencedTable/);
    refused(() => db().from("turns").select("*", { count: "planned" }), /planned/);
    refused(() => db().from("turns").select("*", { count: "estimated" }), /estimated/);
    refused(() => db().from("turns").select("*", { bogus: true } as any), /bogus/);
    refused(() => db().from("brokers").insert({ name: "x" }, { count: "exact" }), /count/);
    refused(() => db().from("brokers").upsert({ name: "x" }, { count: "exact" }), /count/);
    refused(() => db().from("brokers").upsert({ name: "x" }, { onConflict: "id", bogus: 1 } as any), /bogus/);
    refused(() => db().from("brokers").update({ name: "x" }, { count: "exact" }), /count/);
    refused(() => db().from("brokers").delete({ count: "exact" }), /count/);
    // After a write, supabase-js's select() takes no options: a count asked for there never comes back.
    refused(() => (db().from("brokers").insert({ name: "x" }) as any).select("*", { count: "exact" }), /select/);
    assert.equal(fake.tables.brokers.length, 0);
  });

  test("a batch whose rows have different keys is refused unless defaultToNull is false (PostgREST fills a gap with NULL, not the default)", async () => {
    const mixed = [{ kind: "a", payload: {} }, { kind: "b", payload: {}, status: "done" }];
    refused(() => db().from("jobs").insert(mixed), /defaultToNull/);
    refused(() => db().from("jobs").upsert(mixed), /defaultToNull/);
    // With defaultToNull: false supabase-js sends `missing=default`, so the gap gets the column default.
    const res = await db().from("jobs").insert(mixed, { defaultToNull: false }).select("kind,status");
    assert.deepEqual(rowsOf(res).map((r) => r.status), ["queued", "done"]);
  });

  test("rpc() is a builder: nothing runs until awaited, single()/maybeSingle() work, and anything else throws naming the shape", async () => {
    const clock = fakeClock("2026-10-31T08:00:00.000Z");
    try {
      await db().from("jobs").insert({ kind: "ingest_transcript", payload: {}, run_after: "2026-10-31T07:00:00.000Z" });
      const notAwaited = db().rpc("claim_job", { p_worker: "w0" });
      void notAwaited;
      assert.equal(fake.tables.jobs[0]!.status, "queued");
      assert.equal(fake.log.filter((q) => q.op === "rpc").length, 0);

      const one = await db().rpc("claim_job", { p_worker: "w1" }).single();
      assert.equal(one.error, null);
      assert.equal((one.data as any).status, "running");
      assert.equal((one.data as any).locked_by, "w1");
      const none = await db().rpc("claim_job", { p_worker: "w2" }).maybeSingle();
      assert.deepEqual({ data: none.data, error: none.error }, { data: null, error: null });
      const missing = await db().rpc("claim_job", { p_worker: "w2" }).single();
      assert.equal(missing.error?.code, "PGRST116");
      assert.deepEqual(fake.log.filter((q) => q.op === "rpc").map((q) => q.args), [{ p_worker: "w1" }, { p_worker: "w2" }, { p_worker: "w2" }]);

      refused(() => db().rpc("claim_job", { p_worker: "w3" }).select("id"), /rpc\("claim_job"\)\.select/);
      refused(() => db().rpc("claim_job", { p_worker: "w3" }).eq("id", 1), /rpc\("claim_job"\)\.eq/);
      // A misspelt argument is PGRST202 (no such function signature) in production.
      refused(() => db().rpc("claim_job", { p_wroker: "w3" }), /p_wroker/);
      refused(() => db().rpc("claim_job", { p_worker: "w3" }, { count: "exact" }), /count/);
    } finally {
      clock.restore();
    }
  });

  test("an upsert batch is one statement: a repeated conflict key is 21000, and any failure applies nothing", async () => {
    const broker_id = await addBroker();
    const onConflict = "broker_id,phone_e164";
    const { data: one } = await db().from("clients").insert({ broker_id, phone_e164: "+27799930301", first_name: "One" }).select().single();
    const { data: other } = await db().from("clients").insert({ broker_id, phone_e164: "+27799930302", first_name: "Two" }).select().single();

    const twice = await db().from("clients").upsert(
      [
        { broker_id, phone_e164: "+27799930303", first_name: "a" },
        { broker_id, phone_e164: "+27799930303", first_name: "b" },
      ],
      { onConflict },
    );
    assert.equal(twice.error?.code, "21000");
    assert.equal(fake.tables.clients.length, 2);

    // Row 1 would update "One"; row 2 takes an id that is already used. Postgres applies neither.
    const broken = await db().from("clients").upsert(
      [
        { id: one.id, broker_id, phone_e164: "+27799930301", first_name: "One changed" },
        { id: other.id, broker_id, phone_e164: "+27799930304", first_name: "Clash" },
      ],
      { onConflict },
    );
    assert.equal(broken.error?.code, "23505");
    assert.deepEqual(fake.tables.clients.map((c) => c.first_name), ["One", "Two"]);

    // ON CONFLICT DO NOTHING: the second of two equal keys is skipped, not an error.
    const skipped = await db().from("clients").upsert(
      [
        { broker_id, phone_e164: "+27799930305", first_name: "first" },
        { broker_id, phone_e164: "+27799930305", first_name: "second" },
      ],
      { onConflict, ignoreDuplicates: true },
    ).select();
    assert.deepEqual(rowsOf(skipped).map((r) => r.first_name), ["first"]);
    assert.equal(fake.tables.clients.length, 3);

    // One UPDATE that gives two rows the same unique value fails whole, too.
    await db().from("sessions").insert([
      { broker_id, mode: "call", provider: "elevenlabs", conversation_id: "conv_1" },
      { broker_id, mode: "call", provider: "elevenlabs", conversation_id: "conv_2" },
    ]);
    const same = await db().from("sessions").update({ conversation_id: "conv_x" }).eq("broker_id", broker_id);
    assert.equal(same.error?.code, "23505");
    assert.deepEqual(fake.tables.sessions.map((s) => s.conversation_id), ["conv_1", "conv_2"]);
  });

  test("an explicit id on a generated-always identity table (jobs, intel_events) is 428C9 and writes nothing", async () => {
    const job = await db().from("jobs").insert({ id: 999, kind: "x", payload: {} });
    assert.equal(job.error?.code, "428C9");
    const event = { id: 5, app: "call", trace_id: "t_demo", kind: "track", name: "demo", actor: "system" };
    assert.equal((await db().from("intel_events").insert(event)).error?.code, "428C9");
    assert.equal((await db().from("jobs").upsert({ id: 1, kind: "x", payload: {} })).error?.code, "428C9");
    assert.equal(fake.tables.jobs.length + fake.tables.intel_events.length, 0);

    const { data: real } = await db().from("jobs").insert({ kind: "x", payload: {} }).select().single();
    const moved = await db().from("jobs").update({ id: 7 }).eq("id", real.id);
    assert.equal(moved.error?.code, "428C9");
    assert.equal(fake.tables.jobs[0]!.id, real.id);
  });

  test("an undefined filter value throws, and so does null anywhere but is() (PostgREST would compare with the text 'null')", () => {
    const clients = () => db().from("clients").select("*");
    refused(() => clients().eq("id", undefined as any), /undefined/);
    refused(() => clients().in("id", ["00000000-0000-4000-8000-000000000001", undefined]), /undefined/);
    refused(() => clients().is("forgotten_at", undefined as any), /undefined/);
    refused(() => clients().not("forgotten_at", "is", undefined), /undefined/);
    refused(() => clients().eq("forgotten_at", null as any), /is\(/);
    refused(() => clients().neq("forgotten_at", null), /is\(/);
    refused(() => clients().gte("created_at", null as any), /is\(/);
    refused(() => clients().in("id", [null]), /is\(/);
    // is() takes null, true or false, nothing else.
    refused(() => clients().is("forgotten_at", "yes" as any), /is\(/);
    assert.equal(fake.log.length, 0);
  });

  test("claim_job treats a NULL run_after or locked_at as SQL does: never due, never stale; a plain insert gets run_after by default", async () => {
    const clock = fakeClock("2026-10-31T08:00:00.000Z");
    try {
      await db().from("jobs").insert({ kind: "x", payload: {}, dedupe_key: "null-run-after", run_after: null });
      await db().from("jobs").insert({ kind: "x", payload: {}, dedupe_key: "null-lock", status: "running", locked_at: null });
      clock.advance(60 * 60_000);
      assert.deepEqual((await db().rpc("claim_job", { p_worker: "w1" })).data, []);

      const { data } = await db().from("jobs").insert({ kind: "x", payload: {}, dedupe_key: "defaulted" }).select().single();
      assert.equal(data.run_after, clock.iso());
      const claimed = await db().rpc("claim_job", { p_worker: "w1" }).single();
      assert.equal((claimed.data as any).dedupe_key, "defaulted");
    } finally {
      clock.restore();
    }
  });

  test("every non-null column with a planned default gets it (so cost_cents + 1 is a number, not NaN)", async () => {
    const clock = fakeClock("2026-10-31T08:00:00.000Z");
    try {
      const broker_id = await addBroker();
      const now = clock.iso();
      const id = "00000000-0000-4000-8000-0000000000ee";
      const cases: [string, Record<string, unknown>, Record<string, unknown>][] = [
        ["sessions", { broker_id, mode: "call", provider: "elevenlabs" }, { readback_confirmed: false, cost_cents: 0 }],
        ["facts", { session_id: id, rel: "age", label: "Age", turn_id: id, confidence: "agent", source: "tool" }, { status: "active", approx: false }],
        ["recommendations", { need_id: id }, { status: "draft" }],
        ["quotes", { session_id: id, broker_id }, { version: 1, status: "draft", flags: [] }],
        ["deliveries", { quote_id: id, channel: "email", to_address: "thandi@example.test" }, { status: "queued" }],
        ["hardship_notes", { session_id: id }, { quotes_from_client: [] }],
        ["product_categories", { id: "life", name: "Life cover", country: "ZA" }, { need_kinds: [] }],
        ["products", { category_id: "life", provider_name: "Demo Life", name: "Demo Term", verified_on: "2026-10-31" }, { active: true, is_demo: true, exclusions: [], keywords: [] }],
        ["model_config", { role: "extract", provider: "openrouter", model: "demo/model" }, { fallbacks: [], params: {}, enabled: true }],
        ["jobs", { kind: "ingest_transcript" }, { payload: {}, status: "queued", attempts: 0, run_after: now }],
        ["webhook_events", { provider: "meta", event_type: "message", external_id: "wamid.demo2", signature_ok: true, raw: {} }, { received_at: now }],
        ["audit_log", { action: "approve", entity: "quote" }, { at: now }],
        ["incidents", { kind: "model", severity: "warn", summary: "demo", fingerprint: "fp_demo" }, { first_at: now, last_at: now, count: 1 }],
        ["intel_events", { app: "call", trace_id: "t_demo", kind: "track", name: "demo", actor: "system" }, { at: now, seq: 0, v: 1, content_mode: "full" }],
      ];
      for (const [table, input, expected] of cases) {
        const { data, error } = await db().from(table).insert(input).select().single();
        assert.equal(error, null, table);
        for (const [column, value] of Object.entries(expected)) assert.deepEqual(data[column], value, `${table}.${column}`);
      }
      assert.equal(fake.tables.sessions[0]!.cost_cents + 1, 1);
      // intel_events' timestamp is `at`; the contract's columns are exact, so there is no created_at.
      assert.equal("created_at" in fake.tables.intel_events[0]!, false);
      // A default never overrides what was written, and each row gets its own array.
      const flagged = await db().from("quotes").insert({ session_id: id, broker_id, status: "held", flags: ["age_unconfirmed"] }).select().single();
      assert.deepEqual([flagged.data.status, flagged.data.flags], ["held", ["age_unconfirmed"]]);
      fake.tables.quotes[0]!.flags.push("mutated");
      assert.deepEqual((await db().from("quotes").insert({ session_id: id, broker_id }).select().single()).data.flags, []);
    } finally {
      clock.restore();
    }
  });
});

describe("fake storage", () => {
  test("upload, download, list and remove, through storage.from(bucket) on the fake client", async () => {
    const fake = installFakeDb();
    try {
      const bucket = db().storage.from("recordings");
      const bytes = new Uint8Array([1, 2, 3, 4]);

      const up = await bucket.upload("s1/chunk-0000.webm", bytes, { contentType: "audio/webm" });
      assert.equal(up.error, null);
      assert.equal(up.data?.path, "s1/chunk-0000.webm");
      assert.deepEqual([...fake.storage.files.get("recordings/s1/chunk-0000.webm")!], [1, 2, 3, 4]);

      const dup = await bucket.upload("s1/chunk-0000.webm", bytes);
      assert.match(dup.error!.message, /already exists/i);
      const over = await bucket.upload("s1/chunk-0000.webm", new Uint8Array([9]), { upsert: true });
      assert.equal(over.error, null);

      await bucket.upload("s1/chunk-0001.webm", new Uint8Array([5]));
      await bucket.upload("s2/chunk-0000.webm", new Uint8Array([6]));

      const down = await bucket.download("s1/chunk-0001.webm");
      assert.equal(down.error, null);
      assert.deepEqual([...new Uint8Array(await down.data!.arrayBuffer())], [5]);
      const gone = await bucket.download("s1/nope.webm");
      assert.equal(gone.data, null);
      assert.match(gone.error!.message, /not found/i);

      const listed = await bucket.list("s1");
      assert.deepEqual(listed.data!.map((f: any) => f.name).sort(), ["chunk-0000.webm", "chunk-0001.webm"]);
      const root = await bucket.list("");
      assert.deepEqual(root.data!.map((f: any) => f.name).sort(), ["s1", "s2"]);

      // Buckets are separate namespaces.
      const other = await db().storage.from("quotes").list("s1");
      assert.deepEqual(other.data, []);

      const removed = await bucket.remove(["s1/chunk-0000.webm", "s1/never-existed.webm"]);
      assert.equal(removed.error, null);
      assert.equal(removed.data!.length, 1);
      assert.equal(fake.storage.files.has("recordings/s1/chunk-0000.webm"), false);
      assert.equal(fake.storage.files.size, 2);
    } finally {
      fake.uninstall();
    }
  });

  test("only the recordings and quotes buckets exist; any other answers Bucket not found, as Storage does", async () => {
    const storage = fakeStorage();
    const typo = storage.from("recordingz");
    const results = [
      await typo.upload("s1/chunk-0000.webm", new Uint8Array([1])),
      await typo.download("s1/chunk-0000.webm"),
      await typo.list("s1"),
      await typo.remove(["s1/chunk-0000.webm"]),
    ];
    for (const res of results) {
      assert.equal(res.data, null);
      assert.match(res.error!.message, /Bucket not found/);
    }
    assert.equal(storage.files.size, 0);

    const fake = installFakeDb();
    try {
      const up = await db().storage.from("quote").upload("q1.pdf", new Uint8Array([1]));
      assert.equal(up.data, null);
      assert.match(up.error!.message, /Bucket not found/);
      assert.equal(fake.storage.files.size, 0);
    } finally {
      fake.uninstall();
    }
  });

  test("fakeStorage() on its own is a bucket namespace with a files map", async () => {
    const storage = fakeStorage();
    await storage.from("quotes").upload("q1.pdf", new Blob(["%PDF"]), { contentType: "application/pdf" });
    assert.equal(new TextDecoder().decode(storage.files.get("quotes/q1.pdf")!), "%PDF");
    assert.equal(storage.contentTypes.get("quotes/q1.pdf"), "application/pdf");
  });
});

describe("fake clock", () => {
  test("controls Date.now() and new Date(), advances on request, and restores", () => {
    const RealDate = Date;
    const clock = fakeClock("2026-10-31T08:00:00.000Z");
    try {
      assert.equal(Date.now(), Date.parse("2026-10-31T08:00:00.000Z"));
      assert.equal(new Date().toISOString(), "2026-10-31T08:00:00.000Z");
      // Time stands still until it is moved.
      assert.equal(Date.now(), Date.now());
      clock.advance(90_000);
      assert.equal(new Date().toISOString(), "2026-10-31T08:01:30.000Z");
      clock.set("2026-11-01T00:00:00.000Z");
      assert.equal(Date.now(), Date.parse("2026-11-01T00:00:00.000Z"));
      // Dates built from arguments are untouched, and instanceof still holds.
      assert.equal(new Date("2020-01-02T03:04:05.000Z").getUTCFullYear(), 2020);
      assert.ok(new Date() instanceof Date);
      assert.equal(typeof Date(), "string");
    } finally {
      clock.restore();
    }
    assert.equal(Date, RealDate);
    assert.ok(Math.abs(Date.now() - RealDate.now()) < 1000);
  });

  test("created_at on inserted rows follows the fake clock", async () => {
    const fake = installFakeDb();
    const clock = fakeClock("2026-10-31T08:00:00.000Z");
    try {
      const { data } = await db().from("brokers").insert({ name: "Demo Broker" }).select().single();
      assert.equal(data.created_at, "2026-10-31T08:00:00.000Z");
    } finally {
      clock.restore();
      fake.uninstall();
    }
  });
});

describe("fake network", () => {
  let net: FakeNet;
  let realFetch: typeof fetch;
  beforeEach(() => {
    realFetch = globalThis.fetch;
    net = installFakeNet();
  });
  afterEach(() => net.restore());

  const chat = (content: string, model = "demo/model") =>
    fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer test-openrouter-key", "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages: [{ role: "system", content: "You extract facts." }, { role: "user", content }] }),
    });

  test("onModel answers a chat call whose prompt matches, as an OpenRouter response", async () => {
    net.onModel(/MARKER-EXTRACT/, () => ({ facts: [{ rel: "age", value_num: 42 }] }));
    net.onModel("MARKER-PLAIN", () => "plain text answer");

    const res = await chat("MARKER-EXTRACT the transcript follows");
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(JSON.parse(body.choices[0].message.content), { facts: [{ rel: "age", value_num: 42 }] });
    assert.equal(body.choices[0].finish_reason, "stop");
    assert.ok(body.usage.completion_tokens > 0);

    const plain = await (await chat("MARKER-PLAIN")).json();
    assert.equal(plain.choices[0].message.content, "plain text answer");

    assert.equal(net.modelCalls.length, 2);
    assert.equal(net.modelCalls[0]!.model, "demo/model");
    assert.match(net.modelCalls[0]!.prompt, /You extract facts\.\nMARKER-EXTRACT/);
    assert.equal(net.calls.length, 2);
    assert.equal(net.calls[0]!.method, "POST");
    assert.equal(net.calls[0]!.headers["authorization"], "Bearer test-openrouter-key");
  });

  test("onModel may return a Response as-is (an error status, a truncated body)", async () => {
    net.onModel(/BOOM/, () => new Response("upstream down", { status: 503 }));
    const res = await chat("BOOM");
    assert.equal(res.status, 503);
  });

  test("modelReply() is an OpenRouter chat reply with the finish_reason and usage a test asks for (a truncation, say)", async () => {
    net.onModel(/CUT/, () => modelReply('{"facts": [', { finishReason: "length", usage: { prompt_tokens: 700, completion_tokens: 1200 } }));
    net.onModel(/OBJ/, () => modelReply({ a: 1 }));
    const cut = await (await chat("CUT")).json();
    assert.equal(cut.choices[0].finish_reason, "length");
    assert.equal(cut.choices[0].message.content, '{"facts": [');
    assert.deepEqual(cut.usage, { prompt_tokens: 700, completion_tokens: 1200, total_tokens: 1900 });
    const obj = await (await chat("OBJ")).json();
    // The defaults are the ones a plain onModel answer has.
    assert.equal(obj.choices[0].finish_reason, "stop");
    assert.equal(obj.choices[0].message.content, '{"a":1}');
    assert.deepEqual(obj.usage, { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 });
    // A null finish_reason is sent as null (a stream cut off upstream reads that way).
    net.onModel(/NULL/, () => modelReply("partial", { finishReason: null }));
    assert.equal((await (await chat("NULL")).json()).choices[0].finish_reason, null);
  });

  test("a model call nobody scripted fails loudly instead of answering", async () => {
    await assert.rejects(() => chat("nothing matches this"), /no scripted model response/);
  });

  test("onFetch intercepts any other URL: object -> JSON 200, Response as-is, and sees the parsed body", async () => {
    net.onFetch(/api\.resend\.com\/emails/, (call) => ({ id: `email_${(call.json as any).to[0]}` }));
    net.onFetch(/graph\.facebook\.com/, () => new Response(JSON.stringify({ error: { code: 190 } }), { status: 401 }));

    const sent = await fetch("https://api.resend.com/emails", { method: "POST", body: JSON.stringify({ to: ["thandi@example.test"] }) });
    assert.equal(sent.status, 200);
    assert.deepEqual(await sent.json(), { id: "email_thandi@example.test" });

    const meta = await fetch("https://graph.facebook.com/v21.0/123/messages", { method: "POST", body: "{}" });
    assert.equal(meta.status, 401);

    assert.deepEqual(net.calls.map((c) => c.url), ["https://api.resend.com/emails", "https://graph.facebook.com/v21.0/123/messages"]);
    assert.deepEqual(net.calls[0]!.json, { to: ["thandi@example.test"] });
  });

  test("a fetch nobody scripted throws, naming the URL, and never reaches the network", async () => {
    await assert.rejects(() => fetch("https://example.test/unscripted"), /unexpected request to https:\/\/example\.test\/unscripted/);
    assert.equal(net.calls.length, 1);
  });

  test("non-string bodies are recorded: bytes, an ArrayBuffer, a Blob, FormData entries, URLSearchParams", async () => {
    net.onFetch(/upload\.example\.test/, () => ({ ok: true }));
    const post = (path: string, body: BodyInit) => fetch(`https://upload.example.test/${path}`, { method: "POST", body });
    await post("bytes", new Uint8Array([1, 2, 3]));
    await post("buffer", new Uint8Array([4, 5]).buffer);
    await post("blob", new Blob(['{"x":1}'], { type: "application/json" }));
    const form = new FormData();
    form.append("model", "demo/transcriber");
    form.append("file", new Blob([new Uint8Array([7, 8])], { type: "audio/webm" }), "chunk-0000.webm");
    await post("form", form);
    await post("params", new URLSearchParams({ a: "1", b: "two" }));

    const [bytes, buffer, blob, multipart, params] = net.calls;
    assert.deepEqual([...bytes!.bytes!], [1, 2, 3]);
    assert.deepEqual([...buffer!.bytes!], [4, 5]);
    assert.equal(blob!.body, '{"x":1}');
    assert.deepEqual(blob!.json, { x: 1 });
    assert.deepEqual(multipart!.form, [
      { name: "model", value: "demo/transcriber" },
      { name: "file", filename: "chunk-0000.webm", type: "audio/webm", bytes: new Uint8Array([7, 8]) },
    ]);
    assert.equal(params!.body, "a=1&b=two");
    // A string body is still the string, and its bytes are there too.
    await post("text", "hello");
    assert.equal(net.calls[5]!.body, "hello");
    assert.deepEqual([...net.calls[5]!.bytes!], [...new TextEncoder().encode("hello")]);
  });

  test("a /g or /y pattern matches on every call (RegExp.test is stateful with those flags)", async () => {
    net.onFetch(/api\.resend\.com/g, () => ({ id: "email_demo" }));
    net.onModel(/You extract facts/y, () => "ok");
    for (let i = 0; i < 2; i++) {
      assert.equal((await fetch("https://api.resend.com/emails", { method: "POST", body: "{}" })).status, 200);
      assert.equal((await (await chat(`MARKER ${i}`)).json()).choices[0].message.content, "ok");
    }
  });

  test("restore() puts the real fetch back; so does uninstall()", () => {
    assert.notEqual(globalThis.fetch, realFetch);
    net.restore();
    assert.equal(globalThis.fetch, realFetch);
    const again = installFakeNet();
    assert.notEqual(globalThis.fetch, realFetch);
    again.uninstall();
    assert.equal(globalThis.fetch, realFetch);
  });
});

describe("env", () => {
  // The npm scripts own this one (test vs test:intel); put back whatever they set.
  const intelCapture = process.env.INTEL_CAPTURE;
  const exampleNames = (): string[] =>
    readFileSync(new URL("../.env.example", import.meta.url), "utf8")
      .split("\n")
      .map((l) => /^([A-Z][A-Z0-9_]*)=/.exec(l)?.[1])
      .filter((n): n is string => Boolean(n));

  afterEach(async () => {
    await setEnv({
      ELEVENLABS_CENTS_PER_MINUTE: TEST_ENV.ELEVENLABS_CENTS_PER_MINUTE,
      ELEVENLABS_MINUTES_INCLUDED: undefined,
      OPENROUTER_API_KEY: TEST_ENV.OPENROUTER_API_KEY,
      DEFAULT_RETENTION_DAYS: undefined,
      INTEL_CAPTURE: intelCapture,
    });
  });

  test("env has a key for every variable in .env.example, and it is a frozen snapshot", () => {
    const names = exampleNames();
    assert.ok(names.includes("SUPABASE_URL") && names.includes("INTEL_CAPTURE"), "the parse found the file");
    for (const name of names) assert.ok(name in env, `env.${name} is missing`);
    assert.ok(Object.isFrozen(env));
    assert.throws(() => {
      (env as any).SUPABASE_URL = "https://elsewhere.example.test";
    });
  });

  test("the test environment covers every variable in .env.example (so a real shell value can never leak into a test)", () => {
    // INTEL_CAPTURE is owned by the npm scripts (test vs test:intel), not by the fake env.
    const uncovered = exampleNames().filter((n) => !(n in TEST_ENV) && n !== "INTEL_CAPTURE");
    assert.deepEqual(uncovered, []);
    for (const [name, value] of Object.entries(TEST_ENV)) {
      if (value !== undefined) assert.doesNotMatch(value, /^(sk-|re_|EAA)/, `${name} looks like a real key`);
    }
  });

  test("defaults from .env.example apply when a variable is unset, and numbers are numbers", async () => {
    await setEnv({ ELEVENLABS_CENTS_PER_MINUTE: undefined, ELEVENLABS_MINUTES_INCLUDED: undefined, DEFAULT_RETENTION_DAYS: undefined, INTEL_CAPTURE: undefined });
    assert.equal(env.ELEVENLABS_CENTS_PER_MINUTE, 10);
    assert.equal(env.ELEVENLABS_MINUTES_INCLUDED, 15);
    assert.equal(env.OPENROUTER_DAILY_BUDGET, 50);
    assert.equal(env.DEFAULT_RETENTION_DAYS, 30);
    assert.equal(env.WHATSAPP_VERIFY_TOKEN, "call-verify");
    assert.equal(env.WHATSAPP_API_VERSION, "v21.0");
    assert.equal(env.WHATSAPP_TEMPLATE_QUOTE_READY, "quote_ready");
    assert.equal(env.WHATSAPP_TEMPLATE_BROKER_NEW_QUOTE, "broker_new_quote");
    assert.equal(env.INTEL_CAPTURE, "full");
    assert.equal(typeof env.ELEVENLABS_CENTS_PER_MINUTE, "number");
  });

  test("reloadEnv() takes a new frozen snapshot; a value that is not a number falls back to its default", async () => {
    const before = env;
    await setEnv({ ELEVENLABS_CENTS_PER_MINUTE: "12", INTEL_CAPTURE: "meta" });
    assert.equal(env.ELEVENLABS_CENTS_PER_MINUTE, 12);
    assert.equal(env.INTEL_CAPTURE, "meta");
    assert.notEqual(env, before);
    assert.ok(Object.isFrozen(env));

    // NaN in a budget comparison is always false, which would quietly switch the limit off.
    process.env.ELEVENLABS_CENTS_PER_MINUTE = "ten";
    reloadEnv();
    assert.equal(env.ELEVENLABS_CENTS_PER_MINUTE, 10);
    process.env.ELEVENLABS_CENTS_PER_MINUTE = "-3";
    reloadEnv();
    assert.equal(env.ELEVENLABS_CENTS_PER_MINUTE, 10);

    process.env.INTEL_CAPTURE = "loud";
    assert.equal(reloadEnv().INTEL_CAPTURE, "full");
  });

  test("values are trimmed, and a blank value counts as unset", async () => {
    await setEnv({ WORKER_SECRET: "  test-worker-secret \n", WHATSAPP_VERIFY_TOKEN: "   " });
    assert.equal(env.WORKER_SECRET, "test-worker-secret");
    assert.equal(env.WHATSAPP_VERIFY_TOKEN, "call-verify");
    await setEnv({ WORKER_SECRET: TEST_ENV.WORKER_SECRET, WHATSAPP_VERIFY_TOKEN: undefined });
  });

  test("required(name) returns the value, and throws naming the variable when it is missing", async () => {
    assert.equal(required("SUPABASE_URL"), "https://fake.supabase.co");
    await setEnv({ OPENROUTER_API_KEY: undefined });
    assert.throws(() => required("OPENROUTER_API_KEY"), /OPENROUTER_API_KEY is not set/);
  });

  test("importing env never throws when nothing is configured", async () => {
    await setEnv(Object.fromEntries(Object.keys(TEST_ENV).map((k) => [k, undefined])));
    assert.equal(env.SUPABASE_URL, "");
    // db() builds its client on first use; clear any cached one so this really is first use.
    const restore = __setClient(null);
    try {
      assert.throws(() => db(), /SUPABASE_URL is not set/);
    } finally {
      restore();
      await setEnv(TEST_ENV);
    }
  });
});
