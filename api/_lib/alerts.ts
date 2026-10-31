// Call — telling a human, without anyone having to look.
//
// Ported from Charlie `api/_lib/alerts.ts`; the why-comments are kept. This is
// the immediate email and the daily digest (Task 0.4); Task 11.3 adds the
// thresholds (webhook signature failures, free-tier warnings) and the daily
// summary, in the same shape. Charlie ran this every minute inside the worker
// tick; Call's cron runs once a day (Hobby), so the worker runs it at the end
// of every drain (api/worker.ts): a job that fails for good is emailed by the
// drain that failed it.
//
// What Call keeps of Charlie's design, and what differs:
//   - Each incident carries its alert level (incidents.alert_level, Charlie's
//     `alert`), set from the caller's hint (track.ts) and by severity when
//     there is none. `immediate` is this file's immediate email; `digest` goes
//     in the daily digest, which the daily tick sends (api/worker.ts); `none`
//     is never emailed. Before the fix round severity alone decided, and every
//     transient free-model failure (error, "digest") was emailed at once.
//   - Call has no alert_state table. Each email is one audit_log row (action
//     alert_email_sent) holding the fingerprints it carried and their counts:
//     the rate limit, the daily cap and "has this problem grown since it was
//     last emailed" are all read back from those rows.
//   - The row is written BEFORE the send, and it is the claim on the send: its
//     id is derived from the email it follows (slotId), so two passes at once —
//     two drains finishing together — compute the same id, and the primary key
//     lets exactly one of them write it (one conditional write). The send then
//     carries that id as Resend's idempotency key, and the row is marked sent
//     or failed. A row that could not be marked stays "sending" and counts as
//     sent: an email that went but whose record did not finish is never sent
//     again, at the price that one claimed but never sent waits for its
//     problem to grow.
//
// The rules, as Charlie learned them:
//   - At most one immediate email every 5 minutes, listing everything new
//     since the last one (C-1541).
//   - The same problem is not re-sent within 30 minutes, and after that only
//     if it is still growing (C-1550): a fault that repeats every minute is
//     one email, not sixty. "N new" is counted from the last email that
//     carried it, however long ago, never the incident's lifetime.
//   - At most 60 a day. Resend's free tier sends 100 a day; the digest and the
//     daily summary need the rest, and the quotations need it more.
//   - With email not configured (RESEND_API_KEY + ALERT_EMAIL_TO), or with
//     TRACKING_OFF=1, nothing is sent and nothing is marked sent: incidents
//     keep counting, /admin shows them, and the first email once alerts can go
//     carries everything that waited (C-1548, C-1552).
//   - No phone number or email address in an email: summaries are masked when
//     they are written (track.ts), and a session is shown by the first 8
//     characters of its id.

import { createHash } from "node:crypto";
import { db } from "./db.js";
import { env } from "./env.js";
import { SEND_TIMEOUT_MS, alertsConfigured, escHtml, sendEmail } from "./email.js";
import { FLUSH_TIMEOUT_MS, errorText, flushTracking, track, trackFailure, trackingOff } from "./track.js";

const MIN = 60_000;
export const IMMEDIATE_GAP_MS = 5 * MIN;
export const SAME_PROBLEM_COOLDOWN_MS = 30 * MIN;
export const IMMEDIATE_DAILY_MAX = 60;
/** The digest goes at most this often: the daily tick sends it, and a tick delivered twice sends one. */
export const DIGEST_GAP_MS = 20 * 60 * MIN;
/** How far back the immediate email reads incidents. An incident quiet for longer has nothing new to say. */
const LOOKBACK_MS = 24 * 60 * MIN;
/** The digest's: a day, plus a tick that came late. */
const DIGEST_LOOKBACK_MS = 48 * 60 * MIN;
/** Alert emails read back per kind, newest first: days of them even at the daily cap, so "new since the last email" is known. */
const HISTORY_ROWS = 500;
/** audit_log.action of the row each alert email leaves. */
export const ALERT_EMAIL_ACTION = "alert_email_sent";
/**
 * The longest one alert pass can take: two sends (the immediate email and, on
 * the tick, the digest) at email.ts's timeout, the flush, and its few reads and
 * writes. queue.ts budgets the worker's tail after its hard stop with it.
 */
export const ALERT_PASS_MAX_MS = 2 * SEND_TIMEOUT_MS + FLUSH_TIMEOUT_MS + 4_000;

type EmailKind = "immediate" | "digest";

export interface AlertsReport {
  /** Incidents the immediate email carried (0: none sent). */
  immediate: number;
  /** Incidents the daily digest carried (0: none sent, or not the tick). */
  digest: number;
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
  id: string;
  at: number;
  /** The record this one followed: its slot was derived from it. */
  prev: string | null;
  /** "sending": claimed and not marked since (counted as sent). Rows from before the fix round have none: sent. */
  status: "sending" | "sent" | "failed";
  /** fingerprint → the incident's count when this email reported it. */
  incidents: Record<string, number>;
}

interface Due {
  row: IncidentLite;
  /** New since the last email that carried it; null when that email is older than the record read. */
  fresh: number | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/** The alert emails of one kind, newest first, and whether that is all of them. */
async function history(kind: EmailKind): Promise<{ rows: SentEmail[]; complete: boolean }> {
  const { data, error } = await db()
    .from("audit_log")
    .select("id, at, after")
    .eq("action", ALERT_EMAIL_ACTION)
    .eq("after->>kind", kind)
    .order("at", { ascending: false })
    .limit(HISTORY_ROWS);
  if (error) throw new Error(`alert email record unreadable: ${errorText(error)}`);
  const rows = ((data as { id: string; at: string; after: unknown }[] | null) ?? []).map((r): SentEmail => {
    const after = isRecord(r.after) ? r.after : {};
    const counts = isRecord(after.incidents) ? after.incidents : {};
    return {
      id: r.id,
      at: Date.parse(r.at),
      prev: typeof after.prev === "string" ? after.prev : null,
      status: after.status === "failed" ? "failed" : after.status === "sending" ? "sending" : "sent",
      incidents: Object.fromEntries(Object.entries(counts).filter((e): e is [string, number] => typeof e[1] === "number")),
    };
  });
  return { rows, complete: rows.length < HISTORY_ROWS };
}

/** The newest record no other record follows: the email the next one follows. */
function tipOf(rows: SentEmail[]): SentEmail | null {
  const followed = new Set(rows.map((r) => r.prev).filter((x): x is string => x !== null));
  return rows.find((r) => !followed.has(r.id)) ?? rows[0] ?? null;
}

/**
 * The id of the email that follows `prev`: the same for every pass that read
 * the same record, so the primary key admits one of them. A UUID's shape
 * (version nibble 5, RFC 4122 variant) for audit_log's uuid id.
 */
export function slotId(kind: EmailKind, prev: string | null): string {
  const h = createHash("sha256").update(`call:alert_email:${kind}:after:${prev ?? "first"}`).digest("hex");
  const variant = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** When each problem was last emailed, and at what count (newest email first, so the first seen wins). */
function lastSentOf(went: SentEmail[]): Map<string, { at: number; count: number }> {
  const lastSent = new Map<string, { at: number; count: number }>();
  for (const e of went) for (const [fp, count] of Object.entries(e.incidents)) if (!lastSent.has(fp)) lastSent.set(fp, { at: e.at, count });
  return lastSent;
}

/** What is new since the email that last carried it, or null when that email is older than the record read. */
function freshCount(row: IncidentLite, prior: { count: number } | undefined, record: { rows: SentEmail[]; complete: boolean }): number | null {
  if (prior) return row.count - prior.count;
  const oldest = record.rows[record.rows.length - 1];
  if (!record.complete && oldest && Date.parse(row.first_at) < oldest.at) return null;
  return row.count;
}

const adminLink = (): string => (env.PUBLIC_BASE_URL ? `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/admin` : "/admin");
const utc = (iso: string): string => `${iso.slice(0, 16).replace("T", " ")} UTC`;
const countLine = ({ row, fresh }: Due): string =>
  fresh === null ? `seen again (${row.count} in total since ${utc(row.first_at)})` : `${fresh} new (${row.count} in total since ${utc(row.first_at)})`;

function incidentLines(rows: Due[]): { text: string; html: string } {
  const text = rows.map((d) => `• [${d.row.severity.toUpperCase()}] ${d.row.summary}\n  ${countLine(d)}`).join("\n");
  const colour: Record<string, string> = { critical: "#b42318", error: "#c0392b", warn: "#a8720f", info: "#3c463f" };
  const html = rows
    .map(
      (d) =>
        `<tr><td style="padding:8px 10px 8px 0;vertical-align:top;font-weight:700;color:${colour[d.row.severity] ?? "#3c463f"};white-space:nowrap">${escHtml(d.row.severity.toUpperCase())}</td><td style="padding:8px 0;vertical-align:top;color:#171f1a">${escHtml(d.row.summary)}<div style="color:#6b756e;font-size:12px">${escHtml(countLine(d).replace(" (", " · ").replace(/\)$/, ""))}</div></td></tr>`,
    )
    .join("");
  return { text, html: `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:14px">${html}</table>` };
}

/** Plain tables and inline hex, like every document Call sends (SPEC R8): some mail clients drop the rest. */
function wrap(title: string, inner: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;font-family:Helvetica,Arial,sans-serif;color:#171f1a;max-width:680px"><tr><td style="background:#171f1a;color:#ffffff;padding:14px 18px;font-weight:700">${escHtml(title)}</td></tr><tr><td style="padding:16px 18px;background:#ffffff">${inner}<p style="color:#6b756e;font-size:12px;margin-top:20px">Everything here, and more, is on the operator page: <a href="${escHtml(adminLink())}" style="color:#1f7a4d">${escHtml(adminLink())}</a>. No phone numbers or email addresses are ever included; a session is shown by the first 8 characters of its id.</p></td></tr></table>`;
}

/**
 * Claim the slot after `tip`, send, and mark the record. Returns how many
 * incidents the email carried (0: another pass holds the slot, or the send
 * failed).
 */
async function sendClaimed(kind: EmailKind, tip: SentEmail | null, now: Date, msg: { subject: string; text: string; html: string }, due: Due[]): Promise<number> {
  const id = slotId(kind, tip?.id ?? null);
  const record = { kind, status: "sending", prev: tip?.id ?? null, subject: msg.subject, incidents: Object.fromEntries(due.map(({ row }) => [row.fingerprint, row.count])) };
  const { error: claimError } = await db()
    .from("audit_log")
    .insert({ id, broker_user_id: null, action: ALERT_EMAIL_ACTION, entity: "incidents", entity_id: null, before: null, after: record, at: now.toISOString() });
  // Another pass read the same record at the same moment and claimed this email first.
  if (claimError && (claimError as { code?: string }).code === "23505") return 0;
  if (claimError) throw new Error(`alert email could not be claimed: ${errorText(claimError)}`);

  const res = await sendEmail({ ...msg, idempotencyKey: `alert:${id}` });
  const mark = async (after: Record<string, unknown>): Promise<void> => {
    const { error } = await db().from("audit_log").update({ after }).eq("id", id);
    // The row stays "sending", which counts as sent: never re-sent, and said here.
    if (error) trackFailure("alert_record_failed", error, { category: "ops", severity: "warn", alert: "digest", props: { kind }, fingerprint: "alert_record_failed" });
  };
  if (!res.ok) {
    await mark({ ...record, status: "failed", status_code: res.status ?? null });
    // A warning, never an error: a failing alert email must not raise an alert about itself.
    if (!res.skipped) trackFailure("alert_email_failed", res.error, { category: "ops", severity: "warn", alert: "digest", props: { kind, status: res.status ?? null } });
    return 0;
  }
  await mark({ ...record, status: "sent", provider_id: res.id ?? null });
  track("alert_email_sent", { category: "ops", props: { kind, incidents: due.length } });
  return due.length;
}

/** One pass of the immediate email. Returns how many incidents it carried. */
export async function runImmediate(now: Date): Promise<number> {
  const nowMs = now.getTime();
  const record = await history("immediate");
  const went = record.rows.filter((e) => e.status !== "failed");
  if (went.length && nowMs - went[0]!.at < IMMEDIATE_GAP_MS) return 0;
  const today = now.toISOString().slice(0, 10);
  if (went.filter((e) => new Date(e.at).toISOString().slice(0, 10) === today).length >= IMMEDIATE_DAILY_MAX) return 0;
  const lastSent = lastSentOf(went);

  const { data, error } = await db()
    .from("incidents")
    .select("fingerprint, kind, severity, summary, first_at, last_at, count")
    .eq("alert_level", "immediate")
    .gte("last_at", new Date(nowMs - LOOKBACK_MS).toISOString())
    .order("last_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(`incidents unreadable: ${errorText(error)}`);
  const due = ((data as IncidentLite[] | null) ?? [])
    .map((row) => ({ row, prior: lastSent.get(row.fingerprint) }))
    .filter(({ row, prior }) => !prior || (row.count > prior.count && nowMs - prior.at >= SAME_PROBLEM_COOLDOWN_MS))
    .map(({ row, prior }): Due => ({ row, fresh: freshCount(row, prior, record) }));
  if (!due.length) return 0;

  const shown = due.slice(0, 20);
  const worst = shown.some(({ row }) => row.severity === "critical") ? "CRITICAL" : "Error";
  const subject = `[Call] ${worst}: ${shown[0]!.row.summary.slice(0, 90)}${shown.length > 1 ? ` (+${shown.length - 1} more)` : ""}`;
  const lines = incidentLines(shown);
  const more = due.length - shown.length;
  return sendClaimed("immediate", tipOf(record.rows), now, {
    subject,
    text: `Something went wrong in Call.\n\n${lines.text}\n\n${more > 0 ? `…and ${more} more.\n\n` : ""}Operator page: ${adminLink()}`,
    html: wrap("Something went wrong in Call", `${lines.html}${more > 0 ? `<p>…and ${more} more.</p>` : ""}`),
  }, due);
}

/**
 * The daily digest: every digest-level problem that is new, or has grown,
 * since the last digest. Sent by the daily tick (api/worker.ts), at most once
 * in DIGEST_GAP_MS. Task 11.3 adds its thresholds (signature failures,
 * free-tier warnings) and the daily summary beside it.
 */
export async function runDigest(now: Date): Promise<number> {
  const nowMs = now.getTime();
  const record = await history("digest");
  const went = record.rows.filter((e) => e.status !== "failed");
  if (went.length && nowMs - went[0]!.at < DIGEST_GAP_MS) return 0;
  const lastSent = lastSentOf(went);

  const { data, error } = await db()
    .from("incidents")
    .select("fingerprint, kind, severity, summary, first_at, last_at, count")
    .eq("alert_level", "digest")
    .gte("last_at", new Date(nowMs - DIGEST_LOOKBACK_MS).toISOString())
    .order("last_at", { ascending: false })
    .limit(100);
  if (error) throw new Error(`incidents unreadable: ${errorText(error)}`);
  const due = ((data as IncidentLite[] | null) ?? [])
    .map((row) => ({ row, prior: lastSent.get(row.fingerprint) }))
    .filter(({ row, prior }) => !prior || row.count > prior.count)
    .map(({ row, prior }): Due => ({ row, fresh: freshCount(row, prior, record) }));
  if (!due.length) return 0;

  const shown = due.slice(0, 40);
  const lines = incidentLines(shown);
  const more = due.length - shown.length;
  const subject = `[Call] Daily digest: ${due.length} problem${due.length === 1 ? "" : "s"} since the last one`;
  return sendClaimed("digest", tipOf(record.rows), now, {
    subject,
    text: `What went wrong in Call that did not need you at once.\n\n${lines.text}\n\n${more > 0 ? `…and ${more} more.\n\n` : ""}Operator page: ${adminLink()}`,
    html: wrap("Call: the daily digest", `${lines.html}${more > 0 ? `<p>…and ${more} more.</p>` : ""}`),
  }, due);
}

/** The whole pass; the daily tick asks for the digest too. Never throws: alerting must not break the drain that runs it. */
export async function runAlerts(opts: { now?: Date; digest?: boolean } = {}): Promise<AlertsReport> {
  const now = opts.now ?? new Date();
  if (trackingOff()) return { immediate: 0, digest: 0, skipped: "TRACKING_OFF=1: alert emails are off (incidents are still counted)" };
  if (!alertsConfigured()) return { immediate: 0, digest: 0, skipped: "email not configured (RESEND_API_KEY + ALERT_EMAIL_TO)" };
  const report: AlertsReport = { immediate: 0, digest: 0 };
  try {
    report.immediate = await runImmediate(now);
  } catch (err) {
    trackFailure("alerts_pass_failed", err, { category: "ops", severity: "warn", alert: "digest", props: { step: "immediate" } });
  }
  if (opts.digest) {
    try {
      report.digest = await runDigest(now);
    } catch (err) {
      trackFailure("alerts_pass_failed", err, { category: "ops", severity: "warn", alert: "digest", props: { step: "digest" } });
    }
  }
  // Task 11.3: the thresholds (signature failures, free-tier warnings) and the daily summary.
  await flushTracking();
  return report;
}
