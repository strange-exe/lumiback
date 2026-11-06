/**
 * Set-password links (sent to imported students, or by an admin) carry their one-time token
 * after "#t=", which browsers never send to a server, so it stays out of access logs.
 */

/** The backend's token shape (schemas.LinkTokenIn): URL-safe base64, 20 to 100 characters. */
const TOKEN = /^[A-Za-z0-9_-]{20,100}$/;

export function isLinkToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN.test(value);
}

/** The token in a location.hash such as "#t=abc...", or null if there is none or it's malformed. */
export function linkTokenFromHash(hash: string): string | null {
  const token = new URLSearchParams(hash.replace(/^#/, "")).get("t");
  return isLinkToken(token) ? token : null;
}
