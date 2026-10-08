/**
 * Gate scanning, as pure functions (no Expo imports) so they are unit-tested.
 * The scan screen turns these into camera, location and API calls.
 */

/** Same shape the API accepts (backend/app/security/gate_codes.py): a /g/ URL or the bare triple. */
const GATE_QR =
  /(?:^|\/g\/)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(\d{1,12})\.([0-9A-Z]{10})(?:$|[?#])/i;

/** The scanned text if it's a Lumiback gate code, else null (a menu, a Wi-Fi code, ...). */
export function gateCode(scanned: string): string | null {
  const text = scanned.trim();
  return GATE_QR.test(text) ? text : null;
}

export interface Fix {
  lat: number;
  lng: number;
  accuracy_m: number;
  mocked: boolean;
}

/**
 * The location sent with a scan. A missing accuracy is treated as unknown-and-poor, so the server
 * asks the student to try again rather than trusting a fix it can't judge.
 */
export function toFix(location: {
  coords: { latitude: number; longitude: number; accuracy: number | null };
  mocked?: boolean;
}): Fix {
  return {
    lat: location.coords.latitude,
    lng: location.coords.longitude,
    accuracy_m: location.coords.accuracy ?? 9_999,
    mocked: location.mocked ?? false,
  };
}

const AFTER_CURFEW = "It's past tonight's curfew, so choose when you'll be back.";

/** What the screen shows when the API says no (or not yet). */
export type Refusal =
  { kind: "needs-time"; message: string } | { kind: "refused"; message: string; retry: boolean };

/** Map an API failure (status + detail) to what the student sees and whether scanning again helps. */
export function refusal(status: number, detail: string): Refusal {
  // The server's wording ("...then scan again") is for any client; here the student just picks a
  // time and taps out with the same code, so the app says that instead.
  if (status === 428) return { kind: "needs-time", message: AFTER_CURFEW };
  if (status === 409) return { kind: "refused", message: detail, retry: false };
  if (status === 0) {
    return {
      kind: "refused",
      message: "Can't reach Lumiback. Check your connection and scan again.",
      retry: true,
    };
  }
  // 422: bad or old code, gate off, too far, weak or mock GPS. The server's wording explains which.
  return { kind: "refused", message: detail, retry: true };
}

/** Return-time choices offered after curfew, as minutes from now. */
export const AFTER_CURFEW_CHOICES = [
  { value: "60", label: "1 h" },
  { value: "120", label: "2 h" },
  { value: "180", label: "3 h" },
] as const;
