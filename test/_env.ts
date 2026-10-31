// Call — the environment every test runs under, set before any api module is
// imported.
//
// api/_lib/env.ts takes its snapshot of process.env the first time it is
// imported, and ES module imports are evaluated in the order they are written,
// so a test file begins with
//
//     import "./_env.ts";
//
// and test/_fakes.ts does the same as its own first line, so a test that only
// imports the fakes is covered too. Do NOT import api/_lib/env.ts from here:
// that would take the snapshot before the assignments below run.
//
// Why every variable is pinned (and not just the ones a test needs): a
// developer's shell may hold real keys. A test that quietly picked up
// OPENROUTER_API_KEY or WHATSAPP_ACCESS_TOKEN from the shell would one day send
// a real request. Everything in .env.example is either set to an obvious fake
// here or deleted (undefined), and test/fakes.test.ts fails if .env.example
// gains a variable this file does not cover.
//
// Deliberately NOT here: INTEL_CAPTURE and TRACKING_OFF. The npm scripts own
// them — `npm test` sets TRACKING_OFF=1, `npm run test:intel` sets
// INTEL_CAPTURE=full — and the suite must behave the same under both (C-1757).

/** undefined = deleted, so the documented default applies. */
export const TEST_ENV: Readonly<Record<string, string | undefined>> = {
  SUPABASE_URL: "https://fake.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
  OPENROUTER_API_KEY: "test-openrouter-key",
  WORKER_SECRET: "test-worker-secret",
  PUBLIC_BASE_URL: "https://call.test",
  SESSION_SECRET: "test-session-secret",

  ELEVENLABS_API_KEY: "test-elevenlabs-key",
  ELEVENLABS_WEBHOOK_SECRET: "test-elevenlabs-webhook-secret",
  VOICE_TOOL_SECRET: "test-voice-tool-secret",
  ELEVENLABS_CENTS_PER_MINUTE: undefined,
  ELEVENLABS_MINUTES_INCLUDED: undefined,

  RESEND_API_KEY: "test-resend-key",
  QUOTE_EMAIL_FROM: "Demo Brokers <quotes@example.test>",
  RESEND_WEBHOOK_SECRET: "test-resend-webhook-secret",
  ALERT_EMAIL_TO: "ops@example.test",

  WHATSAPP_APP_SECRET: "test-whatsapp-app-secret",
  WHATSAPP_ACCESS_TOKEN: "test-whatsapp-token",
  WHATSAPP_PHONE_NUMBER_ID: "100000000001",
  WHATSAPP_VERIFY_TOKEN: undefined,
  WHATSAPP_API_VERSION: undefined,
  WHATSAPP_TEMPLATE_QUOTE_READY: undefined,
  WHATSAPP_TEMPLATE_BROKER_NEW_QUOTE: undefined,

  // Obvious fakes, so the direct transcription routes can be tested (models.test.ts).
  GROQ_API_KEY: "test-groq-key",
  OPENAI_API_KEY: "test-openai-key",

  // Unset on purpose: with no Jev key the guardrails fall through to the model
  // backstop, which is the configuration most deployments run (SPEC R13).
  TYPESAFE_API_KEY: undefined,

  CRON_SECRET: "test-cron-secret",
  ADMIN_SECRET: "test-admin-secret",
  OPENROUTER_DAILY_BUDGET: undefined,
  DEFAULT_RETENTION_DAYS: undefined,
};

/** Write values into process.env; undefined deletes the variable. */
function apply(values: Readonly<Record<string, string | undefined>>): void {
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

apply(TEST_ENV);

/**
 * Change variables mid-test and take a new snapshot (undefined deletes one).
 * Put them back afterwards: setEnv(TEST_ENV) restores every variable above.
 */
export async function setEnv(values: Readonly<Record<string, string | undefined>>) {
  apply(values);
  // Dynamic, so this file never imports the module before the assignments above have run.
  const { reloadEnv } = await import("../api/_lib/env.ts");
  return reloadEnv();
}
