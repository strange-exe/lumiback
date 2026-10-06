import { IS_PRODUCTION } from "@/lib/config";

export const ACCESS_COOKIE = "outing_at";
export const REFRESH_COOKIE = "outing_rt";

/** Expire the access cookie a minute before the 15-minute JWT, so proxy.ts refreshes in time. */
export const ACCESS_MAX_AGE = 14 * 60;
export const REFRESH_MAX_AGE = 30 * 24 * 60 * 60;

export const COOKIE_BASE = {
  httpOnly: true, // never readable by page JavaScript
  secure: IS_PRODUCTION,
  sameSite: "lax", // not sent on cross-site POSTs; Server Actions also check Origin
  path: "/",
} as const;

/**
 * A guest's proof of having joined one session with a code. One cookie per session, so joining
 * a second share never replaces the first. httpOnly like the login cookies: page scripts never
 * see it. Outlives the longest share (8 h); the backend decides when access actually ends.
 */
export function guestCookie(sessionId: string): string {
  return `outing_guest_${sessionId}`;
}
export const GUEST_MAX_AGE = 9 * 60 * 60;
