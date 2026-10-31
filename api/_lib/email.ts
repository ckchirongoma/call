// Call — sending an email. One function, one provider.
//
// Ported from Charlie `api/_lib/email.ts`; the why-comments are kept. Charlie
// sent only alerts to its own team; Call also sends the broker's notification
// and the client's quotation (Tasks 7.1, 7.5), so the sender takes a recipient
// list, a reply-to, attachments and an idempotency key (sendEmailTo), and the
// alert email is one use of it (sendEmail).
//
// Resend's HTTP API (resend.com, free tier: 3,000 emails a month, 100 a day),
// called with fetch, so there is no SDK to install or keep up to date. The
// alerts (alerts.ts) are rate-limited well under that: at most one immediate
// email every five minutes, and at most 60 of them a day.
//
// Nothing here knows what an alert or a quotation is; it sends what it is
// given. Without RESEND_API_KEY it sends nothing and says so ("email not
// configured"); without ALERT_EMAIL_TO the alerts are still recorded in
// `incidents` and shown on /admin.
//
// Two rules that are new in Call:
//   - No address is ever logged, and none reaches an error message: a
//     provider's error body can quote the `to` field, and an error outlives
//     "forget me" (it is a job's last_error, an incident, a log line). This
//     file has no console call at all, and every error text is masked.
//   - An address that is not plainly one address is never sent: a CR or LF in
//     it is a header injection, and a malformed one is a bounce we pay for.

import { env } from "./env.js";

export const RESEND_EMAILS_URL = "https://api.resend.com/emails";

/**
 * Resend's shared test sender. Until a domain is verified it is the only
 * sender that works, and it delivers only to the account's own address
 * (.env.example; C-1026 notes the delivery as "sandbox sender").
 */
export const SANDBOX_FROM = "onboarding@resend.dev";

const SEND_TIMEOUT_MS = 10_000;

export interface EmailResult {
  ok: boolean;
  /** Not attempted: email is not configured. */
  skipped?: boolean;
  /** Resend's id for the email, for the delivery webhook. */
  id?: string;
  /** Masked: never an address. */
  error?: string;
  /** Resend's HTTP status, when it answered. */
  status?: number;
  /** A failure that a later attempt may not have (429, 5xx, timeout, network); a 4xx is final. */
  retryable?: boolean;
  /** Sent from SANDBOX_FROM because QUOTE_EMAIL_FROM is not set. */
  sandbox?: boolean;
}

export interface EmailMessage {
  subject: string;
  text: string;
  html: string;
}

export interface EmailToMessage extends EmailMessage {
  to: string[];
  /** Display name for the sender ("Demo Brokers via Call"); the address is QUOTE_EMAIL_FROM's, or the sandbox's. */
  fromName?: string;
  replyTo?: string;
  attachments?: { filename: string; content: Buffer }[];
  /** Resend keeps the first send for a key and answers a repeat without sending again (C-1028: quote:{id}:v{n}). */
  idempotencyKey?: string;
}

/** One plain address: no display name, no whitespace (so no CR/LF), exactly one @, a dot in the domain. */
const ADDRESS = /^[^\s@<>()[\],;:"]+@[^\s@<>()[\],;:"]+\.[^\s@<>()[\],;:"]+$/;
export const isAddress = (x: unknown): x is string => typeof x === "string" && x.length <= 254 && ADDRESS.test(x);

/** No address in text that outlives the send: an error, a last_error, an incident. */
const maskAddresses = (s: string): string => s.replace(/[^\s<>()"',;:]+@[^\s<>()"',;:]+/g, "[email]");

export function alertRecipients(): string[] {
  return env.ALERT_EMAIL_TO.split(",")
    .map((x) => x.trim())
    .filter(isAddress);
}

/** Alerts can be emailed: a Resend key and at least one valid address in ALERT_EMAIL_TO. /api/health says it as `alerts`. */
export function alertsConfigured(): boolean {
  return Boolean(env.RESEND_API_KEY) && alertRecipients().length > 0;
}

/** The address inside QUOTE_EMAIL_FROM ("Name <a@b>" or "a@b"), or the sandbox's when it is unset. */
function senderAddress(): { address: string; sandbox: boolean } {
  const configured = env.QUOTE_EMAIL_FROM;
  if (!configured) return { address: SANDBOX_FROM, sandbox: true };
  const inside = /<([^<>]+)>\s*$/.exec(configured)?.[1]?.trim() ?? configured;
  return { address: inside, sandbox: false };
}

/** A display name cannot carry its own brackets, quotes or line breaks into the From header. */
const displayName = (name: string): string => name.replace(/[\r\n<>"]/g, " ").replace(/\s+/g, " ").trim().slice(0, 120);

export async function sendEmailTo(msg: EmailToMessage): Promise<EmailResult> {
  if (!env.RESEND_API_KEY) return { ok: false, skipped: true, error: "email not configured" };
  const addresses = [...msg.to, ...(msg.replyTo !== undefined ? [msg.replyTo] : [])];
  if (!msg.to.length || !addresses.every(isAddress)) return { ok: false, error: "invalid_address" };

  const sender = senderAddress();
  const from = msg.fromName ? `${displayName(msg.fromName)} <${sender.address}>` : env.QUOTE_EMAIL_FROM || sender.address;
  const payload: Record<string, unknown> = {
    from,
    to: msg.to,
    // A subject is one header line.
    subject: msg.subject.replace(/[\r\n]+/g, " ").slice(0, 200),
    html: msg.html,
    text: msg.text,
  };
  if (msg.replyTo) payload.reply_to = msg.replyTo;
  if (msg.attachments?.length) payload.attachments = msg.attachments.map((a) => ({ filename: a.filename, content: a.content.toString("base64") }));
  const headers: Record<string, string> = { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" };
  if (msg.idempotencyKey) headers["Idempotency-Key"] = msg.idempotencyKey.slice(0, 256);

  try {
    const res = await fetch(RESEND_EMAILS_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    const answer = await res.text();
    if (!res.ok) {
      return { ok: false, status: res.status, retryable: res.status === 429 || res.status >= 500, error: maskAddresses(`Resend ${res.status}: ${answer.slice(0, 300)}`) };
    }
    let id: string | undefined;
    try {
      id = (JSON.parse(answer) as { id?: string }).id;
    } catch {
      /* a 200 is a send */
    }
    return { ok: true, ...(id ? { id } : {}), status: res.status, sandbox: sender.sandbox };
  } catch (err) {
    // A timeout or a refused connection: the email may not have gone, and a retry with the same key cannot double it.
    return { ok: false, retryable: true, error: maskAddresses(`Resend unreachable: ${(err as Error)?.message ?? String(err)}`).slice(0, 300) };
  }
}

/** The alert email: to every valid address in ALERT_EMAIL_TO. */
export async function sendEmail(msg: EmailMessage): Promise<EmailResult> {
  if (!alertsConfigured()) return { ok: false, skipped: true, error: "email not configured" };
  return sendEmailTo({ ...msg, to: alertRecipients(), fromName: "Call alerts" });
}

/** Escape for the HTML half of an email. */
export const escHtml = (x: unknown): string =>
  String(x ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
