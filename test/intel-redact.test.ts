// Call — Chase Intelligence: what never leaves the process (api/_lib/intelredact.ts).
//
// Every captured row is redacted before it is written (intel.ts flushIntel)
// and every exported line again on export (Task 12.5). Two kinds of thing go:
// this deployment's secrets, and anything that identifies a person (ID, card,
// account and phone numbers, email addresses, PINs, OTPs, sign-in codes).
// Money and dates stay: a quotation's whole point is the amounts, and a
// redactor that ate "R1 500 000" or a cover of 150 000 000 cents would make
// the record useless for training. Audio and PDF bytes are kept as their type
// and size, never the bytes (INTEL-CONTRACT §4 rule 4).
//
// The rows are asserted after a real capture and flush into the fake
// database, so what is pinned is what would reach `intel_events`, not only
// what the pure functions return.

// Must be first: api/_lib/env.ts snapshots process.env when it is first imported.
import "./_env.ts";
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { installFakeDb, type FakeDb } from "./_fakes.ts";
import { SECRET_ENV, redactDeep, redactJson, redactText } from "../api/_lib/intelredact.ts";
import { __resetIntel, capture, flushIntel, traceForSession, withTrace } from "../api/_lib/intel.ts";

const S1 = "5e550001-0000-4000-8000-000000000001";
const CLIENT = "00000000-0000-4000-8000-0000000000c1";

type Row = Record<string, any>;

let fake: FakeDb;
const captureWas = process.env.INTEL_CAPTURE;

beforeEach(() => {
  // This file is about what capture writes, so capture is on here whatever the npm script says.
  process.env.INTEL_CAPTURE = "full";
  __resetIntel();
  fake = installFakeDb();
});

afterEach(() => {
  __resetIntel();
  fake.uninstall();
  if (captureWas === undefined) delete process.env.INTEL_CAPTURE;
  else process.env.INTEL_CAPTURE = captureWas;
});

const rows = (): Row[] => fake.tables.intel_events as Row[];
const written = (): string => JSON.stringify(rows());

/** Capture inside a session's trace, as the pipeline does, and write it. */
async function captured(fn: () => void): Promise<Row[]> {
  await withTrace({ traceId: traceForSession(S1), sessionId: S1, clientId: CLIENT, channel: "phone" }, async () => fn());
  const res = await flushIntel();
  assert.equal(res.dropped, 0, "nothing dropped");
  return rows();
}

/** No run of nine or more digits, with or without spaces or dashes inside. */
const NINE_DIGITS = /\d(?:[ -]?\d){8,}/;

describe("intelredact: secrets", () => {
  // The thirteen the criterion names; SECRET_ENV is checked against .env.example below.
  const DEPLOYMENT_SECRETS = [
    "SUPABASE_SERVICE_ROLE_KEY",
    "OPENROUTER_API_KEY",
    "ELEVENLABS_API_KEY",
    "ELEVENLABS_WEBHOOK_SECRET",
    "VOICE_TOOL_SECRET",
    "SESSION_SECRET",
    "WORKER_SECRET",
    "RESEND_API_KEY",
    "WHATSAPP_ACCESS_TOKEN",
    "WHATSAPP_APP_SECRET",
    "TYPESAFE_API_KEY",
    "CRON_SECRET",
    "ADMIN_SECRET",
  ];

  test("[C-1736] every deployment secret, set to a known test value and placed in a prompt, a tool arg and a turn, is in no row", async () => {
    const was = Object.fromEntries(DEPLOYMENT_SECRETS.map((n) => [n, process.env[n]]));
    // Shaped like nothing the pattern rules know, so only the match by value can catch them.
    const value = (name: string): string => `known ${name.toLowerCase().replace(/_/g, " ")} value 7f3a`.replace(/ /g, "-");
    for (const name of DEPLOYMENT_SECRETS) process.env[name] = value(name);
    try {
      const all = DEPLOYMENT_SECRETS.map(value);
      const out = await captured(() => {
        capture("model", { name: "model_call:extract", content: { messages: [{ role: "user", content: `Extract the facts. Config: ${all.join(" ")}` }], response: `{"note":"${all[0]}"}`, reasoning: null } });
        capture("tool", { name: "save_fact", content: { args: { label: "note", value: all.join(","), nested: { deep: [...all] } }, result: { ok: true, echoed: all[3] } } });
        capture("ask", { name: "turn", content: { text: `My broker said the key is ${all.join(" and ")}`, kind: "turn", t: 12.5 }, meta: { chars: 40, idx: 3 } });
      });
      assert.equal(out.length, 3, "the rows themselves were written");
      const text = written();
      for (const name of DEPLOYMENT_SECRETS) assert.ok(!text.includes(value(name)), `${name} was written`);
      assert.match(out[0]!.content.messages[0].content, /^Extract the facts\. Config: \[redacted\]/);
    } finally {
      for (const [name, v] of Object.entries(was)) {
        if (v === undefined) delete process.env[name];
        else process.env[name] = v;
      }
    }
  });

  test("[C-1736] every key, secret and token variable in .env.example is matched by value (a new one cannot be forgotten)", () => {
    const names = [...readFileSync(new URL("../.env.example", import.meta.url), "utf8").matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]!);
    const secretNamed = names.filter((n) => /KEY|SECRET|TOKEN/.test(n));
    assert.ok(secretNamed.length >= 15, `read ${secretNamed.length} from .env.example`);
    for (const n of secretNamed) assert.ok(SECRET_ENV.includes(n), `${n} is not in intelredact.ts SECRET_ENV`);
    // A rotated key is covered at once: the value is read when the text is redacted, not at import.
    const was = process.env.WORKER_SECRET;
    process.env.WORKER_SECRET = "rotated-worker-secret-0042";
    try {
      assert.equal(redactText("x rotated-worker-secret-0042 y"), "x [redacted] y");
    } finally {
      process.env.WORKER_SECRET = was;
    }
  });

  test("[C-1737] a bearer token, a JWT, sk-/xi- keys, a PEM private key, a postgres:// connection string, a Cookie: header and a signed /q/ link are each removed", async () => {
    const pieces = {
      bearer: "Bearer abcdefghijklmnopqrstuvwxyz0123456789",
      jwt: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJkZW1vLWNsaWVudCJ9.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
      skDash: "sk-or-v1-0123456789abcdef0123456789abcdef",
      skUnder: "sk_0123456789abcdef0123456789abcdef01234567",
      xi: "xi-0123456789abcdef0123456789abcdef",
      pem: "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\nAQEAq1w2e3r4t5y6u7i8o9p0\n-----END PRIVATE KEY-----",
      postgres: "postgres://postgres.demo:hunter2pass@db.demo.example.test:5432/postgres",
      cookie: "Cookie: call_session=s3ss10nvalue0123456789; theme=dark",
      signed: "https://call.test/q/7d9f2c1e-0000-4000-8000-00000000a001?exp=1761900000&sig=9f86d081884c7d659a2feaa0c55ad015",
    };
    const secretParts = [
      pieces.bearer.slice(7),
      pieces.jwt,
      pieces.skDash,
      pieces.skUnder,
      pieces.xi,
      "MIIEvQIBADANBgkqhkiG9w0BAQEFAASC",
      "hunter2pass",
      "postgres.demo",
      "s3ss10nvalue0123456789",
      "9f86d081884c7d659a2feaa0c55ad015",
      "7d9f2c1e-0000-4000-8000-00000000a001?exp",
    ];
    const text = Object.entries(pieces)
      .map(([k, v]) => `${k}: before ${v} after`)
      .join("\n");
    const out = redactText(text);
    for (const s of secretParts) assert.ok(!out.includes(s), `kept: ${s.slice(0, 16)}…`);
    for (const k of Object.keys(pieces)) assert.match(out, new RegExp(`${k}: before .*after`), `${k}'s words around it stay`);
    assert.match(out, /\/q\/\[redacted\]/);
    // And so in the row, from a prompt and a tool's args.
    const [model, tool] = await captured(() => {
      capture("model", { name: "model_call:writer", content: { messages: [{ role: "user", content: text }], response: "ok" } });
      capture("tool", { name: "send_link", content: { args: { link: pieces.signed, header: pieces.cookie }, result: null } });
    });
    for (const s of secretParts) assert.ok(!JSON.stringify([model, tool]).includes(s), `written: ${s.slice(0, 16)}…`);
  });

  test("[C-1738] values under secret-named keys go, any case, nested; counts that only sound like it stay", async () => {
    const input = {
      secret: "plain-secret-value",
      Token: "plain-token-value",
      PASSWORD: "plain-password-value",
      headers: { Authorization: "Basic abcdefghijkl", Cookie: "sid=plain-cookie-value", "X-Call-Secret": "plain-call-secret", "ElevenLabs-Signature": "t=1,v0=plain-sig" },
      api_key: "plain-api-key-value",
      list: [{ signature: "plain-signature-value", deeper: { access_token: "plain-access-token", webhook_secret: { nested: "plain-nested" } } }],
      usage: { prompt_tokens: 12, completion_tokens: 30, tokens: 42 },
      max_tokens: 1200,
      label: "secret-free words",
    };
    const leaked = (v: unknown): string[] => JSON.stringify(v).match(/plain-[a-z-]+/g) ?? [];
    for (const out of [redactDeep(input), JSON.parse(redactJson(JSON.stringify(input)))]) {
      assert.deepEqual(leaked(out), [], "no secret value survives");
      assert.equal(out.secret, "[redacted]");
      assert.equal(out.Token, "[redacted]");
      assert.equal(out.PASSWORD, "[redacted]");
      assert.equal(out.headers.Authorization, "[redacted]");
      assert.equal(out.headers.Cookie, "[redacted]");
      assert.equal(out.headers["X-Call-Secret"], "[redacted]");
      assert.equal(out.headers["ElevenLabs-Signature"], "[redacted]");
      assert.equal(out.api_key, "[redacted]");
      assert.equal(out.list[0].signature, "[redacted]");
      assert.equal(out.list[0].deeper.access_token, "[redacted]");
      assert.equal(out.list[0].deeper.webhook_secret, "[redacted]", "a whole object under a secret-named key goes");
      assert.deepEqual(out.usage, { prompt_tokens: 12, completion_tokens: 30, tokens: 42 }, "a count is not a secret");
      assert.equal(out.max_tokens, 1200);
      assert.equal(out.label, "secret-free words");
    }
    const [row] = await captured(() => capture("tool", { name: "notify", content: { args: input, result: null }, meta: { headers: { authorization: "Bearer plain-meta-token-0123456789" } } }));
    assert.deepEqual(leaked(row), []);
    assert.equal(row!.meta.headers.authorization, "[redacted]", "meta is redacted too");
  });
});

describe("intelredact: identifiers", () => {
  test("[C-1739] a 13-digit SA ID, a 10-digit phone, a 16-digit card and an 11-digit account number go, with or without spaces or dashes", async () => {
    const cases = [
      "ID 8001015009087 please",
      "ID 800101 5009 087 please",
      "phone 0799930001 please",
      "phone 079-993-0001 please",
      "phone +27 79 993 0001 please",
      "card 4111111111111111 please",
      "card 4111 1111 1111 1111 please",
      "card 4111-1111-1111-1111 please",
      "account 62123456789 please",
      "account 6212 345 6789 please",
    ];
    for (const c of cases) {
      const out = redactText(c);
      assert.doesNotMatch(out, NINE_DIGITS, `${c} → ${out}`);
      assert.match(out, /^(ID|phone|card|account) \[(number|contact)\] please$/, `${c} → ${out}`);
    }
    const [row] = await captured(() => capture("ask", { name: "turn", content: { text: cases.join(". "), kind: "turn", t: 1 } }));
    assert.doesNotMatch(JSON.stringify(row!.content), NINE_DIGITS);
    // A row's ids are not a person's numbers: a uuid's digit groups, read across its dashes, are kept whole.
    const ids = `session ${S1}, client ${CLIENT}, quote 7d9f2c1e-0000-4000-8000-000000000123`;
    assert.equal(redactText(ids), ids);
    assert.deepEqual(redactDeep({ session_id: S1, note: `for ${CLIENT} call 0799930001` }), { session_id: S1, note: `for ${CLIENT} call [contact]` });
  });

  test("[C-1740] money and dates survive, in text and as JSON numbers under money keys; a long number under any other key does not", async () => {
    const text = "Cover of R1 500 000, I earn about twelve thousand, 12000 a month, from 31 October 2026 (2026-10-31).";
    assert.equal(redactText(text), text);
    const money = { cover_cents: 150000000, premium_cents: 85000, cover_amount: 150000000, value_num: 1500000000, budget: 250000000, total_premium_cents: 1234567890 };
    for (const out of [redactDeep(money), JSON.parse(redactJson(JSON.stringify(money)))]) assert.deepEqual(out, money);
    const ids = { id_number: 8001015009087, phone: 27799930001, account: 62123456789, small: 12345678 };
    assert.deepEqual(redactDeep(ids), { id_number: "[number]", phone: "[number]", account: "[number]", small: 12345678 }, "nine digits or more go unless the key is money; eight stay");
    const [row] = await captured(() => capture("tool", { name: "save_fact", content: { args: { text, ...money }, result: ids } }));
    assert.equal(row!.content.args.text, text);
    for (const [k, v] of Object.entries(money)) assert.equal(row!.content.args[k], v, k);
    assert.equal(row!.content.result.id_number, "[number]");
  });

  test("[C-1741] the login-code email's say row has content null and meta.kind login_code, even in full mode", async () => {
    assert.doesNotMatch(redactText("Your Call sign-in code is 482913."), /482913/, "the text rule alone removes it too");
    const [row] = await captured(() =>
      capture("say", { name: "email:login_code", content: { text: "Your Call sign-in code is 482913. It expires in 10 minutes.", kind: "login_code" }, meta: { kind: "login_code", chars: 58 } }),
    );
    assert.equal(row!.content, null);
    assert.equal(row!.content_mode, "meta");
    assert.equal(row!.meta.kind, "login_code");
    assert.doesNotMatch(written(), /482913|expires in/);
  });

  test("[C-1742] 'my PIN is 4471' and 'the OTP is 552019' lose their digits", async () => {
    for (const [text, digits] of [
      ["my PIN is 4471", "4471"],
      ["the OTP is 552019", "552019"],
      ["My pin: 4471, thanks", "4471"],
      ["one-time pin 552019", "552019"],
    ] as const) {
      const out = redactText(text);
      assert.ok(!out.includes(digits), `${text} → ${out}`);
      assert.match(out, /\[redacted\]/);
    }
    const [row] = await captured(() => capture("ask", { name: "turn", content: { text: "my PIN is 4471 and the OTP is 552019", kind: "turn", t: 3 } }));
    assert.doesNotMatch(JSON.stringify(row), /4471|552019/);
  });

  test("[C-1743] a turn where the client read out their email or number carries [contact], exactly as turns.text does", async () => {
    const said = "You can email me at thandi.demo@example.test or WhatsApp me on 079 993 0001, or +27 79 993 0002.";
    const stored = "You can email me at [contact] or WhatsApp me on [contact], or [contact].";
    assert.equal(redactText(said), stored);
    // turns.text already holds [contact] (SPEC 7.2); redaction leaves it exactly as it is.
    assert.equal(redactText(stored), stored);
    const [raw, fromTurn] = await captured(() => {
      capture("ask", { name: "turn", content: { text: said, kind: "turn", t: 40.2 }, meta: { chars: said.length, idx: 9 } });
      capture("ask", { name: "turn", content: { text: stored, kind: "turn", t: 40.2 }, meta: { chars: stored.length, idx: 9 } });
    });
    assert.equal(raw!.content.text, stored);
    assert.equal(fromTurn!.content.text, stored);
    assert.doesNotMatch(written(), /example\.test|993 000/);
  });
});

describe("intelredact: bytes", () => {
  test("[C-1734] no row holds a base64 run over 200 characters: audio and PDF bytes are kept as their type and size", async () => {
    const bytes = new Uint8Array(6000).map((_, i) => (i * 37) % 256);
    const b64 = Buffer.from(bytes).toString("base64");
    const blob = new Blob([bytes], { type: "audio/ogg" });
    const out = await captured(() => {
      capture("model", { name: "model_call:voice", content: { audio: bytes, response: "four people" } });
      capture("send", { name: "email:quote", content: { attachments: [{ filename: "quote.pdf", content: b64, buffer: Buffer.from(bytes), raw: bytes.buffer }] } });
      capture("tool", { name: "upload", content: { args: { file: `data:audio/webm;base64,${b64}`, blob }, result: null } });
      capture("ask", { name: "turn", content: { text: `the PDF said JVBERi0x${b64} and then nothing`, kind: "turn", t: 2 } });
    });
    assert.equal(out.length, 4);
    assert.doesNotMatch(written(), /[A-Za-z0-9+/]{201,}/, "no bytes as base64");
    assert.doesNotMatch(written(), /(\d+,){200}/, "no bytes as a list of numbers either");
    assert.deepEqual(out[0]!.content.audio, { type: "bytes", size: 6000 });
    const att = out[1]!.content.attachments[0];
    assert.equal(att.filename, "quote.pdf");
    assert.deepEqual(att.content, { type: "base64", size: 6000 });
    assert.deepEqual(att.buffer, { type: "bytes", size: 6000 });
    assert.deepEqual(att.raw, { type: "bytes", size: 6000 });
    assert.deepEqual(out[2]!.content.args.file, { type: "audio/webm", size: 6000 });
    assert.deepEqual(out[2]!.content.args.blob, { type: "audio/ogg", size: 6000 });
    assert.match(out[3]!.content.text, /^the PDF said \[bytes\] and then nothing$/);
  });
});
