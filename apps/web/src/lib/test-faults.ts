/**
 * End-to-end tests can't intercept the server's own calls to the API (page.route only sees the
 * browser), so they ask for a failure with a request header instead:
 *   x-lumiback-test-fail: /admin/overview, /outings/summary
 * Only honoured when the dev server runs with E2E_FAULTS=1 (playwright.config.ts sets it), and
 * never in a production build: NODE_ENV is inlined there, so the check is removed entirely.
 */
export const FAULT_HEADER = "x-lumiback-test-fail";

export const faultsEnabled = (env: { NODE_ENV?: string; E2E_FAULTS?: string }): boolean =>
  env.NODE_ENV !== "production" && env.E2E_FAULTS === "1";

/** Whether an API call to `path` should fail: it starts with one of the header's paths. */
export function shouldFail(path: string, header: string | null | undefined): boolean {
  if (!header) return false;
  const target = path.split("?")[0];
  return header
    .split(",")
    .map((p) => p.trim())
    .some((p) => p.startsWith("/") && (target === p || target.startsWith(`${p}/`)));
}
