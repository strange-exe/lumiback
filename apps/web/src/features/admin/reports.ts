/**
 * The office's Reports page (app/(admin)/admin/reports): its date range, its words for the
 * numbers, and its CSV download. Pure (no Next.js imports) so it runs under `node --test`.
 */

import type { Report, ReportWeek } from "../../lib/types.ts";
import { isRealDate } from "./day-param.ts";

/** The backend's limits (services/reports.py), counting both ends. */
export const DEFAULT_REPORT_DAYS = 30;
export const MAX_REPORT_DAYS = 366;

const DAY_MS = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const MESSAGES = {
  dates: "Choose a real start and end date, or leave both empty for the last 30 days.",
  order: "The end date is before the start date. Swap them and try again.",
  range: `Choose a range of at most ${MAX_REPORT_DAYS} days.`,
  unavailable:
    "Lumiback couldn't reach its server, so nothing was downloaded. Try again in a moment.",
  denied: "Only the hostel office can download reports.",
  busy: "Too many downloads at once. Wait a moment and try again.",
  failed: "The download didn't work. Try again.",
} as const;

export type ReportProblem = keyof typeof MESSAGES;

function dayNumber(value: string): number {
  return Date.parse(`${value}T00:00:00Z`) / DAY_MS;
}

function dayString(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

function given(value: unknown): boolean {
  return value !== undefined && value !== null && value !== "";
}

/**
 * The range a page address asks for: none is the last 30 IST days (today included). A problem
 * means no report is asked for; the form shows the message and the dates to fix.
 */
export function resolveReportRange(
  from: unknown,
  to: unknown,
  today: string,
): { from: string; to: string; problem: ReportProblem | null } {
  if (!given(from) && !given(to)) {
    return {
      from: dayString(dayNumber(today) - (DEFAULT_REPORT_DAYS - 1)),
      to: today,
      problem: null,
    };
  }
  const shown = {
    from: typeof from === "string" ? from : "",
    to: typeof to === "string" ? to : "",
  };
  if (!isRealDate(from) || !isRealDate(to) || from < "2000-01-01" || to > "2999-12-31") {
    return { ...shown, problem: "dates" };
  }
  if (to < from) return { ...shown, problem: "order" };
  if (dayNumber(to) - dayNumber(from) >= MAX_REPORT_DAYS) return { ...shown, problem: "range" };
  return { from, to, problem: null };
}

/** The message for a problem key from the URL; unknown keys show nothing. */
export function reportMessage(key: unknown): string | null {
  if (typeof key !== "string" || !Object.hasOwn(MESSAGES, key)) return null;
  return MESSAGES[key as ReportProblem];
}

/** A backend answer (or none: null) that wasn't a file. 401 is handled by the caller. */
export function reportProblemFor(status: number | null): ReportProblem {
  if (status === null || status >= 500) return "unavailable";
  if (status === 403 || status === 404) return "denied";
  if (status === 422) return "dates";
  if (status === 429) return "busy";
  return "failed";
}

export function percentText(rate: number | null): string {
  return rate === null ? "Nobody back" : `${Math.round(rate * 100)}%`;
}

export function minutesText(minutes: number | null): string {
  return minutes === null ? "None late" : `${minutes} min`;
}

/** A bar's length as a share of the longest one, 0 to 100. */
export function barPercent(value: number, max: number): number {
  return max > 0 ? Math.round((value / max) * 100) : 0;
}

// Spelled out: ICU versions differ on short months ("Sep" or "Sept"), so the same label
// reads the same in every browser, in Node and in tests.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "5 Oct 2026" for a YYYY-MM-DD day. */
export function dayText(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  return `${day} ${MONTHS[(month ?? 1) - 1]} ${year}`;
}

/** "Week of 5 Oct", and "(4 days in range)" for a week the range only partly covers. */
export function weekLabel(week: ReportWeek): string {
  const [, month, day] = week.week_start.split("-").map(Number);
  const label = `Week of ${day} ${MONTHS[(month ?? 1) - 1]}`;
  if (week.days >= 7) return label;
  return `${label} (${week.days} ${week.days === 1 ? "day" : "days"} in range)`;
}

function dateParams(from: unknown, to: unknown): URLSearchParams {
  const params = new URLSearchParams();
  if (typeof from === "string" && DATE.test(from)) params.set("from", from);
  if (typeof to === "string" && DATE.test(to)) params.set("to", to);
  return params;
}

export function reportExportHref(from: string, to: string): string {
  return `/admin/reports/export?${dateParams(from, to).toString()}`;
}

/** Back to the Reports page, at the download, with the problem and well formed dates only. */
export function reportBackPath(problem: ReportProblem, from: unknown, to: unknown): string {
  const params = new URLSearchParams({ export_error: problem });
  for (const [key, value] of dateParams(from, to)) params.set(key, value);
  return `/admin/reports?${params.toString()}#report-download`;
}

/** Nothing happened in the range: no outings, escalations or decided requests. */
/**
 * The total row's name. A warden's report covers only their hostels, so its total isn't the
 * campus's (the backend's CSV names it the same way: services/reports.py total_label).
 */
export function totalLabel(report: Pick<Report, "every_hostel">): string {
  return report.every_hostel ? "All hostels" : "Your hostels";
}

export function isEmptyReport(report: Report): boolean {
  const t = report.total;
  return t.outings + t.escalations + t.requests_approved + t.requests_declined === 0;
}
