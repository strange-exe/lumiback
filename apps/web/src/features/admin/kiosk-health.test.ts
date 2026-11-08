import assert from "node:assert/strict";
import { test } from "node:test";

import { kioskLine } from "./kiosk-health.ts";

test("each state says what it means in words", () => {
  assert.deepEqual(kioskLine("ok", "8:02 PM", null), {
    label: "Tablet online",
    detail: "Last asked for a code at 8:02 PM.",
    tone: "good",
  });
  const stale = kioskLine("stale", "Mon 6 Oct, 7:40 PM", null);
  assert.equal(stale?.tone, "warn");
  assert.match(stale?.detail ?? "", /7:40 PM\. Check the tablet/);
  assert.equal(kioskLine("never", null, null)?.label, "No tablet yet");
  assert.equal(
    kioskLine("quiet", "10:59 PM", "6:00 AM")?.detail,
    "Kiosks are paused until 6:00 AM.",
  );
  assert.equal(kioskLine("quiet", null, null)?.detail, "Kiosks are paused for quiet hours.");
});

test("no state (a warden, an older server) shows nothing", () => {
  assert.equal(kioskLine(null, null, null), null);
  assert.equal(kioskLine(undefined, "8:02 PM", null), null);
});
