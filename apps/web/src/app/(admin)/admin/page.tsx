import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { adminApi } from "@/features/admin/api";
import { AutoRefresh } from "@/features/admin/components/AutoRefresh";
import { Via } from "@/features/admin/components/Via";
import { formatWhen, istToday } from "@/features/admin/format";
import { formatMinutes } from "@/features/outings/time";
import { requireAdmin } from "@/lib/session";
import type { AdminOuting } from "@/lib/types";

export const metadata: Metadata = { title: "Register" };

const STATES = [
  { value: "all", label: "Everyone out" },
  { value: "overdue", label: "Overdue" },
  { value: "out", label: "Not yet due" },
] as const;
type State = (typeof STATES)[number]["value"];

interface PageProps {
  searchParams: Promise<{ state?: string }>;
}

export default async function RegisterPage({ searchParams }: PageProps): Promise<ReactNode> {
  const { token } = await requireAdmin();
  const requested = (await searchParams).state;
  const state: State = STATES.find((s) => s.value === requested)?.value ?? "all";
  const [overview, outings, late] = await Promise.all([
    adminApi.overview(token),
    adminApi.outings(token, state),
    adminApi.lateToday(token),
  ]);

  const stats = [
    { label: "Out now", value: overview.out_now, alert: false },
    { label: "Overdue", value: overview.overdue, alert: overview.overdue > 0 },
    { label: "Gate scans today", value: overview.scans_today, alert: false },
    { label: "Refused scans today", value: overview.rejected_today, alert: false },
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
        />
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-sheet border border-line bg-line sm:grid-cols-4">
          {stats.map((stat) => (
            <div key={stat.label} className="flex flex-col-reverse gap-1 bg-surface px-5 py-4">
              <dt className="text-sm text-muted">{stat.label}</dt>
              <dd
                className={`font-display text-title tabular-nums ${stat.alert ? "text-danger" : "text-ink"}`}
              >
                {stat.value}
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
              <Link
                key={s.value}
                href={s.value === "all" ? "/admin" : `/admin?state=${s.value}`}
                aria-current={state === s.value ? "page" : undefined}
                className={`flex min-h-10 items-center rounded-[10px] px-3 text-sm font-bold ${
                  state === s.value ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
                }`}
              >
                {s.label}
              </Link>
            ))}
          </nav>
        </div>
        {outings.length === 0 ? (
          <p className="rounded-sheet border border-dashed border-line px-5 py-10 text-center text-muted">
            {state === "overdue"
              ? "Nobody is overdue."
              : "Nobody is out right now. Students appear here when they tap out at a gate or check out in the app or on the website."}
          </p>
        ) : (
          <OutingsTable outings={outings} />
        )}
      </section>

      <LateToday late={late} />

      <ExportForm />
    </div>
  );
}

function OutingsTable({ outings }: { outings: AdminOuting[] }): ReactNode {
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
          <th scope="col" className="py-2 font-normal">
            Status
          </th>
        </tr>
      </thead>
      <tbody className="block divide-y divide-line border-y border-line md:table-row-group md:border-t-0">
        {outings.map((o) => (
          <tr key={o.id} className="grid grid-cols-2 gap-x-4 gap-y-1.5 py-3.5 md:table-row">
            <td className="col-span-2 min-w-0 md:py-3.5 md:pr-4">
              <p className="truncate font-bold text-ink">{o.name}</p>
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
            <td className="col-span-2 text-sm font-bold md:py-3.5">
              <span className="flex flex-wrap gap-1.5">
                {o.status === "overdue" ? (
                  <span className="inline-flex rounded-full bg-danger-soft px-2.5 py-1 text-danger">
                    Overdue {formatMinutes(o.late_minutes)}
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
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Tonight's latecomers: back after their return time, or still out past it. */
function LateToday({ late }: { late: AdminOuting[] }): ReactNode {
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
          Nobody has been late today.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-line border-y border-line">
          {late.map((o) => (
            <li
              key={o.id}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-3"
            >
              <div className="min-w-0">
                <p className="truncate font-bold text-ink">{o.name}</p>
                <p className="truncate text-sm text-muted">
                  {[o.roll_no, o.hostel].filter(Boolean).join(" · ") || o.email} · due{" "}
                  {formatWhen(o.expected_return_at)}
                  {o.returned_at ? `, back ${formatWhen(o.returned_at)}` : ", not back yet"}
                </p>
              </div>
              <span
                className={`inline-flex rounded-full px-2.5 py-1 text-sm font-bold ${
                  o.returned_at ? "bg-accent-soft text-accent" : "bg-danger-soft text-danger"
                }`}
              >
                {formatMinutes(o.late_minutes)} late
              </span>
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
}: {
  escalations: number;
  requests: number;
}): ReactNode {
  if (!escalations && !requests) return null;
  return (
    <div className="flex flex-col gap-2 sm:flex-row">
      {escalations ? (
        <Link
          href="/admin/escalations"
          className="flex min-h-12 flex-1 items-center justify-between gap-3 rounded-control bg-danger px-4 font-bold text-surface hover:brightness-110"
        >
          {escalations} late {escalations === 1 ? "student isn't" : "students aren't"} answering
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
    </div>
  );
}

function ExportForm(): ReactNode {
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
            defaultValue={monthStart}
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
            defaultValue={today}
            max={today}
            required
            className={input}
          />
        </label>
        <button
          type="submit"
          className="min-h-12 rounded-control bg-ink px-5 font-bold text-page hover:opacity-90 active:translate-y-px"
        >
          Download CSV
        </button>
      </form>
    </section>
  );
}
