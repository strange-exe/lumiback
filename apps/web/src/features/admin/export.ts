/**
 * The register download (app/(admin)/admin/export/route.ts). A failed download goes back to the
 * office page with a fixed problem key, shown next to the form; nothing the visitor typed is
 * ever echoed as a message. Pure (no Next.js imports) so it runs under `node --test`.
 */

import { isRealDate } from "./day-param.ts";

/** The backend's limit (services/admin.py MAX_EXPORT_DAYS), counting both ends. */
export const MAX_EXPORT_DAYS = 92;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const MESSAGES = {
  dates: "Choose a real start and end date.",
  order: "The end date is before the start date. Swap them and try again.",
  range: `Choose a range of at most ${MAX_EXPORT_DAYS} days, then download the rest separately.`,
  unavailable:
    "Lumiback couldn't reach its server, so nothing was downloaded. Try again in a moment.",
  denied: "Only admins can download the register.",
  busy: "Too many downloads at once. Wait a moment and try again.",
  failed: "The download didn't work. Try again.",
} as const;

export type ExportProblem = keyof typeof MESSAGES;

/** Days since 1970-01-01 for a real YYYY-MM-DD date, or null. */
function dayNumber(value: string | null | undefined): number | null {
  return isRealDate(value) ? Date.parse(`${value}T00:00:00Z`) / 86_400_000 : null;
}

/** The same checks the backend makes, before anything is sent. */
export function exportRangeProblem(
  from: string | null | undefined,
  to: string | null | undefined,
): ExportProblem | null {
  const start = dayNumber(from);
  const end = dayNumber(to);
  if (start === null || end === null) return "dates";
  if (end < start) return "order";
  if (end - start >= MAX_EXPORT_DAYS) return "range";
  return null;
}

/** A backend answer (or none: null) that wasn't a file. 401 is handled by the caller. */
export function exportProblemFor(status: number | null): ExportProblem {
  if (status === null || status >= 500) return "unavailable";
  if (status === 403 || status === 404) return "denied";
  if (status === 422) return "dates";
  if (status === 429) return "busy";
  return "failed";
}

/** The message for a problem key from the URL; unknown keys show nothing. */
export function exportMessage(key: string | null | undefined): string | null {
  if (typeof key !== "string" || !Object.hasOwn(MESSAGES, key)) return null;
  return MESSAGES[key as ExportProblem];
}

/** Back to the office page, at the form, with the problem and the dates (only if well formed). */
export function exportBackPath(
  problem: ExportProblem,
  from: string | null | undefined,
  to: string | null | undefined,
): string {
  const params = new URLSearchParams({ export_error: problem });
  if (typeof from === "string" && DATE.test(from)) params.set("from", from);
  if (typeof to === "string" && DATE.test(to)) params.set("to", to);
  return `/admin?${params.toString()}#export-heading`;
}

/** A date from the URL to prefill the form with, if well formed. */
export function exportDate(value: string | null | undefined): string | undefined {
  return typeof value === "string" && DATE.test(value) ? value : undefined;
}
