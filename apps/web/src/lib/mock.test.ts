import assert from "node:assert/strict";
import { test } from "node:test";

import type { LiveLocation } from "./types.ts";
import { formatDistance, metresApart, mockState } from "./mock.ts";

const at = (lat: number, lng: number, time: string): LiveLocation => ({
  lat,
  lng,
  accuracy_m: 10,
  recorded_at: time,
  stale: false,
});
const real = at(30.2687, 77.9947, "2026-10-08T15:00:00Z"); // Graphic Era
const fake = at(30.3165, 78.0322, "2026-10-08T15:01:00Z"); // Clock Tower, Dehradun

test("no mock fix: nothing to show (older API omits the field)", () => {
  assert.deepEqual(mockState({ location: real }), { kind: "none" });
  assert.deepEqual(mockState({ location: real, mocked_location: null }), { kind: "none" });
});

test("newest fix is fake: shown beside the last real one, with the gap", () => {
  const state = mockState({ location: real, mocked_location: fake });
  assert.equal(state.kind, "now");
  if (state.kind !== "now") return;
  assert.equal(state.real, real);
  assert.ok(state.apartM !== null && state.apartM > 6_000 && state.apartM < 7_000);
});

test("mock app on from the start: no real position to compare", () => {
  assert.deepEqual(mockState({ location: null, mocked_location: fake }), {
    kind: "now",
    fake,
    real: null,
    apartM: null,
  });
});

test("real fixes resumed: only a note that a mock app was used", () => {
  const later = { ...real, recorded_at: "2026-10-08T15:05:00Z" };
  assert.deepEqual(mockState({ location: later, mocked_location: fake }), {
    kind: "earlier",
    at: fake.recorded_at,
  });
});

test("distances", () => {
  assert.equal(metresApart(real, real), 0);
  assert.equal(formatDistance(347), "350 m");
  assert.equal(formatDistance(2_340), "2.3 km");
  assert.equal(formatDistance(48_200), "48 km");
});
