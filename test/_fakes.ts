// Call — in-memory stand-ins for Supabase (database and Storage), the clock,
// and the network (OpenRouter, Resend, Meta, ElevenLabs).
//
// Ported from Charlie `test/_fakes.ts`; the why-comments are kept. Added here:
// Storage, the clock, a table list that knows every Call table and its
// columns, unique constraints, and a structured query log.
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
//   - rows come back as copies, so mutating a result cannot "update" the table;
//   - a column is checked against api/_lib/types.ts wherever it is named
//     (filter, order, select, write, seed): PostgREST answers a typo with
//     42703, where a schemaless fake let `.is("lockd_at", null)` match every row;
//   - a filter value of undefined, or null anywhere but `.is()`, throws:
//     supabase-js sends them as the text "undefined" / "null";
//   - an option the fake does not implement throws instead of being ignored;
//   - a batch whose rows have different keys throws: supabase-js sends the
//     union of keys, and PostgREST writes NULL, not the default, into the gaps.
//
// Not emulated: foreign keys and cascades (forgetClient deletes explicitly),
// RLS (db/0007 and test/rls.test.ts own that), column types and NOT NULL /
// CHECK constraints, joins.
//
// Several tasks extend this file (0.3 finish_reason, 0.6 the intel_events
// missing-table switch); add the shape you need and keep the throw. Task 0.3
// added modelReply() (a chat reply with any finish_reason and usage), the
// bump_incident rpc (track.ts counts incidents through it), and failTable() (a
// table that answers every query with an error: "model_config is unreadable").

// Must be first: api/_lib/env.ts snapshots process.env when it is first imported,
// and importing the fakes imports api/_lib/db.ts which imports it.
import "./_env.ts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { __setClient } from "../api/_lib/db.ts";
import type { TableName, TableRows } from "../api/_lib/types.ts";

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

// ── Every column, by table ───────────────────────────────────────

/**
 * Every column of every table, exactly as api/_lib/types.ts declares them. A
 * column named anywhere else throws, so a typo is loud. types.ts is the
 * authority: a column listed here that types.ts lacks, or one types.ts has
 * that is missing here, fails the typecheck (below).
 */
const COLUMNS = {
  brokers: ["id", "name", "fsp_number", "agent_name", "country", "currency", "auto_send", "retention_days", "notify_channel", "notify_email", "notify_whatsapp", "elevenlabs_agent_id", "phone_number_e164", "voice_id", "agent_llm", "created_at"],
  broker_users: ["id", "broker_id", "email", "name", "role", "last_login_at", "created_at"],
  login_codes: ["id", "email", "code_hash", "expires_at", "used_at", "created_at"],
  sessions_auth: ["id", "broker_user_id", "token_hash", "expires_at", "created_at"],
  clients: ["id", "broker_id", "phone_e164", "whatsapp_e164", "email", "first_name", "last_name", "preferred_channel", "last_inbound_at", "forgotten_at", "created_at"],
  sessions: [
    "id", "broker_id", "client_id", "mode", "provider", "conversation_id", "started_at", "ended_at", "duration_secs", "outcome", "consent_turn_id",
    "readback_confirmed", "channel_chosen", "caller_id_raw", "cost_cents", "provider_analysis", "provider_summary", "provider_cost", "turn_count", "continues_session_id", "created_at",
  ],
  turns: ["id", "session_id", "idx", "role", "text", "t_start_secs", "t_end_secs", "tool_calls", "created_at"],
  recordings: ["id", "session_id", "storage_path", "mime", "bytes", "duration_secs", "delete_after", "deleted_at", "created_at"],
  consents: ["id", "session_id", "client_id", "kind", "granted", "turn_id", "method", "created_at"],
  callbacks: ["id", "session_id", "client_id", "reason", "preferred_time", "done_at", "created_at"],
  client_messages: ["id", "broker_id", "client_id", "direction", "body", "provider_id", "read_at", "created_at"],
  meeting_chunks: ["id", "session_id", "idx", "storage_path", "bytes", "mime", "created_at"],
  facts: [
    "id", "session_id", "client_id", "rel", "label", "value_text", "value_num", "unit", "per", "turn_id", "confidence", "status", "supersedes_id", "source",
    "approx", "value_min", "value_max", "created_at",
  ],
  fact_refusals: ["id", "session_id", "rel", "label", "reason", "raw", "created_at"],
  needs: ["id", "session_id", "kind", "priority", "basis", "note", "created_at"],
  recommendations: [
    "id", "need_id", "product_id", "cover_amount", "term_months", "premium_cents", "premium_basis", "why", "alternative_if", "considered", "status",
    "replaces_fact_id", "created_at",
  ],
  quotes: [
    "id", "session_id", "client_id", "broker_id", "version", "status", "html", "pdf_path", "total_premium_cents", "checker_report", "approved_by", "approved_at",
    "outcome", "outcome_at", "flags", "created_at",
  ],
  deliveries: ["id", "quote_id", "channel", "to_address", "provider_id", "status", "error", "sent_at", "updated_at", "created_at"],
  hardship_notes: ["id", "session_id", "quotes_from_client", "next_step", "created_at"],
  product_categories: ["id", "name", "need_kinds", "country", "created_at"],
  products: [
    "id", "broker_id", "category_id", "provider_name", "name", "summary", "min_age", "max_age", "min_cover", "max_cover", "term_rules", "eligibility",
    "exclusions", "keywords", "verified_on", "source_url", "active", "is_demo", "created_at",
  ],
  product_pricing: ["id", "product_id", "age_from", "age_to", "smoker", "rate_per_1000", "flat_cents", "min_premium_cents", "verified_on", "created_at"],
  disclosures: ["id", "country", "key", "text", "verified_on", "created_at"],
  model_config: ["role", "provider", "model", "fallbacks", "params", "enabled", "created_at"],
  jobs: ["id", "kind", "session_id", "payload", "status", "attempts", "run_after", "locked_by", "locked_at", "last_error", "dedupe_key", "created_at"],
  webhook_events: ["id", "provider", "event_type", "external_id", "signature_ok", "raw", "received_at", "processed_at", "created_at"],
  safety_events: ["id", "session_id", "check", "engine", "outcome", "detail", "created_at"],
  usage_ledger: ["id", "session_id", "item", "qty", "unit", "cost_cents", "provider_ref", "created_at"],
  audit_log: ["id", "broker_user_id", "action", "entity", "entity_id", "before", "after", "at", "created_at"],
  incidents: ["id", "kind", "severity", "summary", "fingerprint", "first_at", "last_at", "count", "created_at"],
  // INTEL-CONTRACT §1 exactly: its timestamp is `at`, and there is no created_at.
  intel_events: [
    "id", "at", "seq", "app", "v", "trace_id", "turn_id", "job_id", "business_id", "channel", "stage", "kind", "name", "actor", "ok", "ms", "content_mode",
    "content", "meta", "source_ref",
  ],
} as const satisfies { readonly [T in TableName]: readonly (keyof TableRows[T])[] };

type UnlistedColumns = { [T in TableName]: Exclude<keyof TableRows[T], (typeof COLUMNS)[T][number]> }[TableName];
const allColumnsListed: [UnlistedColumns] extends [never] ? true : never = true;
void allColumnsListed;

/** The columns types.ts gives a JSON shape (unknown, or a Record): the jsonb columns. */
type JsonColumn<R> = { [K in keyof R]: [R[K]] extends [string | number | boolean | null | string[]] ? never : K }[keyof R];

/** The jsonb columns, the only ones a `col->>key` path may read. Complete in both directions, like COLUMNS. */
const JSONB = {
  sessions: ["provider_analysis"],
  turns: ["tool_calls"],
  fact_refusals: ["raw"],
  needs: ["basis"],
  recommendations: ["premium_basis", "considered"],
  quotes: ["checker_report"],
  products: ["term_rules", "eligibility"],
  model_config: ["params"],
  jobs: ["payload"],
  webhook_events: ["raw"],
  safety_events: ["detail"],
  audit_log: ["before", "after"],
  intel_events: ["content", "meta"],
} as const satisfies { readonly [T in TableName]?: readonly JsonColumn<TableRows[T]>[] };

type UnlistedJson = {
  [T in TableName]: Exclude<JsonColumn<TableRows[T]>, T extends keyof typeof JSONB ? (typeof JSONB)[T][number] : never>;
}[TableName];
const allJsonListed: [UnlistedJson] extends [never] ? true : never = true;
void allJsonListed;

const COLUMN_SETS: ReadonlyMap<string, ReadonlySet<string>> = new Map(Object.entries(COLUMNS).map(([t, cols]) => [t, new Set<string>(cols)]));
const JSONB_SETS: ReadonlyMap<string, ReadonlySet<string>> = new Map(Object.entries(JSONB).map(([t, cols]) => [t, new Set<string>(cols)]));

/** Primary key, where it is not `id`. */
const PRIMARY_KEY: Partial<Record<TableName, string>> = { model_config: "role" };

/** bigint `generated always as identity` ids (a number, never written by the caller), not uuids. */
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
  // bump_incident's arbiter: one row per distinct problem (Charlie db/0024 made it the primary key).
  incidents: [["fingerprint"]],
  intel_events: [["source_ref"]],
};

/**
 * Column defaults: every non-null column of types.ts that has one in the
 * migration. Task 1.1 writes the SQL to match (the plan notes repeat this
 * list). Without them a fake row has no key at all where Postgres gives the
 * default, so `cost_cents + 1` is NaN. auto_send false is SPEC R12. As in SQL,
 * a default applies only when the key is absent: an explicit null stays null.
 * created_at (now) is added for every table that has the column, which is
 * every table but intel_events.
 */
const DEFAULTS: { readonly [T in TableName]?: () => Partial<TableRows[T]> } = {
  brokers: () => ({ country: "ZA", currency: "ZAR", auto_send: false, retention_days: 30 }),
  sessions: () => ({ readback_confirmed: false, cost_cents: 0 }),
  facts: () => ({ approx: false, status: "active" }),
  recommendations: () => ({ status: "draft" }),
  quotes: () => ({ version: 1, status: "draft", flags: [] }),
  deliveries: () => ({ status: "queued" }),
  hardship_notes: () => ({ quotes_from_client: [] }),
  product_categories: () => ({ need_kinds: [] }),
  products: () => ({ active: true, is_demo: true, exclusions: [], keywords: [] }),
  model_config: () => ({ fallbacks: [], params: {}, enabled: true }),
  jobs: () => ({ payload: {}, status: "queued", attempts: 0, run_after: new Date().toISOString() }),
  webhook_events: () => ({ received_at: new Date().toISOString() }),
  audit_log: () => ({ at: new Date().toISOString() }),
  incidents: () => {
    const now = new Date().toISOString();
    return { first_at: now, last_at: now, count: 1 };
  },
  intel_events: () => ({ at: new Date().toISOString(), seq: 0, v: 1, content_mode: "full" }),
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

/**
 * Wrap a builder so a method it lacks (textSearch, like, ilike, or, csv, ...)
 * throws FakeDbUnsupported naming the shape when it is CALLED, however far down
 * the chain. Every chain method returns this proxy, never the bare target.
 */
function refuseUnknown<T extends object>(target: T, shape: (prop: string, args: unknown[]) => string): T {
  return new Proxy(target, {
    get(t, prop, receiver) {
      if (prop in t) return Reflect.get(t, prop, receiver);
      if (typeof prop === "symbol" || PASSTHROUGH.has(prop)) return undefined;
      return (...args: unknown[]) => {
        throw new FakeDbUnsupported(shape(prop, args));
      };
    },
  });
}

/** An option the fake ignored would be a silently wrong answer, so any key it does not implement throws. */
const onlyOptions = (shape: string, opts: unknown, allowed: readonly string[]): void => {
  if (opts === undefined || opts === null) return;
  if (typeof opts !== "object") throw new FakeDbUnsupported(`${shape}: options ${show([opts])} are not an object`);
  const extra = Object.entries(opts)
    .filter(([key, value]) => value !== undefined && !allowed.includes(key))
    .map(([key]) => `"${key}"`);
  if (extra.length > 0) {
    throw new FakeDbUnsupported(`${shape}: option ${extra.join(", ")} (the fake implements ${allowed.length ? allowed.join(", ") : "no options"} here)`);
  }
};

// ── Columns and filters ──────────────────────────────────────────

const PLAIN = /^[a-z_][a-z0-9_]*$/;
/** `col->>key`: a jsonb column's key, as text. JSON keys are case-sensitive, so the key may be camelCase. */
const JSON_TEXT = /^([a-z_][a-z0-9_]*)->>([A-Za-z0-9_]+)$/;

const requireColumn = (t: TableName, column: string, shape: string): void => {
  if (!COLUMN_SETS.get(t)!.has(column)) {
    throw new FakeDbUnsupported(`${shape}: "${column}" is not a column of ${t} (api/_lib/types.ts; PostgREST answers 42703)`);
  }
};

/** A column the query reads: a plain column, or one key of a jsonb column. */
interface ColumnRef {
  column: string;
  key: string | null;
}

/**
 * Resolve a filter or order column, or throw. Two shapes are faked: a column of
 * the table, and `col->>key` on one of its jsonb columns. Everything else
 * throws: `->` (it yields jsonb, so an absent key and a JSON null are not the
 * same NULL), deeper paths, casts, `->>` on a column that is not jsonb
 * (Postgres: 42883), and any column the table does not have. The schemaless
 * version read them all as "an absent column", which matched nothing, or, under
 * `.is(x, null)`, everything.
 */
const resolveColumn = (t: TableName, column: unknown, shape: string): ColumnRef => {
  if (typeof column !== "string") throw new FakeDbUnsupported(`${shape}: the column is not a string`);
  if (PLAIN.test(column)) {
    requireColumn(t, column, shape);
    return { column, key: null };
  }
  const path = JSON_TEXT.exec(column);
  if (!path) throw new FakeDbUnsupported(`${shape}: column shape "${column}" (only a column, or col->>key on a jsonb column, is faked)`);
  requireColumn(t, path[1]!, shape);
  if (!JSONB_SETS.get(t)?.has(path[1]!)) {
    throw new FakeDbUnsupported(`${shape}: "${path[1]}" is not a jsonb column of ${t}, so "${column}" is an operator error (Postgres: 42883)`);
  }
  return { column: path[1]!, key: path[2]! };
};

/** Every key a write names must be a column (PostgREST: PGRST204). */
const requireWriteColumns = (t: TableName, rows: Row[], shape: string): void => {
  for (const row of rows) {
    if (row === null || typeof row !== "object" || Array.isArray(row)) throw new FakeDbUnsupported(`${shape}: a row that is not an object`);
    for (const column of Object.keys(row)) requireColumn(t, column, shape);
  }
};

/**
 * supabase-js sends a batch's union of keys as `columns` (a key whose value is
 * undefined counts), and PostgREST writes NULL — not the column default — into
 * every row that lacks one; on an upsert's update it overwrites the stored
 * value too. So a batch whose rows differ would write NULL status in
 * production while the fake applied 'queued'. Refused, unless an insert passes
 * defaultToNull: false (supabase-js then sends missing=default, which is what
 * the fake does).
 */
const requireSameKeys = (rows: Row[], shape: string, remedy: string): void => {
  const union = new Set(rows.flatMap((r) => Object.keys(r)));
  if (rows.every((r) => Object.values(r).filter((v) => v !== undefined).length === union.size)) return;
  throw new FakeDbUnsupported(
    `${shape}: rows with different keys (or an undefined value). supabase-js sends the union of keys, and PostgREST writes NULL into each gap, not the default. Give every row the same keys${remedy}`,
  );
};

type FilterKind = "eq" | "neq" | "is" | "not_is" | "gt" | "gte" | "lt" | "lte" | "in";

interface Filter {
  kind: FilterKind;
  /** As the caller wrote it, for the log. */
  column: string;
  ref: ColumnRef;
  value: unknown;
}

/**
 * Refuse a value PostgREST would not compare the way the code means:
 * undefined goes over the wire as the text "undefined" (22P02 on a uuid
 * column), and `eq(col, null)` compares with the text 'null', which never
 * matches a NULL. `is()` takes null, true or false, and nothing else.
 */
const checkFilterValue = (kind: FilterKind, value: unknown, shape: string): void => {
  const one = (v: unknown) => {
    if (v === undefined) throw new FakeDbUnsupported(`${shape}: the value is undefined (supabase-js sends the text "undefined")`);
    if (v === null) throw new FakeDbUnsupported(`${shape}: null here compares with the text 'null' and never matches a NULL; use .is(column, null)`);
  };
  if (kind === "is" || kind === "not_is") {
    if (value === undefined) one(value);
    if (value !== null && value !== true && value !== false) throw new FakeDbUnsupported(`${shape}: is() takes null, true or false`);
    return;
  }
  if (kind === "in") {
    if (!Array.isArray(value)) throw new FakeDbUnsupported(`${shape}: in() takes an array`);
    value.forEach(one);
    return;
  }
  one(value);
};

/** The value a column reference reads: `col->>key` gives the key as text, and JSON null or an absent key as NULL. */
const columnValue = (row: Row, ref: ColumnRef): unknown => {
  const v = row[ref.column];
  if (ref.key === null) return v;
  const inner = v !== null && typeof v === "object" && !Array.isArray(v) ? v[ref.key] : undefined;
  if (inner === null || inner === undefined) return null;
  return typeof inner === "object" ? JSON.stringify(inner) : String(inner);
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
    const v = columnValue(row, f.ref);
    switch (f.kind) {
      case "eq":
        return same(v, f.value);
      case "is":
        return f.value === null ? isNil(v) : v === f.value;
      // NOT (x IS TRUE) holds for false and for NULL.
      case "not_is":
        return f.value === null ? !isNil(v) : v !== f.value;
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

// ── Results, as supabase-js shapes them ──────────────────────────

const pgError = (code: string, message: string, details: string | null = null, hint: string | null = null) => ({ code, message, details, hint });
type PgError = ReturnType<typeof pgError>;

interface Result {
  data: Row[] | Row | null;
  error: PgError | null;
  count: number | null;
  status: number;
  statusText: string;
}

type Mode = "many" | "single" | "maybe";

const ok = (data: Row[] | null, count: number | null = null): Result => ({ data, error: null, count, status: data === null ? 204 : 200, statusText: "OK" });
const fail = (error: PgError, status = 409): Result => ({ data: null, error, count: null, status, statusText: "Error" });

/** Apply single()/maybeSingle() to a list result. */
const finish = (rows: Row[] | null, count: number | null, mode: Mode): Result => {
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

// Postgres refuses a caller-written value in a `generated always as identity` column.
const identityInsertError = () =>
  pgError("428C9", `cannot insert a non-DEFAULT value into column "id"`, `Column "id" is an identity column defined as GENERATED ALWAYS.`, "Use OVERRIDING SYSTEM VALUE to override.");
const identityUpdateError = () => pgError("428C9", `column "id" can only be updated to DEFAULT`, `Column "id" is an identity column defined as GENERATED ALWAYS.`);

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
  /**
   * Make every query on `table` answer with `error` (default 42P01, the table
   * does not exist) instead of running, until failTable(table, null). The query
   * is still logged. For "the table is unreadable" (model_config, C-1523) and,
   * later, "intel_events is missing" (Task 0.6).
   */
  failTable(table: TableName, error?: { code: string; message: string } | null): void;
  /** Empty every table, the log and Storage, and clear every failTable() switch. */
  reset(): void;
  /** Take this client back out of db(). */
  uninstall(): void;
  restore(): void;
}

const STALE_LOCK_MS = 300_000;

/** Build a fake database without installing it. */
export function makeFakeDb(seed: Record<string, Row[]> = {}): FakeDb {
  for (const [name, rows] of Object.entries(seed)) {
    if (!TABLE_SET.has(name)) throw new FakeDbUnsupported(`seed table "${name}" (not a Call table)`);
    requireWriteColumns(name as TableName, rows, `seed for "${name}"`);
  }
  const tables = Object.fromEntries(TABLES.map((t) => [t, [] as Row[]])) as Record<TableName, Row[]>;
  const log: QueryLog[] = [];
  const storage = fakeStorage();
  /** failTable() switches: a table here answers every query with its error. */
  const failing = new Map<TableName, PgError>();

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

  /** A new row as the INSERT would store it: defaults where a key is absent, then a generated id. */
  const fill = (t: TableName, wired: Row): Row => {
    const row: Row = { ...DEFAULTS[t]?.(), ...wired };
    if (COLUMN_SETS.get(t)!.has("created_at") && !("created_at" in row)) row.created_at = new Date().toISOString();
    if (pkOf(t) === "id" && isNil(row.id)) row.id = freshId(t);
    return row;
  };

  /**
   * The first unique key two rows of `after` (the whole table as the statement
   * would leave it) share, where one of them is new or changed. Checked on the
   * end state, as Postgres does for one statement, so two rows of one UPDATE
   * that collide with each other are caught too. NULL never conflicts.
   */
  const firstConflict = (t: TableName, after: Row[], changed: ReadonlySet<Row>): { cols: string[]; row: Row } | null => {
    for (const cols of uniqueSets(t)) {
      const seen = new Map<string, Row>();
      for (const row of after) {
        if (cols.some((c) => isNil(row[c]))) continue;
        const key = JSON.stringify(cols.map((c) => String(row[c])));
        const prior = seen.get(key);
        if (prior && (changed.has(row) || changed.has(prior))) return { cols, row: changed.has(row) ? row : prior };
        seen.set(key, row);
      }
    }
    return null;
  };
  const conflictError = (t: TableName, cols: string[], row: Row) =>
    pgError(
      "23505",
      `duplicate key value violates unique constraint "${t}_${cols.join("_")}_key"`,
      `Key (${cols.join(", ")})=(${cols.map((c) => String(row[c])).join(", ")}) already exists.`,
    );

  /** All-or-nothing, like one INSERT statement. A seed may write a bigint id; a client insert may not (428C9). */
  const insertRows = (t: TableName, inputs: Row[], fromClient: boolean): { rows: Row[] } | { error: PgError; status: number } => {
    const wired = inputs.map((r) => wire(r));
    if (fromClient && BIGINT_ID.has(t) && wired.some((r) => "id" in r)) return { error: identityInsertError(), status: 400 };
    const staged = wired.map((r) => fill(t, r));
    const clash = firstConflict(t, [...tables[t], ...staged], new Set(staged));
    if (clash) return { error: conflictError(t, clash.cols, clash.row), status: 409 };
    for (const row of staged) {
      order.set(row, ++orderCounter);
      tables[t].push(row);
    }
    return { rows: staged };
  };

  for (const [name, rows] of Object.entries(seed)) {
    const res = insertRows(name as TableName, rows, false);
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
    const orders: { ref: ColumnRef; ascending: boolean; nullsFirst: boolean }[] = [];
    let limitTo: number | null = null;
    let rangeTo: [number, number] | null = null;
    let wantCount = false;
    let headOnly = false;
    let mode: Mode = "many";

    const shapeOf = (method: string, args: unknown[]): string => `query shape ${t}.${method}(${show(args)})`;

    const project = (row: Row): Row => {
      if (!columns) return structuredClone(row);
      return Object.fromEntries(columns.map((c) => [c, structuredClone(isNil(row[c]) ? null : row[c])]));
    };

    const selected = (): Row[] => {
      let rows = tables[t].filter((r) => matches(r, filters));
      // A stable sort per key, last key first. Postgres puts NULLs last ascending
      // and first descending unless nullsFirst says otherwise.
      for (const { ref, ascending, nullsFirst } of [...orders].reverse()) {
        rows = [...rows].sort((a, b) => {
          const av = columnValue(a, ref);
          const bv = columnValue(b, ref);
          if (isNil(av) && isNil(bv)) return 0;
          if (isNil(av)) return nullsFirst ? -1 : 1;
          if (isNil(bv)) return nullsFirst ? 1 : -1;
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

    const done = (rows: Row[] | null, count: number | null = null): Result => finish(rows, count, mode);

    /** One INSERT ... ON CONFLICT statement: every row is staged, then all apply or none do. */
    const upsertRows = (): Result => {
      const wired = inputs.map((r) => wire(r));
      if (BIGINT_ID.has(t) && wired.some((r) => "id" in r)) return fail(identityInsertError(), 400);
      const cols = (onConflict ?? pkOf(t)).split(",").map((c) => c.trim());
      const updates = new Map<Row, Row>();
      const inserts: Row[] = [];
      const out: Row[] = [];
      const seenKeys = new Set<string>();
      for (const incoming of wired) {
        const keyed = cols.every((c) => !isNil(incoming[c]));
        if (keyed) {
          const key = JSON.stringify(cols.map((c) => String(incoming[c])));
          if (seenKeys.has(key)) {
            // ON CONFLICT DO NOTHING skips the second; DO UPDATE refuses the statement.
            if (ignoreDuplicates) continue;
            return fail(
              pgError(
                "21000",
                "ON CONFLICT DO UPDATE command cannot affect row a second time",
                null,
                "Ensure that no rows proposed for insertion within the same command have duplicate constrained values.",
              ),
              400,
            );
          }
          seenKeys.add(key);
        }
        const existing = keyed ? tables[t].find((r) => cols.every((c) => same(r[c], incoming[c]))) : undefined;
        if (existing) {
          if (ignoreDuplicates) continue;
          const merged = { ...existing, ...incoming };
          updates.set(existing, merged);
          out.push(merged);
        } else {
          const row = fill(t, incoming);
          inserts.push(row);
          out.push(row);
        }
      }
      const after = [...tables[t].map((r) => updates.get(r) ?? r), ...inserts];
      const clash = firstConflict(t, after, new Set([...updates.values(), ...inserts]));
      if (clash) return fail(conflictError(t, clash.cols, clash.row));
      for (const [row, merged] of updates) Object.assign(row, merged);
      for (const row of inserts) {
        order.set(row, ++orderCounter);
        tables[t].push(row);
      }
      return done(returning ? out.map(project) : null);
    };

    const settle = (): Result => {
      const kind = op ?? "select";

      const broken = failing.get(t);
      if (broken) {
        logEntry(kind);
        return fail(broken, broken.code === "42P01" ? 404 : 500);
      }

      if (kind === "select") {
        logEntry("select");
        const all = selected();
        let rows = all;
        if (rangeTo) rows = rows.slice(rangeTo[0], rangeTo[1] + 1);
        if (limitTo !== null) rows = rows.slice(0, limitTo);
        const count = wantCount ? all.length : null;
        return done(headOnly ? null : rows.map(project), count);
      }

      if (kind === "insert") {
        logEntry("insert");
        const res = insertRows(t, inputs, true);
        if ("error" in res) return fail(res.error, res.status);
        return done(returning ? res.rows.map(project) : null);
      }

      if (kind === "upsert") {
        logEntry("upsert");
        return upsertRows();
      }

      // update and delete
      if (filters.length === 0) {
        throw new FakeDbUnsupported(`unfiltered ${kind} on ${t} (it would change every row; add a filter)`);
      }
      const hit = tables[t].filter((r) => matches(r, filters));
      logEntry(kind);
      if (kind === "update") {
        const changes = wire(patch);
        if (BIGINT_ID.has(t) && "id" in changes) return fail(identityUpdateError(), 400);
        const merged = new Map(hit.map((row) => [row, { ...row, ...changes }]));
        const clash = firstConflict(t, tables[t].map((r) => merged.get(r) ?? r), new Set(merged.values()));
        if (clash) return fail(conflictError(t, clash.cols, clash.row));
        for (const [row, next] of merged) Object.assign(row, next);
        return done(returning ? hit.map(project) : null);
      }
      // In place, so a test's reference to fake.tables.x stays valid.
      for (const row of hit) tables[t].splice(tables[t].indexOf(row), 1);
      return done(returning ? hit.map(project) : null);
    };

    const filter = (kind: FilterKind, shape: string, column: unknown, value: unknown) => {
      const ref = resolveColumn(t, column, shape);
      checkFilterValue(kind, value, shape);
      filters.push({ kind, column: column as string, ref, value: wire(value) });
      return self;
    };

    const api = {
      select(cols?: string, opts?: { count?: string; head?: boolean }) {
        const shape = shapeOf("select", opts === undefined ? [cols] : [cols, opts]);
        if (op) {
          // After a write, supabase-js's select() takes columns only and drops anything else.
          if (opts !== undefined) throw new FakeDbUnsupported(`${shape} after ${op}: supabase-js takes no select() options after a write`);
          returning = true;
        } else {
          onlyOptions(shape, opts, ["count", "head"]);
          // planned and estimated are the planner's guesses; no test can know what Postgres would answer.
          if (opts?.count !== undefined && opts.count !== "exact") throw new FakeDbUnsupported(`${shape}: count "${opts.count}" (only "exact" is faked)`);
          if (opts?.count) wantCount = true;
          if (opts?.head) headOnly = true;
        }
        if (cols !== undefined && cols.trim() !== "*") {
          const list = cols.split(",").map((c) => c.trim());
          if (!list.every((c) => PLAIN.test(c))) {
            // Embedded resources (turns(*)), aliases, casts and JSON paths: the fake does no joins.
            throw new FakeDbUnsupported(`query shape ${t}.select(${show([cols])}) (only plain column lists are projected)`);
          }
          for (const c of list) requireColumn(t, c, shape);
          columns = list;
        }
        return self;
      },
      insert(rows: Row | Row[], opts?: { defaultToNull?: boolean }) {
        const shape = shapeOf("insert", [rows]);
        onlyOptions(shape, opts, ["defaultToNull"]);
        inputs = Array.isArray(rows) ? rows : [rows];
        requireWriteColumns(t, inputs, shape);
        if (Array.isArray(rows) && opts?.defaultToNull !== false) requireSameKeys(inputs, shape, ", or pass defaultToNull: false");
        op = "insert";
        return self;
      },
      update(values: Row, opts?: Record<string, unknown>) {
        const shape = shapeOf("update", [values]);
        onlyOptions(shape, opts, []);
        requireWriteColumns(t, [values], shape);
        op = "update";
        patch = values;
        return self;
      },
      upsert(rows: Row | Row[], opts?: { onConflict?: string; ignoreDuplicates?: boolean; defaultToNull?: boolean }) {
        const shape = shapeOf("upsert", [rows]);
        onlyOptions(shape, opts, ["onConflict", "ignoreDuplicates", "defaultToNull"]);
        const cols = (opts?.onConflict ?? pkOf(t)).split(",").map((c) => c.trim());
        const declared = uniqueSets(t).some((set) => set.length === cols.length && set.every((c) => cols.includes(c)));
        if (!declared) {
          throw new FakeDbUnsupported(
            `upsert on ${t} with onConflict "${cols.join(",")}": no unique constraint on those columns (Postgres would fail with 42P10). Declare it in the migration and in UNIQUE in test/_fakes.ts.`,
          );
        }
        inputs = Array.isArray(rows) ? rows : [rows];
        requireWriteColumns(t, inputs, shape);
        if (Array.isArray(rows)) {
          requireSameKeys(inputs, shape, " (defaultToNull: false does not help an upsert: its update half would write the default over the stored value)");
        }
        op = "upsert";
        onConflict = opts?.onConflict;
        ignoreDuplicates = Boolean(opts?.ignoreDuplicates);
        return self;
      },
      delete(opts?: Record<string, unknown>) {
        onlyOptions(shapeOf("delete", [opts]), opts, []);
        op = "delete";
        return self;
      },
      eq: (column: string, value: unknown) => filter("eq", shapeOf("eq", [column, value]), column, value),
      neq: (column: string, value: unknown) => filter("neq", shapeOf("neq", [column, value]), column, value),
      is: (column: string, value: unknown) => filter("is", shapeOf("is", [column, value]), column, value),
      gt: (column: string, value: unknown) => filter("gt", shapeOf("gt", [column, value]), column, value),
      gte: (column: string, value: unknown) => filter("gte", shapeOf("gte", [column, value]), column, value),
      lt: (column: string, value: unknown) => filter("lt", shapeOf("lt", [column, value]), column, value),
      lte: (column: string, value: unknown) => filter("lte", shapeOf("lte", [column, value]), column, value),
      in: (column: string, values: unknown[]) => filter("in", shapeOf("in", [column, values]), column, values),
      not(column: string, operator: string, value: unknown) {
        const shape = shapeOf("not", [column, operator, value]);
        if (operator === "is") return filter("not_is", shape, column, value);
        if (operator === "eq") return filter("neq", shape, column, value);
        throw new FakeDbUnsupported(`query shape ${t}.not(${show([column, operator, value])})`);
      },
      order(column: string, opts?: { ascending?: boolean; nullsFirst?: boolean }) {
        const shape = shapeOf("order", opts === undefined ? [column] : [column, opts]);
        onlyOptions(shape, opts, ["ascending", "nullsFirst"]);
        const ascending = opts?.ascending !== false;
        orders.push({ ref: resolveColumn(t, column, shape), ascending, nullsFirst: opts?.nullsFirst ?? !ascending });
        return self;
      },
      limit(n: number, opts?: Record<string, unknown>) {
        onlyOptions(shapeOf("limit", [n, opts]), opts, []);
        limitTo = n;
        return self;
      },
      /** PostgREST paging: rows from..to inclusive, after ordering. */
      range(from: number, to: number, opts?: Record<string, unknown>) {
        onlyOptions(shapeOf("range", [from, to, opts]), opts, []);
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

    const self: any = refuseUnknown(api, (prop, args) => shapeOf(prop, args));
    return self;
  }

  // ── rpc ────────────────────────────────────────────────────────

  /**
   * claim_job(p_worker): the oldest runnable job, marked running. Mirrors
   * Charlie's db/0013 minus its per-owner ordering; Task 0.4 / 1.1 own Call's
   * real function and update this when it differs. Runnable = queued and due,
   * or running with a lock more than five minutes old (its worker died). As in
   * SQL, a comparison with NULL is not true: a NULL run_after is never due, a
   * NULL locked_at never stale.
   */
  const claimJob = (args: Record<string, unknown>): Row[] => {
    const now = Date.now();
    const ms = (v: unknown): number | null => (typeof v === "string" ? Date.parse(v) : null);
    const due = (j: Row): boolean => {
      const at = ms(j.run_after);
      return at !== null && at <= now;
    };
    const stale = (j: Row): boolean => {
      const at = ms(j.locked_at);
      return at !== null && now - at > STALE_LOCK_MS;
    };
    const runnable = tables.jobs.filter((j) => (j.status === "queued" && due(j)) || (j.status === "running" && stale(j)));
    runnable.sort((a, b) => (ms(a.run_after) ?? Infinity) - (ms(b.run_after) ?? Infinity) || (order.get(a) ?? 0) - (order.get(b) ?? 0));
    const job = runnable[0];
    if (!job) return [];
    job.status = "running";
    job.attempts = (job.attempts ?? 0) + 1;
    job.locked_at = new Date().toISOString();
    job.locked_by = args.p_worker ?? null;
    return [structuredClone(job)];
  };

  const SEVERITIES = ["info", "warn", "error", "critical"];

  /**
   * bump_incident(p_fingerprint, p_kind, p_severity, p_summary): one atomic
   * upsert-and-count per distinct problem, as Charlie's db/0024, on Call's
   * incidents columns. A new fingerprint is a row with count 1; a repeat adds
   * one, moves last_at, keeps the worst severity it has ever had (one critical
   * repeat is never downgraded) and the latest summary. The summary is cut to
   * 500 characters, as the SQL's left(p_summary, 500). Returns void (data null).
   * Task 0.4 / 1.1 own the real function and update this when it differs.
   */
  const bumpIncident = (args: Record<string, unknown>): Result => {
    const severity = String(args.p_severity);
    if (!SEVERITIES.includes(severity)) {
      return fail(pgError("23514", `new row for relation "incidents" violates check constraint "incidents_severity_check"`), 400);
    }
    const summary = String(args.p_summary).slice(0, 500);
    const now = new Date().toISOString();
    const existing = tables.incidents.find((r) => r.fingerprint === args.p_fingerprint);
    if (existing) {
      existing.count = (existing.count ?? 0) + 1;
      existing.last_at = now;
      if (SEVERITIES.indexOf(severity) > SEVERITIES.indexOf(existing.severity)) existing.severity = severity;
      existing.summary = summary;
      return ok(null);
    }
    const res = insertRows("incidents", [{ kind: args.p_kind, severity, summary, fingerprint: args.p_fingerprint, first_at: now, last_at: now, count: 1 }], true);
    return "error" in res ? fail(res.error, res.status) : ok(null);
  };

  /** Each faked function, with its exact parameter list (PostgREST answers PGRST202 for any other) and whether every one is text. */
  const RPCS: Record<string, { params: string[]; text: boolean; run: (args: Record<string, unknown>) => Result | Row[] }> = {
    claim_job: { params: ["p_worker"], text: false, run: claimJob },
    bump_incident: { params: ["p_fingerprint", "p_kind", "p_severity", "p_summary"], text: true, run: bumpIncident },
  };

  /** A builder, like supabase-js's: nothing runs until it is awaited, and single()/maybeSingle() shape the rows. */
  const rpc = (fn: string, args: Record<string, unknown> = {}, opts?: Record<string, unknown>) => {
    const def = RPCS[fn];
    if (!def) throw new FakeDbUnsupported(`rpc("${fn}")`);
    const shape = `rpc(${show([fn, args])})`;
    onlyOptions(shape, opts, []);
    const params = Object.keys(args);
    if (params.length !== def.params.length || !def.params.every((p) => params.includes(p))) {
      throw new FakeDbUnsupported(`${shape}: ${fn} takes exactly (${def.params.join(", ")}); PostgREST answers PGRST202 for any other arguments`);
    }
    if (def.text && !def.params.every((p) => typeof args[p] === "string")) {
      throw new FakeDbUnsupported(`${shape}: every argument of ${fn} is text (a null or a number here is a bug at the call site)`);
    }
    let mode: Mode = "many";
    const api = {
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
          log.push({ table: "", op: "rpc", filters: [], fn, args: wire(args) });
          const out = def.run(args);
          return Promise.resolve(Array.isArray(out) ? finish(out, null, mode) : out).then(resolve, reject);
        } catch (err) {
          return Promise.reject(err).then(resolve, reject);
        }
      },
    };
    const self: any = refuseUnknown(api, (prop, a) => `rpc("${fn}").${prop}(${show(a)})`);
    return self;
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
    failTable(table, error) {
      if (!TABLE_SET.has(table)) throw new FakeDbUnsupported(`failTable("${table}") (not a Call table)`);
      if (error === null) failing.delete(table);
      else failing.set(table, pgError(error?.code ?? "42P01", error?.message ?? `relation "public.${table}" does not exist`));
    },
    reset() {
      for (const t of TABLES) tables[t].length = 0;
      log.length = 0;
      failing.clear();
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
 * defaults and unique-key checks as an insert; a table that is not a Call table,
 * or a column that is not one of its columns, throws before anything is
 * installed. A seed may give jobs and intel_events explicit ids (a fixture's
 * OVERRIDING SYSTEM VALUE); a client insert may not.
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

/**
 * The buckets Task 1.1's migration creates, both private. Storage answers any
 * other name with "Bucket not found", so a typo in the recording upload or the
 * quote PDF store is an error result here too, not a file kept in a bucket
 * that does not exist.
 */
const BUCKETS: ReadonlySet<string> = new Set(["recordings", "quotes"]);

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
  // What storage-js returns for a bucket that does not exist (HTTP 400, body statusCode "404").
  const notFound = () => ({ data: null, error: { message: "Bucket not found", status: 400, statusCode: "404", error: "Bucket not found" } });
  const exists = BUCKETS.has(bucket);
  const api = {
    async upload(path: string, body: StorageBody, opts?: { contentType?: string; upsert?: boolean }) {
      if (!exists) return notFound();
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
      if (!exists) return notFound();
      const key = keyOf(path);
      const bytes = files.get(key);
      if (!bytes) return { data: null, error: { message: "Object not found", statusCode: "404", error: "not_found" } };
      return { data: new Blob([bytes.slice()], { type: contentTypes.get(key) ?? "" }), error: null };
    },
    async remove(paths: string[]) {
      if (!exists) return notFound();
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
      if (!exists) return notFound();
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
  return refuseUnknown(api, (prop, args) => `storage.from("${bucket}").${prop}(${show(args)})`);
}

/** The supabase-js Storage shape (upload, download, remove, list) over a Map. Only the two real buckets exist. */
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

/** One multipart field: a string, or a file with its name, type and bytes. */
export type FormEntry = { name: string; value: string } | { name: string; filename: string; type: string; bytes: Uint8Array };

/** One request the fake fetch saw. */
export interface FetchCall {
  url: string;
  method: string;
  /** Lower-cased names. */
  headers: Record<string, string>;
  /** The body as text: a string as sent, URLSearchParams serialised, bytes and Blobs decoded as UTF-8. Null for FormData. */
  body: string | null;
  /** The body as bytes (every body but FormData): an audio upload is asserted on these. */
  bytes: Uint8Array | null;
  /** A FormData body's entries, in order (a transcription upload). */
  form: FormEntry[] | null;
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
   * Response, which is sent as-is: an error status, a truncated body, or
   * modelReply(content, { finishReason, usage }). It may be
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

export interface ModelReplyOptions {
  /** "stop" unless given. "length" is a truncation (C-1500); null is a stream that ended without saying why. */
  finishReason?: string | null;
  usage?: { prompt_tokens: number; completion_tokens: number };
  /** The model the reply says answered (OpenRouter echoes the slug). Omitted unless given. */
  model?: string;
  id?: string;
}

/** The body of an OpenRouter chat completion: `content` as the message (an object is JSON-stringified). */
function chatBody(content: unknown, opts: ModelReplyOptions = {}): Record<string, unknown> {
  const usage = opts.usage ?? { prompt_tokens: 10, completion_tokens: 10 };
  return {
    id: opts.id ?? "gen-test",
    ...(opts.model !== undefined ? { model: opts.model } : {}),
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: typeof content === "string" ? content : JSON.stringify(content) },
        finish_reason: opts.finishReason === undefined ? "stop" : opts.finishReason,
      },
    ],
    usage: { ...usage, total_tokens: usage.prompt_tokens + usage.completion_tokens },
  };
}

/**
 * A chat reply an onModel responder can return when "stop" with 10/10 tokens
 * will not do: a truncation (`finishReason: "length"`), a reply that spent a
 * given number of tokens (the usage ledger), or both.
 */
export const modelReply = (content: unknown, opts: ModelReplyOptions = {}): Response => jsonResponse(chatBody(content, opts));

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** A private copy without the g flag: the caller's RegExp is never shared or advanced. */
const toRe = (m: RegExp | string): RegExp => (typeof m === "string" ? new RegExp(escapeRe(m)) : new RegExp(m.source, m.flags.replace("g", "")));
/** RegExp.test with y (or g) resumes at lastIndex, so a route would match every other call; start from 0 each time. */
const hits = (re: RegExp, s: string): boolean => {
  re.lastIndex = 0;
  return re.test(s);
};

const CHAT_URL = /openrouter\.ai\/api\/v1\/chat\/completions/;

const encodeText = (s: string): Uint8Array => new TextEncoder().encode(s);
const decodeText = (b: Uint8Array): string => new TextDecoder().decode(b);

/**
 * The body as the server would receive it, recorded without consuming the
 * caller's copy. A ReadableStream can be read only once, so it throws rather
 * than being recorded as nothing.
 */
async function recordBody(input: string | URL | Request, init?: RequestInit): Promise<Pick<FetchCall, "body" | "bytes" | "form">> {
  const asBytes = (bytes: Uint8Array) => ({ body: decodeText(bytes), bytes, form: null });
  const raw = init?.body ?? null;
  if (raw === null) {
    if (input instanceof Request && input.body !== null) return asBytes(new Uint8Array(await input.clone().arrayBuffer()));
    return { body: null, bytes: null, form: null };
  }
  if (typeof raw === "string") return { body: raw, bytes: encodeText(raw), form: null };
  if (raw instanceof URLSearchParams) return { body: raw.toString(), bytes: encodeText(raw.toString()), form: null };
  if (raw instanceof FormData) {
    const entries: [string, FormDataEntryValue][] = [];
    raw.forEach((value, name) => entries.push([name, value]));
    const form: FormEntry[] = [];
    for (const [name, value] of entries) {
      form.push(typeof value === "string" ? { name, value } : { name, filename: value.name, type: value.type, bytes: new Uint8Array(await value.arrayBuffer()) });
    }
    return { body: null, bytes: null, form };
  }
  if (raw instanceof Blob) return asBytes(new Uint8Array(await raw.arrayBuffer()));
  if (raw instanceof ArrayBuffer) return asBytes(new Uint8Array(raw.slice(0)));
  if (ArrayBuffer.isView(raw)) return asBytes(new Uint8Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength)));
  throw new Error(`fake net: cannot record a ${Object.prototype.toString.call(raw)} body; send a string, bytes, a Blob or FormData`);
}

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
    const recorded = await recordBody(input, init);
    let parsed: unknown;
    try {
      parsed = recorded.body === null ? undefined : JSON.parse(recorded.body);
    } catch {
      parsed = undefined;
    }
    const call: FetchCall = {
      url,
      method: (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase(),
      headers,
      ...recorded,
      json: parsed,
      init,
    };
    calls.push(call);

    const route = fetchRoutes.find((r) => hits(r.match, url));
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
      const hit = modelRoutes.find((r) => hits(r.match, prompt));
      if (!hit) throw new Error(`fake net: no scripted model response for prompt starting:\n${prompt.slice(0, 300)}`);
      const content = await hit.respond(prompt, init);
      if (content instanceof Response) return content;
      return jsonResponse(chatBody(content, { id: `gen-test-${modelCalls.length}`, model: payload.model }));
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
