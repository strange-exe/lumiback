import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { adminApi } from "@/features/admin/api";
import { AutoRefresh } from "@/features/admin/components/AutoRefresh";
import { RequestCard } from "@/features/admin/components/RequestCard";
import { pastDay } from "@/features/admin/day-param";
import { istToday } from "@/features/admin/format";
import { formatDay } from "@/features/outings/time";
import { requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Requests" };

interface PageProps {
  searchParams: Promise<{ day?: string }>;
}

export default async function RequestsPage({ searchParams }: PageProps): Promise<ReactNode> {
  const { token } = await requireStaff();
  const today = istToday();
  // An earlier day, to look up a past request and who decided it; anything else is today.
  const day = pastDay((await searchParams).day, today);
  const requests = await adminApi.requests(token, day);
  const pending = day ? 0 : requests.filter((r) => r.status === "pending").length;
  const dayLabel = day ? formatDay(`${day}T12:00:00+05:30`) : null;

  return (
    <section aria-labelledby="requests-heading" className="flex flex-col gap-6">
      {day ? null : <AutoRefresh />}
      <div className="flex flex-col gap-1">
        <h1 id="requests-heading" className="font-display text-title text-ink">
          {dayLabel ? `Outing requests, ${dayLabel}` : "Outing requests"}
        </h1>
        <p className="max-w-[65ch] text-muted">
          On days whose rules need approval (set on the Rules page), students send a form on the
          day. Once you approve it they can tap out at the gate or check out on the website, once,
          for up to the day&apos;s limit.
          {pending ? ` ${pending} waiting for you.` : ""}
        </p>
      </div>

      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5 text-sm font-bold text-ink">
          Show another day
          <input
            type="date"
            name="day"
            max={today}
            defaultValue={day ?? today}
            required
            className="min-h-11 rounded-control border border-line bg-surface px-3 font-normal text-ink"
          />
        </label>
        <button
          type="submit"
          className="min-h-11 rounded-control bg-ink px-4 text-sm font-bold text-page hover:opacity-90"
        >
          Show
        </button>
        {day ? (
          <Link
            href="/admin/requests"
            className="flex min-h-11 items-center px-2 text-sm font-bold text-accent"
          >
            Back to today
          </Link>
        ) : null}
      </form>

      {requests.length === 0 ? (
        <p className="rounded-sheet border border-dashed border-line px-5 py-10 text-center text-muted">
          {dayLabel
            ? `No requests on ${dayLabel}.`
            : "No requests today. They appear here on days that need approval, as students send them."}
        </p>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {requests.map((r) => (
            <RequestCard key={r.id} request={r} past={day !== null} />
          ))}
        </div>
      )}
    </section>
  );
}
