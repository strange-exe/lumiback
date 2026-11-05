// node --test infra/support-email/worker.test.mjs
// The worker imports "cloudflare:email", which only exists on Cloudflare; the test loads a
// copy with that one import replaced, then checks the reply a mail client would receive.
import assert from "node:assert/strict";
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
  assert.match(raw, /\r\nSubject: Re: Can't tap out at the gate\r\n/);
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

test("replies keep an existing Re: and encode non-ASCII subjects", () => {
  const re = worker.buildReply({ from: "s@x.y", to: "a@b.c", subject: "RE: hello" });
  assert.match(re, /\r\nSubject: RE: hello\r\n/);
  const hindi = worker.buildReply({ from: "s@x.y", to: "a@b.c", subject: "नमस्ते" });
  const encoded = hindi.match(/\r\nSubject: =\?UTF-8\?B\?([^?]+)\?=\r\n/)[1];
  assert.equal(Buffer.from(encoded, "base64").toString("utf8"), "Re: नमस्ते");
  const injected = worker.buildReply({ from: "s@x.y", to: "a@b.c", subject: "hi\r\nBcc: x@evil" });
  assert.ok(!/\r\nBcc:/.test(injected), "a subject can't add headers");
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

const incoming = (calls, { failReply = false, extraHeaders = {} } = {}) => ({
  from: "riya@geu.ac.in",
  to: "support@lumiback.abhinesh.codes",
  headers: headers({ Subject: "Help", "Message-ID": "<m@geu.ac.in>", ...extraHeaders }),
  forward: async (to) => calls.push(["forward", to]),
  reply: async (msg) => {
    calls.push(["reply", msg.to]);
    if (failReply) throw new Error("DMARC failed");
  },
});

test("replies once, then forwards (Cloudflare's order)", async () => {
  const calls = [];
  await worker.default.email(incoming(calls), { FORWARD_TO: "me@example.com" });
  assert.deepEqual(calls, [
    ["reply", "riya@geu.ac.in"],
    ["forward", "me@example.com"],
  ]);
});

test("a refused reply still forwards the email", async () => {
  const calls = [];
  await worker.default.email(incoming(calls, { failReply: true }), { FORWARD_TO: "me@example.com" });
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
  const env = { FORWARD_TO: "me@example.com", RESEND_API_KEY: "re_test" };
  await worker.default.email(incoming(calls), env, {}, fetcher);
  assert.deepEqual(calls, [["forward", "me@example.com"]]); // Cloudflare's reply() not used
  const [{ url, init, body }] = sent;
  assert.equal(url, "https://api.resend.com/emails");
  assert.equal(init.headers.Authorization, "Bearer re_test");
  assert.equal(init.headers["Idempotency-Key"], "support-auto-reply-<m@geu.ac.in>");
  assert.equal(body.from, "Lumiback Support <support@lumiback.abhinesh.codes>");
  assert.deepEqual(body.to, ["riya@geu.ac.in"]);
  assert.equal(body.subject, "Re: Help");
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
    const env = { FORWARD_TO: "me@example.com", RESEND_API_KEY: "bad" };
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
