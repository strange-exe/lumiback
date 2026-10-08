import type { LiveLocation } from "@/lib/types";

/** What `/sessions/{id}/location` (and the WebSocket) return for a live share. */
export interface Positions {
  location: LiveLocation | null; // latest real fix
  mocked_location?: LiveLocation | null; // latest fix from a mock-location app (newer API only)
}

/**
 * How to present mock locations:
 * - "now": the newest fix is fake. Show it in red beside the last real one (if any).
 * - "earlier": a mock app was used in this share, but real fixes have resumed since.
 */
export type MockState =
  | { kind: "none" }
  | { kind: "now"; fake: LiveLocation; real: LiveLocation | null; apartM: number | null }
  | { kind: "earlier"; at: string };

export function mockState({ location, mocked_location: fake }: Positions): MockState {
  if (!fake) return { kind: "none" };
  if (location && Date.parse(location.recorded_at) > Date.parse(fake.recorded_at)) {
    return { kind: "earlier", at: fake.recorded_at };
  }
  return {
    kind: "now",
    fake,
    real: location,
    apartM: location ? metresApart(location, fake) : null,
  };
}

/** Great-circle distance (haversine), good to well under 1% at campus-to-city scale. */
export function metresApart(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

interface LatLng {
  lat: number;
  lng: number;
}

/** "350 m", "2.3 km", "48 km" */
export function formatDistance(metres: number): string {
  if (metres < 1000) return `${Math.max(10, Math.round(metres / 10) * 10)} m`;
  const km = metres / 1000;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}
