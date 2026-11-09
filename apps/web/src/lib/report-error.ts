import { createReporter } from "@/lib/error-report";

/**
 * The website's one error reporter, shared by the global handlers (instrumentation-client.ts)
 * and the error boundaries. Same-origin only: /api/errors passes reports on to the API and adds
 * the version (so the changelog stays out of every page's JavaScript).
 */
const reporter = createReporter({
  platform: "web",
  route: () => (typeof location === "undefined" ? null : location.pathname),
  send: (payload) =>
    fetch("/api/errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      credentials: "same-origin",
      // Still delivered if the page is going away.
      keepalive: true,
    }).then((response) => response.ok),
});

/** Report something that broke on this page. Never throws, never logs. */
export function reportClientError(error: unknown): void {
  if (typeof window === "undefined") return; // a server render: the server logs its own
  try {
    reporter.report(error);
  } catch {
    // A reporter must never be the next error.
  }
}
