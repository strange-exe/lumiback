import assert from "node:assert/strict";
import { test } from "node:test";

import { errorCopy, supportHref } from "./error-copy.ts";
import { SUPPORT_EMAIL } from "./support.ts";

test("offline: says so and asks to check the connection", () => {
  const copy = errorCopy({ online: false });
  assert.equal(copy.title, "You're offline");
  assert.match(copy.body, /connection/);
});

test("online: blames the server (it may be waking), never the user", () => {
  const copy = errorCopy({ online: true });
  assert.equal(copy.title, "This page didn't load");
  assert.match(copy.body, /starting up/);
  assert.doesNotMatch(copy.body, /offline/i);
});

test("support link carries the error reference in the body", () => {
  const href = supportHref("1234567890");
  assert.ok(href.startsWith(`mailto:${SUPPORT_EMAIL}?subject=`));
  assert.equal(new URL(href).searchParams.get("body"), "Error reference: 1234567890");
});

test("support link without a reference has no empty body", () => {
  for (const digest of [undefined, "", "   "]) {
    const href = supportHref(digest);
    assert.equal(new URL(href).searchParams.has("body"), false, String(digest));
    assert.match(new URL(href).searchParams.get("subject") ?? "", /didn't load/);
  }
});

test("a reference can't add mail headers", () => {
  const href = supportHref("x&cc=someone@example.com");
  const params = new URL(href).searchParams;
  assert.equal(params.has("cc"), false);
  assert.equal(params.get("body"), "Error reference: x&cc=someone@example.com");
});
