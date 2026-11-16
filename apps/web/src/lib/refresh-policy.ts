/** The browser API routes that act only for a signed-in account (never for a guest). */
const ACCOUNT_ONLY = ["/api/share/", "/api/account/"];

/**
 * What the proxy does with a request whose access token has run out while the backend can't
 * refresh it (asleep on the free tier, restarting, or the refresh rate-limited). The refresh
 * token is kept either way.
 *
 * Pages, and API routes that also serve guests (the live view, error reports), go on without a
 * token as before. An account-only API call is answered 503 instead: going on without a token
 * would reach the route as "not signed in" (401), and the live share reads a 401 as a sign-out
 * and stops sending while the share is still running.
 */
export function whenRefreshUnavailable(pathname: string): "continue" | "retry-later" {
  return ACCOUNT_ONLY.some((prefix) => pathname.startsWith(prefix)) ? "retry-later" : "continue";
}
