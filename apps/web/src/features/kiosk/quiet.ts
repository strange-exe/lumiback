/**
 * Kiosk quiet hours, as the gate tablet sees them. Inside the hours the API answers /kiosk/qr
 * with 423 and `{ quiet: true, opens_at, detail }`; the tablet then sleeps until `opens_at`
 * instead of asking every 30 seconds. Pure, so `node --test` can load it.
 */

/** Never sooner (a tablet whose clock runs fast would otherwise ask over and over)... */
export const QUIET_MIN_WAIT_MS = 30_000;
/** ...and never later, so a change to the hours reaches a sleeping tablet within half an hour. */
export const QUIET_MAX_WAIT_MS = 30 * 60_000;
/** Ask just after opening, so the first code is ready. */
const AFTER_OPENING_MS = 1_000;

export interface QuietUntil {
  /** IST ISO time the kiosks open again. */
  opensAt: string;
  /** How long to wait before asking again. */
  waitMs: number;
}

/** The quiet-hours answer in a 423 body, or null when the gate is switched off instead. */
export function quietUntil(body: unknown, nowMs: number): QuietUntil | null {
  if (!body || typeof body !== "object") return null;
  const { quiet, opens_at: opensAt } = body as { quiet?: unknown; opens_at?: unknown };
  if (quiet !== true || typeof opensAt !== "string") return null;
  const at = Date.parse(opensAt);
  if (Number.isNaN(at)) return null;
  const wait = at - nowMs + AFTER_OPENING_MS;
  return { opensAt, waitMs: Math.min(QUIET_MAX_WAIT_MS, Math.max(QUIET_MIN_WAIT_MS, wait)) };
}
