/**
 * Safe return, as pure functions (no Expo imports) so they are unit-tested: whether Today offers
 * "Let my emergency contact follow until I'm back", and what to say after checking out with it.
 */

import type { Profile } from "@/lib/types";

/** What Today shows above the tap-out buttons. */
export type SafeReturnOffer =
  | { kind: "tick"; name: string } // the tick, naming the contact
  | { kind: "hint" } // no email yet: a short hint to add one
  | { kind: "none" }; // profile not loaded: nothing rather than a guess

export function safeReturnOffer(
  profile: Pick<Profile, "emergency_name" | "emergency_email"> | null,
): SafeReturnOffer {
  if (!profile) return { kind: "none" };
  if (!profile.emergency_email) return { kind: "hint" };
  const first = profile.emergency_name?.trim().split(/\s+/)[0];
  return { kind: "tick", name: first || "your emergency contact" };
}

/** How starting the location service for the outing's share went ("error": couldn't ask). */
export type OutingShareStart = "started" | "denied" | "servicesOff" | "error";

/**
 * After a check-out: null when there's nothing to fix, otherwise one sentence. `sessionId` is the
 * outing's safe_return_session_id (null: the server didn't start it, e.g. today's email limit).
 */
export function safeReturnNotice(
  ticked: boolean,
  sessionId: string | null | undefined,
  start: OutingShareStart | null,
): string | null {
  if (!ticked) return null;
  if (!sessionId) {
    return "You're out, but your emergency contact wasn't emailed: too many safe-return emails went out today. You can still share your location from Live.";
  }
  const got = "Your emergency contact got the link, but your location isn't being sent.";
  switch (start) {
    case "started":
      return null;
    case "denied":
      return `${got} Allow location for Lumiback, then tap Send my location.`;
    case "servicesOff":
      return `${got} Turn on location, then tap Send my location.`;
    default:
      return `${got} Tap Send my location to try again.`;
  }
}
