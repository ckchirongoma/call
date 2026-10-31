// Call — the webhook signature verifiers (api/_lib/crypto.ts).
//
// These pin the verifier half of every webhook criterion. The HTTP half —
// "then 401", "then 200", the webhook_events row, the incident, which secret
// is logged — belongs to the handlers (Task 3.3 for ElevenLabs, the Resend and
// Meta tasks for theirs), so the criteria whose then-clause is an HTTP answer
// are proved there, not tagged here. The tests below that cover the verifier
// side of those name the criterion in plain text, without the bracket tag.
//
// The expected signatures are computed here with node:crypto directly, never
// with the module's own helpers, so a bug in hmacHex cannot sign and verify
// its own mistake.

// Must be first: api/_lib/env.ts snapshots process.env when it is first imported.
import "./_env.ts";
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import nodeCrypto, { createHash, createHmac } from "node:crypto";
import { fakeClock } from "./_fakes.ts";
import { hmacHex, safeEqualHex, sha256Hex, verifyElevenLabs, verifyMeta, verifyResend } from "../api/_lib/crypto.ts";

/** The verifier's own TypeError, not Node's (hmac.update(object) also throws a TypeError). */
const RAW_BODY_ERROR = { name: "TypeError", message: /needs the raw request body as a Buffer/ };

const NOW = Math.floor(Date.parse("2026-10-31T08:00:00.000Z") / 1000);
const MIN = 60;

// A post-call body with a multibyte character in it, pretty-printed, so the
// exact bytes (whitespace included) are what was signed.
const BODY = JSON.stringify(
  {
    type: "post_call_transcription",
    event_timestamp: NOW,
    data: {
      conversation_id: "conv_demo_0001",
      transcript: [{ role: "user", message: "Ja, R 1 235 a month is fine — café 🙂", time_in_call_secs: 12 }],
    },
  },
  null,
  2,
);
const RAW = Buffer.from(BODY, "utf8");

// ── ElevenLabs ──────────────────────────────────────────────────────────────
const EL_SECRET = "test-secret";
const EL_PREVIOUS = "test-secret-previous";

/** HMAC-SHA256 hex over `${t}.` followed by the raw bytes, as ElevenLabs signs. */
const elSign = (secret: string, t: number | string, raw: Buffer = RAW): string =>
  createHmac("sha256", secret).update(`${t}.`, "utf8").update(raw).digest("hex");
const elHeader = (t: number | string, ...hexes: string[]): string => [`t=${t}`, ...hexes.map((h) => `v0=${h}`)].join(",");
const elSigned = (t: number, secret = EL_SECRET, raw: Buffer = RAW): string => elHeader(t, elSign(secret, t, raw));

// ── Resend (svix) ───────────────────────────────────────────────────────────
const RS_KEY = Buffer.from("test-resend-signing-key-0123456789", "utf8");
const RS_SECRET = `whsec_${RS_KEY.toString("base64")}`;
const RS_ID = "msg_demo_0001";

/** base64 HMAC-SHA256 over `${id}.${timestamp}.` followed by the raw bytes, with the DECODED key. */
const rsSign = (key: Buffer | string, id: string, ts: number | string, raw: Buffer = RAW): string =>
  createHmac("sha256", key).update(`${id}.${ts}.`, "utf8").update(raw).digest("base64");
const rsHeaders = (ts: number, signature = `v1,${rsSign(RS_KEY, RS_ID, ts)}`, id = RS_ID) => ({
  id,
  timestamp: String(ts),
  signature,
});

// ── Meta ────────────────────────────────────────────────────────────────────
const APP_SECRET = "test-whatsapp-app-secret";
const metaSign = (secret: string, raw: Buffer = RAW): string =>
  "sha256=" + createHmac("sha256", secret).update(raw).digest("hex");

describe("hashing helpers", () => {
  test("hmacHex and sha256Hex match the published test vectors, for strings and bytes alike", () => {
    // RFC 4231 test case 2 and the FIPS 180-2 "abc" vector.
    const rfc = "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843";
    assert.equal(hmacHex("Jefe", "what do ya want for nothing?"), rfc);
    assert.equal(hmacHex(Buffer.from("Jefe"), Buffer.from("what do ya want for nothing?")), rfc);
    const abc = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
    assert.equal(sha256Hex("abc"), abc);
    assert.equal(sha256Hex(Buffer.from("abc")), abc);
    assert.equal(sha256Hex(RAW), createHash("sha256").update(RAW).digest("hex"));
  });

  test("[C-1590] safeEqualHex checks the length before timingSafeEqual, and an empty digest matches nothing", (t) => {
    const spy = t.mock.method(nodeCrypto, "timingSafeEqual");
    const a = elSign(EL_SECRET, NOW);
    assert.equal(safeEqualHex(a, a), true);
    assert.equal(spy.mock.callCount(), 1);
    assert.equal(safeEqualHex(a, a.slice(0, -1) + (a.endsWith("0") ? "1" : "0")), false);
    assert.equal(spy.mock.callCount(), 2);

    // A different length is refused before timingSafeEqual (which would throw on it).
    assert.equal(safeEqualHex(a, a.slice(0, 10)), false);
    assert.equal(safeEqualHex(a, a + "00"), false);
    assert.equal(spy.mock.callCount(), 2);

    // Charlie's version answered true for ("", ""). An unset digest is never a match.
    assert.equal(safeEqualHex("", ""), false);
    assert.equal(safeEqualHex(a, ""), false);
    assert.equal(safeEqualHex(null as unknown as string, undefined as unknown as string), false);
  });
});

describe("verifyElevenLabs", () => {
  test("[C-1587] verifies the raw Buffer; a parsed body or a string is refused with a TypeError", () => {
    const header = elSigned(NOW);
    assert.deepEqual(verifyElevenLabs(RAW, header, [EL_SECRET], NOW), { ok: true, secretIndex: 0 });
    // Raw bytes in any Uint8Array are still bytes.
    assert.equal(verifyElevenLabs(new Uint8Array(RAW) as Buffer, header, [EL_SECRET], NOW).ok, true);

    // A handler that let the platform parse the body hands over an object. That
    // is a wiring bug, so it fails loudly, never as an ordinary 401.
    const parsed = JSON.parse(BODY);
    assert.throws(() => verifyElevenLabs(parsed as unknown as Buffer, header, [EL_SECRET], NOW), RAW_BODY_ERROR);
    assert.throws(() => verifyElevenLabs(BODY as unknown as Buffer, header, [EL_SECRET], NOW), RAW_BODY_ERROR);
    assert.throws(() => verifyElevenLabs(undefined as unknown as Buffer, header, [EL_SECRET], NOW), RAW_BODY_ERROR);
  });

  test("a missing header is reason missing (verifier half of C-0417)", () => {
    for (const header of [null, undefined, "", "   "]) {
      assert.deepEqual(verifyElevenLabs(RAW, header as string | null, [EL_SECRET], NOW), { ok: false, reason: "missing" }, String(header));
    }
  });

  test("a header without a usable t and v0 is reason malformed (verifier half of C-0418)", () => {
    const hex = elSign(EL_SECRET, NOW);
    const cases = [
      "v0=", // the criterion's case: v0= only
      `v0=${hex}`, // no t
      `t=${NOW}`, // no v0
      `t=${NOW},v0=`, // empty v0
      `t=,v0=${hex}`, // empty t
      `t=soon,v0=${hex}`, // t not a number
      `t=-${NOW},v0=${hex}`,
      `t=${NOW}.5,v0=${hex}`,
      `t=${NOW},t=${NOW - 1},v0=${hex}`, // two t values: which one was signed is ambiguous
      "garbage",
      ",,,",
    ];
    for (const header of cases) {
      assert.deepEqual(verifyElevenLabs(RAW, header, [EL_SECRET], NOW), { ok: false, reason: "malformed" }, header);
    }
  });

  test("t older than 30 minutes is reason stale, even when correctly signed (verifier half of C-0414)", () => {
    for (const age of [31 * MIN, 1801, 24 * 60 * MIN]) {
      const t = NOW - age;
      assert.deepEqual(verifyElevenLabs(RAW, elSigned(t), [EL_SECRET], NOW), { ok: false, reason: "stale" }, `age ${age}`);
    }
  });

  test("t 29 minutes old, or exactly 30, still verifies (verifier half of C-0416)", () => {
    for (const age of [29 * MIN, 1800, 0]) {
      const t = NOW - age;
      assert.deepEqual(verifyElevenLabs(RAW, elSigned(t), [EL_SECRET], NOW), { ok: true, secretIndex: 0 }, `age ${age}`);
    }
  });

  test("t more than 5 minutes ahead is reason future; 5 minutes ahead is clock skew and verifies (verifier half of C-0415)", () => {
    assert.deepEqual(verifyElevenLabs(RAW, elSigned(NOW + 301), [EL_SECRET], NOW), { ok: false, reason: "future" });
    assert.deepEqual(verifyElevenLabs(RAW, elSigned(NOW + 60 * MIN), [EL_SECRET], NOW), { ok: false, reason: "future" });
    // Milliseconds where seconds belong reads as far in the future, never as valid.
    assert.deepEqual(verifyElevenLabs(RAW, elSigned(NOW * 1000), [EL_SECRET], NOW), { ok: false, reason: "future" });
    assert.deepEqual(verifyElevenLabs(RAW, elSigned(NOW + 300), [EL_SECRET], NOW), { ok: true, secretIndex: 0 });
  });

  test("a wrong secret, a changed byte, or a signature moved to a fresh t is reason mismatch", () => {
    assert.deepEqual(verifyElevenLabs(RAW, elSigned(NOW, "not-the-secret"), [EL_SECRET], NOW), { ok: false, reason: "mismatch" });

    const tampered = Buffer.from(RAW);
    tampered[tampered.indexOf("1 235")] = "9".charCodeAt(0);
    assert.deepEqual(verifyElevenLabs(tampered, elSigned(NOW), [EL_SECRET], NOW), { ok: false, reason: "mismatch" });

    // t is inside the signed content, so an old signature cannot be replayed under a new t.
    const old = elSign(EL_SECRET, NOW - 40 * MIN);
    assert.deepEqual(verifyElevenLabs(RAW, elHeader(NOW, old), [EL_SECRET], NOW), { ok: false, reason: "mismatch" });

    // Not hex, or the right hex with a different length: still just a mismatch.
    assert.deepEqual(verifyElevenLabs(RAW, elHeader(NOW, "zz"), [EL_SECRET], NOW), { ok: false, reason: "mismatch" });
    assert.deepEqual(verifyElevenLabs(RAW, elHeader(NOW, elSign(EL_SECRET, NOW) + "0"), [EL_SECRET], NOW), { ok: false, reason: "mismatch" });
  });

  test("with two v0 values, either one matching verifies (verifier half of C-0412)", () => {
    const good = elSign(EL_SECRET, NOW);
    const other = elSign("some-other-secret", NOW);
    assert.deepEqual(verifyElevenLabs(RAW, elHeader(NOW, other, good), [EL_SECRET], NOW), { ok: true, secretIndex: 0 });
    assert.deepEqual(verifyElevenLabs(RAW, elHeader(NOW, good, other), [EL_SECRET], NOW), { ok: true, secretIndex: 0 });
    assert.deepEqual(verifyElevenLabs(RAW, elHeader(NOW, other, other), [EL_SECRET], NOW), { ok: false, reason: "mismatch" });
  });

  test("tolerates spaces around the parts, upper-case hex, and parts it does not know", () => {
    const hex = elSign(EL_SECRET, NOW);
    assert.equal(verifyElevenLabs(RAW, ` t=${NOW} , v0=${hex} `, [EL_SECRET], NOW).ok, true);
    assert.equal(verifyElevenLabs(RAW, `t=${NOW},v0=${hex.toUpperCase()}`, [EL_SECRET], NOW).ok, true);
    assert.equal(verifyElevenLabs(RAW, `t=${NOW},v1=abc,v0=${hex}`, [EL_SECRET], NOW).ok, true);
  });

  test("rotation: the previous secret still verifies and says so with secretIndex 1 (verifier half of C-0422)", () => {
    const secrets = [EL_SECRET, EL_PREVIOUS];
    assert.deepEqual(verifyElevenLabs(RAW, elSigned(NOW, EL_PREVIOUS), secrets, NOW), { ok: true, secretIndex: 1 });
    assert.deepEqual(verifyElevenLabs(RAW, elSigned(NOW, EL_SECRET), secrets, NOW), { ok: true, secretIndex: 0 });
    assert.deepEqual(verifyElevenLabs(RAW, elSigned(NOW, "neither"), secrets, NOW), { ok: false, reason: "mismatch" });

    // An unset slot (env gives "") keeps the others' positions, so the index still names the variable.
    assert.deepEqual(verifyElevenLabs(RAW, elSigned(NOW, EL_PREVIOUS), ["", EL_PREVIOUS], NOW), { ok: true, secretIndex: 1 });
  });

  test("an empty secret never verifies, even a header signed with the empty key", () => {
    const signedWithEmpty = elSigned(NOW, "");
    assert.deepEqual(verifyElevenLabs(RAW, signedWithEmpty, [""], NOW), { ok: false, reason: "mismatch" });
    assert.deepEqual(verifyElevenLabs(RAW, signedWithEmpty, ["", "   "], NOW), { ok: false, reason: "mismatch" });
    assert.deepEqual(verifyElevenLabs(RAW, signedWithEmpty, [], NOW), { ok: false, reason: "mismatch" });
  });

  test("[C-0419] the signature over the original bytes verifies; the same JSON re-serialised does not", () => {
    const header = elSigned(NOW);
    assert.deepEqual(verifyElevenLabs(RAW, header, [EL_SECRET], NOW), { ok: true, secretIndex: 0 });

    // Same data, different whitespace: a verifier that parsed and re-serialised
    // before checking could never have accepted the delivery above.
    const reserialised = Buffer.from(JSON.stringify(JSON.parse(BODY)), "utf8");
    assert.notEqual(reserialised.length, RAW.length);
    assert.deepEqual(JSON.parse(reserialised.toString("utf8")), JSON.parse(BODY));
    assert.deepEqual(verifyElevenLabs(reserialised, header, [EL_SECRET], NOW), { ok: false, reason: "mismatch" });
  });

  test("reads the clock when nowSecs is not given", () => {
    const clock = fakeClock("2026-10-31T08:00:00.000Z");
    try {
      const header = elSigned(NOW - 60);
      assert.deepEqual(verifyElevenLabs(RAW, header, [EL_SECRET]), { ok: true, secretIndex: 0 });
      clock.advance(30 * MIN * 1000);
      assert.deepEqual(verifyElevenLabs(RAW, header, [EL_SECRET]), { ok: false, reason: "stale" });
    } finally {
      clock.uninstall();
    }
  });
});

describe("verifyResend", () => {
  test("[C-1588] HMAC-SHA256 over id.timestamp.body with the base64-decoded secret", () => {
    const clock = fakeClock("2026-10-31T08:00:00.000Z");
    try {
      assert.equal(verifyResend(RAW, rsHeaders(NOW), RS_SECRET), true);
      // The whsec_ prefix is optional; the key is what follows it, decoded.
      assert.equal(verifyResend(RAW, rsHeaders(NOW), RS_KEY.toString("base64")), true);

      // Keyed with the secret text itself rather than its decoded bytes: refused.
      assert.equal(verifyResend(RAW, rsHeaders(NOW, `v1,${rsSign(RS_SECRET, RS_ID, NOW)}`), RS_SECRET), false);
      // Over the body alone, or with the id and timestamp in the wrong order: refused.
      const bodyOnly = createHmac("sha256", RS_KEY).update(RAW).digest("base64");
      assert.equal(verifyResend(RAW, rsHeaders(NOW, `v1,${bodyOnly}`), RS_SECRET), false);
      const swapped = createHmac("sha256", RS_KEY).update(`${NOW}.${RS_ID}.`).update(RAW).digest("base64");
      assert.equal(verifyResend(RAW, rsHeaders(NOW, `v1,${swapped}`), RS_SECRET), false);
      // The id is signed: the same signature under another id is refused.
      assert.equal(verifyResend(RAW, { ...rsHeaders(NOW), id: "msg_demo_0002" }, RS_SECRET), false);
      // A changed byte is refused.
      const tampered = Buffer.from(RAW);
      tampered[tampered.length - 2] ^= 1;
      assert.equal(verifyResend(tampered, rsHeaders(NOW), RS_SECRET), false);
      // A wrong secret is refused.
      assert.equal(verifyResend(RAW, rsHeaders(NOW), `whsec_${Buffer.from("another-key").toString("base64")}`), false);
    } finally {
      clock.uninstall();
    }
  });

  test("[C-1588] svix-signature may carry several space-separated v1 signatures; only v1 counts", () => {
    const clock = fakeClock("2026-10-31T08:00:00.000Z");
    try {
      const good = rsSign(RS_KEY, RS_ID, NOW);
      const other = rsSign(Buffer.from("old-key"), RS_ID, NOW);
      assert.equal(verifyResend(RAW, rsHeaders(NOW, `v1,${other} v1,${good}`), RS_SECRET), true);
      assert.equal(verifyResend(RAW, rsHeaders(NOW, `v1,${good} v1,${other}`), RS_SECRET), true);
      assert.equal(verifyResend(RAW, rsHeaders(NOW, `v1,${other}`), RS_SECRET), false);
      assert.equal(verifyResend(RAW, rsHeaders(NOW, `v2,${good}`), RS_SECRET), false);
      assert.equal(verifyResend(RAW, rsHeaders(NOW, good), RS_SECRET), false);
    } finally {
      clock.uninstall();
    }
  });

  test("[C-1588] the timestamp tolerance is 5 minutes, either side of now", () => {
    const clock = fakeClock("2026-10-31T08:00:00.000Z");
    try {
      for (const [offset, ok] of [
        [-300, true],
        [300, true],
        [-301, false],
        [301, false],
        [-60 * MIN, false],
      ] as const) {
        assert.equal(verifyResend(RAW, rsHeaders(NOW + offset), RS_SECRET), ok, `offset ${offset}`);
      }
      // Moving the clock moves the window: a delivery checked 6 minutes later is refused.
      const headers = rsHeaders(NOW);
      clock.advance(6 * MIN * 1000);
      assert.equal(verifyResend(RAW, headers, RS_SECRET), false);
    } finally {
      clock.uninstall();
    }
  });

  test("a missing header, a non-numeric timestamp or an empty secret is refused, never thrown", () => {
    const clock = fakeClock("2026-10-31T08:00:00.000Z");
    try {
      const h = rsHeaders(NOW);
      assert.equal(verifyResend(RAW, { ...h, id: null }, RS_SECRET), false);
      assert.equal(verifyResend(RAW, { ...h, timestamp: null }, RS_SECRET), false);
      assert.equal(verifyResend(RAW, { ...h, signature: null }, RS_SECRET), false);
      assert.equal(verifyResend(RAW, { ...h, id: "" }, RS_SECRET), false);
      assert.equal(verifyResend(RAW, { ...h, timestamp: "2026-10-31T08:00:00Z" }, RS_SECRET), false);
      assert.equal(verifyResend(RAW, { ...h, signature: "v1," }, RS_SECRET), false);
      // An empty key is something anyone can sign with.
      const emptyKey = { ...h, signature: `v1,${rsSign(Buffer.alloc(0), RS_ID, NOW)}` };
      assert.equal(verifyResend(RAW, emptyKey, ""), false);
      assert.equal(verifyResend(RAW, emptyKey, "whsec_"), false);
      assert.throws(() => verifyResend(JSON.parse(BODY) as unknown as Buffer, h, RS_SECRET), RAW_BODY_ERROR);
    } finally {
      clock.uninstall();
    }
  });
});

describe("verifyMeta", () => {
  test("[C-1589] X-Hub-Signature-256 is sha256 HMAC over the raw bytes with the app secret", () => {
    assert.equal(verifyMeta(RAW, metaSign(APP_SECRET), APP_SECRET), true);
    assert.equal(verifyMeta(RAW, metaSign(APP_SECRET).toUpperCase().replace("SHA256=", "sha256="), APP_SECRET), true);

    assert.equal(verifyMeta(RAW, metaSign("not-the-app-secret"), APP_SECRET), false);
    const tampered = Buffer.from(RAW);
    tampered[5] ^= 1;
    assert.equal(verifyMeta(tampered, metaSign(APP_SECRET), APP_SECRET), false);
    // Re-serialised JSON is different bytes, so it is refused.
    const reserialised = Buffer.from(JSON.stringify(JSON.parse(BODY)), "utf8");
    assert.equal(verifyMeta(reserialised, metaSign(APP_SECRET), APP_SECRET), false);
    // The prefix is part of the format: bare hex, or the old sha1 header, is refused.
    assert.equal(verifyMeta(RAW, metaSign(APP_SECRET).slice("sha256=".length), APP_SECRET), false);
    const sha1 = "sha1=" + createHmac("sha1", APP_SECRET).update(RAW).digest("hex");
    assert.equal(verifyMeta(RAW, sha1, APP_SECRET), false);
    // The right digest under another label of the same length is still not sha256=.
    assert.equal(verifyMeta(RAW, metaSign(APP_SECRET).replace("sha256=", "sha384="), APP_SECRET), false);
  });

  test("a missing header or an empty app secret is refused, never thrown", () => {
    assert.equal(verifyMeta(RAW, null, APP_SECRET), false);
    assert.equal(verifyMeta(RAW, "", APP_SECRET), false);
    assert.equal(verifyMeta(RAW, "sha256=", APP_SECRET), false);
    assert.equal(verifyMeta(RAW, metaSign(""), ""), false);
    assert.throws(() => verifyMeta(BODY as unknown as Buffer, metaSign(APP_SECRET), APP_SECRET), RAW_BODY_ERROR);
  });
});

describe("all three verifiers", () => {
  test("[C-1591] a UTF-8 multibyte body verifies: the bytes are signed, not the string length", () => {
    // The body holds an em dash, an e-acute and an emoji, so its byte length
    // and its JavaScript string length differ.
    assert.ok(RAW.length > BODY.length, "fixture must contain multibyte characters");
    assert.notEqual(Buffer.byteLength(BODY, "utf8"), BODY.length);

    assert.deepEqual(verifyElevenLabs(RAW, elSigned(NOW), [EL_SECRET], NOW), { ok: true, secretIndex: 0 });
    assert.equal(verifyMeta(RAW, metaSign(APP_SECRET), APP_SECRET), true);
    const clock = fakeClock("2026-10-31T08:00:00.000Z");
    try {
      assert.equal(verifyResend(RAW, rsHeaders(NOW), RS_SECRET), true);
    } finally {
      clock.uninstall();
    }

    // Dropping the last byte of the emoji (an invalid UTF-8 tail) is a different body.
    const cut = RAW.subarray(0, RAW.indexOf(Buffer.from("🙂")) + 3);
    assert.deepEqual(verifyElevenLabs(cut, elSigned(NOW), [EL_SECRET], NOW), { ok: false, reason: "mismatch" });
    assert.deepEqual(verifyElevenLabs(cut, elSigned(NOW, EL_SECRET, cut), [EL_SECRET], NOW), { ok: true, secretIndex: 0 });
  });

  test("[C-0421][C-1590] every signature comparison is timingSafeEqual, after a length check", (t) => {
    const spy = t.mock.method(nodeCrypto, "timingSafeEqual");
    const clock = fakeClock("2026-10-31T08:00:00.000Z");
    const sameLengthArgs = () => spy.mock.calls.every((c) => (c.arguments[0] as Buffer).length === (c.arguments[1] as Buffer).length);
    try {
      // ElevenLabs: a match and a same-length mismatch each go through timingSafeEqual.
      assert.equal(verifyElevenLabs(RAW, elSigned(NOW), [EL_SECRET], NOW).ok, true);
      assert.ok(spy.mock.callCount() >= 1, "ElevenLabs match compared with timingSafeEqual");
      let before = spy.mock.callCount();
      assert.equal(verifyElevenLabs(RAW, elSigned(NOW, "not-the-secret"), [EL_SECRET], NOW).reason, "mismatch");
      assert.ok(spy.mock.callCount() > before, "ElevenLabs mismatch compared with timingSafeEqual");

      before = spy.mock.callCount();
      assert.equal(verifyResend(RAW, rsHeaders(NOW), RS_SECRET), true);
      assert.ok(spy.mock.callCount() > before, "Resend compared with timingSafeEqual");

      before = spy.mock.callCount();
      assert.equal(verifyMeta(RAW, metaSign(APP_SECRET), APP_SECRET), true);
      assert.ok(spy.mock.callCount() > before, "Meta compared with timingSafeEqual");

      // Never called with unequal lengths: the length check always comes first.
      assert.ok(sameLengthArgs(), "timingSafeEqual only ever sees equal-length inputs");

      // A short signature is refused by the length check alone, without throwing.
      before = spy.mock.callCount();
      assert.equal(verifyElevenLabs(RAW, elHeader(NOW, "abcd"), [EL_SECRET], NOW).reason, "mismatch");
      assert.equal(verifyResend(RAW, rsHeaders(NOW, "v1,abcd"), RS_SECRET), false);
      assert.equal(verifyMeta(RAW, "sha256=abcd", APP_SECRET), false);
      assert.equal(spy.mock.callCount(), before, "a length mismatch never reaches timingSafeEqual");
    } finally {
      clock.uninstall();
    }
  });
});
