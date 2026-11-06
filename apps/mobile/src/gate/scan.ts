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
 * expo-router reuses an open scan screen for a new lumiback://scan?qr=... and only replaces its
 * params. What to show then: the new code waits on its own confirm step (or is refused), and
 * safe return is off, because a code from a link never asks for it. Null means keep the current
 * phase: the same code, a cleared one (Scan again does that), or a check already in flight,
 * whose result the student must still see.
 */
export function phaseForNewLink(
  previous: string | undefined,
  next: string | undefined,
  shown: "camera" | "confirm" | "checking" | "refused" | "done" | "stale",
): { phase: ReturnType<typeof startPhase>; safeReturn: false } | null {
  if (!next || next === previous || shown === "checking") return null;
  return { phase: startPhase(next), safeReturn: false };
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

/**
 * Shown when Android refused a tap on the confirm button because another app was drawing over
 * Lumiback (a chat bubble, screen filter or a hidden overlay trying to steer the tap).
 */
export const blockedTapCopy =
  "That tap didn't count: another app is showing something over Lumiback. Close any bubbles, screen filters or overlays, then tap again.";

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

/** The answer to "your outing from an earlier day was never closed". */
export type ScanIntent = "in" | "out";

/**
 * The POST /gates/scan body. `ask_if_stale` tells the server this app can answer the stale-outing
 * question: it then replies 409 with `{code: "stale_outing", left_at, message}` instead of a
 * sentence for older apps. `intent` is that answer, sent with the same scan.
 */
export function scanBody(
  qr: string,
  fix: Fix,
  safeReturn: boolean,
  intent: ScanIntent | null = null,
): Fix & { qr: string; safe_return: boolean; ask_if_stale: true; intent?: ScanIntent } {
  return {
    qr,
    ...fix,
    safe_return: safeReturn,
    ask_if_stale: true,
    ...(intent ? { intent } : {}),
  };
}

/** The stale-outing question, when that's what a refusal is; else null. */
export function staleOuting(error: {
  status: number;
  problem: { code: string; message: string; [key: string]: unknown } | null;
}): { message: string; leftAt: string | null } | null {
  if (error.status !== 409 || error.problem?.code !== "stale_outing") return null;
  const leftAt = error.problem.left_at;
  return { message: error.problem.message, leftAt: typeof leftAt === "string" ? leftAt : null };
}

/**
 * A gate code is good for at least 40 s after it's read (the current 20 s window and the two
 * before it). An answer within this long resends the same scan; a slower one asks for a fresh
 * scan (the answer is kept and sent with it), rather than sending a code that has run out.
 */
export const STALE_RESEND_MS = 30_000;

export function afterStaleAnswer(readAt: number, now: number): "resend" | "rescan" {
  return now - readAt <= STALE_RESEND_MS ? "resend" : "rescan";
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
