import assert from "node:assert/strict";
import { test } from "node:test";

import { faultsEnabled, shouldFail } from "./test-faults.ts";

test("never on in production, even with the flag", () => {
  assert.equal(faultsEnabled({ NODE_ENV: "production", E2E_FAULTS: "1" }), false);
});

test("off unless the flag is exactly 1", () => {
  assert.equal(faultsEnabled({ NODE_ENV: "development" }), false);
  assert.equal(faultsEnabled({ NODE_ENV: "development", E2E_FAULTS: "true" }), false);
  assert.equal(faultsEnabled({ NODE_ENV: "development", E2E_FAULTS: "1" }), true);
  assert.equal(faultsEnabled({ NODE_ENV: "test", E2E_FAULTS: "1" }), true);
});

test("no header: nothing fails", () => {
  assert.equal(shouldFail("/admin/overview", null), false);
  assert.equal(shouldFail("/admin/overview", undefined), false);
  assert.equal(shouldFail("/admin/overview", ""), false);
});

test("matches the path and its sub-paths, ignoring the query", () => {
  assert.equal(shouldFail("/admin/overview", "/admin/overview"), true);
  assert.equal(shouldFail("/admin/overview?x=1", "/admin/overview"), true);
  assert.equal(shouldFail("/admin/outings/late-today", "/admin/outings"), true);
});

test("doesn't match a different path that shares a prefix", () => {
  assert.equal(shouldFail("/admin/overviews", "/admin/overview"), false);
  assert.equal(shouldFail("/auth/me", "/admin"), false);
});

test("several paths, with spaces; entries without a leading slash are ignored", () => {
  const header = " /outings/summary , admin/overview";
  assert.equal(shouldFail("/outings/summary", header), true);
  assert.equal(shouldFail("/admin/overview", header), false);
});
