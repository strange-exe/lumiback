import assert from "node:assert/strict";
import { test } from "node:test";

import { ago } from "./ago.ts";

test("reads like a person would say it", () => {
  const now = 1_000_000_000;
  assert.equal(ago(now - 3_000, now), "just now");
  assert.equal(ago(now - 25_000, now), "25 s ago");
  assert.equal(ago(now - 3 * 60_000, now), "3 min ago");
  assert.equal(ago(now - 125 * 60_000, now), "2 h ago");
});

test("a clock slightly ahead never shows negative time", () => {
  assert.equal(ago(2_000, 1_000), "just now");
});
