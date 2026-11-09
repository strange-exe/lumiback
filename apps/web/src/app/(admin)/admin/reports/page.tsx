import type { Metadata } from "next";
import type { ReactNode } from "react";

import { FormError } from "@/components/ui/Field";
import { adminApi } from "@/features/admin/api";
import { istToday } from "@/features/admin/format";
import {
  barPercent,
  dayText,
  isEmptyReport,
  MAX_REPORT_DAYS,
  minutesText,
  percentText,
  reportExportHref,
  reportMessage,
  resolveReportRange,
  totalLabel,
  weekLabel,
  type ReportProblem,
} from "@/features/admin/reports";
import { ApiError } from "@/lib/api-error";
import { requireStaff } from "@/lib/session";
import type { Report, ReportHostel, ReportStats, ReportWeek } from "@/lib/types";

export const metadata: Metadata = { title: "Reports" };

interface PageProps {
  searchParams: Promise<{ from?: unknown; to?: unknown; export_error?: unknown }>;
}

/**
 * Counts for the hostels this office looks after over a range of IST days: trips, late returns,
 * escalations and requests. Numbers only, never a student's name. The backend scopes the
 * hostels (a warden sees their own) and checks the range again.
 */
export default async function ReportsPage({ searchParams }: PageProps): Promise<ReactNode> {
  const { token } = await requireStaff();
  const params = await searchParams;
  const today = istToday();
  const range = resolveReportRange(params.from, params.to, today);

  let problem: ReportProblem | null = range.problem;
  let report: Report | null = null;
  if (!problem) {
    try {
      report = await adminApi.report(token, range.from, range.to);
    } catch (error) {
      // The API's own range check (a clock a day apart, say): shown next to the dates.
      if (error instanceof ApiError && error.status === 422) problem = "dates";
      else throw error; // the office's error page, with a retry
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <section aria-labelledby="reports-heading" className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h1 id="reports-heading" className="font-display text-title text-ink">
            Reports
          </h1>
          <p className="max-w-[65ch] text-muted">
            How trips went in your hostels between two dates (IST): how many, how many came back
            late, and what the office handled. Counts only, never names.
          </p>
        </div>
        <RangeForm from={range.from} to={range.to} today={today} problem={problem} />
      </section>

      {report === null ? null : isEmptyReport(report) ? (
        <p
          data-state="empty"
          className="rounded-sheet border border-dashed border-line px-5 py-10 text-center text-muted"
        >
          Nothing to count between {dayText(report.start)} and {dayText(report.end)}: no trips,
          escalations or decided requests. Try a longer range.
        </p>
      ) : (
        <div data-state="ready" className="flex flex-col gap-8">
          <Summary report={report} />
          <HostelTable report={report} />
          <WeekBars weeks={report.weeks} />
          <Download
            from={report.start}
            to={report.end}
            error={reportMessage(params.export_error)}
          />
        </div>
      )}
    </div>
  );
}

function RangeForm({
  from,
  to,
  today,
  problem,
}: {
  from: string;
  to: string;
  today: string;
  problem: ReportProblem | null;
}): ReactNode {
  const input = "min-h-12 rounded-control border border-line bg-page px-3 font-normal text-ink";
  return (
    <form
      method="get"
      action="/admin/reports"
      aria-label="Choose the dates"
      className="flex flex-col gap-3"
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5 text-sm font-bold text-ink">
          From
          <input
            type="date"
            name="from"
            defaultValue={from}
            min="2000-01-01"
            max={today}
            required
            className={input}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-bold text-ink">
          To
          <input
            type="date"
            name="to"
            defaultValue={to}
            min="2000-01-01"
            max={today}
            required
            className={input}
          />
        </label>
        <button
          type="submit"
          className="press min-h-12 rounded-control bg-ink px-5 font-bold text-page hover:opacity-90"
        >
          Show
        </button>
      </div>
      <p className="text-sm text-muted">Up to {MAX_REPORT_DAYS} days, both dates included.</p>
      <FormError message={problem ? reportMessage(problem) : null} />
    </form>
  );
}

function Summary({ report }: { report: Report }): ReactNode {
  const t = report.total;
  return (
    <section aria-labelledby="summary-heading" className="flex flex-col gap-3">
      <h2 id="summary-heading" className="font-display text-xl text-ink">
        {dayText(report.start)} to {dayText(report.end)}
      </h2>
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-sheet border border-line bg-line md:grid-cols-4">
        <Figure term="Trips" value={String(t.outings)}>
          {t.gate_out} through a gate, {t.self_out} in the app
        </Figure>
        <Figure term="Back late" value={percentText(t.late_rate)}>
          {t.returned_late} of {t.back} back
        </Figure>
        <Figure term="Median lateness" value={minutesText(t.median_minutes_late)}>
          Of those back late
        </Figure>
        <Figure term="Escalations" value={String(t.escalations)}>
          {t.running_late} running late notices used
        </Figure>
      </dl>
      <p className="text-sm text-muted">
        Requests: {t.requests_approved} approved, {t.requests_declined} declined.
      </p>
    </section>
  );
}

function Figure({
  term,
  value,
  children,
}: {
  term: string;
  value: string;
  children: ReactNode;
}): ReactNode {
  return (
    <div className="flex flex-col gap-1 bg-surface p-4">
      <dt className="text-sm text-muted">{term}</dt>
      <dd className="font-display text-2xl tabular-nums text-ink">{value}</dd>
      <dd className="text-sm text-muted">{children}</dd>
    </div>
  );
}

const COLUMNS: { key: keyof ReportStats; label: string; text?: (row: ReportStats) => string }[] = [
  { key: "outings", label: "Trips" },
  { key: "gate_out", label: "Left through a gate" },
  { key: "self_out", label: "Logged in the app" },
  { key: "back", label: "Back" },
  { key: "returned_late", label: "Back late" },
  { key: "late_rate", label: "Back late (%)", text: (row) => percentText(row.late_rate) },
  {
    key: "median_minutes_late",
    label: "Median lateness",
    text: (row) => minutesText(row.median_minutes_late),
  },
  { key: "escalations", label: "Escalations" },
  { key: "requests_approved", label: "Requests approved" },
  { key: "requests_declined", label: "Requests declined" },
  { key: "running_late", label: "Running late used" },
];

function cell(row: ReportStats, column: (typeof COLUMNS)[number]): string {
  return column.text ? column.text(row) : String(row[column.key]);
}

function HostelTable({ report }: { report: Report }): ReactNode {
  return (
    <section aria-labelledby="hostels-heading" className="flex flex-col gap-3">
      <h2 id="hostels-heading" className="font-display text-xl text-ink">
        By hostel
      </h2>
      {/* Wider than a phone: the table scrolls inside its own box, which takes focus so a
          keyboard can scroll it too. */}
      <div
        role="region"
        aria-labelledby="hostels-heading"
        tabIndex={0}
        className="overflow-x-auto rounded-sheet border border-line bg-surface"
      >
        <table className="w-full min-w-[56rem] text-left text-sm">
          <thead className="border-b border-line text-muted">
            <tr>
              <th scope="col" className="sticky left-0 bg-surface px-4 py-3 font-normal">
                Hostel
              </th>
              {COLUMNS.map((column) => (
                <th key={column.key} scope="col" className="px-3 py-3 text-right font-normal">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {report.hostels.map((row) => (
              <HostelRow key={row.hostel_id ?? "none"} row={row} />
            ))}
          </tbody>
          <tfoot className="border-t-2 border-line font-bold">
            <tr>
              <th
                scope="row"
                className="sticky left-0 whitespace-nowrap bg-surface px-4 py-3 text-ink"
              >
                {totalLabel(report)}
              </th>
              {COLUMNS.map((column) => (
                <td key={column.key} className="px-3 py-3 text-right tabular-nums text-ink">
                  {cell(report.total, column)}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

function HostelRow({ row }: { row: ReportHostel }): ReactNode {
  return (
    <tr>
      <th
        scope="row"
        className="sticky left-0 whitespace-nowrap bg-surface px-4 py-3 font-bold text-ink"
      >
        {row.hostel}
      </th>
      {COLUMNS.map((column) => (
        <td key={column.key} className="px-3 py-3 text-right tabular-nums text-ink">
          {cell(row, column)}
        </td>
      ))}
    </tr>
  );
}

/** Trips per week as bars, with the counts written out: the bars only repeat the numbers. */
function WeekBars({ weeks }: { weeks: ReportWeek[] }): ReactNode {
  const most = Math.max(0, ...weeks.map((w) => w.outings));
  return (
    <section aria-labelledby="weeks-heading" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="weeks-heading" className="font-display text-xl text-ink">
          Week by week
        </h2>
        <p className="text-sm text-muted">
          Trips that started each week (Monday to Sunday). The red part came back late.
        </p>
      </div>
      <ol className="flex flex-col divide-y divide-line border-y border-line">
        {weeks.map((week) => (
          <li
            key={week.week_start}
            className="grid grid-cols-1 gap-x-4 gap-y-1.5 py-3 sm:grid-cols-[15rem_minmax(0,1fr)_11rem] sm:items-center"
          >
            <p className="text-sm font-bold text-ink">{weekLabel(week)}</p>
            <div aria-hidden="true" className="flex h-3 overflow-hidden rounded-full bg-page">
              <div
                className="flex h-full justify-end bg-ink"
                style={{ width: `${barPercent(week.outings, most)}%` }}
              >
                <div
                  className="h-full bg-danger"
                  style={{ width: `${barPercent(week.returned_late, week.outings)}%` }}
                />
              </div>
            </div>
            <p className="text-sm tabular-nums text-muted sm:text-right">
              {week.outings} {week.outings === 1 ? "trip" : "trips"}, {week.returned_late} late
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Download({
  from,
  to,
  error,
}: {
  from: string;
  to: string;
  error: string | null;
}): ReactNode {
  return (
    <section
      id="report-download"
      aria-labelledby="report-download-heading"
      className="flex flex-col gap-3 rounded-sheet border border-line bg-surface p-5 sm:p-6"
    >
      <div className="flex flex-col gap-1">
        <h2 id="report-download-heading" className="font-display text-xl text-ink">
          Download this report
        </h2>
        <p className="text-sm text-muted">
          The table above as a spreadsheet, one row per hostel and a total. No names.
        </p>
      </div>
      <a
        href={reportExportHref(from, to)}
        className="press flex min-h-12 items-center self-start rounded-control bg-ink px-5 font-bold text-page hover:opacity-90"
      >
        Download CSV
      </a>
      <FormError message={error} />
    </section>
  );
}
