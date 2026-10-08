import type { LiveLocation } from "@/lib/types";

import { formatDistance, metresApart, mockState } from "./mock";

const at = (lat: number, lng: number, time: string): LiveLocation => ({
  lat,
  lng,
  accuracy_m: 10,
  recorded_at: time,
  stale: false,
});
const real = at(30.2687, 77.9947, "2026-10-08T15:00:00Z"); // Graphic Era
const fake = at(30.3165, 78.0322, "2026-10-08T15:01:00Z"); // Clock Tower, Dehradun

test("no mock fix: nothing to show", () => {
  expect(mockState({ location: real })).toEqual({ kind: "none" });
  expect(mockState({ location: real, mocked_location: null })).toEqual({ kind: "none" });
});

test("newest fix is fake: show it beside the last real one, with the gap", () => {
  const state = mockState({ location: real, mocked_location: fake });
  expect(state.kind).toBe("now");
  if (state.kind !== "now") return;
  expect(state.real).toBe(real);
  expect(state.fake).toBe(fake);
  expect(state.apartM).toBeGreaterThan(6_000);
  expect(state.apartM).toBeLessThan(7_000);
});

test("mock app on from the start: fake only, no real position to compare", () => {
  expect(mockState({ location: null, mocked_location: fake })).toEqual({
    kind: "now",
    fake,
    real: null,
    apartM: null,
  });
});

test("real fixes resumed: only a note that a mock app was used", () => {
  const later = { ...real, recorded_at: "2026-10-08T15:05:00Z" };
  expect(mockState({ location: later, mocked_location: fake })).toEqual({
    kind: "earlier",
    at: fake.recorded_at,
  });
});

test("distance is symmetric and zero for the same point", () => {
  expect(metresApart(real, real)).toBe(0);
  expect(metresApart(real, fake)).toBeCloseTo(metresApart(fake, real), 6);
});

test("distances read naturally", () => {
  expect(formatDistance(3)).toBe("10 m");
  expect(formatDistance(347)).toBe("350 m");
  expect(formatDistance(2_340)).toBe("2.3 km");
  expect(formatDistance(48_200)).toBe("48 km");
});
