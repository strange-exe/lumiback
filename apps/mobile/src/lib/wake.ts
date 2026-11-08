/**
 * Waking the API early: the free server sleeps when nobody uses it, and its first request can
 * take most of a minute. The app pings GET /health (no auth, ignored answer) when it comes to
 * the foreground and when the gate scanner opens, so the server is awake by the time the scan
 * is sent. Pure, so the throttle is unit-tested; wake-server.ts makes the request.
 */

/** At most one ping a minute, whichever trigger asked. */
export const WAKE_EVERY_MS = 60_000;

export interface WakeGate {
  /** True when a ping should go out now (and counts it as sent). */
  shouldWake(now: number): boolean;
}

export function createWakeGate(everyMs: number = WAKE_EVERY_MS): WakeGate {
  let last: number | null = null;
  return {
    shouldWake(now) {
      // A clock corrected backwards would otherwise block pings until it caught up again.
      if (last !== null && now >= last && now - last < everyMs) return false;
      last = now;
      return true;
    },
  };
}
