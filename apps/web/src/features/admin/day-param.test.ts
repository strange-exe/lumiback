import assert from "node:assert/strict";
import { test } from "node:test";

import { isRealDate, pastDay } from "./day-param.ts";

test("real YYYY-MM-DD dates only", () => {
  assert.equal(isRealDate("2026-11-07"), true);
  assert.equal(isRealDate("2024-02-29"), true);
  assert.equal(isRealDate("2026-02-29"), false);
  assert.equal(isRealDate("2026-13-01"), false);
  assert.equal(isRealDate("7/11/2026"), false);
  assert.equal(isRealDate(""), false);
  assert.equal(isRealDate(undefined), false);
  assert.equal(isRealDate(["2026-11-07"]), false);
});

test("an earlier day is shown; today, the future or junk means today (null)", () => {
  const today = "2026-11-07";
  assert.equal(pastDay("2026-11-02", today), "2026-11-02");
  assert.equal(pastDay("2026-11-07", today), null);
  assert.equal(pastDay("2026-11-08", today), null);
  assert.equal(pastDay("2026-02-30", today), null);
  assert.equal(pastDay("../../admin", today), null);
  assert.equal(pastDay(undefined, today), null);
});
