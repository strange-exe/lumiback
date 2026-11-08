import assert from "node:assert/strict";
import { test } from "node:test";

import { CALL_ME_SENT, callMeError, helpError, helpFix, helpTold, officeChoice } from "./alerts.ts";

test("with an office number the student calls; without one they ask for a call", () => {
  assert.deepEqual(officeChoice({ hostel: "Hostel 3", name: "Mr Rawat", phone: "+919876543210" }), {
    kind: "call",
    phone: "+919876543210",
    who: "Mr Rawat, Hostel 3",
  });
  assert.deepEqual(officeChoice({ hostel: "Hostel 3", name: null, phone: "+919876543210" }), {
    kind: "call",
    phone: "+919876543210",
    who: "Hostel 3",
  });
  assert.deepEqual(officeChoice({ hostel: "Hostel 3", name: "Mr Rawat", phone: null }), {
    kind: "ask",
  });
  assert.deepEqual(officeChoice({ hostel: null, name: null, phone: "  " }), { kind: "ask" });
  assert.deepEqual(officeChoice(null), { kind: "ask" });
  assert.deepEqual(officeChoice(undefined), { kind: "ask" });
});

test("asking for a call: sent, too many, or not out", () => {
  assert.equal(CALL_ME_SENT, "The office has been asked to call you.");
  assert.equal(
    callMeError(429, "Too many"),
    "You've asked 3 times in the last hour. The office has your request; wait for their call.",
  );
  assert.equal(
    callMeError(404, "Not out"),
    "You're not checked out, so there's nothing to ask about. Reload the page.",
  );
  assert.equal(
    callMeError(503, "Lumiback can't reach its server"),
    "Lumiback can't reach its server",
  );
});

test("help errors: too many, or not out; anything else as the server said", () => {
  assert.equal(
    helpError(429, "Too many"),
    "You've sent 5 help alerts in the last hour. Call the hostel office or your emergency contact directly.",
  );
  assert.equal(
    helpError(404, "Not out"),
    "You're not checked out, so no help alert was sent. Reload the page.",
  );
  assert.equal(
    helpError(500, "Something went wrong. Try again."),
    "Something went wrong. Try again.",
  );
});

test("one location fix is read from the form, or none if anything is off", () => {
  assert.deepEqual(helpFix("30.2687", "77.9947", "12.5"), {
    lat: 30.2687,
    lng: 77.9947,
    accuracy_m: 12.5,
  });
  // A very rough fix is still a fix, capped at the API's limit.
  assert.deepEqual(helpFix("30", "77", "250000"), { lat: 30, lng: 77, accuracy_m: 100000 });
  for (const [lat, lng, acc] of [
    ["", "", ""],
    ["30", "", "10"],
    ["91", "77", "10"],
    ["30", "-181", "10"],
    ["30", "77", "-1"],
    ["abc", "77", "10"],
    ["30", "77", ""],
    ["Infinity", "77", "10"],
  ]) {
    assert.equal(helpFix(lat, lng, acc), null, `${lat},${lng},${acc}`);
  }
});

test("who else was told, in one plain line", () => {
  assert.equal(
    helpTold({ office_told: 2, followers_told: 2, contact_told: true }),
    "Also told: your emergency contact and 2 people you share your location with.",
  );
  assert.equal(
    helpTold({ office_told: 1, followers_told: 1, contact_told: false }),
    "Also told: 1 person you share your location with.",
  );
  assert.equal(
    helpTold({ office_told: 1, followers_told: 0, contact_told: true }),
    "Also told: your emergency contact.",
  );
  assert.equal(helpTold({ office_told: 1, followers_told: 0, contact_told: false }), null);
});
