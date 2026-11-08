import assert from "node:assert/strict";
import { test } from "node:test";

import { readQuietHours } from "./quiet-hours.ts";

test("off sends no times, whatever the boxes hold", () => {
  assert.deepEqual(readQuietHours(false, "23:00", "05:30"), { ok: true, from: null, until: null });
  assert.deepEqual(readQuietHours(false, "", ""), { ok: true, from: null, until: null });
});

test("on needs two real, different times, which may cross midnight", () => {
  assert.deepEqual(readQuietHours(true, "23:00", "05:30"), {
    ok: true,
    from: "23:00",
    until: "05:30",
  });
  assert.deepEqual(readQuietHours(true, " 13:15:00 ", "14:00"), {
    ok: true,
    from: "13:15",
    until: "14:00",
  });
  assert.equal(readQuietHours(true, "23:00", "").ok, false);
  assert.equal(readQuietHours(true, "", "05:00").ok, false);
  for (const bad of ["24:00", "7:00", "23:60", "11pm", "23:00:99"]) {
    assert.deepEqual(
      readQuietHours(true, bad, "05:00"),
      { ok: false, error: "Enter quiet-hour times like 23:00." },
      bad,
    );
  }
  assert.deepEqual(readQuietHours(true, "06:00", "06:00"), {
    ok: false,
    error: "Quiet hours need different start and end times.",
  });
});
