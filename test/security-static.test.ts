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
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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
 * "fixes" that by verifying something else. A handler either reads the
 * request's stream itself (`req`/`request`: arrayBuffer(), bytes(),
 * body.getReader(), or a Node request's chunks with `for await (… of req)`) or
 * switches the platform's parser off — and never parses the request as well
 * (text(), json(), formData()). Matched on the code alone, comments and string
 * text removed: this codebase comments heavily, and a header saying "reads the
 * body with arrayBuffer()" next to a req.json() must not pass. So a webhook
 * names its request `req` or `request`, and reads it in the handler file.
 */
const REQ = String.raw`\b(?:req|request)(?:\s*\.\s*clone\s*\(\s*\))?`;
const READS_RAW = new RegExp(
  [
    String.raw`bodyParser\s*:\s*false`,
    String.raw`${REQ}\s*\.\s*(?:arrayBuffer|bytes)\s*\(\s*\)`,
    String.raw`${REQ}\s*\.\s*body\s*!?\s*\??\.\s*getReader\s*\(`,
    String.raw`for\s+await\s*\(\s*(?:const|let|var)\s+\w+\s+of\s+(?:req|request)\s*\)`,
  ].join("|"),
);
const PARSES_BODY = new RegExp(String.raw`${REQ}\s*\.\s*(?:json|text|formData)\s*\(`);
function webhooksReadRawBytes(root: string): string[] {
  const out: string[] = [];
  for (const rel of webhookHandlers(root)) {
    const code = stripSource(read(root, rel));
    if (!READS_RAW.test(code)) out.push(`${rel}:1: a webhook handler that never reads the raw body (req.arrayBuffer(), req.bytes(), the request's stream, or bodyParser: false)`);
    if (PARSES_BODY.test(code)) out.push(`${rel}:1: a webhook handler that parses the request (json(), text(), formData()): parse the raw bytes it verified`);
  }
  return out;
}

/**
 * SPEC §2: a webhook stores the event, enqueues a job and answers 200 in under
 * a second; the model work happens in the job. A model call in the handler
 * makes the sender wait on a model — ElevenLabs does not retry by default, so a
 * timeout there is a call that never reaches the broker.
 *
 * What this proves, precisely: no file a webhook handler reaches through its
 * relative value imports — the handler itself, and every api/ file those import
 * in turn — imports _lib/models, calls askJSON/askText/transcribeAudio, or names
 * openrouter.ai, with two stops. The walk does not go past api/_lib/queue.ts:
 * enqueue() is the door into job work, and whatever the queue's handlers import
 * runs in a job, not in the request. Nor past api/_lib/models.ts itself (the
 * import of it is the offence). Type-only imports are erased and comments are
 * not code. What it cannot see: a model reached some way other than an import
 * (a fetch to a URL built at run time) — Task 3.3's handler test proves askJSON
 * is never called while the post-call webhook answers.
 */
const MODEL_CALL = /\b(askJSON|askText|transcribeAudio)\s*[<(]|openrouter\.ai/g;
const MODELS = "api/_lib/models.ts";
const QUEUE = "api/_lib/queue.ts";
function noModelCallInWebhooks(root: string): string[] {
  const out: string[] = [];
  for (const handler of webhookHandlers(root)) {
    const seen = new Set<string>([handler]);
    const todo = [handler];
    while (todo.length) {
      const rel = todo.shift()!;
      const code = valueCode(read(root, rel));
      const offence = (line: number, what: string): void => {
        out.push(rel === handler ? `${rel}:${line}: ${what}` : `${handler}:1: reaches ${rel}:${line}: ${what}`);
      };
      for (const m of code.matchAll(MODEL_CALL)) offence(lineOf(code, m.index!), m[0]);
      for (const imp of relativeImports(rel, code)) {
        if (imp.target === MODELS) offence(imp.line, `import ${imp.spec}`);
        const file = [imp.target, imp.index].find((p) => existsSync(join(root, p)) && statSync(join(root, p)).isFile());
        if (!file || seen.has(file)) continue;
        seen.add(file);
        if (file !== QUEUE && file !== MODELS) todo.push(file);
      }
    }
  }
  return out;
}

/** Source with comments and type-only imports blanked (newlines kept, so line numbers hold); strings kept. */
const valueCode = (src: string): string =>
  stripSource(src, true).replace(/^[ \t]*(import|export)\s+type\b[^;]*;/gm, (m) => m.replace(/[^\n]/g, ""));

/**
 * What `rel` imports by a relative path (static, re-export, side-effect or
 * dynamic): the .ts it names (api/ imports name the .js the platform will run)
 * and the index.ts of a folder, whether or not either exists.
 */
function relativeImports(rel: string, code: string): { spec: string; target: string; index: string; line: number }[] {
  const out: { spec: string; target: string; index: string; line: number }[] = [];
  for (const m of code.matchAll(/\bfrom\s*["'](\.[^"']+)["']|\bimport\s*\(\s*["'](\.[^"']+)["']\s*\)|\bimport\s*["'](\.[^"']+)["']/g)) {
    const spec = m[1] ?? m[2] ?? m[3]!;
    const base = join(dirname(rel), spec).split(sep).join("/");
    const target = /\.js$/.test(base) ? base.replace(/\.js$/, ".ts") : /\.ts$/.test(base) ? base : `${base}.ts`;
    out.push({ spec, target, index: `${base}/index.ts`, line: lineOf(code, m.index!) });
  }
  return out;
}

/**
 * Minimality (SPEC R11, C-1439): a request body is a transcript, a phone
 * number, an email address. Vercel keeps function logs, and nothing deletes
 * them when a client says "forget me" (R15). So no console call under api/
 * may log a body. A message about the body is fine; the body is not — hence
 * the words inside string literals are removed before looking (a template
 * literal keeps its ${…} expressions), and what is left is searched as the
 * criterion's own grep searches (`console.log(.*body`, case-insensitive): "body"
 * anywhere in the code of the call — body, rawBody, bodyText, bodyJson, req.body
 * — or raw*, or the request read in place (req.text(), request.json()). A name
 * with "body" in it is taken to be one, whatever it holds: call an upstream
 * error's text something else.
 */
const BODY_LIKE = /body|\braw\w*\b|\b(req|request)\s*\.\s*(text|json|formData|arrayBuffer|bytes)\s*\(/i;
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

/**
 * The source with every comment removed and — unless `keepStrings` — the text
 * of every string literal removed (template literals keep their ${…}
 * expressions, which are code). Newlines are kept, so line numbers hold. A `/`
 * where a value cannot stand (after an operator, a bracket or a keyword) opens
 * a regex literal, which is kept whole, so a quote inside one starts no
 * string. Enough of a tokenizer for these checks; not a JavaScript parser.
 */
function stripSource(src: string, keepStrings = false): string {
  let out = "";
  const regexMayStart = (): boolean => {
    const before = out.replace(/\s+$/, "");
    if (!before) return true;
    if ("(,=:[!&|?{};+-*%<>~^".includes(before.at(-1)!)) return true;
    return /\b(return|typeof|case|do|else|in|of|new|delete|void|throw|await|yield)$/.test(before);
  };
  const regexEnd = (i: number): number => {
    let inClass = false;
    for (let j = i + 1; j < src.length && src[j] !== "\n"; j++) {
      const c = src[j];
      if (c === "\\") j++;
      else if (inClass) inClass = c !== "]";
      else if (c === "[") inClass = true;
      else if (c === "/") {
        j++;
        while (/[a-z]/i.test(src[j] ?? "")) j++;
        return j;
      }
    }
    return i + 1; // no closing slash on the line: a division after all
  };
  // Code from i; inside a template's ${…}, stops after the brace that closes it.
  const code = (i: number, inTemplate: boolean): number => {
    let depth = 0;
    while (i < src.length) {
      const c = src[i]!;
      const d = src[i + 1];
      if (c === "/" && d === "/") {
        while (i < src.length && src[i] !== "\n") i++;
      } else if (c === "/" && d === "*") {
        const close = src.indexOf("*/", i + 2);
        const end = close === -1 ? src.length : close + 2;
        out += src.slice(i, end).replace(/[^\n]/g, "");
        i = end;
      } else if (c === '"' || c === "'") {
        const end = skipQuoted(src, i);
        out += keepStrings ? src.slice(i, end) : c + c;
        i = end;
      } else if (c === "`") {
        i = template(i);
      } else if (c === "/" && regexMayStart()) {
        const end = regexEnd(i);
        out += src.slice(i, end);
        i = end;
      } else {
        if (c === "{") depth++;
        else if (c === "}") {
          if (inTemplate && depth === 0) return i + 1;
          depth--;
        }
        out += c;
        i++;
      }
    }
    return i;
  };
  const template = (i: number): number => {
    out += "`";
    i++;
    while (i < src.length && src[i] !== "`") {
      if (src[i] === "\\") {
        if (keepStrings) out += src.slice(i, i + 2);
        i += 2;
      } else if (src[i] === "$" && src[i + 1] === "{") {
        out += "${";
        i = code(i + 2, true);
        out += "}";
      } else {
        if (keepStrings || src[i] === "\n") out += src[i];
        i++;
      }
    }
    out += "`";
    return i + 1;
  };
  code(0, false);
  return out;
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

/**
 * SPEC R10: no model slug in api/ but HARD_FALLBACKS (C-1527, C-1528). The
 * check is scripts/grep-models.sh, which CI runs; these run that very script,
 * copied into a tree of our making (it cds to its own parent and greps api/).
 */
const GREP_MODELS = "scripts/grep-models.sh";
function slugGrep(root: string): { status: number | null; out: string } {
  if (root !== REPO) {
    mkdirSync(join(root, "scripts"), { recursive: true });
    copyFileSync(join(REPO, GREP_MODELS), join(root, GREP_MODELS));
  }
  const run = spawnSync("bash", [join(root, GREP_MODELS)], { encoding: "utf8" });
  return { status: run.status, out: `${run.stdout}${run.stderr}` };
}

/**
 * The script exempts api/_lib/models.ts whole; the rule (SPEC R10) exempts its
 * HARD_FALLBACKS only. So: models.ts with that one array cut out, at a path
 * the script does not exempt, must pass the script's own grep.
 */
const HARD_FALLBACKS_BLOCK = /export const HARD_FALLBACKS\b[^=]*=\s*\[[\s\S]*?\];/;
function slugsOutsideHardFallbacks(root: string): { status: number | null; out: string } {
  const src = read(root, "api/_lib/models.ts");
  assert.match(src, HARD_FALLBACKS_BLOCK, "api/_lib/models.ts has no HARD_FALLBACKS array to exempt");
  return slugGrep(tempTree({ "api/_lib/models-without-hard-fallbacks.ts": src.replace(HARD_FALLBACKS_BLOCK, "") }));
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

  test("[C-1528] grep-models passes on this tree, whose api/_lib/models.ts holds HARD_FALLBACKS, and nothing in models.ts but that array is a slug", () => {
    const real = slugGrep(REPO);
    assert.equal(real.status, 0, real.out);
    assert.match(real.out, /No hardcoded model slugs under api\//);
    // The exemption is in use, not idle: the slugs it lets through are there.
    const block = read(REPO, "api/_lib/models.ts").match(HARD_FALLBACKS_BLOCK)?.[0] ?? "";
    assert.ok((block.match(/"[a-z0-9-]+\/[^"]+"/g) ?? []).length >= 2, block);
    const rest = slugsOutsideHardFallbacks(REPO);
    assert.equal(rest.status, 0, `a slug in models.ts outside HARD_FALLBACKS:\n${rest.out}`);
  });

  // No criterion of its own: the ground C-1565 (crons, Task 11.1) stands on. A
  // functions key naming a file that does not exist fails the deploy ("The
  // pattern … defined in `functions` doesn't match any Serverless Functions"),
  // so a renamed handler is a broken deploy, caught here before one; an entry
  // point with no key silently runs on the platform's default limits; a cron
  // path with no handler is a scheduled 404 nobody sees.
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

  test("[C-1592] a webhook handler that parses the body is caught, even beside a comment or a string about raw bytes; reading the request's stream or bodyParser:false passes", () => {
    const root = tempTree({
      // api/voice.ts is the post-call webhook (SPEC §2), whatever else it serves;
      // api/wa.ts is Meta's, even when it leaves the signature to a _lib file.
      // A header comment that says the right thing is not the right thing.
      "api/voice.ts": `// The post-call webhook. Reads the body once with arrayBuffer() and verifies those bytes.\nexport async function POST(req: Request) {\n  const event = await req.json();\n  return new Response("ok");\n}\n`,
      "api/wa.ts": `import { inbound } from "./_lib/wa-inbound.js";\nexport async function POST(req: Request) {\n  return inbound(await req.json(), req.headers);\n}\n`,
      "api/whatsapp-webhook.ts": `import { verifyMeta } from "./_lib/crypto.js";\nexport async function POST(req: Request) {\n  const text = await req.text();\n  verifyMeta(Buffer.from(text), req.headers.get("x-hub-signature-256"), "s");\n}\n`,
      // A for-await over something else is not the request's stream.
      "api/sms-webhook.ts": `export async function POST(req: Request) {\n  let n = 0;\n  for await (const page of pages()) n++;\n  return handle(req, n);\n}\n`,
      // Nor is a string that names the right call.
      "api/meta-webhook.ts": `export async function POST(req: Request) {\n  console.warn("read req.arrayBuffer() before verifying");\n  return handle(JSON.parse(await req.text()));\n}\n`,
      // Raw bytes read, and then the body parsed again: the parse is what gets used.
      "api/twilio-webhook.ts": `export async function POST(req: Request) {\n  const raw = Buffer.from(await req.clone().arrayBuffer());\n  const event = await req.json();\n  return handle(raw, event);\n}\n`,
      "api/resend-webhook.ts": `import { verifyResend } from "./_lib/crypto.js";\nexport async function POST(req: Request) {\n  const raw = Buffer.from(await req.arrayBuffer());\n  verifyResend(raw, { id: "", timestamp: "", signature: "" }, "s");\n}\n`,
      "api/meta.ts": `import { verifyMeta } from "./_lib/crypto.js";\nexport const config = { api: { bodyParser: false } };\nexport default async function handler(req: any) { const chunks = []; for await (const c of req) chunks.push(c); verifyMeta(Buffer.concat(chunks), null, "s"); }\n`,
      "api/stream-webhook.ts": `export async function POST(request: Request) {\n  const reader = request.body!.getReader();\n  return handle(await drain(reader));\n}\n`,
      "api/node-webhook.ts": `export default async function handler(req: any) {\n  const chunks: Buffer[] = [];\n  for await (const chunk of req) chunks.push(chunk);\n  return handle(Buffer.concat(chunks));\n}\n`,
      // Not webhooks: the dashboard parses JSON, and a library file is handed bytes by its caller.
      "api/app.ts": `export async function POST(req: Request) { return Response.json(await req.json()); }\n`,
      "api/_lib/post-call.ts": `import { verifyElevenLabs } from "./crypto.js";\nexport function check(raw: Buffer) { return verifyElevenLabs(raw, null, ["s"]); }\n`,
    });
    assert.deepEqual(offenders(webhooksReadRawBytes(root)), [
      "api/meta-webhook.ts",
      "api/sms-webhook.ts",
      "api/twilio-webhook.ts",
      "api/voice.ts",
      "api/wa.ts",
      "api/whatsapp-webhook.ts",
    ]);
  });

  test("[C-1593] a model call in a webhook handler, or in a _lib helper it calls on the request path, is caught; through the queue, or in the worker, it is not", () => {
    const root = tempTree({
      "api/voice.ts": `import { askJSON } from "./_lib/models.js";\nexport async function POST(req: Request) {\n  const raw = Buffer.from(await req.arrayBuffer());\n  const facts = await askJSON<object>("extract", "…", {});\n}\n`,
      "api/resend-webhook.ts": `export async function POST(req: Request) {\n  const raw = Buffer.from(await req.arrayBuffer());\n  const m = await import("./_lib/models.js");\n}\n`,
      "api/whatsapp-webhook.ts": `export async function POST(req: Request) {\n  const raw = Buffer.from(await req.arrayBuffer());\n  await fetch("https://openrouter.ai/api/v1/chat/completions");\n}\n`,
      // Two hops down, inline: the sender waits on a model all the same.
      "api/wa.ts": `import { inbound } from "./_lib/inbound.js";\nexport async function POST(req: Request) {\n  return inbound(Buffer.from(await req.arrayBuffer()));\n}\n`,
      "api/_lib/inbound.ts": `import { db } from "./db.js";\nimport { readFacts } from "./facts.js";\nexport async function inbound(raw: Buffer) { return readFacts(raw); }\n`,
      "api/_lib/facts.ts": `import { askJSON } from "./models.js";\nexport async function readFacts(raw: Buffer) {\n  return askJSON("extract", raw.toString(), {});\n}\n`,
      "api/_lib/db.ts": `export const db = () => null;\n`,
      // Through the queue is job work, whatever the queue's handlers import; a
      // type from models.ts is erased; a comment about a model call is not one.
      "api/meta-webhook.ts": `import type { Role } from "./_lib/models.js";\nimport { enqueue } from "./_lib/queue.js";\n// Never askJSON( here: the extract_facts job does it.\nexport async function POST(req: Request) {\n  const raw = Buffer.from(await req.arrayBuffer());\n  await enqueue("extract_facts", null, { bytes: raw.length });\n}\n`,
      "api/_lib/queue.ts": `import { readFacts } from "./facts.js";\nexport async function enqueue(kind: string, s: null, p: object) {}\n`,
      "api/worker.ts": `import { askJSON } from "./_lib/models.js";\nexport async function POST() { await askJSON("extract", "…", {}); }\n`,
      "api/_lib/extract.ts": `import { askJSON } from "./models.js";\n`,
    });
    const found = noModelCallInWebhooks(root);
    assert.deepEqual(offenders(found), ["api/resend-webhook.ts", "api/voice.ts", "api/wa.ts", "api/whatsapp-webhook.ts"]);
    assert.ok(found.some((l) => /^api\/voice\.ts:4: askJSON/.test(l)), found.join("\n"));
    assert.ok(found.some((l) => /^api\/wa\.ts:1: reaches api\/_lib\/facts\.ts:\d+: /.test(l)), found.join("\n"));
  });

  test("[C-1439] console.log(body), a raw body in a template or across lines, a logged req.json() are caught; a message about the body is not", () => {
    const root = tempTree({
      "api/voice.ts": `export async function POST(req: Request) {\n  const body = await req.text();\n  console.log("post-call", body);\n}\n`,
      "api/_lib/post-call.ts": `export function bad(rawBody: Buffer) {\n  console.error(\n    "bad event",\n    rawBody.toString("utf8"),\n  );\n}\n`,
      "api/_lib/wa.ts": "export function seen(req: any) {\n  console.warn(`inbound ${req.body}`);\n}\n",
      "api/app.ts": `export async function POST(req: Request) {\n  console.info("action", await req.json());\n}\n`,
      // The criterion's own grep is console.log(.*body: "body" anywhere in a name counts.
      "api/_lib/ingest.ts": `export function seen(bodyText: string, bodyJson: unknown, eventBody: string) {\n  console.log("post-call", bodyText);\n  console.warn(bodyJson);\n  console.error(\`event \${eventBody.slice(0, 40)}\`);\n}\n`,
      "api/_lib/ok.ts":
        `export async function fine(bytes: Uint8Array, err: unknown, res: Response) {\n` +
        `  console.warn("post-call: body over the limit", bytes.length);\n` +
        `  console.error("ingest failed", err instanceof Error ? err.message : String(err));\n` +
        "  console.log(`stored ${bytes.length} bytes (raw body not logged)`);\n" +
        "  console.warn(`upstream ${res.status}: ${(await res.text()).slice(0, 200)}`);\n" +
        `}\n`,
    });
    const found = noBodyInLogs(root);
    assert.deepEqual(offenders(found), ["api/_lib/ingest.ts", "api/_lib/post-call.ts", "api/_lib/wa.ts", "api/app.ts", "api/voice.ts"]);
    assert.ok(found.includes("api/voice.ts:3: console.log"), found.join("\n"));
    assert.ok(found.includes("api/_lib/post-call.ts:2: console.error"), found.join("\n"));
    for (const line of ["api/_lib/ingest.ts:2: console.log", "api/_lib/ingest.ts:3: console.warn", "api/_lib/ingest.ts:4: console.error"]) {
      assert.ok(found.includes(line), `${line} not caught:\n${found.join("\n")}`);
    }
  });

  test("[C-1527] grep-models exits 1 when a slug literal is added to api/_lib/extract.ts, and passes the same tree without it", () => {
    const clean = { "api/_lib/env.ts": `export const env = { MODEL: process.env.MODEL ?? "" };\n`, "api/_lib/db.ts": `const ct = "application/json";\n` };
    assert.equal(slugGrep(tempTree(clean)).status, 0, "the tree is clean before the slug is planted");

    for (const slug of ["meta-llama/llama-3.3-70b-instruct:free", "qwen/qwen3-235b-a22b", "mistralai/mistral-small:free"]) {
      const planted = slugGrep(tempTree({ ...clean, "api/_lib/extract.ts": `export const MODEL = "${slug}";\n` }));
      assert.equal(planted.status, 1, `${slug} not caught:\n${planted.out}`);
      assert.match(planted.out, new RegExp(`api/_lib/extract\\.ts:1:.*${slug.replace(/[.]/g, "\\.")}`));
    }
  });

  test("[C-1528] the exemption is HARD_FALLBACKS in api/_lib/models.ts only: not another file named models.ts, not a slug elsewhere in models.ts", () => {
    const hard = `export const HARD_FALLBACKS: string[] = [\n  "nvidia/nemotron-3-ultra-550b-a55b:free",\n  "google/gemma-4-31b-it:free",\n];\n`;
    const ok = tempTree({ "api/_lib/models.ts": `// the model layer\n${hard}export const MIN_MAX_TOKENS = 1200;\n` });
    assert.equal(slugGrep(ok).status, 0, "HARD_FALLBACKS in api/_lib/models.ts is the exemption");
    assert.equal(slugsOutsideHardFallbacks(ok).status, 0);

    const elsewhere = slugGrep(tempTree({ "api/_lib/old/models.ts": hard, "api/models.ts": hard }));
    assert.equal(elsewhere.status, 1, "a file merely named models.ts is not exempt");
    assert.deepEqual(offenders(elsewhere.out.split("\n").filter((l) => l.startsWith("api/"))), ["api/_lib/old/models.ts", "api/models.ts"]);

    const stray = tempTree({ "api/_lib/models.ts": `${hard}const VOICE = "openai/whisper-1";\n` });
    assert.equal(slugGrep(stray).status, 0, "the script alone exempts the whole file…");
    const outside = slugsOutsideHardFallbacks(stray);
    assert.equal(outside.status, 1, "…so a slug beside HARD_FALLBACKS is caught here");
    assert.match(outside.out, /openai\/whisper-1/);
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
