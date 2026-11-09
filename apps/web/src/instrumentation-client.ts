import { reportClientError } from "@/lib/report-error";

/**
 * Runs once in the browser before the page becomes interactive (Next.js instrumentation-client):
 * anything thrown that nothing caught is reported (scrubbed by the API, see lib/report-error.ts).
 * Errors an error boundary catches are reported by the boundary itself (components/ui/ErrorPanel).
 */
try {
  window.addEventListener("error", (event) => {
    reportClientError(event.error ?? event.message);
  });
  window.addEventListener("unhandledrejection", (event) => {
    reportClientError(event.reason);
  });
} catch {
  // Reporting is a nice to have: never let it stop the page.
}
