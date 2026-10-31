// Call — telling a human, without anyone having to look.
//
// Ported from Charlie `api/_lib/alerts.ts`; the why-comments are kept. This is
// the immediate email (Task 0.4); Task 11.3 adds the digest (warnings,
// delivery failures, webhook signature failures) and the daily summary, in
// the same shape. Charlie ran this every minute inside the worker tick; Call's
// cron runs once a day (Hobby), so the worker runs it at the end of every
// drain (api/worker.ts): a job that fails for good is emailed by the drain
// that failed it.
//
// Two things differ from Charlie, on purpose:
//   - Call's `incidents` has the columns SPEC §4 gives it (kind, severity,
//     summary, fingerprint, first_at, last_at, count) and no alert level, so
//     the severity decides: error and critical go in the immediate email; a
//     warning waits for the digest (Task 11.3); info is never emailed. A
//     caller's `alert` hint (track.ts) decides only whether a warning becomes
//     an incident at all.
//   - Call has no alert_state table. Each email sent is one audit_log row
//     (action alert_email_sent) holding the fingerprints it carried and their
//     counts at the time: the rate limit, the daily cap and "has this problem
//     grown since it was last emailed" are all read back from those rows.
//
// The rules, as Charlie learned them:
//   - At most one immediate email every 5 minutes, listing everything new
//     since the last one (C-1541).
//   - The same problem is not re-sent within 30 minutes, and after that only
//     if it is still growing (C-1550): a fault that repeats every minute is
//     one email, not sixty.
//   - At most 60 a day. Resend's free tier sends 100 a day; the digest and the
//     daily summary need the rest, and the quotations need it more.
//   - With email not configured (RESEND_API_KEY + ALERT_EMAIL_TO), or with
//     TRACKING_OFF=1, nothing is sent and nothing is marked sent: incidents
//     keep counting, /admin shows them, and the first email once alerts can go
//     carries everything that waited (C-1548, C-1552).
//   - No phone number or email address in an email: summaries are masked when
//     they are written (track.ts), and a session is shown by the first 8
//     characters of its id.

import { db } from "./db.js";
import { env } from "./env.js";
import { alertsConfigured, escHtml, sendEmail } from "./email.js";
import { errorText, flushTracking, track, trackFailure, trackingOff } from "./track.js";

const MIN = 60_000;
export const IMMEDIATE_GAP_MS = 5 * MIN;
export const SAME_PROBLEM_COOLDOWN_MS = 30 * MIN;
export const IMMEDIATE_DAILY_MAX = 60;
/** How far back the email record and the incidents are read. An incident quiet for longer has nothing new to say. */
const LOOKBACK_MS = 24 * 60 * MIN;
/** audit_log.action of the row each alert email leaves. */
export const ALERT_EMAIL_ACTION = "alert_email_sent";
/** Severities emailed at once (see the header: no alert level in Call's incidents). */
const IMMEDIATE_SEVERITIES = ["error", "critical"];

export interface AlertsReport {
  /** Incidents the immediate email carried (0: none sent). */
  immediate: number;
  /** Why nothing could be sent at all. */
  skipped?: string;
}

interface IncidentLite {
  fingerprint: string;
  kind: string;
  severity: string;
  summary: string;
  first_at: string;
  last_at: string;
  count: number;
}

interface SentEmail {
  at: number;
  kind: string;
  /** fingerprint → the incident's count when this email reported it. */
  incidents: Record<string, number>;
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/** The alert emails sent since `sinceIso`, newest first. */
async function emailsSince(sinceIso: string): Promise<SentEmail[]> {
  const { data, error } = await db().from("audit_log").select("at, after").eq("action", ALERT_EMAIL_ACTION).gte("at", sinceIso).order("at", { ascending: false }).limit(500);
  if (error) throw new Error(`alert email record unreadable: ${errorText(error)}`);
  return ((data as { at: string; after: unknown }[] | null) ?? []).map((r) => {
    const after = isRecord(r.after) ? r.after : {};
    const counts = isRecord(after.incidents) ? after.incidents : {};
    return {
      at: Date.parse(r.at),
      kind: String(after.kind ?? ""),
      incidents: Object.fromEntries(Object.entries(counts).filter((e): e is [string, number] => typeof e[1] === "number")),
    };
  });
}

const adminLink = (): string => (env.PUBLIC_BASE_URL ? `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/admin` : "/admin");
const utc = (iso: string): string => `${iso.slice(0, 16).replace("T", " ")} UTC`;

function incidentLines(rows: { row: IncidentLite; fresh: number }[]): { text: string; html: string } {
  const text = rows.map(({ row, fresh }) => `• [${row.severity.toUpperCase()}] ${row.summary}\n  ${fresh} new (${row.count} in total since ${utc(row.first_at)})`).join("\n");
  const colour: Record<string, string> = { critical: "#b42318", error: "#c0392b", warn: "#a8720f", info: "#3c463f" };
  const html = rows
    .map(
      ({ row, fresh }) =>
        `<tr><td style="padding:8px 10px 8px 0;vertical-align:top;font-weight:700;color:${colour[row.severity] ?? "#3c463f"};white-space:nowrap">${escHtml(row.severity.toUpperCase())}</td><td style="padding:8px 0;vertical-align:top;color:#171f1a">${escHtml(row.summary)}<div style="color:#6b756e;font-size:12px">${fresh} new · ${row.count} in total since ${escHtml(utc(row.first_at))}</div></td></tr>`,
    )
    .join("");
  return { text, html: `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px">${html}</table>` };
}

/** Plain tables and inline hex, like every document Call sends (SPEC R8): some mail clients drop the rest. */
function wrap(title: string, inner: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;font-family:Helvetica,Arial,sans-serif;color:#171f1a;max-width:680px"><tr><td style="background:#171f1a;color:#ffffff;padding:14px 18px;font-weight:700">${escHtml(title)}</td></tr><tr><td style="padding:16px 18px;background:#ffffff">${inner}<p style="color:#6b756e;font-size:12px;margin-top:20px">Everything here, and more, is on the operator page: <a href="${escHtml(adminLink())}" style="color:#1f7a4d">${escHtml(adminLink())}</a>. No phone numbers or email addresses are ever included; a session is shown by the first 8 characters of its id.</p></td></tr></table>`;
}

/** One pass of the immediate email. Returns how many incidents it carried. */
export async function runImmediate(now: Date): Promise<number> {
  const nowMs = now.getTime();
  const since = new Date(nowMs - LOOKBACK_MS).toISOString();
  const sent = (await emailsSince(since)).filter((e) => e.kind === "immediate");
  if (sent.length && nowMs - sent[0]!.at < IMMEDIATE_GAP_MS) return 0;
  const today = now.toISOString().slice(0, 10);
  if (sent.filter((e) => new Date(e.at).toISOString().slice(0, 10) === today).length >= IMMEDIATE_DAILY_MAX) return 0;

  // When each problem was last emailed, and at what count (newest email first, so the first seen wins).
  const lastSent = new Map<string, { at: number; count: number }>();
  for (const e of sent) for (const [fp, count] of Object.entries(e.incidents)) if (!lastSent.has(fp)) lastSent.set(fp, { at: e.at, count });

  const { data, error } = await db()
    .from("incidents")
    .select("fingerprint, kind, severity, summary, first_at, last_at, count")
    .in("severity", IMMEDIATE_SEVERITIES)
    .gte("last_at", since)
    .order("last_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(`incidents unreadable: ${errorText(error)}`);
  const due = ((data as IncidentLite[] | null) ?? [])
    .map((row) => ({ row, prior: lastSent.get(row.fingerprint) }))
    .filter(({ row, prior }) => !prior || (row.count > prior.count && nowMs - prior.at >= SAME_PROBLEM_COOLDOWN_MS))
    .map(({ row, prior }) => ({ row, fresh: prior ? row.count - prior.count : row.count }));
  if (!due.length) return 0;

  const shown = due.slice(0, 20);
  const worst = shown.some(({ row }) => row.severity === "critical") ? "CRITICAL" : "Error";
  const subject = `[Call] ${worst}: ${shown[0]!.row.summary.slice(0, 90)}${shown.length > 1 ? ` (+${shown.length - 1} more)` : ""}`;
  const lines = incidentLines(shown);
  const more = due.length - shown.length;
  const res = await sendEmail({
    subject,
    text: `Something went wrong in Call.\n\n${lines.text}\n\n${more > 0 ? `…and ${more} more.\n\n` : ""}Operator page: ${adminLink()}`,
    html: wrap("Something went wrong in Call", `${lines.html}${more > 0 ? `<p>…and ${more} more.</p>` : ""}`),
  });
  if (!res.ok) {
    // A warning, never an error: a failing alert email must not raise an alert about itself.
    if (!res.skipped) trackFailure("alert_email_failed", res.error, { category: "ops", severity: "warn", alert: "digest", props: { kind: "immediate", status: res.status ?? null } });
    return 0;
  }
  // What this email reported, as read now: a repeat counted while it was being sent is still new next time.
  const { error: recordError } = await db()
    .from("audit_log")
    .insert({
      broker_user_id: null,
      action: ALERT_EMAIL_ACTION,
      entity: "incidents",
      entity_id: null,
      before: null,
      after: { kind: "immediate", subject, provider_id: res.id ?? null, incidents: Object.fromEntries(due.map(({ row }) => [row.fingerprint, row.count])) },
      at: now.toISOString(),
    });
  // An email that went but is not on the record would be sent again next pass: say so loudly.
  if (recordError) throw new Error(`alert email sent but not recorded: ${errorText(recordError)}`);
  track("alert_email_sent", { category: "ops", props: { kind: "immediate", incidents: due.length } });
  return due.length;
}

/** The whole pass. Never throws: alerting must not break the drain that runs it. */
export async function runAlerts(now = new Date()): Promise<AlertsReport> {
  if (trackingOff()) return { immediate: 0, skipped: "TRACKING_OFF=1: alert emails are off (incidents are still counted)" };
  if (!alertsConfigured()) return { immediate: 0, skipped: "email not configured (RESEND_API_KEY + ALERT_EMAIL_TO)" };
  const report: AlertsReport = { immediate: 0 };
  try {
    report.immediate = await runImmediate(now);
  } catch (err) {
    trackFailure("alerts_pass_failed", err, { category: "ops", severity: "warn", alert: "digest", props: { step: "immediate" } });
  }
  // Task 11.3: the hourly digest (warnings, delivery failures, signature failures) and the daily summary.
  await flushTracking();
  return report;
}
