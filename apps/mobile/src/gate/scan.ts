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

/**
 * Where the scan screen starts. A code from the camera is the student's own action; a code that
 * arrived with the screen (lumiback://scan?qr=..., a gate link) could have been opened by any
 * link or app, so it waits on a confirm step and nothing is checked or sent until they tap.
 */
export function startPhase(
  linked: string | undefined,
):
  | { kind: "camera" }
  | { kind: "confirm"; qr: string }
  | { kind: "refused"; message: string; retry: boolean; fallback: boolean } {
  if (!linked) return { kind: "camera" };
  const qr = gateCode(linked);
  if (qr) return { kind: "confirm", qr };
  return {
    kind: "refused",
    message: "That link isn't a Lumiback gate code.",
    retry: true,
    fallback: true,
  };
}

/**
 * The confirm step's words. The gate's name is only known after the server checks the code, so
 * they name the direction instead: out on a trip taps in, otherwise out; neutral until known.
 */
export function confirmCopy(out: boolean | null): {
  title: string;
  detail: string;
  action: string;
} {
  const detail =
    "This gate code came from a link, not your camera. Lumiback checks your location once, then the gate.";
  if (out === true) return { title: "Tap back in at this gate?", detail, action: "Tap in" };
  if (out === false) return { title: "Tap out at this gate?", detail, action: "Tap out" };
  return { title: "Check in or out at this gate?", detail, action: "Continue" };
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

/** What the screen shows when the API says no. */
export interface Refusal {
  kind: "refused";
  message: string;
  retry: boolean;
  /**
   * Offer "Can't scan?" (log the trip, or tap I'm back) instead. Only for problems with the
   * scanning itself (connection, server error); never when the server judged the scan, because
   * its reasons include the outing rules, which logging the trip can't get around.
   */
  fallback: boolean;
}

/** Map an API failure (status + detail) to what the student sees and whether scanning again helps. */
export function refusal(status: number, detail: string): Refusal {
  if (status === 409) return { kind: "refused", message: detail, retry: false, fallback: false };
  if (status === 0) {
    return {
      kind: "refused",
      message: "Can't reach Lumiback. Check your connection and scan again.",
      retry: true,
      fallback: true,
    };
  }
  if (status >= 500) return { kind: "refused", message: detail, retry: true, fallback: true };
  // 422: bad or old code, gate off, too far, weak or mock GPS, or the outing rules (outside the
  // hours, no approved request). The server's wording explains which; it sends no code to tell
  // them apart, so none of them offers the fallback.
  return { kind: "refused", message: detail, retry: true, fallback: false };
}
