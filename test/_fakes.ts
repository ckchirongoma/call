// Call — in-memory stand-ins for Supabase (database and Storage), the clock,
// and the network (OpenRouter, Resend, Meta, ElevenLabs).
//
// Ported from Charlie `test/_fakes.ts`; the why-comments are kept. Added here:
// Storage, the clock, a table list that knows every Call table, unique
// constraints, and a structured query log.
//
// These exist so a WHOLE journey can run in a test — a call's webhook, the
// pipeline's jobs, the broker's tap, the send — with no network and no
// credentials. Per-module unit tests cannot catch the failures that actually
// hurt: a job nothing handles, a button that dispatches nowhere, a message sent
// with an empty body. Every one of those is a wiring failure between modules.
//
// The fake database implements only the query shapes this codebase actually
// uses. That is deliberate: a fake that silently accepts a query it does not
// really support would make a broken test pass. Anything it does not know
// throws FakeDbUnsupported, naming the shape. To teach it a shape, add the
// shape here, with a line in test/fakes.test.ts; never loosen the throw.
//
// Where the fake is stricter than PostgREST, it is on purpose, each for a bug
// the lax version hides:
//   - a write returns `data: null` unless `.select()` was chained, as supabase-js
//     does, so code that reads `data` after a bare insert fails here, not in prod;
//   - `.single()` / `.maybeSingle()` error on more than one row (PGRST116);
//   - an unfiltered update or delete is refused rather than run on every row;
//   - `upsert({ onConflict })` on columns with no unique constraint is refused
//     (Postgres: 42P10), and a duplicate on a unique key is a 23505 error;
//   - rows come back as copies, so mutating a result cannot "update" the table.
//
// Not emulated: foreign keys and cascades (forgetClient deletes explicitly),
// RLS (db/0007 and test/rls.test.ts own that), column types, joins.
//
// Several tasks extend this file (0.3 finish_reason, 0.6 the intel_events
// missing-table switch); add the shape you need and keep the throw.

// Must be first: api/_lib/env.ts snapshots process.env when it is first imported,
// and importing the fakes imports api/_lib/db.ts which imports it.
import "./_env.ts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { __setClient } from "../api/_lib/db.ts";
import type { TableName } from "../api/_lib/types.ts";

type Row = Record<string, any>;

// ── Every table, by name ─────────────────────────────────────────

/** Every table in SPEC §4 plus Task 1.1's extras. A table missing here is a type error (below). */
export const TABLES = [
  "brokers",
  "broker_users",
  "login_codes",
  "sessions_auth",
  "clients",
  "sessions",
  "turns",
  "recordings",
  "consents",
  "callbacks",
  "client_messages",
  "meeting_chunks",
  "facts",
  "fact_refusals",
  "needs",
  "recommendations",
  "quotes",
  "deliveries",
  "hardship_notes",
  "product_categories",
  "products",
  "product_pricing",
  "disclosures",
  "model_config",
  "jobs",
  "webhook_events",
  "safety_events",
  "usage_ledger",
  "audit_log",
  "incidents",
  "intel_events",
] as const satisfies readonly TableName[];

// Adding a table to api/_lib/types.ts without listing it above fails the typecheck.
type UnlistedTables = Exclude<TableName, (typeof TABLES)[number]>;
const allTablesListed: [UnlistedTables] extends [never] ? true : never = true;
void allTablesListed;

const TABLE_SET: ReadonlySet<string> = new Set(TABLES);

/** Primary key, where it is not `id`. */
const PRIMARY_KEY: Partial<Record<TableName, string>> = { model_config: "role" };

/** bigint identity ids (a number), not uuids. */
const BIGINT_ID: ReadonlySet<string> = new Set(["jobs", "intel_events"]);

/**
 * Unique constraints beyond the primary key, from SPEC §4 and the plan. NULLs
 * never conflict (as in Postgres), which is why clients is a plain
 * UNIQUE (broker_id, phone_e164) here: walk-ins have no phone. SPEC §4 writes
 * it as a partial index `WHERE phone_e164 IS NOT NULL`, but supabase-js's
 * upsert({ onConflict: "broker_id,phone_e164" }) cannot name an index
 * predicate, so a PARTIAL index cannot be the arbiter of an upsert; Task 1.1
 * must make it a plain unique constraint (same behaviour, since NULLs are
 * distinct) or the upsert fails in production with 42P10.
 */
const UNIQUE: Partial<Record<TableName, string[][]>> = {
  clients: [["broker_id", "phone_e164"]],
  sessions: [["conversation_id"]],
  turns: [["session_id", "idx"]],
  webhook_events: [["provider", "external_id", "event_type"]],
  jobs: [["dedupe_key"]],
  intel_events: [["source_ref"]],
};

/**
 * Column defaults that code (or a test) can observe. Each mirrors the
 * migration; Task 1.1 keeps them honest. Not every default is here, only the
 * ones that change behaviour: auto_send false is SPEC R12.
 */
const DEFAULTS: Partial<Record<TableName, () => Row>> = {
  brokers: () => ({ country: "ZA", currency: "ZAR", auto_send: false, retention_days: 30 }),
  products: () => ({ is_demo: true }),
  facts: () => ({ approx: false }),
  jobs: () => ({ status: "queued", attempts: 0, run_after: new Date().toISOString() }),
};

// ── The error the fake throws for a shape it does not know ───────

export class FakeDbUnsupported extends Error {
  constructor(shape: string) {
    super(
      `fake db: unsupported ${shape}. If the code really needs it, teach test/_fakes.ts (and test/fakes.test.ts) the shape; do not loosen the check.`,
    );
    this.name = "FakeDbUnsupported";
  }
}

const show = (args: unknown[]): string => {
  try {
    const s = JSON.stringify(args).slice(1, -1);
    return s.length > 120 ? `${s.slice(0, 117)}...` : s;
  } catch {
    return "...";
  }
};

/** Property reads the runtime or the test runner makes on any object; never a query shape. */
const PASSTHROUGH: ReadonlySet<string> = new Set(["then", "toJSON", "constructor", "inspect", "asymmetricMatch", "nodeType", "tagName", "$$typeof", "__proto__"]);

// ── Filters ──────────────────────────────────────────────────────

type FilterKind = "eq" | "neq" | "is" | "not_is" | "gt" | "gte" | "lt" | "lte" | "in";

interface Filter {
  kind: FilterKind;
  column: string;
  value: unknown;
}

/** A column, or a PostgREST JSON path into one: `col->>key` reads `key` of a jsonb column as text. */
const columnValue = (row: Row, column: string): unknown => {
  const path = /^([a-z_0-9]+)->>([a-z_0-9]+)$/.exec(column);
  if (!path) return row[column];
  const v = row[path[1]!]?.[path[2]!];
  return v === null || v === undefined ? null : String(v);
};

const isNil = (v: unknown): v is null | undefined => v === null || v === undefined;

/** PostgREST puts every filter value in a URL, so 2 and "2" match; Dates travel as ISO strings. */
const same = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (isNil(a) || isNil(b)) return false;
  return String(a) === String(b);
};

const ISO = /^\d{4}-\d{2}-\d{2}T/;

/** Order two non-null values: numbers numerically, timestamps by instant, the rest as text. */
const compare = (a: unknown, b: unknown): number => {
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "string" && typeof b === "string") {
    if (ISO.test(a) && ISO.test(b)) {
      const d = Date.parse(a) - Date.parse(b);
      if (!Number.isNaN(d)) return d;
    }
    return a < b ? -1 : a > b ? 1 : 0;
  }
  const na = Number(a);
  const nb = Number(b);
  if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  const sa = String(a);
  const sb = String(b);
  return sa < sb ? -1 : sa > sb ? 1 : 0;
};

const matches = (row: Row, filters: Filter[]): boolean =>
  filters.every((f) => {
    const v = columnValue(row, f.column);
    switch (f.kind) {
      case "eq":
        return same(v, f.value);
      case "is":
        return f.value === null ? isNil(v) : v === f.value;
      case "not_is":
        return !isNil(v);
      // SQL: NULL <> x is NULL, so a row whose column is null is NOT returned by neq.
      case "neq":
        return !isNil(v) && !same(v, f.value);
      case "gt":
        return !isNil(v) && compare(v, f.value) > 0;
      case "gte":
        return !isNil(v) && compare(v, f.value) >= 0;
      case "lt":
        return !isNil(v) && compare(v, f.value) < 0;
      case "lte":
        return !isNil(v) && compare(v, f.value) <= 0;
      case "in":
        return Array.isArray(f.value) && !isNil(v) && f.value.some((x) => same(v, x));
    }
  });

/** What goes over the wire: JSON. Dates become ISO strings, undefined disappears, and nothing is shared with the caller. */
const wire = <T>(value: T): T => {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
};

// ── The fake database ────────────────────────────────────────────

export interface LoggedFilter {
  kind: FilterKind;
  column: string;
  value: unknown;
}

/** One executed query, for assertions ("the quote was written with status awaiting_broker"). */
export interface QueryLog {
  table: string;
  op: "select" | "insert" | "update" | "upsert" | "delete" | "rpc";
  filters: LoggedFilter[];
  /** insert / upsert: the rows as the caller passed them. update: [the patch]. */
  rows?: Row[];
  onConflict?: string;
  /** rpc only. */
  fn?: string;
  args?: Record<string, unknown>;
}

export interface FakeDb {
  client: SupabaseClient;
  tables: Record<TableName, Row[]>;
  /** Every query run, in order. */
  log: QueryLog[];
  storage: FakeStorage;
  /** Empty every table, the log and Storage. */
  reset(): void;
  /** Take this client back out of db(). */
  uninstall(): void;
  restore(): void;
}

const pgError = (code: string, message: string, details: string | null = null) => ({ code, message, details, hint: null });

const STALE_LOCK_MS = 300_000;

/** Build a fake database without installing it. */
export function makeFakeDb(seed: Record<string, Row[]> = {}): FakeDb {
  for (const name of Object.keys(seed)) {
    if (!TABLE_SET.has(name)) throw new FakeDbUnsupported(`seed table "${name}" (not a Call table)`);
  }
  const tables = Object.fromEntries(TABLES.map((t) => [t, [] as Row[]])) as Record<TableName, Row[]>;
  const log: QueryLog[] = [];
  const storage = fakeStorage();

  // Ids are per database, so every test starts at 1 and ids in a failure message are stable.
  let uuidCounter = 0;
  const bigCounters = new Map<string, number>();
  const nextUuid = (): string => `00000000-0000-4000-8000-${(++uuidCounter).toString(16).padStart(12, "0")}`;
  const nextBig = (table: string): number => {
    const n = (bigCounters.get(table) ?? 0) + 1;
    bigCounters.set(table, n);
    return n;
  };
  // A test that seeds hand-written ids ("00000000-0000-4000-8000-000000000001")
  // must not collide with the ids generated later, so skip any id already used.
  const freshId = (t: TableName): string | number => {
    for (;;) {
      const id = BIGINT_ID.has(t) ? nextBig(t) : nextUuid();
      if (!tables[t].some((r) => r.id === id)) return id;
    }
  };
  // Insertion order, kept off the rows so a row compares equal to what a test expects.
  const order = new WeakMap<Row, number>();
  let orderCounter = 0;

  const pkOf = (t: TableName): string => PRIMARY_KEY[t] ?? "id";
  const uniqueSets = (t: TableName): string[][] => [[pkOf(t)], ...(UNIQUE[t] ?? [])];

  const fill = (t: TableName, input: Row): Row => {
    const row: Row = { ...DEFAULTS[t]?.(), ...wire(input) };
    if (pkOf(t) === "id" && isNil(row.id)) row.id = freshId(t);
    const stamp = t === "intel_events" ? "at" : "created_at";
    if (isNil(row[stamp])) row[stamp] = new Date().toISOString();
    if (t === "audit_log" && isNil(row.at)) row.at = new Date().toISOString();
    return row;
  };

  /** The unique key a candidate row would violate, if any. NULL in a key column never conflicts. */
  const findConflict = (t: TableName, candidate: Row, ignore?: Row, staged: Row[] = []) => {
    for (const cols of uniqueSets(t)) {
      if (cols.some((c) => isNil(candidate[c]))) continue;
      const hit = [...tables[t], ...staged].find((r) => r !== ignore && cols.every((c) => same(r[c], candidate[c])));
      if (hit) return { cols, hit };
    }
    return null;
  };
  const conflictError = (t: TableName, cols: string[], row: Row) =>
    pgError(
      "23505",
      `duplicate key value violates unique constraint "${t}_${cols.join("_")}_key"`,
      `Key (${cols.join(", ")})=(${cols.map((c) => String(row[c])).join(", ")}) already exists.`,
    );

  /** All-or-nothing, like one INSERT statement. */
  const insertRows = (t: TableName, inputs: Row[]): { rows: Row[] } | { error: ReturnType<typeof pgError> } => {
    const staged: Row[] = [];
    for (const input of inputs) {
      const row = fill(t, input);
      const clash = findConflict(t, row, undefined, staged);
      if (clash) return { error: conflictError(t, clash.cols, row) };
      staged.push(row);
    }
    for (const row of staged) {
      order.set(row, ++orderCounter);
      tables[t].push(row);
    }
    return { rows: staged };
  };

  for (const [name, rows] of Object.entries(seed)) {
    const res = insertRows(name as TableName, rows);
    if ("error" in res) throw new Error(`fake db: seed for "${name}" breaks a unique key: ${res.error.details}`);
  }

  // ── Query builder ──────────────────────────────────────────────

  function builder(t: TableName) {
    const filters: Filter[] = [];
    let op: "insert" | "update" | "upsert" | "delete" | null = null;
    let inputs: Row[] = [];
    let patch: Row = {};
    let onConflict: string | undefined;
    let ignoreDuplicates = false;
    let returning = false;
    let columns: string[] | null = null;
    const orders: { column: string; ascending: boolean }[] = [];
    let limitTo: number | null = null;
    let rangeTo: [number, number] | null = null;
    let wantCount = false;
    let headOnly = false;
    let mode: "many" | "single" | "maybe" = "many";

    const project = (row: Row): Row => {
      if (!columns) return structuredClone(row);
      return Object.fromEntries(columns.map((c) => [c, structuredClone(isNil(row[c]) ? null : row[c])]));
    };

    const selected = (): Row[] => {
      let rows = tables[t].filter((r) => matches(r, filters));
      for (const { column, ascending } of [...orders].reverse()) {
        // Postgres: NULLS LAST ascending, NULLS FIRST descending. A stable sort per key, last key first.
        rows = [...rows].sort((a, b) => {
          const av = columnValue(a, column);
          const bv = columnValue(b, column);
          if (isNil(av) && isNil(bv)) return 0;
          if (isNil(av)) return ascending ? 1 : -1;
          if (isNil(bv)) return ascending ? -1 : 1;
          return compare(av, bv) * (ascending ? 1 : -1);
        });
      }
      return rows;
    };

    const logEntry = (kind: QueryLog["op"]): QueryLog => {
      const entry: QueryLog = { table: t, op: kind, filters: filters.map((f) => ({ kind: f.kind, column: f.column, value: f.value })) };
      if (kind === "insert" || kind === "upsert") entry.rows = wire(inputs);
      if (kind === "update") entry.rows = [wire(patch)];
      if (kind === "upsert") entry.onConflict = onConflict;
      log.push(entry);
      return entry;
    };

    interface Result {
      data: Row[] | Row | null;
      error: ReturnType<typeof pgError> | null;
      count: number | null;
      status: number;
      statusText: string;
    }
    const ok = (data: Row[] | null, count: number | null = null): Result => ({ data, error: null, count, status: data === null ? 204 : 200, statusText: "OK" });
    const fail = (error: ReturnType<typeof pgError>, status = 409): Result => ({ data: null, error, count: null, status, statusText: "Error" });

    const settle = (): Result => {
      const kind = op ?? "select";

      if (kind === "select") {
        logEntry("select");
        const all = selected();
        let rows = all;
        if (rangeTo) rows = rows.slice(rangeTo[0], rangeTo[1] + 1);
        if (limitTo !== null) rows = rows.slice(0, limitTo);
        const count = wantCount ? all.length : null;
        return finish(headOnly ? null : rows.map(project), count);
      }

      if (kind === "insert") {
        logEntry("insert");
        const res = insertRows(t, inputs);
        if ("error" in res) return fail(res.error);
        return finish(returning ? res.rows.map(project) : null);
      }

      if (kind === "upsert") {
        logEntry("upsert");
        const cols = (onConflict ?? pkOf(t)).split(",").map((c) => c.trim());
        const out: Row[] = [];
        for (const input of inputs) {
          const incoming = wire(input);
          const key = cols.every((c) => !isNil(incoming[c]));
          const existing = key ? tables[t].find((r) => cols.every((c) => same(r[c], incoming[c]))) : undefined;
          if (existing) {
            if (ignoreDuplicates) continue;
            const clash = findConflict(t, { ...existing, ...incoming }, existing);
            if (clash) return fail(conflictError(t, clash.cols, incoming));
            Object.assign(existing, incoming);
            out.push(existing);
          } else {
            const res = insertRows(t, [incoming]);
            if ("error" in res) return fail(res.error);
            out.push(...res.rows);
          }
        }
        return finish(returning ? out.map(project) : null);
      }

      // update and delete
      if (filters.length === 0) {
        throw new FakeDbUnsupported(`unfiltered ${kind} on ${t} (it would change every row; add a filter)`);
      }
      const hit = tables[t].filter((r) => matches(r, filters));
      logEntry(kind);
      if (kind === "update") {
        const changes = wire(patch);
        for (const row of hit) {
          const clash = findConflict(t, { ...row, ...changes }, row);
          if (clash) return fail(conflictError(t, clash.cols, { ...row, ...changes }));
        }
        for (const row of hit) Object.assign(row, changes);
        return finish(returning ? hit.map(project) : null);
      }
      // In place, so a test's reference to fake.tables.x stays valid.
      for (const row of hit) tables[t].splice(tables[t].indexOf(row), 1);
      return finish(returning ? hit.map(project) : null);
    };

    /** Apply single()/maybeSingle() to a list result. */
    const finish = (rows: Row[] | null, count: number | null = null): Result => {
      if (mode === "many" || rows === null) return ok(rows, count);
      if (rows.length === 1) return { ...ok(rows, count), data: rows[0]! };
      if (rows.length === 0 && mode === "maybe") return { ...ok(null, count), status: 200 };
      return {
        data: null,
        error: pgError("PGRST116", "JSON object requested, multiple (or no) rows returned", `The result contains ${rows.length} rows`),
        count: null,
        status: 406,
        statusText: "Not Acceptable",
      };
    };

    const filter = (kind: FilterKind, column: string, value: unknown) => {
      filters.push({ kind, column, value: wire(value) });
      return self;
    };

    const api = {
      select(cols?: string, opts?: { count?: string; head?: boolean }) {
        if (cols !== undefined && cols.trim() !== "*") {
          const list = cols.split(",").map((c) => c.trim());
          if (!list.every((c) => /^[a-z_][a-z0-9_]*$/.test(c))) {
            // Embedded resources (turns(*)), aliases, casts and JSON paths: the fake does no joins.
            throw new FakeDbUnsupported(`query shape ${t}.select(${show([cols])}) (only plain column lists are projected)`);
          }
          columns = list;
        }
        if (op) returning = true;
        if (opts?.count) wantCount = true;
        if (opts?.head) headOnly = true;
        return self;
      },
      insert(rows: Row | Row[]) {
        op = "insert";
        inputs = Array.isArray(rows) ? rows : [rows];
        return self;
      },
      update(values: Row) {
        op = "update";
        patch = values;
        return self;
      },
      upsert(rows: Row | Row[], opts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
        const cols = (opts?.onConflict ?? pkOf(t)).split(",").map((c) => c.trim());
        const declared = uniqueSets(t).some((set) => set.length === cols.length && set.every((c) => cols.includes(c)));
        if (!declared) {
          throw new FakeDbUnsupported(
            `upsert on ${t} with onConflict "${cols.join(",")}": no unique constraint on those columns (Postgres would fail with 42P10). Declare it in the migration and in UNIQUE in test/_fakes.ts.`,
          );
        }
        op = "upsert";
        inputs = Array.isArray(rows) ? rows : [rows];
        onConflict = opts?.onConflict;
        ignoreDuplicates = Boolean(opts?.ignoreDuplicates);
        return self;
      },
      delete() {
        op = "delete";
        return self;
      },
      eq: (column: string, value: unknown) => filter("eq", column, value),
      neq: (column: string, value: unknown) => filter("neq", column, value),
      is: (column: string, value: unknown) => filter("is", column, value),
      gt: (column: string, value: unknown) => filter("gt", column, value),
      gte: (column: string, value: unknown) => filter("gte", column, value),
      lt: (column: string, value: unknown) => filter("lt", column, value),
      lte: (column: string, value: unknown) => filter("lte", column, value),
      in: (column: string, values: unknown[]) => filter("in", column, values),
      not(column: string, operator: string, value: unknown) {
        if (operator === "is" && value === null) return filter("not_is", column, null);
        if (operator === "eq") return filter("neq", column, value);
        throw new FakeDbUnsupported(`query shape ${t}.not(${show([column, operator, value])})`);
      },
      order(column: string, opts?: { ascending?: boolean }) {
        orders.push({ column, ascending: opts?.ascending !== false });
        return self;
      },
      limit(n: number) {
        limitTo = n;
        return self;
      },
      /** PostgREST paging: rows from..to inclusive, after ordering. */
      range(from: number, to: number) {
        rangeTo = [from, to];
        return self;
      },
      single() {
        mode = "single";
        return self;
      },
      maybeSingle() {
        mode = "maybe";
        return self;
      },
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
        try {
          return Promise.resolve(settle()).then(resolve, reject);
        } catch (err) {
          return Promise.reject(err).then(resolve, reject);
        }
      },
    };

    // Every chain method returns this proxy, not `api`, so an unsupported method is
    // named (FakeDbUnsupported) however far down the chain it is called.
    const self: any = new Proxy(api, {
      get(target, prop, receiver) {
        if (prop in target) return Reflect.get(target, prop, receiver);
        if (typeof prop === "symbol" || PASSTHROUGH.has(prop)) return undefined;
        // textSearch, like, ilike, or, contains, match, filter, csv, ...: named when CALLED.
        return (...args: unknown[]) => {
          throw new FakeDbUnsupported(`query shape ${t}.${prop}(${show(args)})`);
        };
      },
    });
    return self;
  }

  // ── rpc ────────────────────────────────────────────────────────

  /**
   * claim_job(p_worker): the oldest runnable job, marked running. Mirrors
   * Charlie's db/0013 minus its per-owner ordering; Task 0.4 / 1.1 own Call's
   * real function and update this when it differs. Runnable = queued and due,
   * or running with a lock more than five minutes old (its worker died).
   */
  const claimJob = (args: Record<string, unknown>) => {
    const now = Date.now();
    const at = (v: unknown): number => (typeof v === "string" ? Date.parse(v) : 0);
    const runnable = tables.jobs.filter(
      (j) => (j.status === "queued" && at(j.run_after) <= now) || (j.status === "running" && now - at(j.locked_at) > STALE_LOCK_MS),
    );
    runnable.sort((a, b) => at(a.run_after) - at(b.run_after) || (order.get(a) ?? 0) - (order.get(b) ?? 0));
    const job = runnable[0];
    if (!job) return { data: [] as Row[], error: null };
    job.status = "running";
    job.attempts = (job.attempts ?? 0) + 1;
    job.locked_at = new Date().toISOString();
    job.locked_by = args.p_worker ?? null;
    return { data: [structuredClone(job)], error: null };
  };

  const rpc = (fn: string, args: Record<string, unknown> = {}) => {
    if (fn !== "claim_job") throw new FakeDbUnsupported(`rpc("${fn}")`);
    log.push({ table: "", op: "rpc", filters: [], fn, args: wire(args) });
    return Promise.resolve(claimJob(args));
  };

  const surface = {
    from(name: string) {
      if (!TABLE_SET.has(name)) throw new FakeDbUnsupported(`table "${name}" (not a Call table)`);
      return builder(name as TableName);
    },
    rpc,
    storage,
  };
  const client = new Proxy(surface, {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver);
      if (typeof prop === "symbol" || PASSTHROUGH.has(prop)) return undefined;
      throw new FakeDbUnsupported(`client.${prop} (only from, rpc and storage are faked)`);
    },
  }) as unknown as SupabaseClient;

  const fake: FakeDb = {
    client,
    tables,
    log,
    storage,
    reset() {
      for (const t of TABLES) tables[t].length = 0;
      log.length = 0;
      storage.files.clear();
      storage.contentTypes.clear();
    },
    // Nothing to undo until installFakeDb() wires these up.
    uninstall() {},
    restore() {},
  };
  return fake;
}

/**
 * Build a fake database and make db() return it. Call uninstall() when the test
 * is done (it is safe to call twice). Seed rows are copied, and get the same
 * defaults and unique-key checks as an insert; a table that is not a Call table
 * throws before anything is installed.
 */
export function installFakeDb(seed: Record<string, Row[]> = {}): FakeDb {
  const fake = makeFakeDb(seed);
  const restoreClient = __setClient(fake.client);
  let installed = true;
  fake.uninstall = fake.restore = () => {
    if (!installed) return;
    installed = false;
    restoreClient();
  };
  return fake;
}

// ── Storage ──────────────────────────────────────────────────────

type StorageBody = Uint8Array | ArrayBuffer | ArrayBufferView | Blob | string;

export interface FakeStorage {
  /** Every stored object, keyed "bucket/path". */
  files: Map<string, Uint8Array>;
  /** The contentType each upload declared, same keys. */
  contentTypes: Map<string, string>;
  from(bucket: string): FakeBucket;
}

async function toBytes(body: unknown): Promise<Uint8Array> {
  if (typeof body === "string") return new TextEncoder().encode(body);
  if (body instanceof Blob) return new Uint8Array(await body.arrayBuffer());
  if (body instanceof ArrayBuffer) return new Uint8Array(body.slice(0));
  if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength));
  throw new FakeDbUnsupported(`storage upload body of type ${Object.prototype.toString.call(body)}`);
}

const trimSlashes = (s: string): string => s.replace(/^\/+|\/+$/g, "");

export type FakeBucket = ReturnType<typeof makeBucket>;

function makeBucket(bucket: string, files: Map<string, Uint8Array>, contentTypes: Map<string, string>) {
    const keyOf = (path: string): string => `${bucket}/${trimSlashes(path)}`;
    const api = {
      async upload(path: string, body: StorageBody, opts?: { contentType?: string; upsert?: boolean }) {
        const key = keyOf(path);
        if (files.has(key) && !opts?.upsert) {
          return { data: null, error: { message: "The resource already exists", statusCode: "409", error: "Duplicate" } };
        }
        files.set(key, await toBytes(body));
        if (opts?.contentType) contentTypes.set(key, opts.contentType);
        else contentTypes.delete(key);
        return { data: { id: key, path: trimSlashes(path), fullPath: key }, error: null };
      },
      async download(path: string) {
        const key = keyOf(path);
        const bytes = files.get(key);
        if (!bytes) return { data: null, error: { message: "Object not found", statusCode: "404", error: "not_found" } };
        return { data: new Blob([bytes.slice()], { type: contentTypes.get(key) ?? "" }), error: null };
      },
      async remove(paths: string[]) {
        const removed: { name: string; bucket_id: string }[] = [];
        for (const path of paths) {
          if (files.delete(keyOf(path))) {
            contentTypes.delete(keyOf(path));
            removed.push({ name: trimSlashes(path), bucket_id: bucket });
          }
        }
        return { data: removed, error: null };
      },
      /** One level of a folder: files, and sub-folders as entries with id null. */
      async list(prefix = "", opts?: { limit?: number; offset?: number; search?: string; sortBy?: unknown }) {
        if (opts?.search !== undefined || opts?.sortBy !== undefined) {
          throw new FakeDbUnsupported(`storage.from("${bucket}").list with search/sortBy`);
        }
        const folder = trimSlashes(prefix);
        const start = `${bucket}/${folder ? `${folder}/` : ""}`;
        const entries = new Map<string, Record<string, unknown>>();
        for (const [key, bytes] of files) {
          if (!key.startsWith(start)) continue;
          const rest = key.slice(start.length);
          const slash = rest.indexOf("/");
          if (slash >= 0) {
            const name = rest.slice(0, slash);
            entries.set(name, { name, id: null, updated_at: null, created_at: null, last_accessed_at: null, metadata: null });
          } else {
            entries.set(rest, { name: rest, id: key, metadata: { size: bytes.byteLength, mimetype: contentTypes.get(key) ?? null } });
          }
        }
        const sorted = [...entries.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
        const offset = opts?.offset ?? 0;
        return { data: sorted.slice(offset, offset + (opts?.limit ?? 100)), error: null };
      },
    };
    return new Proxy(api, {
      get(target, prop, receiver) {
        if (prop in target) return Reflect.get(target, prop, receiver);
        if (typeof prop === "symbol" || PASSTHROUGH.has(prop)) return undefined;
        return (...args: unknown[]) => {
          throw new FakeDbUnsupported(`storage.from("${bucket}").${prop}(${show(args)})`);
        };
      },
    });
}

/** The supabase-js Storage shape (upload, download, remove, list) over a Map. */
export function fakeStorage(): FakeStorage {
  const files = new Map<string, Uint8Array>();
  const contentTypes = new Map<string, string>();
  return { files, contentTypes, from: (bucket) => makeBucket(bucket, files, contentTypes) };
}

// ── The clock ────────────────────────────────────────────────────

export interface FakeClock {
  now(): number;
  iso(): string;
  /** Jump to an instant (ISO string or epoch milliseconds). */
  set(to: string | number): void;
  advance(ms: number): void;
  restore(): void;
  uninstall(): void;
}

/**
 * Freeze Date.now() and new Date() at `iso`. Time stands still until advance()
 * or set(): a test that says "ten minutes later" means exactly ten minutes.
 * Only Date is faked; timers still run on the real clock, so code that waits
 * (retry backoff) takes an injectable sleep rather than relying on this.
 * Do not nest two fake clocks.
 */
export function fakeClock(iso = "2026-10-31T08:00:00.000Z"): FakeClock {
  const RealDate = globalThis.Date;
  const parse = (to: string | number): number => {
    const ms = typeof to === "number" ? to : RealDate.parse(to);
    if (Number.isNaN(ms)) throw new Error(`fakeClock: not a date: ${String(to)}`);
    return ms;
  };
  let current = parse(iso);

  // A Proxy over the real Date, so instanceof, Date.UTC, Date.parse and
  // new Date(args) all keep working; only the no-argument forms read the fake.
  const FakeDate = new Proxy(RealDate, {
    construct: (target, args, newTarget) => Reflect.construct(target, args.length ? args : [current], newTarget),
    apply: () => new RealDate(current).toString(),
    get: (target, prop) => (prop === "now" ? () => current : Reflect.get(target, prop, target)),
  });
  globalThis.Date = FakeDate as unknown as DateConstructor;

  const clock: FakeClock = {
    now: () => current,
    iso: () => new RealDate(current).toISOString(),
    set(to) {
      current = parse(to);
    },
    advance(ms) {
      current += ms;
    },
    restore() {
      globalThis.Date = RealDate;
    },
    uninstall() {
      clock.restore();
    },
  };
  return clock;
}

// ── The network ──────────────────────────────────────────────────

/** One request the fake fetch saw. */
export interface FetchCall {
  url: string;
  method: string;
  /** Lower-cased names. */
  headers: Record<string, string>;
  body: string | null;
  /** The body parsed as JSON, when it is JSON. */
  json: unknown;
  init: RequestInit | undefined;
}

export interface ModelCall {
  model: string;
  /** The text of every message, joined by newlines. */
  prompt: string;
    payload: Record<string, any>;
}

export interface FakeNet {
  /** Every request, in order, whether or not anything answered it. */
  calls: FetchCall[];
  /** The OpenRouter chat calls among them. */
  modelCalls: ModelCall[];
  /**
   * Answer a chat call whose prompt (all messages joined) matches. `respond`
   * returns the message content (an object is JSON-stringified), or a
   * Response, which is sent as-is: an error status, a truncated body. It may be
   * async, and is given the request's init (its abort signal, say). First
   * registered match wins. No match throws, so an unscripted model call fails
   * the test instead of inventing an answer.
   */
  onModel(match: RegExp | string, respond: (prompt: string, init?: RequestInit) => unknown | Promise<unknown>): void;
  /**
   * Answer any other request whose URL matches. An object becomes a 200 JSON
   * response; a Response is sent as-is. Checked before the chat route, so a
   * test can also intercept an OpenRouter audio or embeddings URL.
   */
  onFetch(urlMatch: RegExp | string, respond: (call: FetchCall) => unknown | Promise<unknown>): void;
  fetch: typeof fetch;
  restore(): void;
  uninstall(): void;
}

export const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const toRe = (m: RegExp | string): RegExp => (typeof m === "string" ? new RegExp(escapeRe(m)) : m);

const CHAT_URL = /openrouter\.ai\/api\/v1\/chat\/completions/;

/** Replace global fetch. Nothing reaches the network: an unscripted request throws. */
export function installFakeNet(): FakeNet {
  const real = globalThis.fetch;
  const calls: FetchCall[] = [];
  const modelCalls: ModelCall[] = [];
  const modelRoutes: { match: RegExp; respond: (prompt: string, init?: RequestInit) => unknown | Promise<unknown> }[] = [];
  const fetchRoutes: { match: RegExp; respond: (call: FetchCall) => unknown | Promise<unknown> }[] = [];

  const toResponse = (value: unknown): Response => (value instanceof Response ? value : jsonResponse(value === undefined ? {} : value));

  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const headers: Record<string, string> = {};
    new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)).forEach((v, k) => {
      headers[k.toLowerCase()] = v;
    });
    let body: string | null = typeof init?.body === "string" ? init.body : null;
    if (body === null && input instanceof Request && input.method !== "GET" && input.method !== "HEAD") {
      body = await input.clone().text();
    }
    let parsed: unknown;
    try {
      parsed = body === null ? undefined : JSON.parse(body);
    } catch {
      parsed = undefined;
    }
    const call: FetchCall = {
      url,
      method: (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase(),
      headers,
      body,
      json: parsed,
      init,
    };
    calls.push(call);

    const route = fetchRoutes.find((r) => r.match.test(url));
    if (route) return toResponse(await route.respond(call));

    if (CHAT_URL.test(url)) {
            const payload = (parsed ?? {}) as Record<string, any>;
      // Multimodal messages carry an array of parts; the prompt is the text ones.
      const prompt = ((payload.messages ?? []) as { content: unknown }[])
        .map((m) =>
          Array.isArray(m.content)
            ? m.content.filter((p: { type?: string }) => p?.type === "text").map((p: { text: string }) => p.text).join("\n")
            : String(m.content ?? ""),
        )
        .join("\n");
      modelCalls.push({ model: payload.model, prompt, payload });
      const hit = modelRoutes.find((r) => r.match.test(prompt));
      if (!hit) throw new Error(`fake net: no scripted model response for prompt starting:\n${prompt.slice(0, 300)}`);
      const content = await hit.respond(prompt, init);
      if (content instanceof Response) return content;
      return jsonResponse({
        id: `gen-test-${modelCalls.length}`,
        model: payload.model,
        choices: [
          { index: 0, message: { role: "assistant", content: typeof content === "string" ? content : JSON.stringify(content) }, finish_reason: "stop" },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
      });
    }

    // Anything else in a test is a mistake worth failing on.
    throw new Error(`fake net: unexpected request to ${url}`);
  }) as typeof fetch;

  globalThis.fetch = fakeFetch;

  const net: FakeNet = {
    calls,
    modelCalls,
    onModel: (match, respond) => {
      modelRoutes.push({ match: toRe(match), respond });
    },
    onFetch: (urlMatch, respond) => {
      fetchRoutes.push({ match: toRe(urlMatch), respond });
    },
    fetch: fakeFetch,
    restore() {
      globalThis.fetch = real;
    },
    uninstall() {
      net.restore();
    },
  };
  return net;
}
