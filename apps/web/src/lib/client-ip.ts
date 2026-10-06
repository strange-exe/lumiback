/**
 * The visitor's IP, for the backend's per-IP rate limits.
 *
 * Read ONLY X-Real-IP, which our edge proxy (Caddy: `header_up X-Real-IP {remote_host}`)
 * overwrites on every request. X-Forwarded-For is never trusted here: its first entry is
 * whatever the client sent, so an attacker could rotate it to dodge every per-IP limit.
 * Without a proxy (local dev) this is null and the backend falls back to the web server's IP.
 */
export function clientIpFrom(headers: Headers): string | null {
  const ip = headers.get("x-real-ip")?.trim();
  return ip && /^[0-9a-fA-F:.]{2,45}$/.test(ip) ? ip : null;
}
