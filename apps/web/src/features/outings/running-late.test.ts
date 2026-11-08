import assert from "node:assert/strict";
import { test } from "node:test";

import {
  confirmLine,
  dueLine,
  lateChoices,
  lateMinutes,
  lateReason,
  MAX_LATE_REASON,
  movedDue,
  officeLateNote,
  runningLateError,
} from "./running-late.ts";

const DUE = "2026-11-08T21:30:00+05:30"; // 9:30 PM IST

test("only 15, 30 and 60 minutes are offered, in order, and only those the server allows", () => {
  assert.deepEqual(lateChoices([60, 15, 30]), [15, 30, 60]);
  assert.deepEqual(lateChoices([30, 60]), [30, 60]);
  assert.deepEqual(lateChoices([45, 15, 15, 0, -30, 90]), [15]);
  assert.deepEqual(lateChoices([]), []);
  assert.deepEqual(lateChoices(null), []);
  assert.deepEqual(lateChoices(undefined), []);
});

test("a submitted choice is read only when it is one of 15, 30 or 60", () => {
  assert.equal(lateMinutes("15"), 15);
  assert.equal(lateMinutes(" 60 "), 60);
  for (const bad of ["", "45", "0", "abc", "30.5", "-15", "1e1"]) {
    assert.equal(lateMinutes(bad), null, bad);
  }
});

test("the new due time is the current one plus the minutes, in IST", () => {
  assert.equal(movedDue(DUE, 30), "2026-11-08T22:00:00+05:30");
  assert.equal(movedDue(DUE, 15), "2026-11-08T21:45:00+05:30");
  assert.equal(movedDue("2026-11-08T23:30:00+05:30", 60), "2026-11-09T00:30:00+05:30");
});

test("the reason is optional, one plain line, at most 120 characters", () => {
  assert.equal(MAX_LATE_REASON, 120);
  assert.deepEqual(lateReason(""), { ok: true, value: null });
  assert.deepEqual(lateReason("   "), { ok: true, value: null });
  assert.deepEqual(lateReason("  Bus broke down  "), { ok: true, value: "Bus broke down" });
  assert.deepEqual(lateReason("a".repeat(120)), { ok: true, value: "a".repeat(120) });
  assert.deepEqual(lateReason("a".repeat(121)), {
    ok: false,
    error: "Keep the reason to 120 characters.",
  });
  // Characters, not UTF-16 units: 120 Devanagari letters with a joiner are still fine.
  const hindi = String.fromCodePoint(0x0915).repeat(119) + String.fromCodePoint(0x200d);
  assert.deepEqual(lateReason(hindi), { ok: true, value: hindi });
  for (const bad of [
    `Bus${String.fromCodePoint(0x0a)}late`,
    `Bus${String.fromCodePoint(0x200b)}late`,
    `Bus${String.fromCodePoint(0x202e)}late`,
  ]) {
    assert.deepEqual(lateReason(bad), {
      ok: false,
      error: "Write the reason as one line of plain text.",
    });
  }
});

test("the due line names the original time only once it moved", () => {
  assert.equal(dueLine("2026-11-08T22:00:00+05:30", DUE), "Due back 10:00 PM, was 9:30 PM");
  assert.equal(dueLine(DUE, null), "Due back 9:30 PM");
  assert.equal(dueLine(DUE, undefined), "Due back 9:30 PM");
  assert.equal(dueLine(null, DUE), null);
  assert.equal(dueLine(undefined, undefined), null);
});

test("the confirm step says the new time and that it is once per outing", () => {
  assert.equal(
    confirmLine(DUE, 30),
    "You'll be due back at 10:00 PM instead of 9:30 PM. You can only do this once per outing.",
  );
});

test("errors: not out reads plainly; every other refusal is the server's own words", () => {
  assert.equal(
    runningLateError(404, "You are not on an outing"),
    "You're not checked out, so there's nothing to move. Reload the page.",
  );
  const used = "You've already told the hostel office you're running late on this outing.";
  assert.equal(runningLateError(409, used), used);
  const past = "That time has already passed. Choose a longer time.";
  assert.equal(runningLateError(409, past), past);
  assert.equal(runningLateError(422, "Bad reason"), "Bad reason");
});

test("the office sees the moved time and the reason, and nothing when it never moved", () => {
  const fmt = (iso: string): string => `at ${iso.slice(11, 16)}`;
  assert.deepEqual(
    officeLateNote(
      {
        original_return_at: DUE,
        running_late_minutes: 30,
        running_late_reason: "Bus broke down",
      },
      fmt,
    ),
    { moved: "Running late: 30 min more, was due at 21:30", reason: "Bus broke down" },
  );
  assert.deepEqual(
    officeLateNote(
      { original_return_at: DUE, running_late_minutes: 15, running_late_reason: null },
      fmt,
    ),
    { moved: "Running late: 15 min more, was due at 21:30", reason: null },
  );
  assert.equal(officeLateNote({ original_return_at: null }, fmt), null);
  assert.equal(officeLateNote({}, fmt), null);
});
