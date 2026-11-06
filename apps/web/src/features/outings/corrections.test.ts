import assert from "node:assert/strict";
import { test } from "node:test";

import type { Correction, Outing } from "../../lib/types.ts";
import {
  askedFor,
  canAsk,
  correctionBody,
  correctionLine,
  inViaLabel,
  isCancelled,
  timeKind,
} from "./corrections.ts";
import { istInputToIso, istInputValue, istIso } from "./time.ts";

// ---------- IST datetime-local helpers ----------

test("istInputValue shows IST wall time whatever the offset of the input", () => {
  assert.equal(istInputValue("2026-11-06T19:40:00+05:30"), "2026-11-06T19:40");
  assert.equal(istInputValue("2026-11-06T14:10:00Z"), "2026-11-06T19:40");
  // Crosses midnight in IST although it is still the 6th in UTC.
  assert.equal(istInputValue("2026-11-06T20:00:00Z"), "2026-11-07T01:30");
  assert.equal(istInputValue(new Date(Date.UTC(2026, 0, 1, 0, 0))), "2026-01-01T05:30");
});

test("istInputToIso reads the value as IST, not the machine's timezone", () => {
  assert.equal(istInputToIso("2026-11-06T19:40"), "2026-11-06T19:40:00+05:30");
  assert.equal(istInputToIso(" 2026-11-07T01:30 "), "2026-11-07T01:30:00+05:30");
  assert.equal(istInputToIso("2026-11-06T19:40:15"), "2026-11-06T19:40:15+05:30");
  const iso = istInputToIso("2026-11-06T19:40");
  assert.ok(iso);
  assert.equal(Date.parse(iso), Date.UTC(2026, 10, 6, 14, 10));
});

test("istInputToIso round-trips with istInputValue", () => {
  for (const value of ["2026-02-28T23:59", "2026-03-01T00:00", "2026-12-31T23:30"]) {
    const iso = istInputToIso(value);
    assert.ok(iso);
    assert.equal(istInputValue(iso), value);
  }
});

test("istInputToIso refuses what isn't a real date and time", () => {
  for (const bad of [
    "",
    "now",
    "2026-11-06",
    "2026-11-06 19:40",
    "2026-11-31T10:00",
    "2026-02-29T10:00",
    "2026-11-06T24:00",
    "2026-11-06T19:60",
    "2026-11-06T19:40+05:30",
  ]) {
    assert.equal(istInputToIso(bad), null, bad);
  }
});

test("a time in the minute they left means when they left, never before it", () => {
  const left = "2026-11-06T19:40:30+05:30";
  assert.equal(istInputToIso("2026-11-06T19:40", left), left);
  // The server's own string, microseconds and all (rounding them away would be too early).
  const precise = "2026-11-06T19:40:30.123456+05:30";
  assert.equal(istInputToIso("2026-11-06T19:40", precise), precise);
  const onTheMinute = "2026-11-06T19:40:00.000500+05:30";
  assert.equal(istInputToIso("2026-11-06T19:40", onTheMinute), onTheMinute);
  // Any other minute is taken as typed (the server refuses times before they left).
  assert.equal(istInputToIso("2026-11-06T19:39", left), "2026-11-06T19:39:00+05:30");
  assert.equal(istInputToIso("2026-11-06T19:41", left), "2026-11-06T19:41:00+05:30");
  assert.equal(istInputToIso("2026-11-06T19:40", null), "2026-11-06T19:40:00+05:30");
  assert.equal(istInputToIso("2026-11-06T19:40", "not a time"), "2026-11-06T19:40:00+05:30");
});

test("istIso writes +05:30", () => {
  assert.equal(istIso(Date.UTC(2026, 10, 6, 14, 10, 5)), "2026-11-06T19:40:05+05:30");
});

// ---------- who can ask, and labels ----------

const NOW = Date.parse("2026-11-06T20:00:00+05:30");

function outing(overrides: Partial<Outing> = {}): Outing {
  return {
    id: "o1",
    destination: "Market",
    purpose: null,
    left_at: "2026-11-06T17:00:00+05:30",
    expected_return_at: "2026-11-06T21:00:00+05:30",
    returned_at: null,
    status: "out",
    late_minutes: 0,
    duration_minutes: null,
    out_via: "self",
    in_via: null,
    correction: null,
    ...overrides,
  };
}

function correction(overrides: Partial<Correction> = {}): Correction {
  return {
    id: "c1",
    kind: "return",
    status: "pending",
    returned_at: "2026-11-06T18:30:00+05:30",
    reason: "Forgot to tap in",
    by_staff: false,
    old_returned_at: null,
    note: null,
    created_at: "2026-11-06T19:00:00+05:30",
    ...overrides,
  };
}

test("an open outing can be asked about", () => {
  assert.equal(canAsk(outing(), NOW), true);
});

test("an outing that ended in the last 7 days can be asked about; older ones can't", () => {
  const ended = (iso: string): Outing =>
    outing({ returned_at: iso, status: "returned", left_at: "2026-10-20T17:00:00+05:30" });
  assert.equal(canAsk(ended("2026-11-01T20:00:00+05:30"), NOW), true);
  assert.equal(canAsk(ended("2026-10-30T20:00:00+05:30"), NOW), true); // exactly 7 days
  assert.equal(canAsk(ended("2026-10-30T19:59:00+05:30"), NOW), false);
});

test("one ask at a time, and nothing to ask once the office cancelled it", () => {
  assert.equal(canAsk(outing({ correction: correction() }), NOW), false);
  assert.equal(canAsk(outing({ correction: correction({ status: "declined" }) }), NOW), true);
  const cancelled = outing({
    returned_at: "2026-11-06T17:00:00+05:30",
    status: "returned",
    correction: correction({ kind: "cancel", status: "approved", returned_at: null }),
  });
  assert.equal(isCancelled(cancelled), true);
  assert.equal(canAsk(cancelled, NOW), false);
  // A declined cancel isn't a cancelled trip.
  const declined = correction({ kind: "cancel", status: "declined", returned_at: null });
  assert.equal(isCancelled(outing({ correction: declined })), false);
});

test("timeKind records a return on an open outing and changes it on a closed one", () => {
  assert.equal(timeKind({ returned_at: null }), "return");
  assert.equal(timeKind({}), "return");
  assert.equal(timeKind({ returned_at: "2026-11-06T18:00:00+05:30" }), "return_time");
});

test("inViaLabel names office returns and unknown return times only", () => {
  assert.equal(inViaLabel("staff"), "Recorded by the office");
  assert.equal(inViaLabel("unrecorded"), "Return time not recorded");
  assert.equal(inViaLabel("gate"), null);
  assert.equal(inViaLabel("self"), null);
  assert.equal(inViaLabel(null), null);
  assert.equal(inViaLabel(undefined), null);
});

test("askedFor says what was asked, with the day only when it differs", () => {
  const left = "2026-11-06T17:00:00+05:30";
  assert.equal(askedFor(correction(), left), "came back at 6:30 PM");
  assert.equal(
    askedFor(correction({ returned_at: "2026-11-07T00:10:00+05:30" }), left),
    "came back at Sat, 7 Nov, 12:10 AM",
  );
  assert.equal(
    askedFor(correction({ kind: "cancel", returned_at: null }), left),
    "this trip didn't happen",
  );
});

test("correctionBody sends IST times, and no time for a cancel", () => {
  const left = "2026-11-06T17:00:30+05:30";
  assert.deepEqual(
    correctionBody(
      { kind: "return", time: "2026-11-06T18:30", leftAt: left, reason: "  Forgot to tap  " },
      "student",
    ),
    { body: { kind: "return", returned_at: "2026-11-06T18:30:00+05:30", reason: "Forgot to tap" } },
  );
  assert.deepEqual(
    correctionBody(
      { kind: "return_time", time: "2026-11-06T17:00", leftAt: left, reason: "abc" },
      "staff",
    ),
    { body: { kind: "return_time", returned_at: left, reason: "abc" } },
  );
  assert.deepEqual(
    correctionBody(
      { kind: "cancel", time: "2026-11-06T18:30", leftAt: left, reason: "Wrong tap" },
      "staff",
    ),
    { body: { kind: "cancel", returned_at: null, reason: "Wrong tap" } },
  );
});

test("correctionBody explains what's missing, in the asker's words", () => {
  const base = { kind: "return", time: "2026-11-06T18:30", leftAt: "", reason: "Forgot" };
  assert.deepEqual(correctionBody({ ...base, kind: "delete" }, "staff"), {
    error: "Choose what happened.",
  });
  assert.deepEqual(correctionBody({ ...base, time: "" }, "student"), {
    error: "Say when you came back.",
  });
  assert.deepEqual(correctionBody({ ...base, time: "" }, "staff"), {
    error: "Say when they came back.",
  });
  assert.deepEqual(correctionBody({ ...base, time: "2026-11-31T10:00" }, "staff"), {
    error: "Enter the date and time in full.",
  });
  assert.deepEqual(correctionBody({ ...base, reason: " ab " }, "student"), {
    error: "Tell the hostel office what happened, in a few words.",
  });
  assert.deepEqual(correctionBody({ ...base, reason: "ab" }, "staff"), {
    error: "Give a reason, for the record.",
  });
  assert.deepEqual(correctionBody({ ...base, reason: "x".repeat(301) }, "staff"), {
    error: "Keep the reason under 300 characters.",
  });
  assert.ok("body" in correctionBody({ ...base, reason: "x".repeat(300) }, "staff"));
});

test("correctionLine: waiting, corrected, recorded, cancelled, declined", () => {
  const left = "2026-11-06T17:00:00+05:30";
  assert.deepEqual(correctionLine(correction(), left), {
    label: "Waiting for the hostel office",
    tone: "waiting",
    detail: "You said you came back at 6:30 PM.",
  });
  assert.equal(
    correctionLine(correction({ kind: "cancel", returned_at: null }), left)?.detail,
    "You said the trip didn't happen.",
  );
  assert.deepEqual(
    correctionLine(
      correction({ status: "approved", old_returned_at: "2026-11-07T09:00:00+05:30" }),
      left,
    ),
    { label: "Corrected by the hostel office", tone: "done", was: "Sat, 7 Nov, 9:00 AM" },
  );
  assert.equal(
    correctionLine(correction({ status: "approved", by_staff: true }), left)?.label,
    "Return recorded by the hostel office",
  );
  assert.equal(
    correctionLine(correction({ status: "approved", kind: "cancel", returned_at: null }), left)
      ?.label,
    "Cancelled by the hostel office",
  );
  assert.deepEqual(correctionLine(correction({ status: "declined", note: "Gate saw you" }), left), {
    label: "The hostel office didn't change this",
    tone: "refused",
    detail: "Their note: Gate saw you",
  });
  assert.equal(correctionLine(correction({ status: "declined" }), left)?.detail, null);
  assert.equal(correctionLine(correction({ status: "cancelled" }), left), null);
});
