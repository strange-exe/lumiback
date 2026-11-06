import assert from "node:assert/strict";
import { test } from "node:test";

import { isLinkToken, linkTokenFromHash } from "./link-token.ts";

const TOKEN = "AbC_def-1234567890xyzQ";

test("reads the token after #t=", () => {
  assert.equal(linkTokenFromHash(`#t=${TOKEN}`), TOKEN);
});

test("works without the leading # and alongside other values", () => {
  assert.equal(linkTokenFromHash(`t=${TOKEN}`), TOKEN);
  assert.equal(linkTokenFromHash(`#x=1&t=${TOKEN}`), TOKEN);
});

test("no token: an empty hash, another key, or an empty value", () => {
  assert.equal(linkTokenFromHash(""), null);
  assert.equal(linkTokenFromHash("#"), null);
  assert.equal(linkTokenFromHash(`#code=${TOKEN}`), null);
  assert.equal(linkTokenFromHash("#t="), null);
});

test("rejects tokens the backend would refuse anyway", () => {
  assert.equal(linkTokenFromHash("#t=short"), null);
  assert.equal(linkTokenFromHash(`#t=${"a".repeat(101)}`), null);
  assert.equal(linkTokenFromHash(`#t=${TOKEN}%3Cimg%3E`), null);
  assert.equal(linkTokenFromHash(`#t=${TOKEN}.x`), null);
  assert.equal(linkTokenFromHash(`#t=${"a".repeat(100)}`), "a".repeat(100));
  assert.equal(linkTokenFromHash(`#t=${"a".repeat(20)}`), "a".repeat(20));
});

test("the server action's own check refuses anything but a token string", () => {
  assert.equal(isLinkToken(TOKEN), true);
  assert.equal(isLinkToken(null), false);
  assert.equal(isLinkToken(42), false);
  assert.equal(isLinkToken(`${TOKEN} `), false);
  assert.equal(isLinkToken(`${TOKEN}\n`), false);
});
