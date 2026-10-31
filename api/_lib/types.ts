// Call — one row type per table.
//
// Columns are exactly SPEC §4, plus the extras Task 1.1 adds (facts.approx,
// sessions.provider_*, clients.whatsapp_e164, …). Conventions, all because of
// what PostgREST returns:
//   - uuid, text, date and timestamptz columns are `string` (timestamps are ISO);
//   - numeric, int and bigint columns are `number` (jobs.id and intel_events.id
//     are bigint identity: a number, never a uuid);
//   - money is integer cents, in a column ending _cents (SPEC R5, never a float);
//   - jsonb columns are `unknown` until a module that owns the shape narrows them;
//   - a nullable column is `| null`. SPEC §4 does not mark NOT NULL, so Task 1.1's
//     migrations are the authority; where they differ from this file, change this
//     file in the same commit. The fake database (test/_fakes.ts) is schemaless,
//     so these types and test/rls.test.ts are the only schema guards.
//
// Every table has created_at (C-1580); audit_log also has `at`, and
// intel_events has `at` and no created_at (INTEL-CONTRACT §1 says "exactly").

// ── Closed value sets ────────────────────────────────────────────

export type NotifyChannel = "email" | "whatsapp" | "both";
export type BrokerRole = "admin" | "user";
export type ClientChannel = "email" | "whatsapp";

export type SessionMode = "call" | "web" | "meeting" | "stabilising";
export type SessionProvider = "elevenlabs" | "upload";
export type SessionOutcome = "completed" | "declined_consent" | "dropped" | "abandoned" | "hardship" | "failed";

export type TurnRole = "agent" | "client" | "broker" | "unknown";

export type ConsentKind = "recording" | "contact" | "in_person";
export type ConsentMethod = "voice" | "tap" | "in_person";

export type FactConfidence = "agent" | "confirmed" | "transcript" | "broker";
export type FactStatus = "active" | "superseded" | "refused";
export type FactSource = "tool" | "extract" | "readback" | "broker" | "elevenlabs_dc";

export type RecommendationStatus = "draft" | "approved" | "edited" | "removed";
export type QuoteStatus =
  | "draft"
  | "checked"
  | "awaiting_broker"
  | "approved"
  | "sent"
  | "delivered"
  | "read"
  | "failed"
  | "held"
  | "declined"
  | "superseded";
export type QuoteOutcome = "accepted" | "declined" | "no_response" | "replaced";

export type DeliveryChannel = "email" | "whatsapp";
export type DeliveryStatus = "queued" | "sent" | "delivered" | "read" | "bounced" | "failed";

export type CategoryId =
  | "life"
  | "funeral"
  | "disability"
  | "income_protection"
  | "critical_illness"
  | "medical_gap"
  | "retirement_annuity"
  | "tax_free_savings"
  | "unit_trust"
  | "short_term_car"
  | "short_term_home"
  | "credit_life"
  | "education_saver";

/** The seven model jobs; which model does which is the model_config table (SPEC R10). */
export type ModelRole = "extract" | "needs" | "writer" | "checker" | "safety" | "voice" | "summary";

export type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled" | "skipped";
export type WebhookProvider = "elevenlabs" | "resend" | "meta";

export type SafetyEngine = "jev" | "model" | "rules" | "none";
export type SafetyOutcome = "pass" | "flag" | "block" | "unavailable";

export type UsageItem = "agent_minutes" | "llm_tokens" | "telephony" | "email" | "whatsapp" | "transcription" | "storage";

// ── Brokers and their people ─────────────────────────────────────

export interface Broker {
  id: string;
  name: string;
  fsp_number: string | null;
  agent_name: string | null;
  /** 'ZA' */
  country: string;
  /** 'ZAR' */
  currency: string;
  /** Off by default (SPEC R12); labelled "demo" wherever it is shown. */
  auto_send: boolean;
  /** 30 */
  retention_days: number;
  notify_channel: NotifyChannel | null;
  notify_email: string | null;
  notify_whatsapp: string | null;
  elevenlabs_agent_id: string | null;
  phone_number_e164: string | null;
  /** The ElevenLabs voice, chosen in the dashboard, not in code. */
  voice_id: string | null;
  /** The agent's LLM slug as recorded for the cost ledger. */
  agent_llm: string | null;
  created_at: string;
}

export interface BrokerUser {
  id: string;
  broker_id: string;
  email: string;
  name: string | null;
  role: BrokerRole;
  last_login_at: string | null;
  created_at: string;
}

/** Magic-link login. Only a hash of the code is stored. */
export interface LoginCode {
  id: string;
  email: string;
  code_hash: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
}

/** A dashboard login session. Table name sessions_auth; named apart from a call's Session. */
export interface AuthSession {
  id: string;
  broker_user_id: string;
  token_hash: string;
  expires_at: string;
  created_at: string;
}

// ── Clients, calls, transcripts ──────────────────────────────────

export interface Client {
  id: string;
  broker_id: string;
  /** Null for a walk-in; unique per broker where present. */
  phone_e164: string | null;
  whatsapp_e164: string | null;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  preferred_channel: ClientChannel | null;
  /** The 24-hour WhatsApp service window opens from this. */
  last_inbound_at: string | null;
  /** Set by forgetClient(); the row stays, with phone and email nulled, so the deletion is provable. */
  forgotten_at: string | null;
  created_at: string;
}

export interface Session {
  id: string;
  broker_id: string;
  client_id: string | null;
  mode: SessionMode;
  provider: SessionProvider;
  /** ElevenLabs conversation id; unique where present. */
  conversation_id: string | null;
  started_at: string | null;
  ended_at: string | null;
  duration_secs: number | null;
  outcome: SessionOutcome | null;
  consent_turn_id: string | null;
  readback_confirmed: boolean;
  channel_chosen: ClientChannel | null;
  caller_id_raw: string | null;
  cost_cents: number;
  /** The provider's own analysis, kept as received. */
  provider_analysis: unknown | null;
  provider_summary: string | null;
  provider_cost: number | null;
  turn_count: number | null;
  /** A second call that carries on from an earlier one. */
  continues_session_id: string | null;
  created_at: string;
}

export interface Turn {
  id: string;
  session_id: string;
  /** Unique with session_id. */
  idx: number;
  role: TurnRole;
  text: string;
  t_start_secs: number | null;
  t_end_secs: number | null;
  tool_calls: unknown | null;
  created_at: string;
}

export interface Recording {
  id: string;
  session_id: string;
  storage_path: string;
  mime: string | null;
  bytes: number | null;
  duration_secs: number | null;
  delete_after: string | null;
  deleted_at: string | null;
  created_at: string;
}

export interface Consent {
  id: string;
  session_id: string;
  client_id: string | null;
  kind: ConsentKind;
  granted: boolean;
  turn_id: string | null;
  method: ConsentMethod;
  created_at: string;
}

// ── Facts (the client graph) ─────────────────────────────────────

export interface Fact {
  id: string;
  session_id: string;
  client_id: string | null;
  rel: string;
  label: string;
  value_text: string | null;
  value_num: number | null;
  unit: string | null;
  per: string | null;
  /** NOT NULL: a fact with no backing turn is refused (SPEC R2). */
  turn_id: string;
  confidence: FactConfidence;
  status: FactStatus;
  supersedes_id: string | null;
  source: FactSource;
  /** "about 5 000": a range in value_min/value_max rather than a point. */
  approx: boolean;
  value_min: number | null;
  value_max: number | null;
  created_at: string;
}

export interface FactRefusal {
  id: string;
  session_id: string;
  rel: string | null;
  label: string | null;
  reason: string;
  raw: unknown;
  created_at: string;
}

// ── Needs, recommendations, quotes, delivery ─────────────────────

export interface Need {
  id: string;
  session_id: string;
  kind: string;
  priority: number;
  /** Fact ids the need was derived from. */
  basis: unknown;
  note: string | null;
  created_at: string;
}

export interface Recommendation {
  id: string;
  need_id: string;
  product_id: string | null;
  cover_amount: number | null;
  term_months: number | null;
  premium_cents: number | null;
  premium_basis: unknown;
  why: string | null;
  /** What an alternative would depend on (SPEC R3: one recommendation, never a menu). */
  alternative_if: string | null;
  /** Product ids considered, with the reason each was not chosen. */
  considered: unknown;
  status: RecommendationStatus;
  /** A broker's edit that replaces the fact a recommendation was based on. */
  replaces_fact_id: string | null;
  created_at: string;
}

export interface Quote {
  id: string;
  session_id: string;
  client_id: string | null;
  broker_id: string;
  version: number;
  status: QuoteStatus;
  html: string | null;
  pdf_path: string | null;
  total_premium_cents: number | null;
  checker_report: unknown | null;
  approved_by: string | null;
  approved_at: string | null;
  outcome: QuoteOutcome | null;
  outcome_at: string | null;
  flags: string[];
  created_at: string;
}

export interface Delivery {
  id: string;
  quote_id: string;
  channel: DeliveryChannel;
  to_address: string;
  provider_id: string | null;
  status: DeliveryStatus;
  error: string | null;
  sent_at: string | null;
  updated_at: string | null;
  created_at: string;
}

export interface HardshipNote {
  id: string;
  session_id: string;
  quotes_from_client: string[];
  next_step: string | null;
  created_at: string;
}

// ── Catalogue (reference data; public-read) ──────────────────────

export interface ProductCategory {
  id: CategoryId;
  name: string;
  need_kinds: string[];
  country: string;
  created_at: string;
}

export interface Product {
  id: string;
  /** Null = the shared demo catalogue. */
  broker_id: string | null;
  category_id: CategoryId;
  /** "Demo …" until the founder supplies real rate tables (BEHAVIOR-MATRIX A12). */
  provider_name: string;
  name: string;
  summary: string | null;
  min_age: number | null;
  max_age: number | null;
  min_cover: number | null;
  max_cover: number | null;
  term_rules: unknown;
  eligibility: unknown;
  exclusions: string[];
  keywords: string[];
  verified_on: string;
  source_url: string | null;
  active: boolean;
  is_demo: boolean;
  created_at: string;
}

export interface ProductPricing {
  id: string;
  product_id: string;
  age_from: number;
  age_to: number;
  /** Null = the band applies to smokers and non-smokers alike. */
  smoker: boolean | null;
  /** Per month, per 1 000 of cover. Either this or flat_cents. */
  rate_per_1000: number | null;
  flat_cents: number | null;
  min_premium_cents: number | null;
  verified_on: string;
  created_at: string;
}

export interface Disclosure {
  id: string;
  country: string;
  key: string;
  text: string;
  verified_on: string;
  created_at: string;
}

// ── Platform ─────────────────────────────────────────────────────

/** Primary key is `role`, not `id`. */
export interface ModelConfig {
  role: ModelRole;
  provider: string;
  model: string;
  fallbacks: string[];
  params: Record<string, unknown>;
  enabled: boolean;
  created_at: string;
}

export interface Job {
  /** bigint generated always as identity. */
  id: number;
  /** One of queue.ts's closed JobKind list (Task 0.4). */
  kind: string;
  session_id: string | null;
  payload: unknown;
  status: JobStatus;
  attempts: number;
  run_after: string;
  locked_by: string | null;
  locked_at: string | null;
  last_error: string | null;
  /** Unique where present: a second enqueue of the same work is a no-op. */
  dedupe_key: string | null;
  created_at: string;
}

export interface WebhookEvent {
  id: string;
  provider: WebhookProvider;
  event_type: string;
  external_id: string;
  signature_ok: boolean;
  raw: unknown;
  received_at: string;
  processed_at: string | null;
  created_at: string;
}

export interface SafetyEvent {
  id: string;
  session_id: string | null;
  check: string;
  engine: SafetyEngine;
  outcome: SafetyOutcome;
  detail: unknown;
  created_at: string;
}

export interface UsageLedgerRow {
  id: string;
  session_id: string | null;
  item: UsageItem;
  qty: number;
  unit: string | null;
  cost_cents: number;
  provider_ref: string | null;
  created_at: string;
}

export interface AuditLogRow {
  id: string;
  broker_user_id: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  before: unknown | null;
  after: unknown | null;
  at: string;
  created_at: string;
}

export interface Incident {
  id: string;
  kind: string;
  severity: string;
  summary: string;
  fingerprint: string;
  first_at: string;
  last_at: string;
  count: number;
  created_at: string;
}

// ── Tables Task 1.1 adds beyond SPEC §4 ──────────────────────────
// SPEC does not list their columns; these are the ones the criteria need
// (C-0354 callbacks, C-1079/C-1080 client_messages, C-1314 meeting_chunks).
// Task 1.1's migrations are the authority.

/** request_callback, and "call me" on WhatsApp. */
export interface Callback {
  id: string;
  session_id: string | null;
  client_id: string | null;
  reason: string;
  preferred_time: string | null;
  /** The broker's "Done" tick. */
  done_at: string | null;
  created_at: string;
}

/** Free text a client sends on WhatsApp after the quote; shown in the broker's inbox. */
export interface ClientMessage {
  id: string;
  broker_id: string;
  client_id: string | null;
  direction: "in" | "out";
  body: string;
  provider_id: string | null;
  read_at: string | null;
  created_at: string;
}

/** One 60-second upload of an in-person recording; unique (session_id, idx). */
export interface MeetingChunk {
  id: string;
  session_id: string;
  idx: number;
  storage_path: string;
  bytes: number | null;
  mime: string | null;
  created_at: string;
}

/** Chase Intelligence (docs/INTEL-CONTRACT.md §1). business_id is the CLIENT's id in Call. */
export interface IntelEvent {
  /** bigint identity. */
  id: number;
  at: string;
  seq: number;
  app: string;
  v: number;
  trace_id: string;
  turn_id: string | null;
  job_id: number | null;
  business_id: string | null;
  channel: string | null;
  stage: string | null;
  kind: "ask" | "say" | "model" | "check" | "tool" | "send" | "job" | "track" | "error";
  name: string;
  actor: "person" | "app" | "model" | "system" | "their_ai";
  ok: boolean | null;
  ms: number | null;
  content_mode: "full" | "meta";
  content: unknown | null;
  meta: Record<string, unknown> | null;
  /** Unique where present: a backfilled row never doubles. */
  source_ref: string | null;
}

// ── Every table, by name ─────────────────────────────────────────

export interface TableRows {
  brokers: Broker;
  broker_users: BrokerUser;
  login_codes: LoginCode;
  sessions_auth: AuthSession;
  clients: Client;
  sessions: Session;
  turns: Turn;
  recordings: Recording;
  consents: Consent;
  callbacks: Callback;
  client_messages: ClientMessage;
  meeting_chunks: MeetingChunk;
  facts: Fact;
  fact_refusals: FactRefusal;
  needs: Need;
  recommendations: Recommendation;
  quotes: Quote;
  deliveries: Delivery;
  hardship_notes: HardshipNote;
  product_categories: ProductCategory;
  products: Product;
  product_pricing: ProductPricing;
  disclosures: Disclosure;
  model_config: ModelConfig;
  jobs: Job;
  webhook_events: WebhookEvent;
  safety_events: SafetyEvent;
  usage_ledger: UsageLedgerRow;
  audit_log: AuditLogRow;
  incidents: Incident;
  intel_events: IntelEvent;
}

export type TableName = keyof TableRows;
