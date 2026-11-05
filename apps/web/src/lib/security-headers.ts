/**
 * Headers for every response (next.config.ts). Nothing frames the site (no iframe in the web
 * app; the mobile app's map WebView loads its own inline HTML), so other origins may not frame
 * it: that stops clickjacking of sign-out, share, approve and safe-return buttons.
 *
 * The CSP holds only frame-ancestors, so it can't block the app's own scripts or styles. No CSP
 * is set anywhere else (proxy.ts, route handlers); a fuller policy belongs here too.
 * Pure (no Next.js imports) so it runs under `node --test`.
 */
export const SECURITY_HEADERS: { key: string; value: string }[] = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" }, // browsers without frame-ancestors
  { key: "X-Content-Type-Options", value: "nosniff" },
];
