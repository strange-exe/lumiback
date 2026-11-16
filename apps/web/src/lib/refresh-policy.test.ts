import assert from "node:assert/strict";
import { test } from "node:test";

import { whenRefreshUnavailable } from "./refresh-policy.ts";

test("the sharer's own API calls wait for the backend instead of going on signed out", () => {
  assert.equal(whenRefreshUnavailable("/api/share/abc"), "retry-later");
  assert.equal(whenRefreshUnavailable("/api/share/abc/location"), "retry-later");
  assert.equal(whenRefreshUnavailable("/api/account/export"), "retry-later");
});

test("a guest's live view goes on: it needs only the guest cookie, not the account", () => {
  // Security audit run-15: a stale account cookie (or a refresh limiter another visitor on the
  // same IP filled) must not cut a guest off their friend's live location.
  assert.equal(whenRefreshUnavailable("/api/watch/abc/stream"), "continue");
  assert.equal(whenRefreshUnavailable("/api/errors"), "continue"); // reports work signed out
});

test("pages go on as before", () => {
  assert.equal(whenRefreshUnavailable("/home"), "continue");
  assert.equal(whenRefreshUnavailable("/"), "continue");
  assert.equal(whenRefreshUnavailable("/api/shared"), "continue"); // a prefix, not the route
});
