// node --test infra/support-email/worker.test.mjs
// The worker imports "cloudflare:email", which only exists on Cloudflare; the test loads a
// copy with that one import replaced, then checks the reply a mail client would receive.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

const source = readFileSync(new URL("./worker.js", import.meta.url), "utf8");
const stubbed = source.replace(
  'import { EmailMessage } from "cloudflare:email";',
  "class EmailMessage { constructor(from, to, raw) { Object.assign(this, { from, to, raw }); } }",
);
assert.notEqual(stubbed, source, "the cloudflare:email import moved; update this test");
const file = join(mkdtempSync(join(tmpdir(), "lumiback-worker-")), "worker.mjs");
writeFileSync(file, stubbed);
const worker = await import(pathToFileURL(file).href);

const headers = (entries) => new Headers(entries);
const parts = (raw) => {
  const boundary = raw.match(/boundary="([^"]+)"/)[1];
  return raw
    .split(`--${boundary}`)
    .slice(1, -1)
    .map((chunk) => {
      const [head, body] = chunk.trim().split("\r\n\r\n");
      return { head, text: Buffer.from(body.replace(/\r\n/g, ""), "base64").toString("utf8") };
    });
};

test("the reply threads under the original, as an RFC 3834 auto-reply", () => {
  const raw = worker.buildReply({
    from: "support@lumiback.abhinesh.codes",
    to: "riya@geu.ac.in",
    subject: "Can't tap out at the gate",
    messageId: "<abc123@geu.ac.in>",
    now: new Date("2026-10-09T18:00:00Z"),
    id: "test-id",
  });
  assert.match(raw, /^From: Lumiback Support <support@lumiback\.abhinesh\.codes>\r\n/);
  assert.match(raw, /\r\nTo: riya@geu\.ac\.in\r\n/);
  assert.match(raw, /\r\nSubject: We've got your message\r\n/);
  assert.match(raw, /\r\nIn-Reply-To: <abc123@geu\.ac\.in>\r\n/);
  assert.match(raw, /\r\nReferences: <abc123@geu\.ac\.in>\r\n/);
  assert.match(raw, /\r\nMessage-ID: <test-id@lumiback\.abhinesh\.codes>\r\n/);
  assert.match(raw, /\r\nAuto-Submitted: auto-replied\r\n/);
  assert.ok(!/[^\r]\n/.test(raw), "every line ends in CRLF");
  for (const line of raw.split("\r\n")) assert.ok(line.length <= 998, "RFC 5322 line limit");
});

test("both parts carry the same message, and the text part comes first", () => {
  const raw = worker.buildReply({
    from: "support@lumiback.abhinesh.codes",
    to: "riya@geu.ac.in",
    subject: "",
    messageId: null,
  });
  assert.match(raw, /\r\nSubject: We've got your message\r\n/);
  assert.ok(!raw.includes("In-Reply-To"));
  const [text, html] = parts(raw);
  assert.match(text.head, /text\/plain; charset=UTF-8/);
  assert.match(html.head, /text\/html; charset=UTF-8/);
  for (const words of ["Message received", "someone will reply", "call your hostel office"]) {
    assert.ok(text.text.includes(words), words);
    assert.ok(html.text.includes(words), words);
  }
  assert.ok(html.text.includes("Thanks for writing to Lumiback"));
  for (const risky of ["<img", "<style", "display:none", "<a "]) assert.ok(!html.text.includes(risky));
});

test("the reply's subject is fixed: the sender's subject is never reflected", () => {
  // A replayed signed message can carry an extra, unsigned Subject on top, so reflecting it
  // would let a third party put words in Lumiback's mail to the signer.
  for (const subject of ["RE: hello", "नमस्ते", "hi\r\nBcc: x@evil", "Buy now at evil.example, Help"]) {
    const raw = worker.buildReply({ from: "s@x.y", to: "a@b.c", subject });
    assert.match(raw, /\r\nSubject: We've got your message\r\n/, subject);
    assert.ok(!/\r\nBcc:/.test(raw) && !raw.includes("evil.example"), subject);
  }
});

test("automated mail is forwarded but never answered", () => {
  const person = headers({ "Message-ID": "<1@x>" });
  assert.equal(worker.isAutomated("riya@geu.ac.in", person), false);
  assert.equal(worker.isAutomated("", person), true); // bounces have no sender
  assert.equal(worker.isAutomated("MAILER-DAEMON@geu.ac.in", person), true);
  assert.equal(worker.isAutomated("no-reply@lumiback.abhinesh.codes", person), true);
  assert.equal(worker.isAutomated("noreply@github.com", person), true);
  assert.equal(worker.isAutomated("x@y.z", headers({ "Auto-Submitted": "auto-replied" })), true);
  assert.equal(worker.isAutomated("x@y.z", headers({ "Auto-Submitted": "no" })), false);
  assert.equal(worker.isAutomated("x@y.z", headers({ Precedence: "bulk" })), true);
  assert.equal(worker.isAutomated("x@y.z", headers({ "List-Id": "<l.x.y>" })), true);
  assert.equal(worker.isAutomated("x@y.z", headers({ "X-Auto-Response-Suppress": "All" })), true);
  assert.equal(worker.isAutomated("x@y.z", headers({ "X-Auto-Response-Suppress": "OOF, AutoReply" })), true);
  // Outlook can stamp ordinary mail with receipt-only values: still a person, still answered.
  assert.equal(worker.isAutomated("x@y.z", headers({ "X-Auto-Response-Suppress": "DR, RN, NRN" })), false);
  assert.match(worker.automatedReason("x@y.z", headers({ Precedence: "bulk" })), /Precedence: bulk/);
});

test("the keep-awake window is on the campus (IST) clock", () => {
  const at = (iso) => new Date(iso);
  assert.equal(worker.inAwakeWindow(at("2026-10-10T03:59:00Z")), false); // 09:29 IST
  assert.equal(worker.inAwakeWindow(at("2026-10-10T04:00:00Z")), true); // 09:30 IST
  assert.equal(worker.inAwakeWindow(at("2026-10-10T16:29:00Z")), true); // 21:59 IST
  assert.equal(worker.inAwakeWindow(at("2026-10-10T16:30:00Z")), false); // 22:00 IST
  assert.equal(worker.inAwakeWindow(at("2026-10-10T20:00:00Z")), false); // 01:30 IST
  // Empty or invalid settings fall back to the default instead of switching keep-awake off.
  assert.equal(worker.inAwakeWindow(at("2026-10-10T06:30:00Z"), "", "nonsense"), true); // 12:00
  // An overnight window wraps past midnight.
  assert.equal(worker.inAwakeWindow(at("2026-10-10T19:00:00Z"), "17:00", "01:00"), true); // 00:30
  assert.equal(worker.inAwakeWindow(at("2026-10-10T21:00:00Z"), "17:00", "01:00"), false); // 02:30
  // A narrower window, e.g. weekday evenings only.
  assert.equal(worker.inAwakeWindow(at("2026-10-10T12:00:00Z"), "17:30", "22:00"), true); // 17:30
  assert.equal(worker.inAwakeWindow(at("2026-10-10T06:30:00Z"), "17:30", "22:00"), false); // 12:00
});

test("keep-awake pings each service only inside its window, and only when configured", async () => {
  const hits = [];
  const fetcher = async (url) => {
    hits.push(url);
    return new Response("ok", { status: 200 });
  };
  const noon = new Date("2026-10-10T06:30:00Z"); // 12:00 IST
  const evening = new Date("2026-10-10T13:00:00Z"); // 18:30 IST
  const night = new Date("2026-10-10T20:00:00Z"); // 01:30 IST
  const api = { KEEP_AWAKE_URL: "https://api.example/health" };
  const both = { ...api, KEEP_AWAKE_WEB_URL: "https://web.example/app/android.json" };
  assert.equal(
    await worker.keepAwake(noon, {}, fetcher),
    "api: off (no KEEP_AWAKE_URL); web: off (no KEEP_AWAKE_WEB_URL)",
  );
  assert.equal(await worker.keepAwake(night, both, fetcher), "api: outside the window; web: outside the window");
  assert.deepEqual(hits, []);
  // The website's default window is the evening only, to leave free hours for the API.
  assert.equal(await worker.keepAwake(noon, both, fetcher), "api: pinged 200; web: outside the window");
  assert.equal(await worker.keepAwake(evening, both, fetcher), "api: pinged 200; web: pinged 200");
  assert.deepEqual(hits, [
    "https://api.example/health",
    "https://api.example/health",
    "https://web.example/app/android.json",
  ]);
  // Each service has its own window.
  const webAllDay = { ...both, KEEP_AWAKE_WEB_FROM: "10:00", KEEP_AWAKE_WEB_UNTIL: "22:00" };
  assert.equal(await worker.keepAwake(noon, webAllDay, fetcher), "api: pinged 200; web: pinged 200");
  const failing = async () => {
    throw new TypeError("network down");
  };
  assert.equal(
    await worker.keepAwake(noon, api, failing),
    "api: ping failed: TypeError: network down; web: off (no KEEP_AWAKE_WEB_URL)",
  );
});

// ---------- health alerts ----------

const SECRETS = { RESEND_API_KEY: "re_test", FORWARD_TO: "owner@example.com" };
const API_ONLY = { KEEP_AWAKE_URL: "https://api.example/health", ...SECRETS };
const BOTH = { ...API_ONLY, KEEP_AWAKE_WEB_URL: "https://web.example/app/android.json" };
const at = (iso) => new Date(iso);
const NOON = at("2026-10-10T06:30:00Z"); // 12:00 IST, an alert minute
const NOON_10 = at("2026-10-10T06:40:00Z"); // 12:10 IST, not one
const EVENING = at("2026-10-10T13:00:00Z"); // 18:30 IST, both windows

/** A fetcher that answers each URL from `answers` (a Response factory or an Error) and records
 * every Resend call. */
function services(answers) {
  const sent = [];
  const fetcher = async (url, init) => {
    if (url === "https://api.resend.com/emails") {
      sent.push({ headers: init.headers, body: JSON.parse(init.body) });
      return new Response('{"id":"x"}', { status: 200 });
    }
    const answer = answers[url];
    if (answer instanceof Error) throw answer;
    return answer();
  };
  return { fetcher, sent };
}
const json = (body, status = 200) => () => new Response(JSON.stringify(body), { status });
const healthy = {
  "https://api.example/health": json({ status: "ok", sweep: "ok" }),
  "https://web.example/app/android.json": json({ version: 1 }),
};

test("healthy services send no alert and log what the keep-awake always logged", async () => {
  const { fetcher, sent } = services(healthy);
  assert.equal(await worker.monitor(EVENING, BOTH, fetcher), "api: pinged 200; web: pinged 200");
  assert.equal(await worker.monitor(NOON, BOTH, fetcher), "api: pinged 200; web: outside the window");
  assert.deepEqual(sent, []);
});

test("a stale sweep emails the owner through Resend at minute 0 or 30", async () => {
  const { fetcher, sent } = services({
    ...healthy,
    "https://api.example/health": json({ status: "ok", sweep: "stale" }),
  });
  assert.equal(await worker.monitor(NOON, API_ONLY, fetcher), "api: pinged 200, sweep stale; web: off (no KEEP_AWAKE_WEB_URL); alert sent");
  assert.equal(sent.length, 1);
  const [{ headers, body }] = sent;
  assert.equal(headers.Authorization, "Bearer re_test");
  assert.equal(headers["Idempotency-Key"], "health-alert-2026-10-10T06:30");
  assert.deepEqual(body.to, ["owner@example.com"]);
  assert.equal(body.from, "Lumiback Monitor <support@lumiback.abhinesh.codes>");
  assert.equal(body.subject, "Lumiback alert: api needs a look");
  assert.match(body.text, /2026-10-10 12:00 IST/);
  assert.match(body.text, /late alerts and escalations are not going out/);
});

test("alerts are held on the other cron runs, so an incident sends at most 2 an hour", async () => {
  const { fetcher, sent } = services({ ...healthy, "https://api.example/health": json({ status: "database unavailable" }, 503) });
  const runs = [0, 10, 20, 30, 40, 50].map((m) => at(`2026-10-10T06:${String(m).padStart(2, "0")}:00Z`));
  const lines = [];
  for (const now of runs) lines.push(await worker.monitor(now, API_ONLY, fetcher));
  assert.equal(sent.length, 2);
  assert.equal(lines.filter((l) => l.endsWith("alert held until :00 or :30")).length, 4);
  assert.match(sent[0].body.text, /api answered 503 \(https:\/\/api\.example\/health\)/);
  assert.equal(worker.isAlertMinute(NOON), true);
  assert.equal(worker.isAlertMinute(NOON_10), false);
});

test("an unreachable website or API is an alert, and both problems share one email", async () => {
  const { fetcher, sent } = services({
    "https://api.example/health": new TypeError("network down"),
    "https://web.example/app/android.json": json({}, 502),
  });
  const line = await worker.monitor(EVENING, BOTH, fetcher);
  assert.equal(line, "api: ping failed: TypeError: network down; web: pinged 502; alert sent");
  assert.equal(sent.length, 1);
  assert.equal(sent[0].body.subject, "Lumiback alert: services need a look");
  assert.match(sent[0].body.text, /api did not answer: TypeError: network down/);
  assert.match(sent[0].body.text, /web answered 502/);
});

test("the first ping of a window only wakes the service; it never alerts", async () => {
  const { fetcher, sent } = services({ "https://api.example/health": new TypeError("timed out") });
  const opening = at("2026-10-10T04:00:00Z"); // 09:30 IST: the API's window opens, an alert minute
  assert.equal(
    await worker.monitor(opening, API_ONLY, fetcher),
    "api: ping failed: TypeError: timed out; web: off (no KEEP_AWAKE_WEB_URL)",
  );
  assert.deepEqual(sent, []);
  // Ten minutes in, the same failure counts (held, since 09:40 is not an alert minute).
  assert.match(await worker.monitor(at("2026-10-10T04:10:00Z"), API_ONLY, fetcher), /alert held/);
});

test("without the secrets the alert is logged as not sent, and a Resend refusal says why", async () => {
  const down = { "https://api.example/health": json({}, 503) };
  const { fetcher, sent } = services(down);
  const noSecrets = { KEEP_AWAKE_URL: "https://api.example/health" };
  assert.match(await worker.monitor(NOON, noSecrets, fetcher), /alert NOT sent: needs the RESEND_API_KEY and FORWARD_TO secrets$/);
  assert.deepEqual(sent, []);
  const refusing = async (url) =>
    url === "https://api.resend.com/emails"
      ? new Response("domain not verified", { status: 403 })
      : down[url]();
  assert.match(
    await worker.monitor(NOON, API_ONLY, refusing),
    /alert NOT sent: Error: Resend answered 403: domain not verified$/,
  );
});

test("an API answer without a sweep field (an older build) is not an alert", async () => {
  const { fetcher, sent } = services({ "https://api.example/health": json({ status: "ok" }) });
  assert.equal(await worker.monitor(NOON, API_ONLY, fetcher), "api: pinged 200; web: off (no KEEP_AWAKE_WEB_URL)");
  const plain = { "https://api.example/health": () => new Response("ok", { status: 200 }) };
  assert.equal(await worker.monitor(NOON, API_ONLY, services(plain).fetcher), "api: pinged 200; web: off (no KEEP_AWAKE_WEB_URL)");
  assert.deepEqual(sent, []);
});

test("the cron handler runs the monitor", async () => {
  const { fetcher } = services(healthy);
  const realFetch = globalThis.fetch;
  const logged = [];
  const realLog = console.log;
  globalThis.fetch = fetcher;
  console.log = (line) => logged.push(line);
  try {
    let pending;
    await worker.default.scheduled({ scheduledTime: EVENING.getTime() }, BOTH, { waitUntil: (p) => (pending = p) });
    await pending;
  } finally {
    globalThis.fetch = realFetch;
    console.log = realLog;
  }
  assert.deepEqual(logged, ["api: pinged 200; web: pinged 200"]);
});

test("web visits get a plain 404, not an exception", async () => {
  const res = worker.default.fetch(new Request("https://example.workers.dev/"));
  assert.equal(res.status, 404);
  assert.match(await res.text(), /only receives email/);
});

/** A stand-in for a Workers Rate Limiting binding: allows `limit` calls per key, records keys. */
function limiter(limit = Infinity) {
  const counts = new Map();
  const keys = [];
  return {
    keys,
    async limit({ key }) {
      keys.push(key);
      counts.set(key, (counts.get(key) || 0) + 1);
      return { success: counts.get(key) <= limit };
    },
  };
}
const limiters = (sender = limiter(), global = limiter()) => ({
  AUTO_REPLY_SENDER_LIMIT: sender,
  AUTO_REPLY_GLOBAL_LIMIT: global,
});

// The Authentication-Results header Email Routing puts first on every inbound message.
const CF_PASS = "mx.cloudflare.net; spf=pass smtp.mailfrom=geu.ac.in; dkim=pass header.d=geu.ac.in; dmarc=pass header.from=geu.ac.in";

const incoming = (calls, { failReply = false, extraHeaders = {}, from = "riya@geu.ac.in", to, rawHeaders } = {}) => ({
  from,
  to: to || "support@lumiback.abhinesh.codes",
  headers:
    rawHeaders ||
    headers({ From: from, Subject: "Help", "Message-ID": "<m@geu.ac.in>", "Authentication-Results": CF_PASS, ...extraHeaders }),
  forward: async (to) => calls.push(["forward", to]),
  reply: async (msg) => {
    calls.push(["reply", msg.to]);
    if (failReply) throw new Error("DMARC failed");
  },
});

test("replies once, then forwards (Cloudflare's order)", async () => {
  const calls = [];
  await worker.default.email(incoming(calls), { FORWARD_TO: "me@example.com", ...limiters() });
  assert.deepEqual(calls, [
    ["reply", "riya@geu.ac.in"],
    ["forward", "me@example.com"],
  ]);
});

test("a refused reply still forwards the email", async () => {
  const calls = [];
  await worker.default.email(incoming(calls, { failReply: true }), { FORWARD_TO: "me@example.com", ...limiters() });
  assert.deepEqual(calls, [
    ["reply", "riya@geu.ac.in"],
    ["forward", "me@example.com"],
  ]);
});

test("with a Resend key, the reply goes through Resend, threaded and marked as automatic", async () => {
  const calls = [];
  const sent = [];
  const fetcher = async (url, init) => {
    sent.push({ url, init, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ id: "re_1" }), { status: 200 });
  };
  const env = { FORWARD_TO: "me@example.com", RESEND_API_KEY: "re_test", ...limiters() };
  await worker.default.email(incoming(calls), env, {}, fetcher);
  assert.deepEqual(calls, [["forward", "me@example.com"]]); // Cloudflare's reply() not used
  const [{ url, init, body }] = sent;
  assert.equal(url, "https://api.resend.com/emails");
  assert.equal(init.headers.Authorization, "Bearer re_test");
  // A digest of the recipient and Message-ID: the same email retried dedupes, the key stays short.
  const digest = createHash("sha256").update("riya@geu.ac.in <m@geu.ac.in>").digest("hex");
  assert.equal(init.headers["Idempotency-Key"], `support-auto-reply-${digest}`);
  assert.equal(body.from, "Lumiback Support <support@lumiback.abhinesh.codes>");
  assert.deepEqual(body.to, ["riya@geu.ac.in"]);
  assert.equal(body.subject, "We've got your message");
  assert.deepEqual(body.headers, {
    "Auto-Submitted": "auto-replied",
    "X-Auto-Response-Suppress": "All",
    "In-Reply-To": "<m@geu.ac.in>",
    References: "<m@geu.ac.in>",
  });
  assert.match(body.text, /Message received/);
  assert.match(body.html, /Thanks for writing to Lumiback/);
});

test("a Resend refusal is logged with its reason, and the email is still forwarded", async () => {
  const calls = [];
  const logged = [];
  const original = console.log;
  console.log = (line) => logged.push(line);
  try {
    const fetcher = async () => new Response('{"message":"API key is invalid"}', { status: 401 });
    const env = { FORWARD_TO: "me@example.com", RESEND_API_KEY: "bad", ...limiters() };
    await worker.default.email(incoming(calls), env, {}, fetcher);
  } finally {
    console.log = original;
  }
  assert.deepEqual(calls, [["forward", "me@example.com"]]);
  assert.match(logged.at(-1), /^forwarded to inbox; auto-reply NOT sent: Error: Resend answered 401: .*invalid/);
});

test("automated mail is only forwarded", async () => {
  const calls = [];
  const message = incoming(calls, { extraHeaders: { "Auto-Submitted": "auto-replied" } });
  await worker.default.email(message, { FORWARD_TO: "me@example.com" });
  assert.deepEqual(calls, [["forward", "me@example.com"]]);
});

// ---------- auto-reply limits, fixed sender, timeouts ----------

/** Runs email() with console.log captured; returns the log lines. */
async function emailLogged(message, env, fetcher) {
  const logged = [];
  const original = console.log;
  console.log = (line) => logged.push(line);
  try {
    await worker.default.email(message, env, {}, fetcher);
  } finally {
    console.log = original;
  }
  return logged;
}

const resendRecorder = () => {
  const sent = [];
  const fetcher = async (url, init) => {
    sent.push(JSON.parse(init.body));
    return new Response('{"id":"x"}', { status: 200 });
  };
  return { sent, fetcher };
};

test("one sender gets at most the per-sender limit of auto-replies; every email is still forwarded", async () => {
  const { sent, fetcher } = resendRecorder();
  const sender = limiter(1);
  const env = { FORWARD_TO: "me@example.com", RESEND_API_KEY: "re_test", ...limiters(sender) };
  const calls = [];
  await emailLogged(incoming(calls, { from: "Riya@GEU.ac.in" }), env, fetcher);
  const logged = await emailLogged(incoming(calls, { from: "riya@geu.ac.in" }), env, fetcher);
  assert.equal(sent.length, 1);
  assert.deepEqual(sender.keys, ["riya@geu.ac.in", "riya@geu.ac.in"], "the key is the lowercased sender");
  assert.deepEqual(calls, [
    ["forward", "me@example.com"],
    ["forward", "me@example.com"],
  ]);
  assert.match(logged.at(-1), /^forwarded to inbox; no auto-reply \(rate limit: this sender\)$/);
});

test("the global limit stops auto-replies across senders, through Cloudflare too", async () => {
  const global = limiter(2);
  const env = { FORWARD_TO: "me@example.com", ...limiters(limiter(), global) };
  const calls = [];
  for (const from of ["a@geu.ac.in", "b@geu.ac.in", "c@geu.ac.in"]) await emailLogged(incoming(calls, { from }), env);
  assert.deepEqual(
    calls.filter(([kind]) => kind === "reply").map(([, to]) => to),
    ["a@geu.ac.in", "b@geu.ac.in"],
  );
  assert.equal(calls.filter(([kind]) => kind === "forward").length, 3);
  assert.deepEqual(global.keys, ["all", "all", "all"]);
});

test("a sender over its own limit doesn't use up the global allowance", async () => {
  const global = limiter();
  const env = { FORWARD_TO: "me@example.com", ...limiters(limiter(0), global) };
  await emailLogged(incoming([]), env);
  assert.deepEqual(global.keys, []);
});

test("without the rate-limit bindings (or when one throws), no auto-reply, but the email is forwarded", async () => {
  const { sent, fetcher } = resendRecorder();
  const calls = [];
  const logged = await emailLogged(
    incoming(calls),
    { FORWARD_TO: "me@example.com", RESEND_API_KEY: "re_test" },
    fetcher,
  );
  assert.deepEqual(sent, []);
  assert.deepEqual(calls, [["forward", "me@example.com"]]);
  assert.match(logged.at(-1), /no auto-reply \(rate limit: AUTO_REPLY_SENDER_LIMIT binding missing\)$/);
  const broken = { async limit() { throw new Error("limiter down"); } };
  const logged2 = await emailLogged(
    incoming(calls),
    { FORWARD_TO: "me@example.com", RESEND_API_KEY: "re_test", ...limiters(limiter(), broken) },
    fetcher,
  );
  assert.deepEqual(sent, []);
  assert.match(logged2.at(-1), /no auto-reply \(rate limit check failed: Error: limiter down\)$/);
});

test("the reply always comes from the support address, never the envelope recipient", async () => {
  const { sent, fetcher } = resendRecorder();
  const env = { FORWARD_TO: "me@example.com", RESEND_API_KEY: "re_test", ...limiters() };
  await emailLogged(incoming([], { to: "attacker@evil.example" }), env, fetcher);
  assert.equal(sent[0].from, "Lumiback Support <support@lumiback.abhinesh.codes>");
  // The Cloudflare reply() fallback too.
  const replies = [];
  const message = {
    ...incoming([], { to: "billing@lumiback.abhinesh.codes" }),
    reply: async (msg) => replies.push(msg),
  };
  await emailLogged(message, { FORWARD_TO: "me@example.com", ...limiters() });
  assert.equal(replies[0].from, "support@lumiback.abhinesh.codes");
  assert.match(replies[0].raw, /^From: Lumiback Support <support@lumiback\.abhinesh\.codes>\r\n/);
});

test("a prepended second Subject is not reflected through Resend either", async () => {
  const { sent, fetcher } = resendRecorder();
  const env = { FORWARD_TO: "me@example.com", RESEND_API_KEY: "re_test", ...limiters() };
  const rawHeaders = new Headers([
    ["From", "riya@geu.ac.in"],
    ["Subject", "Buy now at evil.example"],
    ["Subject", "Help"],
    ["Message-ID", "<m@geu.ac.in>"],
    ["Authentication-Results", CF_PASS],
  ]);
  await emailLogged(incoming([], { rawHeaders }), env, fetcher);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].subject, "We've got your message");
  assert.ok(!JSON.stringify(sent[0]).includes("evil.example"));
});

/** A fetcher that never answers until its signal aborts, like a hung upstream. */
const hanging = (seen) => (url, init) =>
  new Promise((_, reject) => {
    seen.push(url);
    if (!init?.signal) return; // no signal: hangs forever (the test's own timeout catches it)
    init.signal.addEventListener("abort", () => reject(init.signal.reason));
  });

test("every outbound fetch carries a timeout, and a timeout fails like any other fetch error", async (t) => {
  const saved = { ...worker.FETCH_TIMEOUT_MS };
  Object.assign(worker.FETCH_TIMEOUT_MS, { ping: 20, resend: 20 });
  t.after(() => Object.assign(worker.FETCH_TIMEOUT_MS, saved));
  const seen = [];
  // A ping that hangs is reported as a failed ping and alerts as before; a hung alert send is
  // logged as not sent.
  const line = await worker.monitor(NOON, API_ONLY, hanging(seen));
  assert.match(line, /^api: ping failed: TimeoutError: .+; web: off \(no KEEP_AWAKE_WEB_URL\); alert NOT sent: TimeoutError: /);
  assert.deepEqual(seen, ["https://api.example/health", "https://api.resend.com/emails"]);
  // A hung Resend auto-reply is logged as not sent, and the email is still forwarded.
  const calls = [];
  const logged = await emailLogged(
    incoming(calls),
    { FORWARD_TO: "me@example.com", RESEND_API_KEY: "re_test", ...limiters() },
    hanging([]),
  );
  assert.deepEqual(calls, [["forward", "me@example.com"]]);
  assert.match(logged.at(-1), /^forwarded to inbox; auto-reply NOT sent: TimeoutError: /);
});

test("the real timeouts leave a Render cold start room to answer", () => {
  assert.ok(worker.FETCH_TIMEOUT_MS.ping >= 25_000, "a cold start can take ~30 s; a ping must not cut it short");
  assert.ok(worker.FETCH_TIMEOUT_MS.resend <= 15_000);
});

// ---------- DMARC gate (no backscatter) and the sender's Message-ID ----------

/** Headers with Authentication-Results repeated in order (Headers.get joins them with ", "). */
const withResults = (...results) =>
  new Headers([
    ["Subject", "Help"],
    ["Message-ID", "<m@geu.ac.in>"],
    ...results.map((r) => ["Authentication-Results", r]),
  ]);

test("only Cloudflare's own first Authentication-Results with dmarc=pass allows an auto-reply", () => {
  const ok = (...r) => worker.dmarcReason(withResults(...r)) === null;
  assert.equal(ok(CF_PASS), true);
  // Case-insensitive, with an optional version after the authserv-id, and comments ignored.
  assert.equal(ok("MX.Cloudflare.NET 1; dmarc=PASS header.from=x.in; spf=pass (mx.cloudflare.net: a, b) smtp.mailfrom=x.in"), true);
  // No result, or not Cloudflare's: no reply.
  assert.equal(ok(), false);
  assert.equal(ok("evil.example; dmarc=pass header.from=geu.ac.in"), false);
  assert.equal(ok("mx.cloudflare.net.evil.example; dmarc=pass"), false);
  assert.equal(ok("mx.cloudflare.net; spf=pass; dkim=pass"), false); // no dmarc result at all
  // Cloudflare's result is not a pass.
  for (const v of ["fail", "none", "temperror", "permerror", "bestguesspass"]) {
    assert.equal(ok(`mx.cloudflare.net; dmarc=${v} header.from=x.in`), false, v);
  }
  // A pass hidden in a comment, or a second dmarc result, is not trusted.
  assert.equal(ok("mx.cloudflare.net; dmarc=fail (spoof: dmarc=pass) header.from=x.in"), false);
  assert.equal(ok("mx.cloudflare.net; dmarc=fail; dmarc=pass"), false);
  // Cloudflare adds its header on top, so a sender's own copies come after it. They never
  // upgrade Cloudflare's failure, even when they claim to be mx.cloudflare.net.
  assert.equal(ok("mx.cloudflare.net; dmarc=fail header.from=x.in", "mx.cloudflare.net; dmarc=pass"), false);
  assert.equal(ok("mx.cloudflare.net; dmarc=none header.from=x.in", "evil.example; dmarc=pass"), false);
  assert.equal(ok(CF_PASS, "evil.example; dmarc=fail"), true);
  assert.match(worker.dmarcReason(withResults()), /no Authentication-Results/);
  assert.match(worker.dmarcReason(withResults("mx.cloudflare.net; dmarc=fail")), /dmarc=fail/);
});

test("sender text quoted inside Cloudflare's result is never read as structure (RFC 8601)", () => {
  const ok = (...r) => worker.dmarcReason(withResults(...r)) === null;
  // A quoted envelope local part echoed as smtp.mailfrom can hold ";" and ",": neither may
  // inject a pass nor cut off Cloudflare's real result.
  assert.equal(ok('mx.cloudflare.net; spf=none smtp.mailfrom="x;dmarc=pass,"@victim.example; dmarc=none header.from=victim.example'), false);
  assert.equal(ok('mx.cloudflare.net; spf=none smtp.mailfrom="x;dmarc=pass"@victim.example; dmarc=none header.from=victim.example'), false);
  // A quoted string after the real result (Cloudflare's order: DKIM, DMARC, SPF, ARC) leaves it alone.
  assert.equal(ok('mx.cloudflare.net; dmarc=pass header.from=x.in; spf=pass smtp.mailfrom="a,b;c"@x.in'), true);
  // Unbalanced quotes or comments: unreadable, so no reply.
  assert.equal(ok('mx.cloudflare.net; spf=none smtp.mailfrom="x@y; dmarc=pass header.from=x.in'), false);
  assert.equal(ok("mx.cloudflare.net; spf=none (open comment; dmarc=pass header.from=x.in"), false);
});

// A real Email Routing header (Gmail to the support address, 2026-11-06; the sender's
// address replaced). Cloudflare quotes the remote IP (it holds ":") and leaves plain tokens bare.
const CF_REAL =
  "mx.cloudflare.net; dkim=pass header.d=gmail.com header.s=20260707 header.b=QM2IN6Kl; " +
  "dmarc=pass header.from=gmail.com policy.dmarc=none; " +
  "spf=none (mx.cloudflare.net: no SPF records found for postmaster@mail-ed1-x529.google.com) smtp.helo=mail-ed1-x529.google.com; " +
  "spf=pass (mx.cloudflare.net: domain of sender@gmail.com designates 2a00:1450:4864:20::529 as permitted sender) smtp.mailfrom=sender@gmail.com; " +
  'arc=pass smtp.remote-ip="2a00:1450:4864:20::529"';

test("a real Email Routing header passes, and the sender who signed it gets the reply", async () => {
  assert.equal(worker.dmarcReason(withResults(CF_REAL)), null);
  const signed = withResults(CF_REAL);
  signed.set("From", "Sender <sender@gmail.com>");
  assert.equal(worker.senderReason("sender@gmail.com", signed), null);
  // The same pass never covers another domain's mailbox.
  const other = withResults(CF_REAL);
  other.set("From", "victim@victim.example");
  assert.match(worker.senderReason("victim@victim.example", other), /not the DMARC-authenticated gmail\.com/);
});

test("sender text echoed unquoted in Cloudflare's result can't hide or replace its DMARC result", () => {
  const reason = (r) => worker.dmarcReason(withResults(r));
  // Cloudflare's real result is a fail; the sender's DKIM selector and HELO are written in
  // without the quotes RFC 8601 asks for. Each trick is refused rather than read as a pass.
  const withFields = (selector, helo) =>
    `mx.cloudflare.net; dkim=pass header.d=victim.example header.s=${selector} header.b=abc; ` +
    "dmarc=fail header.from=victim.example policy.dmarc=reject; " +
    `spf=none (mx.cloudflare.net: no SPF records found for postmaster@${helo}) smtp.helo=${helo}; ` +
    'arc=none smtp.remote-ip="192.0.2.1"';
  const fake = "dmarc=pass header.from=victim.example";
  // A ";" adds a second dmarc result.
  assert.match(reason(withFields(`s1; ${fake}`, "mx.example")), /more than one dmarc/);
  assert.match(reason(withFields("s1", `mx.example; ${fake}`)), /more than one dmarc/);
  // A "," ends the first header before Cloudflare's result.
  assert.match(reason(withFields(`s1, x`, "mx.example")), /no dmarc result/);
  // A quote or comment opened in the selector swallows the real result, and a later field
  // closes it and adds a pass. Without the order rule this read as the only result: a pass.
  const hidden = (open, close) =>
    `mx.cloudflare.net; dkim=pass header.d=victim.example header.s=s1${open} header.b=abc; ` +
    `dmarc=fail header.from=victim.example policy.dmarc=reject; spf=none smtp.helo=x${close}; ${fake}`;
  assert.match(reason(hidden('"', '"')), /a quote or comment at or before/);
  assert.match(reason(hidden("(", ")")), /a quote or comment at or before/);
  // A quote inside the dmarc result itself is refused the same way.
  assert.match(reason('mx.cloudflare.net; dmarc=pass reason="a" header.from=x.in'), /a quote or comment at or before/);
});

test("the reply goes only to an envelope sender in the domain DMARC authenticated", async () => {
  const replied = async (from, results, headerFrom = from) => {
    const { sent, fetcher } = resendRecorder();
    const env = { FORWARD_TO: "me@example.com", RESEND_API_KEY: "re_test", ...limiters() };
    const calls = [];
    const rawHeaders = withResults(results);
    if (headerFrom !== null) rawHeaders.set("From", headerFrom);
    const logged = await emailLogged(incoming(calls, { from, rawHeaders }), env, fetcher);
    assert.deepEqual(calls, [["forward", "me@example.com"]], "always forwarded");
    return { sent: sent.length === 1, log: logged.at(-1) };
  };
  // DKIM-aligned mail from the attacker's own domain with someone else's envelope sender.
  const forged = "mx.cloudflare.net; spf=fail smtp.mailfrom=victim.example; dkim=pass header.d=attacker.example; dmarc=pass header.from=attacker.example";
  const r = await replied("victim@victim.example", forged);
  assert.equal(r.sent, false);
  assert.match(r.log, /no auto-reply \(sender: /);
  // A pass that names no header.from domain can't be tied to the sender.
  assert.equal((await replied("riya@geu.ac.in", "mx.cloudflare.net; dmarc=pass")).sent, false);
  // Only a plain address: no quotes, commas, spaces, brackets or a second @.
  for (const from of ['"a,b"@geu.ac.in', "a b@geu.ac.in", "<riya@geu.ac.in>", "a@b@geu.ac.in", "riya@geu.ac.in, x@evil.example", "riya@geu"]) {
    assert.equal((await replied(from, CF_PASS)).sent, false, from);
  }
  // Aligned: the same domain (any case) or a subdomain of it (relaxed alignment).
  assert.equal((await replied("Riya@GEU.ac.in", CF_PASS)).sent, true);
  assert.equal((await replied("riya@mail.geu.ac.in", CF_PASS)).sent, true);
  assert.equal((await replied("riya@notgeu.ac.in", CF_PASS)).sent, false, "a suffix is not a subdomain");
  // DKIM signs the From header, not the envelope: a signed message replayed with another
  // mailbox of the same domain as its envelope sender gets no reply.
  const replay = await replied("victim@geu.ac.in", CF_PASS, "attacker@geu.ac.in");
  assert.equal(replay.sent, false);
  assert.match(replay.log, /no auto-reply \(sender: /);
  assert.equal((await replied("riya@geu.ac.in", CF_PASS, null)).sent, false, "no From header");
  assert.equal((await replied("riya@geu.ac.in", CF_PASS, "a@geu.ac.in, riya@geu.ac.in")).sent, false);
  // A display name is fine; the address inside the angle brackets is what counts.
  assert.equal((await replied("riya@geu.ac.in", CF_PASS, '"Verma, Riya" <Riya@geu.ac.in>')).sent, true);
  assert.equal((await replied("riya@geu.ac.in", CF_PASS, '"riya@geu.ac.in" <x@geu.ac.in>')).sent, false);
  // header.from text inside a quoted value is not the property; two of them is ambiguous.
  const quotedFrom = 'mx.cloudflare.net; dmarc=pass reason="x header.from=victim.example" header.from=geu.ac.in';
  assert.equal((await replied("victim@victim.example", quotedFrom)).sent, false);
  // Cloudflare writes no quoted value in its DMARC result, so one there means no reply at all.
  assert.equal((await replied("riya@geu.ac.in", quotedFrom)).sent, false);
  const twoFroms = "mx.cloudflare.net; dmarc=pass header.from=geu.ac.in header.from=victim.example";
  assert.equal((await replied("riya@geu.ac.in", twoFroms)).sent, false);
});

test("the Resend idempotency key is bound to the recipient as well as the Message-ID", async () => {
  const keys = [];
  const { fetcher } = resendRecorder();
  const recording = async (url, init) => {
    keys.push(init.headers["Idempotency-Key"]);
    return fetcher(url, init);
  };
  const env = () => ({ FORWARD_TO: "me@example.com", RESEND_API_KEY: "re_test", ...limiters() });
  await emailLogged(incoming([], { from: "riya@geu.ac.in" }), env(), recording);
  await emailLogged(incoming([], { from: "aman@geu.ac.in" }), env(), recording);
  assert.equal(keys.length, 2);
  assert.notEqual(keys[0], keys[1]);
});

test("without Cloudflare's dmarc=pass, nothing is sent (Resend or Cloudflare) but the email is forwarded", async () => {
  for (const results of [[], ["evil.example; dmarc=pass"], ["mx.cloudflare.net; dmarc=fail", "mx.cloudflare.net; dmarc=pass"]]) {
    const { sent, fetcher } = resendRecorder();
    const calls = [];
    const sender = limiter();
    const env = { FORWARD_TO: "me@example.com", RESEND_API_KEY: "re_test", ...limiters(sender) };
    const logged = await emailLogged(incoming(calls, { rawHeaders: withResults(...results) }), env, fetcher);
    assert.deepEqual(sent, [], String(results));
    assert.deepEqual(calls, [["forward", "me@example.com"]]);
    assert.match(logged.at(-1), /^forwarded to inbox; no auto-reply \(DMARC: /);
    assert.deepEqual(sender.keys, [], "a spoofed sender doesn't use up the rate limit");
    // The Cloudflare reply() fallback is gated the same way.
    const cfCalls = [];
    await emailLogged(incoming(cfCalls, { rawHeaders: withResults(...results) }), { FORWARD_TO: "me@example.com", ...limiters() });
    assert.deepEqual(cfCalls, [["forward", "me@example.com"]]);
  }
});

test("a Message-ID is used for threading only when it is short and shaped <left@right>", async () => {
  const good = "<m@geu.ac.in>";
  assert.equal(worker.safeMessageId(good), good);
  assert.equal(worker.safeMessageId(`  ${good}  `), good);
  const long = `<${"a".repeat(240)}@geu.ac.in>`;
  assert.ok(long.length > 250);
  for (const bad of [null, "", "m@geu.ac.in", "<m.geu.ac.in>", "<m@>", "<@x>", "<a b@x>", "<a@x>\r\nBcc: e@x", "<a@x><b@y>", "<a@b@c>", long]) {
    assert.equal(worker.safeMessageId(bad), null, String(bad).slice(0, 40));
  }
  assert.equal(worker.safeMessageId(`<${"a".repeat(238)}@geu.ac.in>`).length, 250);
  assert.equal(worker.safeMessageId(`<${"a".repeat(239)}@geu.ac.in>`), null, "251 is one too many");

  for (const messageId of [long, "not-a-message-id", "<a b@x>"]) {
    const { sent, fetcher } = resendRecorder();
    const keys = [];
    const recording = async (url, init) => {
      keys.push(init.headers["Idempotency-Key"]);
      return fetcher(url, init);
    };
    const env = { FORWARD_TO: "me@example.com", RESEND_API_KEY: "re_test", ...limiters() };
    const message = () => incoming([], { extraHeaders: { "Message-ID": messageId } });
    await emailLogged(message(), env, recording);
    await emailLogged(message(), { ...env, ...limiters() }, recording);
    assert.equal(sent.length, 2);
    assert.deepEqual(sent[0].headers, { "Auto-Submitted": "auto-replied", "X-Auto-Response-Suppress": "All" });
    for (const key of keys) {
      assert.match(key, /^support-auto-reply-[0-9a-f-]{36}$/, "a random key");
      assert.ok(!key.includes("a".repeat(20)));
    }
    assert.notEqual(keys[0], keys[1]);
    // The Cloudflare raw reply drops it too.
    const raw = worker.buildReply({ from: "s@x.y", to: "a@b.c", subject: "x", messageId });
    assert.ok(!/In-Reply-To|References/.test(raw));
  }
  // A good one threads, and its key is a fixed-length digest well under Resend's 256 characters.
  const { sent, fetcher } = resendRecorder();
  const keys = [];
  const env = { FORWARD_TO: "me@example.com", RESEND_API_KEY: "re_test", ...limiters() };
  const at250 = `<${"a".repeat(238)}@geu.ac.in>`;
  assert.equal(at250.length, 250);
  await emailLogged(incoming([], { extraHeaders: { "Message-ID": at250 } }), env, async (url, init) => {
    keys.push(init.headers["Idempotency-Key"]);
    return fetcher(url, init);
  });
  assert.equal(sent[0].headers["In-Reply-To"], at250);
  assert.equal(sent[0].headers.References, at250);
  assert.equal(keys[0], `support-auto-reply-${createHash("sha256").update(`riya@geu.ac.in ${at250}`).digest("hex")}`);
  assert.ok(keys[0].length <= 256);
});
