import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createReporter,
  describeError,
  MAX_BODY_BYTES,
  pathOnly,
  type ErrorPayload,
} from "./error-report.ts";

function setup(answers: (boolean | "throw" | "reject")[] = [], max?: number) {
  const sent: ErrorPayload[] = [];
  const reporter = createReporter({
    platform: "web",
    version: "1.19.0",
    route: () => "/home?code=123#k",
    max,
    send: (payload) => {
      sent.push(payload);
      const answer = answers.shift() ?? true;
      if (answer === "throw") throw new Error("send blew up");
      if (answer === "reject") return Promise.reject(new Error("offline"));
      return Promise.resolve(answer);
    },
  });
  return { sent, reporter };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("a report carries the message, stack, page path, version and platform", () => {
  const { sent, reporter } = setup();
  const error = new TypeError("x is undefined");
  reporter.report(error);
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.message, "TypeError: x is undefined");
  assert.equal(sent[0]!.stack, error.stack);
  assert.equal(sent[0]!.route, "/home"); // never the query string or fragment
  assert.equal(sent[0]!.app_version, "1.19.0");
  assert.equal(sent[0]!.platform, "web");
});

test("without a version the report leaves it out (the website's route adds its own)", () => {
  const sent: ErrorPayload[] = [];
  const reporter = createReporter({
    platform: "web",
    route: () => null,
    send: (payload) => {
      sent.push(payload);
      return Promise.resolve(true);
    },
  });
  reporter.report(new Error("no version"));
  assert.equal("app_version" in sent[0]!, false);
  assert.equal(sent[0]!.route, null);
});

test("the same error is sent once", () => {
  const { sent, reporter } = setup();
  const make = () => new Error("same");
  reporter.report(make());
  reporter.report(make());
  reporter.report("same thrown string");
  reporter.report("same thrown string");
  assert.equal(sent.length, 2);
});

test("at most a few reports per page load", () => {
  const { sent, reporter } = setup([], 3);
  for (let i = 0; i < 10; i++) reporter.report(new Error(`error ${i}`));
  assert.equal(sent.length, 3);
});

test("a failed send stops all reporting: no loop when /errors itself fails", async () => {
  for (const failure of [false, "reject", "throw"] as const) {
    const { sent, reporter } = setup([failure]);
    reporter.report(new Error("first"));
    await settle();
    reporter.report(new Error("second"));
    reporter.report(new Error("third"));
    await settle();
    assert.equal(sent.length, 1, String(failure));
  }
});

test("fields are cut to the API's limits", () => {
  const { sent, reporter } = setup();
  const error = new Error("m".repeat(900));
  error.stack = "s".repeat(20_000);
  reporter.report(error);
  assert.equal(sent[0]!.message.length, 500);
  assert.equal(sent[0]!.stack!.length, 8000);
});

test("noise and non-errors are not reported", () => {
  const { sent, reporter } = setup();
  reporter.report(null);
  reporter.report(undefined);
  reporter.report("");
  reporter.report(new Error("ResizeObserver loop completed with undelivered notifications."));
  const opaque = new Error("Script error.");
  opaque.stack = undefined;
  reporter.report(opaque);
  assert.equal(sent.length, 0);
});

test("whatever was thrown becomes a message", () => {
  assert.deepEqual(describeError("plain"), { message: "plain", stack: null });
  assert.deepEqual(describeError({ message: "shaped" }), { message: "shaped", stack: null });
  assert.equal(describeError(42)?.message, "42");
  assert.equal(describeError(Object.create(null))?.message, "Unknown error");
});

test("a page's path keeps no query string or fragment", () => {
  assert.equal(pathOnly("/watch/abc?code=1"), "/watch/abc");
  assert.equal(pathOnly("/a#token=x"), "/a");
  assert.equal(pathOnly("/" + "x".repeat(400)).length, 300);
});

test("a gate page's path never carries the gate's code", () => {
  assert.equal(pathOnly("/g/3f2a9c1e.89570238.MMTP1QMYEA"), "/g/[code]");
  assert.equal(pathOnly("/g/abc/extra?x=1"), "/g/[code]");
  assert.equal(pathOnly("/g"), "/g");
  assert.equal(pathOnly("/going/out"), "/going/out");
});

test("the body always fits the API's byte cap, even for text that is 3 bytes a letter", () => {
  const { sent, reporter } = setup();
  const devanagari = String.fromCodePoint(0x0915, 0x094d, 0x0937); // three letters, 9 bytes
  const error = new Error(devanagari.repeat(400));
  error.stack = `Error: x\n    at f (app.js:1:2)\n${devanagari.repeat(3000)}`;
  reporter.report(error);
  const body = new TextEncoder().encode(JSON.stringify(sent[0])).length;
  assert.ok(body <= MAX_BODY_BYTES, String(body));
  assert.ok(MAX_BODY_BYTES < 16 * 1024 - 256, "room for the version the website's route adds");
  // Cut, not dropped: the start of the stack (where it broke) is kept.
  assert.ok(sent[0]!.stack!.startsWith("Error: x\n    at f (app.js:1:2)"));
  assert.ok(sent[0]!.stack!.length > 1000);
});

test("escaped characters count too: quotes and newlines are two bytes in JSON", () => {
  const { sent, reporter } = setup();
  const error = new Error("quotes");
  error.stack = '"\n'.repeat(4000);
  reporter.report(error);
  assert.ok(new TextEncoder().encode(JSON.stringify(sent[0])).length <= MAX_BODY_BYTES);
});

test("a cut never leaves half of a character made of two code units", () => {
  const { sent, reporter } = setup();
  const error = new Error("emoji");
  error.stack = "x" + String.fromCodePoint(0x1f600).repeat(8000); // pairs from index 1
  reporter.report(error);
  const last = sent[0]!.stack!.charCodeAt(sent[0]!.stack!.length - 1);
  assert.ok(last < 0xd800 || last > 0xdbff, "ends on a lone high surrogate");
});

test("a server error carries its digest, so different server errors are different groups", () => {
  const { sent, reporter } = setup();
  const generic = "An error occurred in the Server Components render.";
  const first = Object.assign(new Error(generic), { digest: "3477366327" });
  const second = Object.assign(new Error(generic), { digest: "1029384756" });
  first.stack = second.stack = "Error: x\n    at render (app.js:1:2)";
  reporter.report(first);
  reporter.report(second);
  assert.equal(sent.length, 2);
  // In letters (a=0 ... j=9): the API leaves digits out of a group's key and scrubs long numbers.
  assert.equal(sent[0]!.message, `Error: ${generic} [digest dehhdggdch, a=0]`);
  assert.equal(sent[1]!.message, `Error: ${generic} [digest bacjdiehfg, a=0]`);
  assert.doesNotMatch(sent[0]!.message, /\[digest [^\]]*\d[^\]]*,/);
});

test("a digest that isn't a plain number keeps only letters, and the message its cap", () => {
  const { sent, reporter } = setup();
  reporter.report(Object.assign(new Error("m".repeat(900)), { digest: "NEXT_x;<b>9" }));
  assert.equal(sent[0]!.message.length, 500);
  assert.ok(sent[0]!.message.endsWith(" [digest NEXT_xbj, a=0]"), sent[0]!.message.slice(-30));
});
