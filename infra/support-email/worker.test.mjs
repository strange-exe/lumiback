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
  // A narrower window, e.g. weekday evenings only.
  assert.equal(worker.inAwakeWindow(at("2026-10-10T12:00:00Z"), "17:30", "22:00"), true); // 17:30
  assert.equal(worker.inAwakeWindow(at("2026-10-10T06:30:00Z"), "17:30", "22:00"), false); // 12:00
});

test("keep-awake pings only inside the window, and only when configured", async () => {
  const hits = [];
  const fetcher = async (url) => {
    hits.push(url);
    return new Response("ok", { status: 200 });
  };
  const noon = new Date("2026-10-10T06:30:00Z"); // 12:00 IST
  const night = new Date("2026-10-10T20:00:00Z"); // 01:30 IST
  const env = { KEEP_AWAKE_URL: "https://api.example/health" };
  assert.equal(await worker.keepAwake(noon, {}, fetcher), "keep-awake off (no KEEP_AWAKE_URL)");
  assert.equal(await worker.keepAwake(night, env, fetcher), "outside the window");
  assert.equal(await worker.keepAwake(noon, env, fetcher), "pinged: 200");
  assert.deepEqual(hits, ["https://api.example/health"]);
  const failing = async () => {
    throw new TypeError("network down");
  };
  assert.equal(await worker.keepAwake(noon, env, failing), "ping failed: TypeError: network down");
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
