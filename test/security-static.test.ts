// Call — static checks over the source: what must never be in api/ or
// public/, and that vercel.json and api/ agree.
//
// Each check is a function over a root directory, run twice: once over this
// repository, where in Phase 0 most of them pass trivially because the files
// they guard (api/voice.ts, the webhooks, public/) do not exist yet; and once
// over a temporary tree holding the mistake, which the check must catch, next
// to the right way of doing the same thing, which it must let through. A
// static test that has never been seen to catch anything proves nothing; the
// second run is what makes these bite when the files arrive.

// Must be first: api/_lib/env.ts snapshots process.env when it is first imported.
import "./_env.ts";
import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("..", import.meta.url));

// ── Reading the tree ────────────────────────────────────────────────────────

/** Every file under root/sub, relative to root with "/" separators, sorted; [] when the folder does not exist. */
function files(root: string, sub: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      if (name === "node_modules") continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else out.push(relative(root, path).split(sep).join("/"));
    }
  };
  walk(join(root, sub));
  return out.sort();
}

const read = (root: string, rel: string): string => readFileSync(join(root, rel), "utf8");
const SOURCE = /\.(ts|mts|js|mjs|cjs)$/;
const lineOf = (src: string, index: number): number => src.slice(0, index).split("\n").length;

/** Vercel serves every source file under api/ as a function unless a path segment starts with "_" (api/_lib). */
const isEntryPoint = (rel: string): boolean =>
  rel.startsWith("api/") && SOURCE.test(rel) && !rel.endsWith(".d.ts") && !rel.split("/").some((s) => s.startsWith("_"));

/** Every match of `re` (global) in the source files under root/sub, as "file:line: match". */
function grep(root: string, sub: string, re: RegExp, only: (rel: string) => boolean = () => true): string[] {
  const out: string[] = [];
  for (const rel of files(root, sub).filter(only)) {
    const src = read(root, rel);
    for (const m of src.matchAll(re)) out.push(`${rel}:${lineOf(src, m.index!)}: ${m[0]}`);
  }
  return out;
}

// ── The checks ──────────────────────────────────────────────────────────────
// Each returns "file:line: what" for every offence under `root`; [] is a pass.

/**
 * SPEC §13: the service role key lives only in Vercel and the publishable key
 * is used nowhere — there is no client-side Supabase. db/0007 gives the anon
 * role nothing but the catalogue, so a backend file reaching for that key is
 * either dead code or a query that will quietly return nothing.
 */
const ANON_KEY = /SUPABASE_ANON|SUPABASE_PUBLISHABLE|NEXT_PUBLIC_SUPABASE|sb_publishable_/g;
const anonKeyInApi = (root: string): string[] => grep(root, "api", ANON_KEY);

/**
 * Anything under public/ is served to every visitor. A project URL, a key (a
 * publishable or secret key, or a JWT), a setting's name or the client library
 * there means a browser is about to talk to the database directly.
 */
const SUPABASE_IN_PUBLIC = /[a-z0-9-]+\.supabase\.(co|in)\b|sb_(publishable|secret)_\w+|eyJhbGciOi[\w-]*|service_role|SUPABASE_[A-Z_]+|@supabase\/supabase-js/g;
const supabaseInPublic = (root: string): string[] => grep(root, "public", SUPABASE_IN_PUBLIC);

/**
 * The webhook handlers: the three the plan names — api/voice.ts (the post-call
 * webhook lives there with init and the tools, SPEC §2), api/wa.ts (Meta,
 * Task 7.2) and api/resend-webhook.ts (Task 7.1) — plus any entry point named
 * for a webhook, and any entry point that calls a signature verifier. Named,
 * and not only detected, because a handler that hands verification to a
 * _lib file would otherwise not look like a webhook at all.
 */
const KNOWN_WEBHOOKS = new Set(["api/voice.ts", "api/wa.ts", "api/resend-webhook.ts"]);
const VERIFIES = /\bverify(ElevenLabs|Resend|Meta)\b/;
function webhookHandlers(root: string): string[] {
  return files(root, "api").filter((rel) => isEntryPoint(rel) && (KNOWN_WEBHOOKS.has(rel) || /webhook/i.test(rel) || VERIFIES.test(read(root, rel))));
}

/**
 * SPEC §13: every webhook is verified over the raw bytes. A signature is an
 * HMAC over exactly what was sent; a body that was parsed and re-serialised, or
 * decoded to a string, is not those bytes (key order, whitespace, a multibyte
 * character), so the check fails for honest senders — or, worse, someone
 * "fixes" that by verifying something else. A handler either reads the stream
 * itself (a Web Request's arrayBuffer()/bytes()/getReader(), or a Node
 * request's chunks) or switches the platform's parser off.
 */
const READS_RAW = /bodyParser\s*:\s*false|\.arrayBuffer\(\s*\)|\.bytes\(\s*\)|\.getReader\(\s*\)|for\s+await\s*\(/;
const webhooksReadRawBytes = (root: string): string[] =>
  webhookHandlers(root)
    .filter((rel) => !READS_RAW.test(read(root, rel)))
    .map((rel) => `${rel}:1: a webhook handler that never reads the raw body (arrayBuffer(), bytes(), the stream, or bodyParser: false)`);

/**
 * SPEC §2: a webhook stores the event, enqueues a job and answers 200 in under
 * a second; the model work happens in the job. A model call in the handler
 * makes the sender wait on a model — ElevenLabs does not retry by default, so a
 * timeout there is a call that never reaches the broker.
 */
const MODEL_CALL = /_lib\/models(\.js|\.ts)?["']|\b(askJSON|askText|transcribeAudio)\s*[<(]|openrouter\.ai/g;
const noModelCallInWebhooks = (root: string): string[] => {
  const handlers = new Set(webhookHandlers(root));
  return grep(root, "api", MODEL_CALL, (rel) => handlers.has(rel));
};

/**
 * Minimality (SPEC R11, C-1439): a request body is a transcript, a phone
 * number, an email address. Vercel keeps function logs, and nothing deletes
 * them when a client says "forget me" (R15). So no console call under api/
 * may log a body. A message about the body is fine; the body is not — hence
 * the words inside string literals are removed before looking (a template
 * literal keeps its ${…} expressions), and what is left is searched for
 * anything body-like: body, rawBody, raw, or the request read in place
 * (req.text(), request.json()). A variable named body is taken to be one,
 * whatever it holds: call an upstream error's text something else.
 */
const BODY_LIKE = /\b\w*body\b|\braw\w*\b|\b(req|request)\s*\.\s*(text|json|formData|arrayBuffer|bytes)\s*\(/i;
function noBodyInLogs(root: string): string[] {
  const out: string[] = [];
  for (const rel of files(root, "api").filter((f) => SOURCE.test(f))) {
    const src = read(root, rel);
    for (const m of src.matchAll(/\bconsole\s*\.\s*(\w+)\s*\(/g)) {
      const { code } = scanCode(src, m.index! + m[0].length, ")");
      if (BODY_LIKE.test(code)) out.push(`${rel}:${lineOf(src, m.index!)}: console.${m[1]}`);
    }
  }
  return out;
}

/** Index just past the closing quote of the string literal that opens at `i` (or the end of its line). */
function skipQuoted(src: string, i: number): number {
  const quote = src[i];
  i++;
  while (i < src.length && src[i] !== quote && src[i] !== "\n") i += src[i] === "\\" ? 2 : 1;
  return i + 1;
}

/**
 * Read source from `i` up to the `close` bracket that ends it, returning that
 * code with the contents of every string literal removed — template literals
 * keep their ${…} expressions, which are code. Enough of a tokenizer for
 * console call arguments; not a JavaScript parser.
 */
function scanCode(src: string, i: number, close: ")" | "}"): { code: string; end: number } {
  let code = "";
  let depth = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === '"' || c === "'") {
      i = skipQuoted(src, i);
      code += '""';
      continue;
    }
    if (c === "`") {
      code += "`";
      i++;
      while (i < src.length && src[i] !== "`") {
        if (src[i] === "\\") i += 2;
        else if (src[i] === "$" && src[i + 1] === "{") {
          const inner = scanCode(src, i + 2, "}");
          code += "${" + inner.code + "}";
          i = inner.end + 1;
        } else i++;
      }
      code += "`";
      i++;
      continue;
    }
    if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") {
      if (depth === 0 && c === close) return { code, end: i };
      depth--;
    }
    code += c;
    i++;
  }
  return { code, end: i };
}

/** Vercel's `functions` keys are globs: `*` within one path segment, `**` across segments. */
function globMatches(glob: string, path: string): boolean {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === "*" && glob[i + 1] === "*") {
      if (glob[i + 2] === "/") {
        re += "(?:.*/)?";
        i += 2;
      } else {
        re += ".*";
        i += 1;
      }
    } else if (c === "*") re += "[^/]*";
    else re += c.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`).test(path);
}

/**
 * vercel.json and api/ agree: every `functions` key names an entry point that
 * exists, every entry point has a `functions` entry (its maxDuration is a
 * decision, never the platform default), and every cron path is served by an
 * entry point.
 */
function vercelAgreesWithApi(root: string): string[] {
  let config: { functions?: Record<string, unknown>; crons?: { path?: string }[] };
  try {
    config = JSON.parse(read(root, "vercel.json"));
  } catch (err) {
    return [`vercel.json:1: unreadable (${(err as Error).message})`];
  }
  const entries = files(root, "api").filter(isEntryPoint);
  const keys = Object.keys(config.functions ?? {});
  const out: string[] = [];
  for (const key of keys) {
    if (!entries.some((f) => globMatches(key, f))) out.push(`vercel.json:1: functions["${key}"] matches no entry point under api/`);
  }
  for (const f of entries) {
    if (!keys.some((k) => globMatches(k, f))) out.push(`${f}:1: no functions entry in vercel.json, so its limits are the platform's default`);
  }
  for (const cron of config.crons ?? []) {
    const target = String(cron.path ?? "").split("?")[0]!.replace(/^\//, "");
    if (!entries.some((f) => f.replace(SOURCE, "") === target)) out.push(`vercel.json:1: cron "${cron.path}" has no entry point under api/`);
  }
  return out;
}

// ── A temporary tree to prove each check bites ──────────────────────────────

const temps: string[] = [];
after(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

/** A fresh directory in os.tmpdir() holding `tree` (relative path → contents). */
function tempTree(tree: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "call-static-"));
  temps.push(root);
  for (const [rel, text] of Object.entries(tree)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
}

/** The files each offence names, without line numbers, sorted. */
const offenders = (lines: string[]): string[] => [...new Set(lines.map((l) => l.split(":")[0]!))].sort();

describe("this repository", () => {
  test("the scans really read api/ (a wrong root would make every check pass)", () => {
    const seen = files(REPO, "api");
    assert.ok(seen.includes("api/_lib/env.ts"), `scanned: ${seen.join(", ")}`);
    assert.ok(seen.includes("api/health.ts"), `scanned: ${seen.join(", ")}`);
  });

  test("[C-1572] no file under api/ names the anon or publishable key", () => {
    assert.deepEqual(anonKeyInApi(REPO), []);
  });

  test("[C-1573] no file under public/ holds a Supabase URL or key", () => {
    assert.deepEqual(supabaseInPublic(REPO), []);
  });

  test("[C-1592] every webhook handler reads the raw bytes, never a parsed body", () => {
    assert.deepEqual(webhooksReadRawBytes(REPO), []);
  });

  test("[C-1593] no webhook handler, api/voice.ts first, calls a model inline", () => {
    assert.deepEqual(noModelCallInWebhooks(REPO), []);
  });

  test("[C-1439] no console call under api/ logs a request body", () => {
    assert.deepEqual(noBodyInLogs(REPO), []);
  });

  // No criterion of its own: the ground C-1565 (crons, Task 11.1) stands on. A
  // functions key naming a file that does not exist is ignored by the platform,
  // so a renamed handler silently loses its maxDuration; a cron path with no
  // handler is a scheduled 404 nobody sees.
  test("vercel.json names only entry points that exist, every entry point has its limits, every cron has a handler", () => {
    assert.deepEqual(vercelAgreesWithApi(REPO), []);
  });
});

describe("each check bites on a temporary tree", () => {
  test("[C-1572] SUPABASE_ANON_KEY or a publishable key in api/ is caught; the service role is not", () => {
    const root = tempTree({
      "api/app.ts": `const key = process.env.SUPABASE_ANON_KEY;\n`,
      "api/_lib/browser.ts": `export const KEY = "sb_publishable_abc123";\n`,
      "api/_lib/env2.ts": `export const k = process.env.SUPABASE_PUBLISHABLE_KEY;\n`,
      "api/_lib/db.ts": `// never the anon key, never the publishable key\nexport const k = process.env.SUPABASE_SERVICE_ROLE_KEY;\n`,
    });
    assert.deepEqual(offenders(anonKeyInApi(root)), ["api/_lib/browser.ts", "api/_lib/env2.ts", "api/app.ts"]);
    assert.match(anonKeyInApi(root).find((l) => l.startsWith("api/app.ts"))!, /^api\/app\.ts:1: SUPABASE_ANON/);
  });

  test("[C-1573] a Supabase URL, a key or the client library in public/ is caught; the word Supabase in prose is not", () => {
    const root = tempTree({
      "public/demo.html": `<script>fetch("https://abcdefghijklmnopqrst.supabase.co/rest/v1/calls")</script>\n`,
      "public/app.js": `const key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.x";\n`,
      "public/meeting.js": `import { createClient } from "https://esm.sh/@supabase/supabase-js@2";\n`,
      "public/config.js": `window.KEY = "sb_publishable_abc123";\n`,
      "public/index.html": `<p>Recorded, stored and costed. Built on Supabase and Vercel.</p>\n`,
    });
    assert.deepEqual(offenders(supabaseInPublic(root)), ["public/app.js", "public/config.js", "public/demo.html", "public/meeting.js"]);
  });

  test("[C-1592] a webhook handler that parses the body is caught; reading the stream or bodyParser:false passes", () => {
    const root = tempTree({
      // api/voice.ts is the post-call webhook (SPEC §2), whatever else it serves;
      // api/wa.ts is Meta's, even when it leaves the signature to a _lib file.
      "api/voice.ts": `export async function POST(req: Request) {\n  const event = await req.json();\n  return new Response("ok");\n}\n`,
      "api/wa.ts": `import { inbound } from "./_lib/wa-inbound.js";\nexport async function POST(req: Request) {\n  return inbound(await req.json(), req.headers);\n}\n`,
      "api/whatsapp-webhook.ts": `import { verifyMeta } from "./_lib/crypto.js";\nexport async function POST(req: Request) {\n  const text = await req.text();\n  verifyMeta(Buffer.from(text), req.headers.get("x-hub-signature-256"), "s");\n}\n`,
      "api/resend-webhook.ts": `import { verifyResend } from "./_lib/crypto.js";\nexport async function POST(req: Request) {\n  const raw = Buffer.from(await req.arrayBuffer());\n  verifyResend(raw, { id: "", timestamp: "", signature: "" }, "s");\n}\n`,
      "api/meta.ts": `import { verifyMeta } from "./_lib/crypto.js";\nexport const config = { api: { bodyParser: false } };\nexport default async function handler(req: any) { const chunks = []; for await (const c of req) chunks.push(c); verifyMeta(Buffer.concat(chunks), null, "s"); }\n`,
      // Not webhooks: the dashboard parses JSON, and a library file is handed bytes by its caller.
      "api/app.ts": `export async function POST(req: Request) { return Response.json(await req.json()); }\n`,
      "api/_lib/post-call.ts": `import { verifyElevenLabs } from "./crypto.js";\nexport function check(raw: Buffer) { return verifyElevenLabs(raw, null, ["s"]); }\n`,
    });
    assert.deepEqual(offenders(webhooksReadRawBytes(root)), ["api/voice.ts", "api/wa.ts", "api/whatsapp-webhook.ts"]);
  });

  test("[C-1593] a model call in a webhook handler is caught; the worker may call models", () => {
    const root = tempTree({
      "api/voice.ts": `import { askJSON } from "./_lib/models.js";\nexport async function POST(req: Request) {\n  const raw = Buffer.from(await req.arrayBuffer());\n  const facts = await askJSON<object>("extract", "…", {});\n}\n`,
      "api/resend-webhook.ts": `export async function POST(req: Request) {\n  const raw = Buffer.from(await req.arrayBuffer());\n  const m = await import("./_lib/models.js");\n}\n`,
      "api/whatsapp-webhook.ts": `export async function POST(req: Request) {\n  const raw = Buffer.from(await req.arrayBuffer());\n  await fetch("https://openrouter.ai/api/v1/chat/completions");\n}\n`,
      "api/worker.ts": `import { askJSON } from "./_lib/models.js";\nexport async function POST() { await askJSON("extract", "…", {}); }\n`,
      "api/_lib/extract.ts": `import { askJSON } from "./models.js";\n`,
    });
    assert.deepEqual(offenders(noModelCallInWebhooks(root)), ["api/resend-webhook.ts", "api/voice.ts", "api/whatsapp-webhook.ts"]);
    assert.ok(noModelCallInWebhooks(root).some((l) => /^api\/voice\.ts:4: askJSON/.test(l)), noModelCallInWebhooks(root).join("\n"));
  });

  test("[C-1439] console.log(body), a raw body in a template or across lines, a logged req.json() are caught; a message about the body is not", () => {
    const root = tempTree({
      "api/voice.ts": `export async function POST(req: Request) {\n  const body = await req.text();\n  console.log("post-call", body);\n}\n`,
      "api/_lib/post-call.ts": `export function bad(rawBody: Buffer) {\n  console.error(\n    "bad event",\n    rawBody.toString("utf8"),\n  );\n}\n`,
      "api/_lib/wa.ts": "export function seen(req: any) {\n  console.warn(`inbound ${req.body}`);\n}\n",
      "api/app.ts": `export async function POST(req: Request) {\n  console.info("action", await req.json());\n}\n`,
      "api/_lib/ok.ts":
        `export async function fine(bytes: Uint8Array, err: unknown, res: Response) {\n` +
        `  console.warn("post-call: body over the limit", bytes.length);\n` +
        `  console.error("ingest failed", err instanceof Error ? err.message : String(err));\n` +
        "  console.log(`stored ${bytes.length} bytes (raw body not logged)`);\n" +
        "  console.warn(`upstream ${res.status}: ${(await res.text()).slice(0, 200)}`);\n" +
        `}\n`,
    });
    const found = noBodyInLogs(root);
    assert.deepEqual(offenders(found), ["api/_lib/post-call.ts", "api/_lib/wa.ts", "api/app.ts", "api/voice.ts"]);
    assert.ok(found.includes("api/voice.ts:3: console.log"), found.join("\n"));
    assert.ok(found.includes("api/_lib/post-call.ts:2: console.error"), found.join("\n"));
  });

  test("vercel.json: a key for a missing file, an entry point with no key and a cron with no handler are caught", () => {
    const api = {
      "api/health.ts": "export function GET() {}\n",
      "api/worker.ts": "export function GET() {}\n",
      "api/cron/retention.ts": "export function GET() {}\n",
      "api/_lib/db.ts": "export {};\n",
    };
    const bad = tempTree({
      ...api,
      "vercel.json": JSON.stringify({
        functions: { "api/health.ts": { maxDuration: 15 }, "api/ghost.ts": { maxDuration: 60 }, "api/cron/*.ts": { maxDuration: 120 } },
        crons: [
          { path: "/api/worker?tick=1", schedule: "0 4 * * *" },
          { path: "/api/cron/nope", schedule: "0 5 * * *" },
        ],
      }),
    });
    const found = vercelAgreesWithApi(bad);
    assert.equal(found.length, 3, found.join("\n"));
    assert.ok(found.some((l) => l.includes("api/ghost.ts")), "a key for a file that does not exist");
    assert.ok(found.some((l) => l.startsWith("api/worker.ts")), "an entry point with no functions entry");
    assert.ok(found.some((l) => l.includes("/api/cron/nope")), "a cron with no handler");

    const good = tempTree({
      ...api,
      "vercel.json": JSON.stringify({
        functions: { "api/health.ts": { maxDuration: 15 }, "api/worker.ts": { maxDuration: 300 }, "api/cron/*.ts": { maxDuration: 120 } },
        crons: [
          { path: "/api/worker?tick=1", schedule: "0 4 * * *" },
          { path: "/api/cron/retention", schedule: "0 2 * * *" },
        ],
      }),
    });
    assert.deepEqual(vercelAgreesWithApi(good), []);

    const unreadable = tempTree({ ...api, "vercel.json": "{ functions: " });
    assert.equal(vercelAgreesWithApi(unreadable).length, 1);
  });
});
