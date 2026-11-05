export const ACCESS_COOKIE = "outing_at";
export const REFRESH_COOKIE = "outing_rt";

/** Expire the access cookie a minute before the 15-minute JWT, so proxy.ts refreshes in time. */
export const ACCESS_MAX_AGE = 14 * 60;
export const REFRESH_MAX_AGE = 30 * 24 * 60 * 60;

/**
 * Options every cookie we set shares. Secure in production (the same test as IS_PRODUCTION in
 * config.ts, which this file doesn't import so unit tests can load it); plain http only in
 * local development. render.yaml pins NODE_ENV=production for the deployed web service.
 */
export function cookieBase(nodeEnv: string | undefined) {
  return {
    httpOnly: true, // never readable by page JavaScript
    secure: nodeEnv === "production",
    sameSite: "lax", // not sent on cross-site POSTs; Server Actions also check Origin
    path: "/",
  } as const;
}

export const COOKIE_BASE = cookieBase(process.env.NODE_ENV);

/**
 * A guest's proof of having joined one session with a code. One cookie per session, so joining
 * a second share never replaces the first. httpOnly like the login cookies: page scripts never
 * see it. Outlives the longest share (8 h); the backend decides when access actually ends.
 */
const GUEST_PREFIX = "outing_guest_";

export function guestCookie(sessionId: string): string {
  return `${GUEST_PREFIX}${sessionId}`;
}

/** One of this browser's guest passes (so sign-out can remove them all on a shared computer). */
export function isGuestCookie(name: string): boolean {
  return name.startsWith(GUEST_PREFIX) && name.length > GUEST_PREFIX.length;
}
export const GUEST_MAX_AGE = 9 * 60 * 60;
/**
 * A safe-return link's guest cookie. The outing's share can outlive 9 h (it lasts until the
 * student is back); the emailed link can set the cookie again whenever it's opened.
 */
export const WATCH_KEY_MAX_AGE = 24 * 60 * 60;
