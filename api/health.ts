// Call — is this thing actually working?
//
// Ported from Charlie `api/health.ts`; the why-comments are kept. This is the
// skeleton (Task 0.5): what is configured, read from the environment alone,
// and the keep-alive ping. Task 11.2 completes it — guardrails_live from the
// engines, the job, webhook, catalogue and free-tier counts, the database
// check folded into `ok`, and the detailed form behind WORKER_SECRET.
//
// The specific failure this exists to prevent: shipping with a guardrail
// switched off and no way to tell. Charlie's first version's safety checks all
// keyed off an environment variable that appeared in no deploy document, so
// "every check passing" and "no check running" looked identical from outside
// (SPEC R13). So this endpoint answers plainly: what is configured, and is a
// guardrail engine live.
//
// What it never says: a value, or anything that depends on one — not a
// secret, not its length, not its first characters, not even a URL. Each
// service is "configured" or "unconfigured" and nothing else. Charlie kept the
// list of missing subsystems behind the worker secret for the same reason: it
// is a map for anyone looking for a way in. This form is public, so it gives
// one word per service and a count of missing required settings, never their
// names or values.

import { db } from "./_lib/db.js";
import { alertsConfigured } from "./_lib/email.js";
import { env, type StringEnvName } from "./_lib/env.js";

type ServiceState = "configured" | "unconfigured";

/** What each service needs before it can work. All of them, not any one: a half-configured service fails at the first request. */
const SERVICES = {
  supabase: ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"],
  openrouter: ["OPENROUTER_API_KEY"],
  elevenlabs_webhook: ["ELEVENLABS_WEBHOOK_SECRET"],
  voice_tools: ["VOICE_TOOL_SECRET"],
  resend: ["RESEND_API_KEY"],
  // Sending needs the token and the number id; the client's replies cannot be
  // authenticated without the app secret, and an unauthenticated webhook is refused.
  whatsapp: ["WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "WHATSAPP_APP_SECRET"],
  // Optional: without Jev the checker and safety rows in model_config run the same checks (R13).
  jev: ["TYPESAFE_API_KEY"],
} as const satisfies Record<string, readonly StringEnvName[]>;

/** The first block of .env.example: without any one of these nothing works, so `ok` is false. */
const REQUIRED: readonly StringEnvName[] = [
  "SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "OPENROUTER_API_KEY",
  "WORKER_SECRET",
  "PUBLIC_BASE_URL",
  "SESSION_SECRET",
];

const state = (names: readonly StringEnvName[]): ServiceState => (names.every((n) => env[n] !== "") ? "configured" : "unconfigured");

/**
 * The deployment's commit. Vercel sets VERCEL_GIT_COMMIT_SHA on every
 * deployment; it is the platform's, not a setting anyone types, so it is not
 * in .env.example and is read here, where it is used, as Charlie does.
 */
const version = (): string => process.env.VERCEL_GIT_COMMIT_SHA?.trim() || "dev";

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

/**
 * ?ping=1 — the keep-alive (Supabase pauses a free project after a week with
 * no activity; the daily cron, Task 11.1, calls this). One cheap query, the
 * nearest PostgREST has to `select 1`: one column of one row of the smallest
 * table every deployment has. A failed query is 503, never a quiet 200, so the
 * cron that reads the answer can tell.
 */
async function ping(): Promise<Response> {
  try {
    const { error } = await db().from("model_config").select("role").limit(1);
    if (!error) return json({ ok: true }, 200);
    console.warn("health: ping query failed", error.message);
  } catch (err) {
    // db() throws when Supabase is not configured: a failed ping, not a crash.
    console.warn("health: ping failed", err instanceof Error ? err.message : String(err));
  }
  return json({ ok: false }, 503);
}

export async function GET(req: Request): Promise<Response> {
  if (new URL(req.url).searchParams.get("ping") === "1") return ping();

  const missing = REQUIRED.filter((n) => env[n] === "").length;
  const services = Object.fromEntries(Object.entries(SERVICES).map(([name, needs]) => [name, state(needs)])) as Record<
    keyof typeof SERVICES,
    ServiceState
  >;
  const body = {
    ok: missing === 0,
    version: version(),
    required_missing: missing,
    services,
    // No guardrail engine exists yet (safety.ts and the checkers arrive in
    // Tasks 4.3 and 6.2). Said plainly, never implied: Task 11.2 makes this
    // true only when Jev or the checker/safety rows are usable (C-1530).
    guardrails_live: false,
    // Whether a failure can reach a human by email (a Resend key and a valid
    // ALERT_EMAIL_TO, alerts.ts). Unconfigured, every alert is still an
    // incident row, shown on /admin (C-1548).
    alerts: alertsConfigured() ? "configured" : "unconfigured",
  };
  return json(body, body.ok ? 200 : 503);
}
