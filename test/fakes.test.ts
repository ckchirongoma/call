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
        await db().from("jobs").insert([
          job({ dedupe_key: "later", run_after: "2026-10-31T08:03:00.000Z" }), // not runnable yet
          job({ dedupe_key: "second", run_after: "2026-10-31T07:30:00.000Z" }),
          job({ dedupe_key: "first", run_after: "2026-10-31T07:00:00.000Z" }),
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

        // Time passing makes the future job runnable (the two running jobs are only 4 minutes into their lock).
        clock.advance(4 * 60_000);
        const d = await db().rpc("claim_job", { p_worker: "w4" });
        assert.equal(d.data[0].dedupe_key, "later");

        // A job whose worker died more than five minutes ago is claimable again, oldest first.
        clock.advance(6 * 60_000);
        const e = await db().rpc("claim_job", { p_worker: "w5" });
        assert.equal(e.data.length, 1);
        assert.equal(e.data[0].dedupe_key, "first");
        assert.equal(e.data[0].attempts, 2);
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
