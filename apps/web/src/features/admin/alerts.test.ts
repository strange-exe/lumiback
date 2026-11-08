import assert from "node:assert/strict";
import { test } from "node:test";

import {
  accuracyText,
  CALL_OUTCOMES,
  callBody,
  canGiveBack,
  isCallOutcome,
  noticeBody,
  noticeResult,
  osmLink,
  OUTCOME_LABELS,
  readTimings,
  shortText,
  telHref,
  TIMING_FIELDS,
} from "./alerts.ts";

const TAB = String.fromCodePoint(0x09);
const LINE_BREAK = String.fromCodePoint(0x0a);
const ZERO_WIDTH_SPACE = String.fromCodePoint(0x200b);
const BIDI_OVERRIDE = String.fromCodePoint(0x202e);
const ZWJ = String.fromCodePoint(0x200d);

test("the map link opens OpenStreetMap at the point, zoomed in", () => {
  assert.equal(
    osmLink(30.2687, 77.9947),
    "https://www.openstreetmap.org/?mlat=30.2687&mlon=77.9947#map=17/30.2687/77.9947",
  );
  assert.equal(
    osmLink(-33.8688197, 151.2092955),
    "https://www.openstreetmap.org/?mlat=-33.86882&mlon=151.2093#map=17/-33.86882/151.2093",
  );
  for (const [lat, lng] of [
    [null, 77],
    [30, null],
    [Number.NaN, 77],
    [91, 77],
    [30, 181],
  ] as const) {
    assert.equal(osmLink(lat, lng), null, `${lat},${lng}`);
  }
});

test("accuracy reads in metres, or kilometres when it's far", () => {
  assert.equal(accuracyText(12.4), "within 12 m");
  assert.equal(accuracyText(0.2), "within 1 m");
  assert.equal(accuracyText(1500), "within 1.5 km");
  assert.equal(accuracyText(null), "accuracy unknown");
});

test("a phone number becomes a tel: link with only digits and a plus", () => {
  assert.equal(telHref("+919876543210"), "tel:+919876543210");
  assert.equal(telHref("+91 98765 43210"), "tel:+919876543210");
  assert.equal(telHref("0135-2644 000"), "tel:01352644000");
  assert.equal(telHref("javascript:alert(1)"), "tel:1");
});

test("every call outcome has a label, and only those are outcomes", () => {
  for (const outcome of CALL_OUTCOMES) assert.ok(OUTCOME_LABELS[outcome], outcome);
  assert.equal(Object.keys(OUTCOME_LABELS).length, CALL_OUTCOMES.length);
  assert.equal(isCallOutcome("no_answer"), true);
  for (const bad of ["", "toString", "__proto__", "answered", null, 3]) {
    assert.equal(isCallOutcome(bad), false, String(bad));
  }
});

test("short text is one line of at most 200 characters, empty meaning none", () => {
  assert.deepEqual(shortText("  Bus was late  ", "note"), { ok: true, value: "Bus was late" });
  assert.deepEqual(shortText("   ", "note"), { ok: true, value: null });
  assert.deepEqual(shortText("a".repeat(200), "note"), { ok: true, value: "a".repeat(200) });
  assert.deepEqual(shortText("a".repeat(201), "note"), {
    ok: false,
    error: "Keep the note under 200 characters.",
  });
  for (const bad of [
    `one${LINE_BREAK}two`,
    `tab${TAB}here`,
    `hidden${ZERO_WIDTH_SPACE}space`,
    `flip${BIDI_OVERRIDE}ped`,
  ]) {
    assert.deepEqual(
      shortText(bad, "message"),
      { ok: false, error: "Write the message as one line of plain text." },
      JSON.stringify(bad),
    );
  }
  // Indic names are spelled with joiners: those stay.
  assert.equal(shortText(`ksh${ZWJ}a`, "note").ok, true);
});

test("a call needs a known outcome; the note is optional", () => {
  assert.deepEqual(callBody("no_answer", ""), { body: { outcome: "no_answer", note: null } });
  assert.deepEqual(callBody("reached_contact", " Mother says on the bus "), {
    body: { outcome: "reached_contact", note: "Mother says on the bus" },
  });
  assert.deepEqual(callBody("", "x"), { error: "Choose how the call went." });
  assert.deepEqual(callBody("answered", "x"), { error: "Choose how the call went." });
  assert.deepEqual(callBody("no_answer", "x".repeat(201)), {
    error: "Keep the note under 200 characters.",
  });
});

test("a notice needs a message; recall and hostel are passed on", () => {
  assert.deepEqual(noticeBody(" Gate 2 is closed, use North Gate ", false, ""), {
    body: { message: "Gate 2 is closed, use North Gate", recall: false, hostel_id: null },
  });
  const hostel = "6f1c2c1e-6b1a-4c55-9a43-8b8f0f0d2e11";
  assert.deepEqual(noticeBody("Come back now", true, hostel), {
    body: { message: "Come back now", recall: true, hostel_id: hostel },
  });
  assert.deepEqual(noticeBody("  ", false, ""), { error: "Write the notice first." });
  assert.deepEqual(noticeBody("x".repeat(201), false, ""), {
    error: "Keep the message under 200 characters.",
  });
  assert.deepEqual(noticeBody("Hi", false, "../users"), {
    error: "Choose a hostel from the list.",
  });
});

test("the notice result says how many students it reached", () => {
  assert.equal(noticeResult(0), "No one is out right now, so nobody was sent it.");
  assert.equal(noticeResult(1), "Sent to 1 student.");
  assert.equal(noticeResult(12), "Sent to 12 students.");
});

test("give back: the claimer, or a head warden or admin when someone else has it", () => {
  const mine = { claimed_by: "Asha", claimed_by_me: true };
  const theirs = { claimed_by: "Asha", claimed_by_me: false };
  const nobody = { claimed_by: null, claimed_by_me: false };
  assert.equal(canGiveBack(mine, "warden"), true);
  assert.equal(canGiveBack(theirs, "warden"), false);
  for (const role of ["head_warden", "admin", "developer"] as const) {
    assert.equal(canGiveBack(theirs, role), true, role);
    assert.equal(canGiveBack(nobody, role), false, role);
  }
});

test("follow-up timings are whole minutes from 5 to 240", () => {
  const typed = {
    request_remind_minutes: "15",
    request_backup_minutes: " 30 ",
    escalation_realert_minutes: "5",
    escalation_takeover_minutes: "240",
  };
  assert.deepEqual(readTimings(typed), {
    ok: true,
    values: {
      request_remind_minutes: 15,
      request_backup_minutes: 30,
      escalation_realert_minutes: 5,
      escalation_takeover_minutes: 240,
    },
  });
  for (const bad of ["4", "241", "", "12.5", "ten", "1e2"]) {
    assert.deepEqual(
      readTimings({ ...typed, escalation_realert_minutes: bad }),
      { ok: false, error: "Follow-up timings are whole minutes from 5 to 240." },
      bad,
    );
  }
  assert.equal(TIMING_FIELDS.length, 4);
  assert.deepEqual(
    TIMING_FIELDS.map((f) => f.fallback),
    [15, 30, 15, 30],
  );
});
