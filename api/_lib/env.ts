// Call — every environment variable in one place (the same list, in the same
// order, as .env.example).
//
// Ported from Charlie `api/_lib/env.ts`; the why-comments are kept. Charlie's
// per-subsystem readiness report is not here: it lands with api/health.ts
// (Task 0.5), which is the only thing that reads it.
//
// Two rules this file exists to enforce:
//
//  1. Nothing here throws at import time. Vercel imports every function module
//     during a build, and a build must not fail because a secret is not set
//     yet. A missing value is "" (or the documented default); the code that
//     needs it calls required(), which names the variable in the error.
//
//  2. A number that cannot be parsed falls back to its default, it never
//     becomes NaN. NaN in a budget comparison is always false, so
//     OPENROUTER_DAILY_BUDGET=fifty would have quietly switched the limits
//     guard off — the "switched off and silent" failure SPEC R13 is about.
//
// `env` is a FROZEN SNAPSHOT taken when this module is first imported, so a
// request cannot see a variable change underneath it. Tests set process.env
// before importing (test/_env.ts) and, when one needs a different value
// mid-file, call reloadEnv() to take a new snapshot. `env` is an ES module live
// binding, so every importer sees the new snapshot; each snapshot is itself
// frozen. Production code never calls reloadEnv().

const read = (name: string): string => (process.env[name] ?? "").trim();

/** A non-negative number, or the default when unset, blank, negative or not a number. */
const num = (name: string, fallback: number): number => {
  const raw = read(name);
  if (raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

export type CaptureMode = "full" | "meta" | "off";

function snapshot() {
  const capture = read("INTEL_CAPTURE").toLowerCase();
  return Object.freeze({
    // ── Required ─────────────────────────────────────────────────
    SUPABASE_URL: read("SUPABASE_URL"),
    /** Bypasses RLS. Vercel only; never a browser, never the repo. */
    SUPABASE_SERVICE_ROLE_KEY: read("SUPABASE_SERVICE_ROLE_KEY"),
    /** Post-call model work. Which model does which job is the model_config table. */
    OPENROUTER_API_KEY: read("OPENROUTER_API_KEY"),
    /** Authenticates /api/worker, /api/render-pdf and /admin detail. */
    WORKER_SECRET: read("WORKER_SECRET"),
    /** e.g. https://call.vercel.app — used in links and for this deployment calling itself. */
    PUBLIC_BASE_URL: read("PUBLIC_BASE_URL"),
    /** Pepper for login codes, session cookies and signed PDF links. */
    SESSION_SECRET: read("SESSION_SECRET"),

    // ── ElevenLabs (the voice agent) ─────────────────────────────
    ELEVENLABS_API_KEY: read("ELEVENLABS_API_KEY"),
    /** Verifies elevenlabs-signature over raw bytes. */
    ELEVENLABS_WEBHOOK_SECRET: read("ELEVENLABS_WEBHOOK_SECRET"),
    /** Sent by the agent's server tools as x-call-secret. */
    VOICE_TOOL_SECRET: read("VOICE_TOOL_SECRET"),
    /** Assumption for the cost ledger until measured; shown on /admin. */
    ELEVENLABS_CENTS_PER_MINUTE: num("ELEVENLABS_CENTS_PER_MINUTE", 10),
    /** Free plan 15, Starter 75. The ledger warns at 80%. */
    ELEVENLABS_MINUTES_INCLUDED: num("ELEVENLABS_MINUTES_INCLUDED", 15),

    // ── Email (Resend) ───────────────────────────────────────────
    RESEND_API_KEY: read("RESEND_API_KEY"),
    /** Unset until a domain is verified: onboarding@resend.dev only delivers to the account's own address. */
    QUOTE_EMAIL_FROM: read("QUOTE_EMAIL_FROM"),
    RESEND_WEBHOOK_SECRET: read("RESEND_WEBHOOK_SECRET"),
    /** Where operator alerts go. Kept out of code on purpose. */
    ALERT_EMAIL_TO: read("ALERT_EMAIL_TO"),

    // ── WhatsApp (Meta Cloud API) ────────────────────────────────
    /** Without it inbound webhooks cannot be authenticated. */
    WHATSAPP_APP_SECRET: read("WHATSAPP_APP_SECRET"),
    WHATSAPP_ACCESS_TOKEN: read("WHATSAPP_ACCESS_TOKEN"),
    WHATSAPP_PHONE_NUMBER_ID: read("WHATSAPP_PHONE_NUMBER_ID"),
    WHATSAPP_VERIFY_TOKEN: read("WHATSAPP_VERIFY_TOKEN") || "call-verify",
    /** Graph API version. In config because Meta sunsets versions on a ~2-year clock. */
    WHATSAPP_API_VERSION: read("WHATSAPP_API_VERSION") || "v21.0",
    /** Name of the approved utility template for first-contact quotes. */
    WHATSAPP_TEMPLATE_QUOTE_READY: read("WHATSAPP_TEMPLATE_QUOTE_READY") || "quote_ready",
    WHATSAPP_TEMPLATE_BROKER_NEW_QUOTE: read("WHATSAPP_TEMPLATE_BROKER_NEW_QUOTE") || "broker_new_quote",

    // ── Transcription, direct (optional) ─────────────────────────
    /** Only when the `voice` row's provider is groq. The default route is OpenRouter's, on OPENROUTER_API_KEY. */
    GROQ_API_KEY: read("GROQ_API_KEY"),
    /** Only when the `voice` row's provider is openai. */
    OPENAI_API_KEY: read("OPENAI_API_KEY"),

    // ── Guardrail engine (optional) ──────────────────────────────
    /** Jev. Absent → the `safety` and `checker` rows in model_config run the same checks; /api/health says which. */
    TYPESAFE_API_KEY: read("TYPESAFE_API_KEY"),

    // ── Operations ───────────────────────────────────────────────
    /** Vercel sends this on scheduled runs; cron endpoints fail closed without it. */
    CRON_SECRET: read("CRON_SECRET"),
    /** Opens /admin. */
    ADMIN_SECRET: read("ADMIN_SECRET"),
    /** Daily OpenRouter request budget the limits guard counts against (free: ~50 with <$10 credit). */
    OPENROUTER_DAILY_BUDGET: num("OPENROUTER_DAILY_BUDGET", 50),
    /** Days before recordings are deleted when a broker has not set their own. */
    DEFAULT_RETENTION_DAYS: num("DEFAULT_RETENTION_DAYS", 30),

    // ── Chase Intelligence (docs/INTEL-CONTRACT.md) ──────────────
    /**
     * full (default) | meta (the shape, no words) | off. This is the setting as
     * written; intel.ts (Task 0.6) decides the EFFECTIVE mode at call time, and
     * also honours TRACKING_OFF=1 when this is unset (C-1706, C-1707).
     */
    INTEL_CAPTURE: (capture === "off" || capture === "meta" ? capture : "full") as CaptureMode,
  });
}

export type Env = ReturnType<typeof snapshot>;

/** The current snapshot. A live binding: reloadEnv() replaces it for every importer. */
export let env: Env = snapshot();

/**
 * Test seam: take a new snapshot of process.env. Tests set env before the first
 * import (test/_env.ts) and use this, through setEnv(), to change a value
 * mid-file. Production code never calls it, which is what keeps `env` a snapshot.
 */
export function reloadEnv(): Env {
  env = snapshot();
  return env;
}

/** The names of the settings that hold text (as opposed to numbers and the capture mode). */
export type StringEnvName = { [K in keyof Env]: Env[K] extends string ? K : never }[keyof Env];

/**
 * The value of a setting that must be there for the code about to run, or an
 * error that names it. Call it where the value is used, never at import.
 */
export function required(name: StringEnvName): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is not set — see .env.example.`);
  return value;
}
