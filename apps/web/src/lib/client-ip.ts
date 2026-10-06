import { timingSafeEqual } from "node:crypto";

/**
 * Where the visitor's real IP comes from, for the backend's per-IP rate limits.
 *
 * Deployed behind Cloudflare: `header` is "cf-connecting-ip", which Cloudflare sets on every
 * request. But the web service is also reachable directly (its *.onrender.com address), where
 * anyone could send that header themselves. So a Cloudflare rule adds a secret header too, and
 * the IP is trusted only when that secret matches. X-Forwarded-For is never trusted: its first
 * entry is whatever the client wrote. Without configuration (local dev) there is no visitor IP.
 */
export interface IpTrust {
  header: string | null;
  edgeSecret: string | null;
}

export const EDGE_AUTH_HEADER = "x-edge-auth";

function sameSecret(sent: string, expected: string): boolean {
  const a = Buffer.from(sent);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function clientIpFrom(headers: Headers, trust: IpTrust): string | null {
  if (!trust.header) return null;
  if (
    trust.edgeSecret !== null &&
    !sameSecret(headers.get(EDGE_AUTH_HEADER) ?? "", trust.edgeSecret)
  ) {
    return null;
  }
  const ip = headers.get(trust.header)?.trim();
  return ip && /^[0-9a-fA-F:.]{2,45}$/.test(ip) ? ip : null;
}

/** Headers that hand the visitor's IP to the API, which trusts them only with the shared secret. */
export function visitorHeaders(
  ip: string | null,
  internalSecret: string | null,
): Record<string, string> {
  return ip && internalSecret ? { "X-Client-IP": ip, "X-Internal-Auth": internalSecret } : {};
}
