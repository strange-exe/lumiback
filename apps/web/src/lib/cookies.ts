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
