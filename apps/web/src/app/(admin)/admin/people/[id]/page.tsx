import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { adminApi } from "@/features/admin/api";
import { Contact } from "@/features/admin/components/Contact";
import { ScanRow } from "@/features/admin/components/ScanRow";
import { Via } from "@/features/admin/components/Via";
import { formatHours, formatWhen } from "@/features/admin/format";
import {
  correctionText,
  RECORD_TAB_LABELS,
  RECORD_TABS,
  recordHref,
  recordId,
  recordView,
  type RecordTab,
} from "@/features/admin/record";
import { studentRecordOr404 } from "@/features/admin/record-data";
import { inViaLabel } from "@/features/outings/corrections";
import { formatDay, formatMinutes } from "@/features/outings/time";
import { ApiError } from "@/lib/api-error";
import { requireStaff } from "@/lib/session";
import type {
  AdminRequest,
  AdminScanPage,
  RecordOuting,
  RecordOutingPage,
  RecordRequestPage,
} from "@/lib/types";

export const metadata: Metadata = { title: "Student record" };

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ show?: string | string[]; before?: string | string[] }>;
}

type TabPage =
  | { tab: "outings"; page: RecordOutingPage }
  | { tab: "requests"; page: RecordRequestPage }
  | { tab: "scans"; page: AdminScanPage };

/** A student this office doesn't look after is a 404, as if they didn't exist (the API says so). */
async function orNotFound<T>(read: Promise<T>): Promise<T> {
  try {
    return await read;
  } catch (error) {
    if (error instanceof ApiError && (error.status === 404 || error.status === 422)) notFound();
    throw error;
  }
}

function readTab(token: string, id: string, tab: RecordTab, before?: string): Promise<TabPage> {
  switch (tab) {
    case "requests":
      return adminApi.recordRequests(token, id, before).then((page) => ({ tab, page }));
    case "scans":
      return adminApi.recordScans(token, id, before).then((page) => ({ tab, page }));
    default:
      return adminApi.recordOutings(token, id, before).then((page) => ({ tab: "outings", page }));
  }
}

const STATUS = {
  in: { label: "In the hostel", className: "bg-line text-ink" },
  out: { label: "Out now", className: "bg-accent-soft text-ink" },
  overdue: { label: "Out and late", className: "bg-danger-soft text-danger" },
} as const;

/**
 * One student's record: who they are, then their outings (each with its corrections and late
 * follow-up), requests and gate scans, newest first. Read only; the Register, Requests and
 * Corrections pages are where things change.
 */
export default async function StudentRecordPage({
  params,
  searchParams,
}: PageProps): Promise<ReactNode> {
  const { token } = await requireStaff();
  const id = recordId((await params).id);
  if (id === null) notFound();
  const { tab, before } = recordView(await searchParams);
  // The record's top was already read (and checked) by the layout: this reuses it.
  const [record, list] = await Promise.all([
    studentRecordOr404(token, id),
    orNotFound(readTab(token, id, tab, before)),
  ]);
  const { student } = record;
  const status = STATUS[student.status];
  const older =
    list.page.next_before === null ? null : recordHref(id, tab, String(list.page.next_before));

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <Link
        href="/admin/people"
        className="flex min-h-11 items-center self-start text-sm font-bold text-accent-text underline-offset-4 hover:underline"
      >
        People
      </Link>

      <section aria-labelledby="record-heading" className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 id="record-heading" className="font-display text-title text-ink">
              {student.name}
            </h1>
            <span className={`rounded-full px-2.5 py-0.5 text-sm font-bold ${status.className}`}>
              {status.label}
            </span>
            {student.account === "off" && (
              <span className="rounded-full border border-danger px-2.5 py-0.5 text-sm font-bold text-danger">
                Account turned off
              </span>
            )}
          </div>
          <p className="text-muted">
            {[student.roll_no, student.hostel ?? "No hostel chosen", student.email]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>

        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <Contact label="Student" phone={student.phone} />
          <Contact
            label={
              student.emergency_relation
                ? `Emergency contact (${student.emergency_relation})`
                : "Emergency contact"
            }
            name={student.emergency_name}
            phone={student.emergency_phone}
          />
        </dl>

        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-sheet border border-line bg-line sm:grid-cols-4">
          {[
            { label: "Outings", value: record.outings },
            { label: "Late", value: record.late },
            { label: "Open late follow-ups", value: record.open_escalations },
            { label: "Requests", value: record.requests },
          ].map((stat) => (
            <div key={stat.label} className="flex flex-col-reverse gap-1 bg-surface px-4 py-3">
              <dt className="text-sm text-muted">{stat.label}</dt>
              <dd className="font-display text-2xl tabular-nums text-ink">{stat.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="history-heading" className="flex flex-col gap-4">
        <h2 id="history-heading" className="sr-only">
          History
        </h2>
        <nav aria-label="Record">
          <ul className="flex flex-wrap gap-1 rounded-control bg-accent-soft p-1">
            {RECORD_TABS.map((t) => (
              <li key={t}>
                <Link
                  href={recordHref(id, t)}
                  prefetch={false}
                  aria-current={t === tab ? "page" : undefined}
                  className={`flex min-h-11 items-center rounded-[10px] px-3 text-sm font-bold ${
                    t === tab ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
                  }`}
                >
                  {RECORD_TAB_LABELS[t]}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        {before && (
          <p className="text-sm text-muted">
            Showing older entries.{" "}
            <Link
              href={recordHref(id, tab)}
              className="font-bold text-accent-text underline-offset-4 hover:underline"
            >
              Back to the newest
            </Link>
          </p>
        )}

        {list.tab === "outings" ? (
          <OutingList outings={list.page.items} />
        ) : list.tab === "requests" ? (
          <RequestList requests={list.page.items} />
        ) : list.page.items.length === 0 ? (
          <Empty>No gate scans{before ? " before these" : ""}.</Empty>
        ) : (
          <ol aria-label="Gate scans" className="divide-y divide-line border-y border-line">
            {list.page.items.map((scan) => (
              <ScanRow key={scan.id} scan={scan} linkName={false} />
            ))}
          </ol>
        )}

        {older && (
          <Link
            href={older}
            prefetch={false}
            className="flex min-h-11 items-center self-center font-bold text-accent-text underline-offset-4 hover:underline"
          >
            Older {RECORD_TAB_LABELS[tab].toLowerCase()}
          </Link>
        )}
      </section>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }): ReactNode {
  return (
    <p className="rounded-sheet border border-dashed border-line px-5 py-8 text-center text-muted">
      {children}
    </p>
  );
}

function OutingList({ outings }: { outings: RecordOuting[] }): ReactNode {
  if (outings.length === 0) return <Empty>No outings in your hostels yet.</Empty>;
  return (
    <ol aria-label="Outings" className="flex flex-col gap-3">
      {outings.map((o) => (
        <li key={o.id}>
          <OutingCard outing={o} />
        </li>
      ))}
    </ol>
  );
}

function OutingCard({ outing: o }: { outing: RecordOuting }): ReactNode {
  const backLate = o.status === "returned" && o.late_minutes > 0;
  return (
    <article className="flex flex-col gap-3 rounded-sheet border border-line bg-surface p-4 sm:p-5">
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 className="font-bold text-ink">{o.destination ? `To ${o.destination}` : "Outing"}</h3>
          <p className="text-sm text-muted">{[o.hostel, o.purpose].filter(Boolean).join(" · ")}</p>
        </div>
        <span className="flex flex-wrap gap-1.5 text-sm font-bold">
          {o.status === "returned" ? (
            <span className="rounded-full bg-line px-2.5 py-0.5 text-ink">Back</span>
          ) : o.status === "overdue" ? (
            <span className="rounded-full bg-danger-soft px-2.5 py-0.5 text-danger">
              Out, {formatMinutes(o.late_minutes)} late
            </span>
          ) : (
            <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-ink">Out</span>
          )}
          {backLate ? (
            <span className="rounded-full bg-warn-soft px-2.5 py-0.5 text-warn">
              {formatMinutes(o.late_minutes)} late
            </span>
          ) : null}
          {o.on_request ? (
            <span className="rounded-full bg-good-soft px-2.5 py-0.5 text-good">Approved form</span>
          ) : null}
        </span>
      </header>

      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
        <div className="flex flex-col gap-0.5">
          <dt className="text-muted">Left</dt>
          <dd className="tabular-nums text-ink">{formatWhen(o.left_at)}</dd>
          <dd>
            <Via via={o.out_via} gate={o.out_gate} />
          </dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-muted">Due back</dt>
          <dd className="tabular-nums text-ink">{formatWhen(o.expected_return_at)}</dd>
        </div>
        <div className="flex flex-col gap-0.5">
          <dt className="text-muted">Back</dt>
          <dd className="tabular-nums text-ink">
            {o.returned_at ? formatWhen(o.returned_at) : "Not back yet"}
          </dd>
          {inViaLabel(o.in_via) ? <dd className="text-muted">{inViaLabel(o.in_via)}</dd> : null}
        </div>
      </dl>

      {o.late_reply ? (
        <p className="text-sm text-ink">
          Answered the late alert: {o.late_reply === "safe" ? "says they're safe" : "on the way"}
        </p>
      ) : null}

      {o.escalation ? (
        <div className="flex flex-col gap-0.5 border-t border-line pt-3 text-sm">
          <p className="font-bold text-ink">
            Late follow-up {o.escalation.resolved_at ? "handled" : "open"}
          </p>
          <p className="text-muted">
            Opened {formatWhen(o.escalation.created_at)}
            {o.escalation.resolved_at
              ? `, handled ${formatWhen(o.escalation.resolved_at)}${
                  o.escalation.resolved_by ? ` by ${o.escalation.resolved_by}` : ""
                }`
              : ""}
          </p>
          {o.escalation.note ? <p className="text-ink">Note: {o.escalation.note}</p> : null}
        </div>
      ) : null}

      {o.corrections.length > 0 ? (
        <div className="flex flex-col gap-2 border-t border-line pt-3 text-sm">
          <p className="font-bold text-ink">Corrections</p>
          <ul className="flex flex-col gap-2">
            {o.corrections.map((c) => {
              const text = correctionText(c, o.left_at);
              return (
                <li key={c.id} className="flex flex-col gap-0.5">
                  <p className="text-ink">
                    {text.title}
                    <span className="text-muted">
                      {" "}
                      · {text.status} · {formatWhen(c.created_at)}
                    </span>
                  </p>
                  {text.details.map((d) => (
                    <p key={d} className="break-words text-muted">
                      {d}
                    </p>
                  ))}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </article>
  );
}

const REQUEST_STATUS: Record<AdminRequest["status"], { label: string; className: string }> = {
  pending: { label: "Waiting", className: "bg-accent-soft text-ink" },
  approved: { label: "Approved", className: "bg-good-soft text-good" },
  declined: { label: "Declined", className: "bg-danger-soft text-danger" },
  cancelled: { label: "Cancelled by student", className: "bg-line text-muted" },
};

function RequestList({ requests }: { requests: AdminRequest[] }): ReactNode {
  if (requests.length === 0) return <Empty>No outing requests.</Empty>;
  return (
    <ol aria-label="Requests" className="divide-y divide-line border-y border-line">
      {requests.map((r) => {
        const status = REQUEST_STATUS[r.status];
        const minutes = r.requested_minutes ?? r.max_minutes;
        return (
          <li key={r.id} className="flex flex-col gap-1 py-3.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <p className="font-bold text-ink">{formatDay(`${r.day}T12:00:00+05:30`)}</p>
              <span className={`rounded-full px-2.5 py-0.5 text-sm font-bold ${status.className}`}>
                {status.label}
                {r.used ? ", used" : ""}
              </span>
            </div>
            <p className="break-words text-ink">{r.purpose}</p>
            <p className="text-sm text-muted">
              {minutes ? `For ${formatHours(minutes)}` : "For the day's limit"} · asked{" "}
              {formatWhen(r.created_at)}
            </p>
            {r.decided_by ? (
              <p className="text-sm text-muted">
                {r.status === "approved" ? "Approved" : "Declined"} by {r.decided_by}
                {r.decided_at ? `, ${formatWhen(r.decided_at)}` : ""}
                {r.note ? `: ${r.note}` : ""}
              </p>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
