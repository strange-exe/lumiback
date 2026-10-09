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

test("forwards first, then replies once; a refused reply doesn't lose the email", async () => {
  const calls = [];
  const message = {
    from: "riya@geu.ac.in",
    to: "support@lumiback.abhinesh.codes",
    headers: headers({ Subject: "Help", "Message-ID": "<m@geu.ac.in>" }),
    forward: async (to) => calls.push(["forward", to]),
    reply: async (msg) => {
      calls.push(["reply", msg.to]);
      throw new Error("DMARC failed");
    },
  };
  await worker.default.email(message, { FORWARD_TO: "me@example.com" });
  assert.deepEqual(calls, [
    ["forward", "me@example.com"],
    ["reply", "riya@geu.ac.in"],
  ]);
});
