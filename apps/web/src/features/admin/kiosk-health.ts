/**
 * What the Gates page says about each gate's kiosk tablet (the API works out the state: see
 * backend services/gates.py kiosk_health). The words carry the meaning; colour only repeats it.
 * Pure, so `node --test` can load it.
 */

import type { KioskHealth } from "../../lib/types.ts";

export type KioskTone = "good" | "warn" | "muted";

export interface KioskLine {
  label: string;
  /** Says when, and what to do; `when` is the formatted last-seen time, if any. */
  detail: string;
  tone: KioskTone;
}

export function kioskLine(
  health: KioskHealth | null | undefined,
  when: string | null,
  opensAt: string | null,
): KioskLine | null {
  switch (health) {
    case "ok":
      return {
        label: "Tablet online",
        detail: when ? `Last asked for a code at ${when}.` : "Asking for codes.",
        tone: "good",
      };
    case "stale":
      return {
        label: "Tablet not seen lately",
        detail: when
          ? `Last asked for a code at ${when}. Check the tablet is on, charged and online.`
          : "Check the tablet is on, charged and online.",
        tone: "warn",
      };
    case "never":
      return {
        label: "No tablet yet",
        detail: "No tablet has opened this gate's kiosk. Make a kiosk link and open it there.",
        tone: "muted",
      };
    case "quiet":
      return {
        label: "Quiet hours",
        detail: opensAt
          ? `Kiosks are paused until ${opensAt}.`
          : "Kiosks are paused for quiet hours.",
        tone: "muted",
      };
    default:
      // A warden's view, or an older server: nothing to say.
      return null;
  }
}
