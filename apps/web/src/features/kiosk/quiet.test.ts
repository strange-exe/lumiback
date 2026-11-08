import assert from "node:assert/strict";
import { test } from "node:test";

import { QUIET_MAX_WAIT_MS, QUIET_MIN_WAIT_MS, quietUntil } from "./quiet.ts";

const NOW = Date.parse("2026-11-08T23:00:00+05:30");

test("a quiet answer gives the opening time and a wait", () => {
  const body = {
    detail: "Main gate opens at 23:20",
    quiet: true,
    opens_at: "2026-11-08T23:20:00+05:30",
  };
  assert.deepEqual(quietUntil(body, NOW), {
    opensAt: "2026-11-08T23:20:00+05:30",
    waitMs: 20 * 60_000 + 1_000,
  });
});

test("the wait is never shorter than half a minute nor longer than half an hour", () => {
  const soon = { quiet: true, opens_at: "2026-11-08T23:00:05+05:30" };
  assert.equal(quietUntil(soon, NOW)?.waitMs, QUIET_MIN_WAIT_MS);
  // A tablet whose clock runs fast: the opening time is already past.
  const past = { quiet: true, opens_at: "2026-11-08T22:00:00+05:30" };
  assert.equal(quietUntil(past, NOW)?.waitMs, QUIET_MIN_WAIT_MS);
  const morning = { quiet: true, opens_at: "2026-11-09T06:00:00+05:30" };
  assert.equal(quietUntil(morning, NOW)?.waitMs, QUIET_MAX_WAIT_MS);
});

test("a switched-off gate or a malformed body is not quiet hours", () => {
  for (const body of [
    null,
    "quiet",
    { detail: "Main gate is switched off" },
    { quiet: "true", opens_at: "2026-11-09T06:00:00+05:30" },
    { quiet: true },
    { quiet: true, opens_at: "tomorrow" },
    { quiet: true, opens_at: 6 },
  ]) {
    assert.equal(quietUntil(body, NOW), null, JSON.stringify(body));
  }
});
