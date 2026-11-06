import assert from "node:assert/strict";
import { test } from "node:test";

import type { Device } from "../../lib/types.ts";
import {
  canSignOut,
  canSignOutOthers,
  deviceName,
  deviceRows,
  deviceTime,
  isDeviceId,
  knowsThisDevice,
  signedOutNotice,
} from "./devices.ts";

const NOW = new Date("2026-11-07T10:00:00Z");

function device(over: Partial<Device> = {}): Device {
  return {
    id: "6f1c2b9e-0a4d-4c8e-9b7a-1d2e3f405162",
    device: "Chrome on Windows",
    signed_in_at: "2026-11-01T03:30:00Z",
    last_active_at: "2026-11-07T15:44:00Z",
    current: false,
    ...over,
  };
}

test("times read as IST wall time, whatever the machine's zone", () => {
  // 15:44 UTC is 9:14 PM IST, the contract's own example.
  assert.equal(deviceTime("2026-11-07T15:44:00Z", NOW), "Sat 7 Nov, 9:14 PM");
  assert.equal(deviceTime("2026-11-07T21:14:00+05:30", NOW), "Sat 7 Nov, 9:14 PM");
  // Morning, and a time just past midnight IST that is still the previous day in UTC.
  assert.equal(deviceTime("2026-11-01T03:30:00Z", NOW), "Sun 1 Nov, 9:00 AM");
  assert.equal(deviceTime("2026-11-06T18:35:00Z", NOW), "Sat 7 Nov, 12:05 AM");
  assert.equal(deviceTime("2026-11-07T06:30:00Z", NOW), "Sat 7 Nov, 12:00 PM");
});

test("the year shows only when it isn't this year in IST", () => {
  assert.equal(deviceTime("2025-11-03T02:35:00Z", NOW), "Mon 3 Nov 2025, 8:05 AM");
  // 31 Dec 2025 20:00 UTC is already 1 Jan 2026 in IST: this year, so no year.
  const newYear = new Date("2026-06-01T00:00:00Z");
  assert.equal(deviceTime("2025-12-31T20:00:00Z", newYear), "Thu 1 Jan, 1:30 AM");
});

test("a device without a name is an unknown device", () => {
  assert.equal(deviceName(device({ device: null })), "Unknown device");
  assert.equal(deviceName(device({ device: "  " })), "Unknown device");
  assert.equal(
    deviceName(device({ device: "Lumiback app on Android 14" })),
    "Lumiback app on Android 14",
  );
});

test("every row but this device gets a Sign out", () => {
  assert.equal(canSignOut(device({ current: true })), false);
  assert.equal(canSignOut(device({ current: false })), true);
});

test("signing out the others needs this device in the list and at least one other", () => {
  const me = device({ id: "a", current: true });
  const phone = device({ id: "b" });
  assert.equal(canSignOutOthers([me, phone]), true);
  assert.equal(canSignOutOthers([me]), false); // only this device
  assert.equal(canSignOutOthers([]), false);
  // Signed in before devices were named: no row is "this device", so it isn't offered.
  assert.equal(knowsThisDevice([phone, device({ id: "c" })]), false);
  assert.equal(canSignOutOthers([phone, device({ id: "c" })]), false);
});

test("the result says how many were signed out", () => {
  assert.equal(signedOutNotice(0), "No other devices were signed in.");
  assert.equal(signedOutNotice(1), "Signed out of 1 device.");
  assert.equal(signedOutNotice(3), "Signed out of 3 devices.");
});

test("this device comes first, the rest keep the API's order, with formatted times", () => {
  const ordered = deviceRows(
    [
      device({ id: "a", device: "Firefox on Android" }),
      device({ id: "b", current: true }),
      device({ id: "c", device: "Safari on iPhone" }),
    ],
    NOW,
  );
  assert.deepEqual(
    ordered.map((r) => r.id),
    ["b", "a", "c"],
  );
  const rows = deviceRows([device({ current: true }), device({ id: "x", device: null })], NOW);
  assert.deepEqual(
    rows.map((r) => [r.name, r.current, r.signedIn, r.lastActive]),
    [
      ["Chrome on Windows", true, "Sun 1 Nov, 9:00 AM", "Sat 7 Nov, 9:14 PM"],
      ["Unknown device", false, "Sun 1 Nov, 9:00 AM", "Sat 7 Nov, 9:14 PM"],
    ],
  );
});

test("only a real id goes into the API path", () => {
  assert.equal(isDeviceId("6f1c2b9e-0a4d-4c8e-9b7a-1d2e3f405162"), true);
  assert.equal(isDeviceId("../users/me"), false);
  assert.equal(isDeviceId("6f1c2b9e-0a4d-4c8e-9b7a-1d2e3f405162/x"), false);
  assert.equal(isDeviceId(null), false);
});
