// Call — the model layer. Every post-call model call goes through OpenRouter;
// which model does which job comes from the `model_config` table, never from
// code (SPEC R10). Roles: extract, needs, writer, checker, safety, voice,
// summary.
//
// Ported from Charlie `api/_lib/models.ts`; the why-comments are kept. What
// Call changes, each for a reason given where it happens:
//   - A truncation doubles the room (cap 8000) and the larger budget carries
//     on to the next model (C-1500–C-1502); askText retries a truncation too,
//     closing the gap Charlie's askText documented.
//   - A disabled or missing row does not stop the role: it runs on its
//     fallbacks and an incident says so (C-1521, C-1522). An unreadable table
//     runs on HARD_FALLBACKS (C-1523).
//   - A 400 is our bug and is surfaced, never routed around (C-1512); a 404 is
//     a model the catalogue retired, which is exactly what a fallback is for.
//   - JSON is repaired (fences, trailing commas, prose around it), then asked
//     for once more, then the step fails (C-1515–C-1520).
//   - Every attempt that spent tokens is a usage_ledger row (C-1504), and an
//     answer from anything but the row's own model is a safety_events note
//     (C-1514).
//   - Not ported: streaming with stall detection, the reasoning-provider
//     routing (require_parameters / ignored providers), embeddings, and the
//     per-request model-call trace. Call's model work is post-call batch work
//     inside a job, where the whole-request timer below and the job deadline
//     bound every call; Chase Intelligence (Task 0.6) records every attempt.
//
// Why model choices live in a table: hosted open-model catalogues retire
// models with a few weeks' notice by email. When that happens the fix is one
// UPDATE in the SQL editor, not a redeploy. The table also carries an ordered
// `fallbacks` list per role, so a congested free queue is routed around
// without anyone being paged.
//
// Two failure modes this file is built around, both seen live in Charlie:
//   1. Truncation. A response cut off mid-JSON is a SIZE problem, not a format
//      problem, even when what arrived happens to parse. Retry the SAME model
//      with more room.
//   2. Free-tier congestion. Waiting and retrying the same congested model does
//      not help; a DIFFERENT model does. Move down the chain instead of sleeping.
//      The backoff in R9 is the job's (queue.ts), between attempts of the whole
//      step, never a sleep in here.

import { db } from "./db.js";
import { env } from "./env.js";
import { DeadlineError, jobCtx, jobMsLeft, onLastAttempt } from "./jobctx.js";
import { currentTrackContext, errorText, holdForFlush, track, trackFailure } from "./track.js";
import type { ModelConfig as ModelConfigRow, ModelRole } from "./types.js";

export { DeadlineError } from "./jobctx.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/** The seven model jobs (types.ts ModelRole). */
export type Role = ModelRole;

/**
 * THIS LIST IS THE ONLY PLACE IN api/ WHERE A MODEL NAME MAY APPEAR AS A
 * LITERAL, and CI enforces that (scripts/grep-models.sh). The rule is that
 * model choices live in the `model_config` table so a retirement is one UPDATE
 * rather than a redeploy — but a fallback that lives in the table cannot help
 * when the table itself is unreadable, which is exactly when it is needed. So
 * the last resorts live here, together, where they can be found and changed in
 * one place.
 *
 * Last-resort chain, used only when a role's own model AND its configured
 * fallbacks have all failed, or the row is missing or unreadable. Spread across
 * different providers on purpose: the failure being routed around is usually
 * one provider's shared queue. Copied from Charlie's current list.
 */
export const HARD_FALLBACKS: string[] = [
  "xiaomi/mimo-v2.5-pro",
  "nvidia/nemotron-3-ultra-550b-a55b:free",
  "google/gemma-4-31b-it:free",
  "nex-agi/nex-n2.5-pro:free",
  "thinkingmachines/inkling:free",
];

/**
 * The smallest `max_tokens` ever sent to a model, whatever a caller or a row
 * asked for (C-1503).
 *
 * Charlie, live test, 2026-09-25: the production model did not honour
 * `reasoning: { enabled: false }` on OpenRouter. The same visible answer
 * sometimes used 69–320 completion tokens and sometimes 1,083–1,243. The
 * difference is hidden reasoning, and it is charged against `max_tokens` BEFORE
 * the answer is written, so a 300-token budget often came back with nothing at
 * all. `max_tokens` is a cap, not a target: a model that answers in 40 tokens
 * stops at 40, and only the tokens written are billed, so a floor costs nothing
 * on the calls it was not needed for and is the difference between an answer
 * and an empty reply on the ones that reason first. 1200 clears the largest
 * hidden-reasoning spend Charlie measured.
 */
export const MIN_MAX_TOKENS = 1200;

/** Doubling stops here (C-1500): past it a cut-off answer means a prompt asking for too much, not too little room. */
export const MAX_MAX_TOKENS = 8000;

/** A role whose params name no temperature gets this (C-1524): low, because the post-call work is extraction and drafting, not invention. */
export const DEFAULT_TEMPERATURE = 0.2;

/**
 * A warm serverless instance handles many jobs; re-reading model_config on
 * every call would be a round trip per call for data that changes monthly. An
 * UPDATE is live within this (C-1525).
 */
export const CONFIG_CACHE_MS = 60_000;

/**
 * A disabled or missing row is a standing state, not an event: every call in
 * the role would raise the same incident. Once a day per role per instance is
 * enough to keep it on the record and in the digest (C-1521).
 */
const STANDING_INCIDENT_EVERY_MS = 24 * 60 * 60_000;

/**
 * The least time worth starting a model call with inside a job attempt. The
 * slowest calls that succeed take 60-75s; a call started with less than this
 * left is more likely to be cut off by the platform than to finish.
 */
export const MIN_CALL_MS = 20_000;

/** The per-request timeout leaves this much for the job to record the result. */
const WRAP_UP_MS = 5_000;

/** The longest one request may run, headers and body, when no deadline is nearer. */
const REQUEST_TIMEOUT_MS = 90_000;

/** Appended to the prompt for the one retry after a reply that could not be read as JSON (C-1518). */
export const JSON_ONLY = "Return JSON only: one JSON object, with no prose before or after it and no code fences.";

export interface ModelParams {
  max_tokens?: number;
  /** Default DEFAULT_TEMPERATURE. */
  temperature?: number;
  /** Sends response_format json_object (C-1519). Off unless the row says so: not every model takes it. */
  json_mode?: boolean;
  /** Passed through to OpenRouter as `reasoning` when set (e.g. { "enabled": false }). */
  reasoning?: unknown;
  /** Cents per million tokens, for usage_ledger. Absent = free. */
  cost_per_mtok_in?: number;
  cost_per_mtok_out?: number;
  /** The voice role: the language to transcribe in, when known. */
  language?: string;
  [k: string]: unknown;
}

/** Where a config came from: the row, or the last resort when there is no usable row. */
export type ConfigSource = "row" | "missing" | "unreadable";

/** A role's config as the layer uses it: the row, or what stands in for it. */
export interface ModelConfig {
  role: Role;
  provider: string;
  /** "" when there is no row. */
  model: string;
  fallbacks: string[];
  params: ModelParams;
  enabled: boolean;
  source: ConfigSource;
}

// ── Errors ───────────────────────────────────────────────────────

type FailureKind = "auth" | "credit" | "rate" | "bad_request" | "not_found" | "upstream" | "network";

// Written out longhand rather than as constructor parameter properties: those
// are a TypeScript-only runtime construct, and Node's type stripping — which is
// how the tests run these files with no build step — refuses them outright.
/** One request's failure. Internal: what a caller sees is one of the three below. */
class ModelError extends Error {
  status: number;
  kind: FailureKind;
  body: string;
  constructor(message: string, status: number, kind: FailureKind, body = "") {
    super(message);
    this.name = "ModelError";
    this.status = status;
    this.kind = kind;
    this.body = body;
  }
}

/** Why no model gave an answer: the last thing that went wrong, or why nothing was tried. */
export type UnavailableKind = FailureKind | "truncated" | "empty" | "bad_output" | "role_disabled" | "role_missing" | "config_unreadable";

/**
 * No model gave a usable answer: every candidate failed, the output could not
 * be read as the JSON asked for, or the account itself was refused (auth,
 * credit). Thrown out of the job, which the queue retries with backoff.
 */
export class ModelUnavailable extends Error {
  role: Role;
  kind: UnavailableKind;
  /** Requests sent, across every model and every retry. */
  tries: number;
  /** The models tried, in order. */
  models: string[];
  constructor(role: Role, kind: UnavailableKind, tries: number, models: string[], detail = "") {
    super(`no model answered for ${role} (${kind}) after ${tries} ${tries === 1 ? "try" : "tries"}${detail ? `: ${detail}` : ""}`);
    this.name = "ModelUnavailable";
    this.role = role;
    this.kind = kind;
    this.tries = tries;
    this.models = models;
  }
}

/**
 * The provider refused the request itself (HTTP 400 and its kin). That is our
 * bug — a malformed message, a parameter the model does not take — so it is
 * surfaced with the provider's own words, never routed around (C-1512).
 */
export class ModelBadRequest extends Error {
  role: Role;
  model: string;
  status: number;
  /** The first 400 characters of the provider's answer. */
  body: string;
  constructor(role: Role, model: string, status: number, body: string) {
    super(`OpenRouter ${status} (${model}) for ${role}: ${body}`);
    this.name = "ModelBadRequest";
    this.role = role;
    this.model = model;
    this.status = status;
    this.body = body;
  }
}

// ── model_config ─────────────────────────────────────────────────

const cache = new Map<Role, { at: number; cfg: ModelConfig }>();
const standingRaisedAt = new Map<string, number>();

/** Test seam: forget every cached row and every once-a-day incident. */
export function __clearModelCache(): void {
  cache.clear();
  standingRaisedAt.clear();
}

/** A standing condition is raised at most once a day per role and instance. */
function raiseStanding(key: string, raise: () => void): void {
  const at = standingRaisedAt.get(key);
  if (at !== undefined && Date.now() - at < STANDING_INCIDENT_EVERY_MS) return;
  standingRaisedAt.set(key, Date.now());
  raise();
}

const lastResort = (role: Role, source: ConfigSource): ModelConfig => ({ role, provider: "openrouter", model: "", fallbacks: [], params: {}, enabled: true, source });

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * A role's config, cached for CONFIG_CACHE_MS. Never throws: a disabled row,
 * a missing row and an unreadable table each come back as a config the chain
 * below knows how to run on, with an incident saying which.
 */
export async function loadModelConfig(role: Role): Promise<ModelConfig> {
  const hit = cache.get(role);
  if (hit && Date.now() - hit.at < CONFIG_CACHE_MS) return hit.cfg;

  let res: { data: unknown; error: unknown };
  try {
    res = await db().from("model_config").select("role, provider, model, fallbacks, params, enabled").eq("role", role).maybeSingle();
  } catch (err) {
    res = { data: null, error: err };
  }

  if (res.error) {
    // Not cached: the very next call reads the table again, so recovery is immediate.
    trackFailure("model_config_unreadable", res.error, {
      severity: "critical",
      alert: "immediate",
      props: { role },
      fingerprint: "model_config_unreadable",
      summary: `model_config could not be read (${errorText(res.error).slice(0, 120)}): every role is running on HARD_FALLBACKS until it can`,
    });
    return lastResort(role, "unreadable");
  }

  let cfg: ModelConfig;
  const row = res.data as Partial<ModelConfigRow> | null;
  if (!row) {
    cfg = lastResort(role, "missing");
    raiseStanding(`role_missing:${role}`, () =>
      trackFailure("role_missing", `model_config has no ${role} row`, {
        severity: "error",
        alert: "digest",
        props: { role },
        fingerprint: `role_missing:${role}`,
        summary: `model_config has no "${role}" row (is db/0002 applied?): ${role} is running on HARD_FALLBACKS`,
      }),
    );
  } else {
    cfg = {
      role,
      // Chat roles always go through OpenRouter; provider routes the voice role only.
      provider: typeof row.provider === "string" && row.provider ? row.provider : "openrouter",
      model: typeof row.model === "string" ? row.model : "",
      fallbacks: Array.isArray(row.fallbacks) ? row.fallbacks.filter((m): m is string => typeof m === "string") : [],
      params: isRecord(row.params) ? (row.params as ModelParams) : {},
      enabled: row.enabled !== false,
      source: "row",
    };
    if (!cfg.enabled) {
      raiseStanding(`role_disabled:${role}`, () =>
        trackFailure("role_disabled", `model_config ${role} is disabled`, {
          severity: "warn",
          alert: "digest",
          props: { role, model: cfg.model },
          fingerprint: `role_disabled:${role}`,
          summary: `model_config "${role}" is disabled: it is running on its fallbacks${cfg.fallbacks.length ? "" : " (none configured, so HARD_FALLBACKS)"}`,
        }),
      );
    }
  }
  cache.set(role, { at: Date.now(), cfg });
  return cfg;
}

/**
 * The models a role tries, in order, each once: its own model (unless the row
 * is disabled), its fallbacks, then HARD_FALLBACKS. A missing or unreadable row
 * is HARD_FALLBACKS alone.
 */
export function candidatesFor(cfg: ModelConfig): string[] {
  const own = cfg.source === "row" ? (cfg.enabled ? [cfg.model, ...cfg.fallbacks] : cfg.fallbacks) : [];
  const seen = new Set<string>();
  return [...own, ...HARD_FALLBACKS].filter((m) => typeof m === "string" && m.trim() !== "" && !seen.has(m) && Boolean(seen.add(m)));
}

// ── Time ─────────────────────────────────────────────────────────

/**
 * How long the next request may run: REQUEST_TIMEOUT_MS, cut to the nearer of
 * the job attempt's deadline (jobctx.ts jobMsLeft) and the caller's own
 * (deadlineMs), less the time the job needs to record the result.
 *
 * Throws DeadlineError instead of starting a request that cannot finish (one
 * whose window would be shorter than MIN_CALL_MS): a request cut off part-way
 * is still billed, and the job is retried on a fresh worker with a whole
 * budget (C-1505).
 */
function callWindow(label: string, askDeadlineAt: number | null): number {
  const jobLeft = jobMsLeft();
  const askLeft = askDeadlineAt === null ? null : askDeadlineAt - Date.now();
  const left = jobLeft === null ? askLeft : askLeft === null ? jobLeft : Math.min(jobLeft, askLeft);
  if (left === null) return REQUEST_TIMEOUT_MS;
  if (left - WRAP_UP_MS < MIN_CALL_MS) throw new DeadlineError(`the model call [${label}]`, left);
  return Math.min(REQUEST_TIMEOUT_MS, left - WRAP_UP_MS);
}

/** An abort: AbortError from controller.abort(), TimeoutError from AbortSignal.timeout(). */
const isAbort = (err: unknown): boolean => err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");

/**
 * What an HTTP status means for the chain. 401/403 and 402 stop everything
 * (every model is on the same account); 429, 5xx and 404 move to the next model
 * (a 404 is "no endpoints for this model": the catalogue retired it, which is
 * exactly what the fallbacks exist for); any other 4xx is a request we got
 * wrong, which no other model will take either.
 */
function kindFor(status: number): FailureKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 402) return "credit";
  if (status === 429) return "rate";
  if (status === 404) return "not_found";
  if (status === 408) return "network";
  if (status >= 400 && status < 500) return "bad_request";
  return "upstream";
}

// ── One request ──────────────────────────────────────────────────

export interface CallResult {
  text: string;
  /** finish_reason was "length": the answer was cut off. */
  truncated: boolean;
  finishReason: string | null;
  model: string;
  /** Which provider behind OpenRouter served it, when OpenRouter says. */
  provider?: string;
  /** `cost` is OpenRouter's own figure in credits, when reported (usage.include). */
  usage: { in: number; out: number; cost?: number };
}

export interface CallOptions {
  maxTokens: number;
  temperature?: number;
  jsonMode?: boolean;
  reasoning?: unknown;
  timeoutMs?: number;
  role?: Role;
}

/** One request to one model. */
export async function callOpenRouter(model: string, messages: { role: string; content: unknown }[], opts: CallOptions): Promise<CallResult> {
  // Task 0.6: capture every attempt here
  if (!env.OPENROUTER_API_KEY) throw new ModelError("OPENROUTER_API_KEY is not set", 401, "auth");

  // The timer covers the WHOLE request — headers AND body — and is cleared
  // only in the finally below. Charlie, round 21, live: it used to be cleared
  // as soon as fetch() resolved, which is when the HEADERS arrive. OpenRouter
  // sends 200 headers early on a non-streaming request and holds the
  // connection open while the upstream provider works, so a stalled provider
  // left res.json() waiting with no timer at all: two build stages sat
  // "running" for seven minutes until Vercel killed the function at 300s.
  const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await requestOnce(model, messages, opts, controller.signal, timeoutMs);
  } finally {
    clearTimeout(timer);
  }
}

async function requestOnce(model: string, messages: { role: string; content: unknown }[], opts: CallOptions, signal: AbortSignal, timeoutMs: number): Promise<CallResult> {
  const seconds = Math.round(timeoutMs / 1000);
  let res: Response;
  try {
    res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        // OpenRouter attributes usage with these.
        ...(env.PUBLIC_BASE_URL ? { "HTTP-Referer": env.PUBLIC_BASE_URL } : {}),
        "X-Title": "Call",
      },
      body: JSON.stringify({
        model,
        messages,
        // Floored here too, for every caller, so a small budget can never
        // starve a reasoning model of the room to answer.
        max_tokens: Math.max(MIN_MAX_TOKENS, opts.maxTokens),
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        ...(opts.jsonMode ? { response_format: { type: "json_object" } } : {}),
        ...(opts.reasoning ? { reasoning: opts.reasoning } : {}),
        // Asks OpenRouter to report what the call cost.
        usage: { include: true },
      }),
      signal,
    });
  } catch (err) {
    throw new ModelError(isAbort(err) ? `${model} did not answer in time (${seconds}s, headers)` : `${model} unreachable: ${err}`, 0, "network");
  }

  if (!res.ok) {
    // Still under the timer: a stalled error body is cut off and read as "".
    // The status is the failure and decides the kind.
    const body = (await res.text().catch(() => "")).slice(0, 400);
    throw new ModelError(`OpenRouter ${res.status} (${model}): ${body}`, res.status, kindFor(res.status), body);
  }

  type Body = {
    choices?: { message?: { content?: unknown }; finish_reason?: unknown }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
    provider?: string;
    error?: { message?: string; code?: number };
  };
  let json: Body;
  try {
    json = (await res.json()) as Body;
  } catch (err) {
    // Charlie round 21's stall: 200 headers, then a body that never finished.
    if (isAbort(err)) throw new ModelError(`${model} did not answer in time (${seconds}s, body)`, 0, "network");
    throw new ModelError(`${model} answered with a body that is not JSON`, 200, "upstream");
  }

  // OpenRouter can return HTTP 200 with a top-level error object: a provider
  // behind it failed, which another model may not.
  if (json.error) {
    const code = json.error.code ?? 0;
    throw new ModelError(`OpenRouter error (${model}): ${json.error.message ?? "unknown"}`, code, code === 429 ? "rate" : "upstream");
  }

  const choice = json.choices?.[0];
  const content = choice?.message?.content;
  const text = typeof content === "string" ? content : Array.isArray(content) ? (content as { text?: string }[]).map((c) => c?.text ?? "").join("") : "";
  const finishReason = typeof choice?.finish_reason === "string" ? choice.finish_reason : null;
  const usage = {
    in: json.usage?.prompt_tokens ?? 0,
    out: json.usage?.completion_tokens ?? 0,
    ...(typeof json.usage?.cost === "number" ? { cost: json.usage.cost } : {}),
  };
  return { text, truncated: finishReason === "length", finishReason, model, usage, ...(typeof json.provider === "string" ? { provider: json.provider } : {}) };
}

// ── Bookkeeping ──────────────────────────────────────────────────

const rate = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

/**
 * What one attempt cost, in the ledger's integer cents, from the role's
 * params (cents per million tokens; SPEC §12). A `:free` slug costs nothing
 * whatever the role's rates. Rounded UP: the ledger is whole cents, and a paid
 * call rounded down to 0 would read as free on /app/costs.
 */
export function costCents(model: string, usage: { in: number; out: number }, params: ModelParams): number {
  if (/:free$/.test(model)) return 0;
  const cents = (usage.in * rate(params.cost_per_mtok_in) + usage.out * rate(params.cost_per_mtok_out)) / 1_000_000;
  return cents > 0 ? Math.ceil(cents) : 0;
}

/**
 * One usage_ledger row per attempt that spent tokens, the cut-off and the
 * unreadable ones included: they were billed (C-1504). Never blocks and never
 * fails the call; flushTracking() at the end of the job waits for it.
 */
function recordTokens(sessionId: string | null, model: string, usage: { in: number; out: number }, params: ModelParams): void {
  if (usage.in + usage.out <= 0) return;
  holdForFlush(
    (async () => {
      try {
        const { error } = await db()
          .from("usage_ledger")
          .insert({ session_id: sessionId, item: "llm_tokens", qty: usage.in + usage.out, unit: "tokens", cost_cents: costCents(model, usage, params), provider_ref: model });
        if (error) throw error;
      } catch (err) {
        console.warn(`models: usage_ledger row not written (${errorText(err)})`);
      }
    })(),
  );
}

/**
 * An answer from anything but the row's own model is worth seeing next to the
 * guardrail rows (C-1514): which role, from what, to what, and why the chain
 * moved. A note, not a guardrail: engine `rules` (deterministic code noticed
 * it), outcome `flag`.
 */
function noteFallback(cfg: ModelConfig, sessionId: string | null, to: string, reason: string, tries: number): void {
  holdForFlush(
    (async () => {
      try {
        const { error } = await db()
          .from("safety_events")
          .insert({
            session_id: sessionId,
            check: "model_fallback",
            engine: "rules",
            outcome: "flag",
            detail: { role: cfg.role, from: cfg.source === "row" && cfg.model ? cfg.model : null, to, reason, tries },
          });
        if (error) throw error;
      } catch (err) {
        console.warn(`models: model_fallback note not written (${errorText(err)})`);
      }
    })(),
  );
}

/**
 * The account itself was refused: every model on it will be too, so nothing
 * else is tried and someone must fix the key or the credit (C-1513). The
 * provider's body can echo the request, so only the status is recorded.
 */
function credentialIncident(provider: string, role: Role, status: number, kind: "auth" | "credit", model: string | null): void {
  const name = `${provider}_${kind === "auth" ? "credential" : "credit"}`;
  trackFailure(name, `${provider} ${status} ${kind}${model ? ` (${model})` : ""}`, {
    severity: "critical",
    alert: "immediate",
    props: { role, status, ...(model ? { model } : {}) },
    fingerprint: name,
    summary:
      kind === "auth"
        ? `${provider} refused the API key (HTTP ${status}): no ${provider} model call can run until the key is fixed`
        : `${provider} is out of credit (HTTP ${status}): no ${provider} model call can run until it is topped up`,
  });
}

/** The call failed on every model, or was refused for time: one incident per role and reason. */
function trackUnavailable(role: Role, label: string, tries: number, err: unknown): void {
  // A job that will be retried is not a lost call: it is the queue's to report.
  const retried = err instanceof DeadlineError && jobCtx.getStore() !== undefined && !onLastAttempt();
  const kind = err instanceof ModelUnavailable ? err.kind : err instanceof DeadlineError ? "out_of_time" : err instanceof ModelBadRequest ? "bad_request" : "other";
  trackFailure("model_call_failed", err instanceof ModelBadRequest ? `OpenRouter ${err.status} bad_request (${err.model})` : err, {
    severity: retried ? "warn" : "error",
    alert: retried ? "none" : "digest",
    props: { role, label, tries, error_kind: kind, ...(retried ? { retried: true } : {}) },
    fingerprint: `model_call_failed:${role}:${retried ? "out_of_time_retried" : kind}`,
    summary: retried
      ? `A ${role} model call (${label}) had no time left in its job attempt; the job goes to a fresh worker`
      : `A ${role} model call (${label}) failed after ${tries} ${tries === 1 ? "try" : "tries"} (${kind})`,
  });
}

// ── JSON ─────────────────────────────────────────────────────────

/** Index of the brace that closes the object opening at `start`, ignoring braces inside strings; -1 if it never closes. */
function balancedEnd(s: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return i;
  }
  return -1;
}

/** A comma before a closing brace or bracket, outside strings, is dropped (C-1516). */
function dropTrailingCommas(s: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === ",") {
      let j = i + 1;
      while (j < s.length && /\s/.test(s[j]!)) j++;
      if (s[j] === "}" || s[j] === "]") continue;
    }
    out += ch;
  }
  return out;
}

const tryParse = (s: string): unknown => {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
};

/**
 * Pull the JSON object out of a reply that may be fenced (C-1515), carry
 * trailing commas (C-1516) or sit in prose (C-1517): the first balanced object,
 * braces inside strings ignored. An object that never closes is null, never a
 * fragment of it: an inner object of a cut-off reply would read as a whole
 * answer with half the facts missing.
 */
export function extractJSON(text: string): unknown | null {
  const clean = String(text ?? "").replace(/```[a-z]*/gi, "");
  let start = clean.indexOf("{");
  while (start !== -1) {
    const end = balancedEnd(clean, start);
    if (end === -1) return null;
    const candidate = clean.slice(start, end + 1);
    const parsed = tryParse(candidate) ?? tryParse(dropTrailingCommas(candidate));
    if (isRecord(parsed)) return parsed;
    start = clean.indexOf("{", end + 1);
  }
  return null;
}

// ── Asking ───────────────────────────────────────────────────────

export interface AskOptions<T = unknown> {
  /** The caller's budget; never below MIN_MAX_TOKENS. Default: the row's params.max_tokens. */
  maxTokens?: number;
  /** A reply that parses but fails this is unreadable: one retry, then failure (C-1520). */
  schema?: (x: unknown) => x is T;
  /** Overrides the row's params.json_mode for this call. */
  jsonMode?: boolean;
  /** The most this whole ask may take, from now; a job's own deadline applies as well, whichever is nearer. */
  deadlineMs?: number;
  /** For usage_ledger and safety_events. Default: the track context's session. */
  sessionId?: string;
  /** For the log lines and incidents; default the role. */
  label?: string;
}

export interface AskResult<T> {
  value: T;
  /** The model that answered. */
  model: string;
  /** Tokens spent across every attempt of this ask. */
  usage: { in: number; out: number };
}

type Parsed<T> = { ok: true; value: T } | { ok: false };

/**
 * Ask for JSON and get a parsed object, or throw.
 *
 * Retry policy, in order of cost:
 *   cut off or empty → same model, double the room (cap 8000), twice; then the
 *                      next model, keeping the larger room
 *   429 / 5xx / 404 / network → next model in the chain immediately
 *   unreadable JSON  → same model once, with JSON_ONLY appended; then fail
 *   400              → ModelBadRequest, no fallback
 *   401 / 403 / 402  → ModelUnavailable and a critical incident, no fallback
 *   out of time      → DeadlineError, before the request that could not finish
 *
 * "Empty" is a size problem too. Charlie's production incident, 2026-09-20: a
 * reasoning-enabled role spends part of its `max_tokens` on reasoning before it
 * writes a word, so a room sized for a non-reasoning model came back empty.
 * More room on the same model is the fix, not a weaker model.
 */
export async function askJSON<T = Record<string, unknown>>(role: Role, prompt: string, opts: AskOptions<T> = {}): Promise<AskResult<T>> {
  const schema = opts.schema;
  return ask<T>(role, prompt, opts, true, (text) => {
    const parsed = extractJSON(text);
    if (parsed === null || (schema && !schema(parsed))) return { ok: false };
    return { ok: true, value: parsed as T };
  });
}

/** Same chain, plain prose out. Same truncation retry: a cut-off summary is not an answer. */
export async function askText(role: Role, prompt: string, opts: Omit<AskOptions<string>, "schema" | "jsonMode"> = {}): Promise<AskResult<string>> {
  return ask<string>(role, prompt, opts, false, (text) => ({ ok: true, value: text.trim() }));
}

async function ask<T>(role: Role, prompt: string, opts: AskOptions<T>, json: boolean, parse: (text: string) => Parsed<T>): Promise<AskResult<T>> {
  const started = Date.now();
  const cfg = await loadModelConfig(role);
  const chain = candidatesFor(cfg);
  const label = opts.label ?? role;
  const sessionId = opts.sessionId ?? currentTrackContext().sessionId ?? null;
  const deadlineAt = typeof opts.deadlineMs === "number" ? started + opts.deadlineMs : null;
  const temperature = typeof cfg.params.temperature === "number" ? cfg.params.temperature : DEFAULT_TEMPERATURE;
  const jsonMode = json && (opts.jsonMode ?? cfg.params.json_mode === true);
  const ownModel = cfg.source === "row" && cfg.enabled ? cfg.model : null;
  const requested = opts.maxTokens ?? (typeof cfg.params.max_tokens === "number" ? cfg.params.max_tokens : MIN_MAX_TOKENS);
  let room = Math.max(MIN_MAX_TOKENS, Number.isFinite(requested) ? requested : MIN_MAX_TOKENS);
  // Why the chain is past the row's own model: the row itself, then the last failure.
  let reason: UnavailableKind | "none" = cfg.source === "missing" ? "role_missing" : cfg.source === "unreadable" ? "config_unreadable" : cfg.enabled ? "none" : "role_disabled";
  let tries = 0;
  const tried: string[] = [];
  const total = { in: 0, out: 0 };

  const giveUp = (err: Error): Error => {
    trackUnavailable(role, label, tries, err);
    return err;
  };

  for (const model of chain) {
    tried.push(model);
    let sizeRetries = 0;
    let jsonRetried = false;
    for (;;) {
      let timeoutMs: number;
      try {
        timeoutMs = callWindow(label, deadlineAt);
      } catch (err) {
        console.log(`model skipped [${label}] ${(err as Error).message}`);
        // Unchanged: the queue requeues a DeadlineError (C-1505).
        throw giveUp(err as Error);
      }
      tries++;
      let out: CallResult;
      try {
        out = await callOpenRouter(model, [{ role: "user", content: jsonRetried ? `${prompt}\n\n${JSON_ONLY}` : prompt }], {
          maxTokens: room,
          temperature,
          jsonMode,
          reasoning: cfg.params.reasoning,
          timeoutMs,
          role,
        });
      } catch (err) {
        const e = err instanceof ModelError ? err : new ModelError(`${model}: ${String(err)}`, 0, "network");
        if (e.kind === "auth" || e.kind === "credit") {
          console.log(`model fatal [${label}] OpenRouter ${e.status} ${e.kind}`);
          credentialIncident("openrouter", role, e.status, e.kind, model);
          throw new ModelUnavailable(role, e.kind, tries, tried, `OpenRouter ${e.status}`);
        }
        if (e.kind === "bad_request") {
          console.log(`model bad-request [${label}] ${model} ${e.status}`);
          throw giveUp(new ModelBadRequest(role, model, e.status, e.body));
        }
        // Recovered by the next model, if any: a warning, not an error.
        console.warn(`model fail [${label}] ${model}: ${e.kind} ${e.status}`);
        reason = e.kind;
        break;
      }

      total.in += out.usage.in;
      total.out += out.usage.out;
      recordTokens(sessionId, model, out.usage, cfg.params);

      if (out.truncated || !out.text.trim()) {
        // A size problem, even when what arrived parses (C-1501).
        reason = out.truncated ? "truncated" : "empty";
        const grown = Math.min(Math.max(room, MAX_MAX_TOKENS), room * 2);
        const couldGrow = grown > room;
        room = grown;
        if (couldGrow && ++sizeRetries < 2) continue;
        // Twice on this model, or no more room to give: the next model, with the larger budget (C-1502).
        break;
      }

      const parsed = parse(out.text);
      if (parsed.ok) {
        console.log(`model ok [${label}] ${model} in=${out.usage.in} out=${out.usage.out} ms=${Date.now() - started} tries=${tries}${model !== ownModel ? ` fallback-from=${ownModel ?? "(no row)"}` : ""}`);
        if (model !== ownModel) noteFallback(cfg, sessionId, model, reason, tries);
        track("model_call", {
          category: "performance",
          ms: Date.now() - started,
          props: { label, role, model, configured: ownModel, fallback: model !== ownModel, tries, in: total.in, out: total.out, ...(out.provider ? { provider: out.provider } : {}) },
        });
        return { value: parsed.value, model, usage: total };
      }
      if (!jsonRetried) {
        jsonRetried = true;
        continue;
      }
      // Repaired, asked again, still unreadable: the step fails (C-1518, C-1520).
      console.log(`model bad-json [${label}] ${model} after the JSON-only retry`);
      throw giveUp(new ModelUnavailable(role, "bad_output", tries, tried, `${model} did not return the JSON asked for`));
    }
  }
  const kind: UnavailableKind = reason === "none" ? "upstream" : reason;
  throw giveUp(new ModelUnavailable(role, kind, tries, tried));
}

// ── Transcription (the voice role) ───────────────────────────────
//
// Charlie, `api/_lib/transcribe.ts`: OpenRouter proxies an OpenAI-shaped
// /audio/transcriptions endpoint, so the default needs no second account and no
// second key. The `voice` row in model_config picks the provider and the model,
// so moving to Groq or OpenAI later — for price, or for per-segment timestamps,
// which only the OpenAI-compatible upstreams return — is a database change, not
// a deploy. Charlie's chat-model route (`openrouter_chat`) is not ported: a
// chat model asked to "write out this audio" quietly tidies and paraphrases,
// which is how a record of advice ends up quoting a client saying what they
// never said (SPEC R2).
//
// There is no last resort for this role: HARD_FALLBACKS are chat models and
// cannot hear. A disabled, missing or unreadable voice row fails the job
// cleanly, and the queue retries it.

export interface Transcript {
  text: string;
  /** Only the OpenAI-compatible upstreams send these (verbose_json). */
  segments?: { start: number; end: number; text: string }[];
  language?: string;
  /** Seconds of audio, when the provider says: the ledger's minutes. */
  duration?: number;
  /** The slug from the voice row that answered. */
  model: string;
}

export interface TranscribeOptions {
  /** Extra words to bias the decoder toward. */
  hint?: string;
  /** Overrides the voice row's params.language. */
  language?: string;
  deadlineMs?: number;
}

interface Driver {
  url: string;
  key: string;
  /** Whether this upstream is expected to honour verbose_json (and so give segments). */
  richFormat: boolean;
}

/** The provider's endpoint and key, or null when its key is not set. */
function driverFor(provider: string): Driver | null {
  switch (provider) {
    case "groq":
      return env.GROQ_API_KEY ? { url: "https://api.groq.com/openai/v1/audio/transcriptions", key: env.GROQ_API_KEY, richFormat: true } : null;
    case "openai":
      return env.OPENAI_API_KEY ? { url: "https://api.openai.com/v1/audio/transcriptions", key: env.OPENAI_API_KEY, richFormat: true } : null;
    case "openrouter":
    default:
      return env.OPENROUTER_API_KEY ? { url: "https://openrouter.ai/api/v1/audio/transcriptions", key: env.OPENROUTER_API_KEY, richFormat: false } : null;
  }
}

// Keyed by the part after "audio/", which also keeps these off the CI rule
// that flags anything shaped like a model slug.
const AUDIO_EXTENSIONS: Record<string, string> = {
  webm: "webm",
  ogg: "ogg",
  opus: "ogg",
  mpeg: "mp3",
  mp3: "mp3",
  mp4: "m4a",
  "x-m4a": "m4a",
  aac: "aac",
  wav: "wav",
  "x-wav": "wav",
  flac: "flac",
};

/** The browser's MediaRecorder sends audio/webm;codecs=opus. The base type is what names the file. */
function audioExtension(mime: string): string {
  const base = (mime || "").split(";")[0]!.trim().toLowerCase().replace(/^audio\//, "");
  return AUDIO_EXTENSIONS[base] ?? "webm";
}

/**
 * A prompt biases the decoder toward words it would otherwise mangle: in a
 * South African fact-find, product words and local terms, which a general
 * model hears as something else and a whole recommendation is then built on.
 */
function decoderHint(extra?: string): string {
  return [
    "A financial adviser and a client in South Africa discussing insurance, savings and investments.",
    "Words that may appear: funeral cover, life cover, disability cover, income protection, dread disease, critical illness, retirement annuity, RA, tax-free savings, TFSA, unit trust, gap cover, medical aid, premium, beneficiary, broker, FSP, FAIS, SARS, rand, stokvel, bond, lobola.",
    extra,
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 800);
}

/**
 * Transcribe audio with the voice row's provider and model (then its
 * fallbacks, same provider). Throws ModelUnavailable when no model answers,
 * ModelBadRequest on a request the provider refused, DeadlineError when the
 * job has no time left. An empty transcript (silence) is returned as one: the
 * job decides what silence means.
 */
export async function transcribeAudio(bytes: Uint8Array, mime: string, opts: TranscribeOptions = {}): Promise<Transcript> {
  const cfg = await loadModelConfig("voice");
  if (cfg.source !== "row") throw new ModelUnavailable("voice", cfg.source === "missing" ? "role_missing" : "config_unreadable", 0, [], "HARD_FALLBACKS cannot transcribe");
  if (!cfg.enabled) throw new ModelUnavailable("voice", "role_disabled", 0, []);

  const provider = cfg.provider.toLowerCase();
  // Whose key it is: an unknown provider falls back to OpenRouter's route, as in Charlie.
  const account = provider === "groq" || provider === "openai" ? provider : "openrouter";
  const driver = driverFor(provider);
  if (!driver) {
    // Every meeting fails until someone adds the key or changes the voice row.
    credentialIncident(account, "voice", 401, "auth", null);
    throw new ModelUnavailable("voice", "auth", 0, [], `the ${provider} key is not set`);
  }
  const language = opts.language ?? (typeof cfg.params.language === "string" ? cfg.params.language : undefined);
  const deadlineAt = typeof opts.deadlineMs === "number" ? Date.now() + opts.deadlineMs : null;
  const models = [cfg.model, ...cfg.fallbacks].filter((m, i, all) => m && all.indexOf(m) === i);
  let tries = 0;
  let reason: UnavailableKind = "upstream";

  for (const model of models) {
    // A bare model id is what a direct provider expects; OpenRouter wants the
    // namespaced slug. Strip the namespace only when we are not on OpenRouter.
    const modelId = account === "openrouter" ? model : model.includes("/") ? model.split("/").pop()! : model;
    // Multipart is the one request shape that works unchanged against
    // OpenRouter, Groq and OpenAI — and it avoids holding both the raw buffer
    // and a base64 copy in memory inside a memory-capped function.
    const build = (rich: boolean): FormData => {
      const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      const form = new FormData();
      // Never set Content-Type by hand: fetch has to write the multipart boundary.
      form.append("file", new Blob([ab], { type: mime || "audio/webm" }), `audio.${audioExtension(mime)}`);
      form.append("model", modelId);
      form.append("temperature", "0");
      form.append("prompt", decoderHint(opts.hint));
      if (language) form.append("language", language);
      if (rich) form.append("response_format", "verbose_json");
      return form;
    };

    for (const rich of driver.richFormat ? [true, false] : [false]) {
      const timeoutMs = callWindow("transcribe", deadlineAt);
      tries++;
      let res: Response;
      try {
        res = await fetch(driver.url, { method: "POST", headers: { Authorization: `Bearer ${driver.key}` }, body: build(rich), signal: AbortSignal.timeout(timeoutMs) });
      } catch (err) {
        console.warn(`transcribe [${provider}] ${modelId}: ${isAbort(err) ? "timed out" : "unreachable"}`);
        reason = "network";
        break;
      }
      if (!res.ok) {
        // The provider's own words stay out of the incident: they can echo what was sent.
        const body = (await res.text().catch(() => "")).slice(0, 400);
        // A 400 on verbose_json means this upstream does not support it. Retry plain.
        if (rich && res.status === 400) continue;
        const kind = kindFor(res.status);
        if (kind === "auth" || kind === "credit") {
          credentialIncident(account, "voice", res.status, kind, model);
          throw new ModelUnavailable("voice", kind, tries, models, `${provider} ${res.status}`);
        }
        if (kind === "bad_request") throw new ModelBadRequest("voice", model, res.status, body);
        console.warn(`transcribe [${provider}] ${modelId}: HTTP ${res.status}`);
        reason = kind;
        break;
      }
      let json: { text?: unknown; language?: unknown; duration?: unknown; segments?: unknown };
      try {
        json = (await res.json()) as typeof json;
      } catch {
        // A JSON parse error quotes the start of the body, which can be the transcript itself.
        reason = "upstream";
        break;
      }
      const segments = (Array.isArray(json.segments) ? json.segments : [])
        .filter((s): s is { start: number; end: number; text: string } => isRecord(s) && typeof s.start === "number" && typeof s.end === "number" && typeof s.text === "string")
        .map((s) => ({ start: s.start, end: s.end, text: s.text.trim() }));
      return {
        text: String(json.text ?? "").trim(),
        model,
        ...(segments.length ? { segments } : {}),
        ...(typeof json.language === "string" ? { language: json.language } : {}),
        ...(typeof json.duration === "number" ? { duration: json.duration } : {}),
      };
    }
  }
  const err = new ModelUnavailable("voice", reason, tries, models);
  trackFailure("transcription_failed", err, {
    props: { provider, tries, bytes: bytes.byteLength },
    fingerprint: `transcription_failed:${provider}:${reason}`,
    summary: `Transcription via ${provider} failed on every voice model after ${tries} ${tries === 1 ? "try" : "tries"} (${reason})`,
  });
  throw err;
}
