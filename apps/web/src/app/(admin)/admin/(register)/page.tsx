import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import type { LedState } from "@/components/led/led";
import { LedFigure } from "@/components/led/LedFigure";
import { FormError } from "@/components/ui/Field";
import { adminApi } from "@/features/admin/api";
import { AutoRefresh } from "@/features/admin/components/AutoRefresh";
import { CorrectionDialog } from "@/features/admin/components/CorrectionForms";
import { exportDate, exportMessage } from "@/features/admin/export";
import { Via } from "@/features/admin/components/Via";
import { formatWhen, istToday } from "@/features/admin/format";
import { inViaLabel } from "@/features/outings/corrections";
import { formatMinutes } from "@/features/outings/time";
import { recordHref } from "@/features/admin/record";
import { extrasFrom, filterHref, MAX_Q, pageHref, resolveFilters } from "@/lib/filters";
import { rememberedFilters, requireStaff } from "@/lib/session";
import type { AdminOuting } from "@/lib/types";

export const metadata: Metadata = { title: "Register" };

const STATES = [
  { value: "all", label: "Everyone out" },
  { value: "overdue", label: "Late" },
  { value: "out", label: "Not yet due" },
] as const;
type State = (typeof STATES)[number]["value"];

interface PageProps {
  searchParams: Promise<{
    state?: string;
    hostel?: string;
    q?: string | string[];
    export_error?: string;
    from?: string;
    to?: string;
  }>;
}

export default async function RegisterPage({ searchParams }: PageProps): Promise<ReactNode> {
  const { token } = await requireStaff();
  const params = await searchParams;
  // The address's filters, or on a bare visit the ones chosen last time (lib/filters.ts). The
  // search is never remembered.
  const [{ values }, mine] = await Promise.all([
    rememberedFilters().then((kept) => resolveFilters("register", params, kept)),
    adminApi.myHostels(token),
  ]);
  const state: State = STATES.find((s) => s.value === values.state)?.value ?? "all";
  // A hostel that isn't (or is no longer) one of theirs is simply not applied.
  const hostel = mine.find((h) => h.id === values.hostel);
  const q = extrasFrom("register", params).q ?? "";
  const typed = typeof params.q === "string" ? params.q.trim() : "";
  const filters = { hostel: hostel?.id, q: q || undefined };
  const [overview, outings, late] = await Promise.all([
    adminApi.overview(token),
    adminApi.outings(token, state, filters),
    adminApi.lateToday(token, filters),
  ]);
  const narrowed = Boolean(hostel || q);
  const where = [hostel ? `in ${hostel.name}` : "", q ? `matching "${q}"` : ""]
    .filter(Boolean)
    .join(" ");
  // Rendered per request: the server's clock is "now" for the correction forms.
  const nowIso = new Date().toISOString();

  // Red only when something is wrong; the label always says what the number is.
  const stats: { label: string; value: number; state: LedState }[] = [
    { label: "Out now", value: overview.out_now, state: "out" },
    { label: "Late", value: overview.overdue, state: overview.overdue > 0 ? "late" : "out" },
    { label: "Gate scans today", value: overview.scans_today, state: "out" },
    {
      label: "Refused scans today",
      value: overview.rejected_today,
      state: overview.rejected_today > 0 ? "late" : "out",
    },
  ];

  return (
    <div className="flex flex-col gap-10">
      <AutoRefresh />
      <section aria-labelledby="register-heading" className="flex flex-col gap-5">
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
          <h1 id="register-heading" className="font-display text-title text-ink">
            Register
          </h1>
          <p className="text-sm text-muted">
            Updates every 30 s · {overview.active_gates}{" "}
            {overview.active_gates === 1 ? "gate" : "gates"} taking scans
          </p>
        </div>
        <NeedsAction
          escalations={overview.open_escalations ?? 0}
          requests={overview.pending_requests ?? 0}
          corrections={overview.corrections ?? 0}
        />
        <dl
          data-tour="register-board"
          className="led-board grid grid-cols-2 gap-x-6 gap-y-5 p-5 sm:grid-cols-4 sm:p-6"
        >
          {stats.map((stat) => (
            <div key={stat.label} className="flex min-w-0 flex-col-reverse gap-2">
              <dt className="text-sm text-board-muted">{stat.label}</dt>
              <dd>
                <LedFigure
                  text={String(stat.value)}
                  label={String(stat.value)}
                  state={stat.state}
                  className="text-[4.5rem]"
                />
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="out-heading" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="out-heading" className="font-display text-xl text-ink">
            Who&apos;s out
          </h2>
          <nav aria-label="Filter" className="flex gap-1 rounded-control bg-accent-soft p-1">
            {STATES.map((s) => (
              // A plain link (no prefetch): following it remembers the choice.
              <a
                key={s.value}
                href={filterHref(
                  "register",
                  { state: s.value, ...(hostel ? { hostel: hostel.id } : {}) },
                  { q },
                )}
                aria-current={state === s.value ? "page" : undefined}
                className={`flex min-h-10 items-center rounded-[10px] px-3 text-sm font-bold ${
                  state === s.value ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
                }`}
              >
                {s.label}
              </a>
            ))}
          </nav>
        </div>
        <RegisterSearch state={state} hostel={hostel?.id} q={q} typed={typed} />
        {mine.length > 1 && (
          <nav aria-label="Hostel">
            <ul className="flex flex-wrap gap-1">
              {[undefined, ...mine].map((h) => (
                <li key={h?.id ?? "all"}>
                  <a
                    href={filterHref(
                      "register",
                      { ...(state !== "all" ? { state } : {}), ...(h ? { hostel: h.id } : {}) },
                      { q },
                    )}
                    aria-current={hostel?.id === h?.id ? "page" : undefined}
                    className={`flex min-h-11 items-center rounded-control px-3 text-sm font-bold ${
                      hostel?.id === h?.id
                        ? "bg-accent-soft text-ink ring-1 ring-accent"
                        : "text-muted ring-1 ring-line hover:text-ink"
                    }`}
                  >
                    {h ? h.name : "All hostels"}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}
        {outings.length === 0 ? (
          <p className="rounded-sheet border border-dashed border-line px-5 py-10 text-center text-muted">
            {narrowed
              ? `Nobody ${where} is ${state === "overdue" ? "late" : "out"} right now.`
              : state === "overdue"
                ? "Nobody is late."
                : "Nobody is out right now. Students appear here when they tap out at a gate or check out in the app or on the website."}
          </p>
        ) : (
          <OutingsTable outings={outings} nowIso={nowIso} />
        )}
      </section>

      <LateToday late={late} nowIso={nowIso} where={where} />

      <ExportForm
        error={exportMessage(params.export_error)}
        from={exportDate(params.from)}
        to={exportDate(params.to)}
      />
    </div>
  );
}

/** The student's name, linking to their record (a deleted account has none). */
function StudentName({ outing }: { outing: AdminOuting }): ReactNode {
  if (!outing.student_id) return <p className="truncate font-bold text-ink">{outing.name}</p>;
  return (
    <p className="truncate font-bold">
      <Link
        href={recordHref(outing.student_id)}
        prefetch={false}
        className="text-ink underline decoration-line underline-offset-4 hover:decoration-ink"
      >
        {outing.name}
      </Link>
    </p>
  );
}

/** Name or roll number search; the state and hostel chosen stay as they are. */
function RegisterSearch({
  state,
  hostel,
  q,
  typed,
}: {
  state: State;
  hostel: string | undefined;
  q: string;
  typed: string;
}): ReactNode {
  return (
    <form method="get" role="search" className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-end gap-3">
        {state !== "all" && <input type="hidden" name="state" value={state} />}
        {hostel && <input type="hidden" name="hostel" value={hostel} />}
        <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm font-bold text-ink">
          Name or roll number
          <input
            type="search"
            name="q"
            defaultValue={typed || q}
            minLength={2}
            maxLength={MAX_Q}
            className="min-h-12 rounded-control border border-line bg-surface px-4 text-base font-normal text-ink"
          />
        </label>
        <button
          type="submit"
          className="min-h-12 rounded-control bg-ink px-5 font-bold text-page hover:opacity-90"
        >
          Search
        </button>
        {q && (
          <a
            href={pageHref("register", {
              ...(state !== "all" ? { state } : {}),
              ...(hostel ? { hostel } : {}),
            })}
            className="flex min-h-12 items-center px-1 text-sm font-bold text-accent-text underline-offset-4 hover:underline"
          >
            Clear search
          </a>
        )}
      </div>
      {typed && !q && <p className="text-sm text-muted">Type at least 2 letters to search.</p>}
    </form>
  );
}

function OutingsTable({ outings, nowIso }: { outings: AdminOuting[]; nowIso: string }): ReactNode {
  return (
    <table className="block w-full text-left md:table">
      <thead className="hidden border-b border-line text-sm text-muted md:table-header-group">
        <tr>
          <th scope="col" className="py-2 pr-4 font-normal">
            Student
          </th>
          <th scope="col" className="py-2 pr-4 font-normal">
            Left
          </th>
          <th scope="col" className="py-2 pr-4 font-normal">
            Due back
          </th>
          <th scope="col" className="py-2 pr-4 font-normal">
            Status
          </th>
          <th scope="col" className="py-2 font-normal">
            <span className="sr-only">Correct</span>
          </th>
        </tr>
      </thead>
      <tbody className="block divide-y divide-line border-y border-line md:table-row-group md:border-t-0">
        {outings.map((o) => (
          <tr key={o.id} className="grid grid-cols-2 gap-x-4 gap-y-1.5 py-3.5 md:table-row">
            <td className="col-span-2 min-w-0 md:py-3.5 md:pr-4">
              <StudentName outing={o} />
              <p className="truncate text-sm text-muted">
                {[o.roll_no, o.hostel, o.destination ? `to ${o.destination}` : null]
                  .filter(Boolean)
                  .join(" · ") || o.email}
              </p>
            </td>
            <td className="text-sm md:py-3.5 md:pr-4">
              <p className="tabular-nums text-ink">{formatWhen(o.left_at)}</p>
              <Via via={o.out_via} gate={o.out_gate} />
            </td>
            <td className="text-sm tabular-nums text-ink md:py-3.5 md:pr-4">
              <span className="text-muted md:hidden">Due </span>
              {formatWhen(o.expected_return_at)}
            </td>
            <td className="text-sm font-bold md:py-3.5 md:pr-4">
              <span className="flex flex-wrap gap-1.5">
                {o.status === "overdue" ? (
                  <span className="inline-flex rounded-full bg-danger-soft px-2.5 py-1 text-danger">
                    {formatMinutes(o.late_minutes)} late
                  </span>
                ) : (
                  <span className="inline-flex rounded-full bg-accent-soft px-2.5 py-1 text-accent">
                    Out
                  </span>
                )}
                {o.late_reply ? (
                  <span className="inline-flex rounded-full bg-line px-2.5 py-1 text-ink">
                    {o.late_reply === "safe" ? "Says they're safe" : "On the way"}
                  </span>
                ) : null}
                {o.on_request ? (
                  <span className="inline-flex rounded-full bg-good-soft px-2.5 py-1 text-good">
                    Approved form
                  </span>
                ) : null}
              </span>
            </td>
            <td className="text-right md:py-3.5">
              <CorrectionDialog outing={o} kind="return" nowIso={nowIso} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Tonight's latecomers: back after their return time, or still out past it. */
function LateToday({
  late,
  nowIso,
  where,
}: {
  late: AdminOuting[];
  nowIso: string;
  where: string;
}): ReactNode {
  return (
    <section aria-labelledby="late-heading" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="late-heading" className="font-display text-xl text-ink">
          Late today
        </h2>
        <p className="text-sm text-muted">
          Everyone who came back after their return time today, or is still out past it. Most late
          first.
        </p>
      </div>
      {late.length === 0 ? (
        <p className="rounded-sheet border border-dashed border-line px-5 py-8 text-center text-muted">
          {where ? `Nobody ${where} has been late today.` : "Nobody has been late today."}
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-line border-y border-line">
          {late.map((o) => (
            <li
              key={o.id}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3"
            >
              <div className="min-w-0">
                <StudentName outing={o} />
                <p className="truncate text-sm text-muted">
                  {[o.roll_no, o.hostel].filter(Boolean).join(" · ") || o.email} · due{" "}
                  {formatWhen(o.expected_return_at)}
                  {o.returned_at ? `, back ${formatWhen(o.returned_at)}` : ", not back yet"}
                </p>
                {inViaLabel(o.in_via) ? (
                  <p className="text-sm text-muted">{inViaLabel(o.in_via)}</p>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex rounded-full px-2.5 py-1 text-sm font-bold ${
                    o.returned_at ? "bg-accent-soft text-accent" : "bg-danger-soft text-danger"
                  }`}
                >
                  {formatMinutes(o.late_minutes)} late
                </span>
                {o.returned_at ? (
                  <>
                    <CorrectionDialog outing={o} kind="return_time" nowIso={nowIso} />
                    <CorrectionDialog outing={o} kind="cancel" nowIso={nowIso} />
                  </>
                ) : (
                  <CorrectionDialog outing={o} kind="return" nowIso={nowIso} />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** What can't wait: late students who didn't answer, and requests waiting for a decision. */
function NeedsAction({
  escalations,
  requests,
  corrections,
}: {
  escalations: number;
  requests: number;
  corrections: number;
}): ReactNode {
  if (!escalations && !requests && !corrections) return null;
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      {escalations ? (
        <Link
          href="/admin/escalations"
          className="flex min-h-12 flex-1 items-center justify-between gap-3 rounded-control bg-danger px-4 font-bold text-surface hover:brightness-110"
        >
          {escalations} late {escalations === 1 ? "student needs" : "students need"} follow-up
          <span aria-hidden="true">→</span>
        </Link>
      ) : null}
      {requests ? (
        <Link
          href="/admin/requests"
          className="flex min-h-12 flex-1 items-center justify-between gap-3 rounded-control bg-accent-soft px-4 font-bold text-accent hover:brightness-95"
        >
          {requests} outing {requests === 1 ? "request" : "requests"} to decide
          <span aria-hidden="true">→</span>
        </Link>
      ) : null}
      {corrections ? (
        <Link
          href="/admin/corrections"
          className="flex min-h-12 flex-1 items-center justify-between gap-3 rounded-control bg-accent-soft px-4 font-bold text-accent hover:brightness-95"
        >
          {corrections} {corrections === 1 ? "outing" : "outings"} to correct
          <span aria-hidden="true">→</span>
        </Link>
      ) : null}
    </div>
  );
}

/** A failed download comes back here (export/route.ts) with a fixed problem key and its dates. */
function ExportForm({
  error,
  from,
  to,
}: {
  error: string | null;
  from?: string;
  to?: string;
}): ReactNode {
  const today = istToday();
  const monthStart = `${today.slice(0, 8)}01`;
  const input = "min-h-12 rounded-control border border-line bg-page px-3 font-normal text-ink";
  return (
    <section
      aria-labelledby="export-heading"
      className="flex flex-col gap-4 rounded-sheet border border-line bg-surface p-5 sm:p-6"
    >
      <div className="flex flex-col gap-1">
        <h2 id="export-heading" className="font-display text-xl text-ink">
          Download the register
        </h2>
        <p className="text-sm text-muted">
          Every trip that started between these dates (IST), as a spreadsheet. Up to 92 days at a
          time.
        </p>
      </div>
      <form action="/admin/export" method="get" className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5 text-sm font-bold text-ink">
          From
          <input
            type="date"
            name="from"
            defaultValue={from ?? monthStart}
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
            defaultValue={to ?? today}
            max={today}
            required
            className={input}
          />
        </label>
        <button
          type="submit"
          className="press min-h-12 rounded-control bg-ink px-5 font-bold text-page hover:opacity-90"
        >
          Download CSV
        </button>
      </form>
      <FormError message={error} />
    </section>
  );
}
