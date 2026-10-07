import type { ReactNode } from "react";

import { formatDay, formatMinutes, formatTime } from "@/features/outings/time";
import type { Outing } from "@/lib/types";

function Outcome({ outing }: { outing: Outing }): ReactNode {
  if (outing.status !== "returned") {
    const overdue = outing.status === "overdue";
    return (
      <span className={overdue ? "text-danger" : "text-ink"}>
        <span aria-hidden="true" className={overdue ? undefined : "text-accent"}>
          ●{" "}
        </span>
        {overdue ? "Overdue" : "Out now"}
      </span>
    );
  }
  const late = outing.late_minutes > 0;
  return (
    <span className={late ? "text-danger" : "text-good"}>
      <span aria-hidden="true">{late ? "◐ " : "○ "}</span>
      {late ? `${formatMinutes(outing.late_minutes)} late` : "On time"}
    </span>
  );
}

/** Group consecutive outings by their IST day (items arrive newest first). */
function byDay(items: Outing[]): { day: string; iso: string; outings: Outing[] }[] {
  const groups: { day: string; iso: string; outings: Outing[] }[] = [];
  for (const outing of items) {
    const day = formatDay(outing.left_at);
    const last = groups.at(-1);
    if (last && last.day === day) last.outings.push(outing);
    else groups.push({ day, iso: outing.left_at, outings: [outing] });
  }
  return groups;
}

/** A dated ledger, not a stack of cards: each day once on the left, its trips on the right. */
export function HistoryLedger({ items }: { items: Outing[] }): ReactNode {
  return (
    <div className="border-t border-line">
      {byDay(items).map((group) => (
        <section
          key={group.iso}
          aria-label={group.day}
          className="grid grid-cols-[5.5rem_1fr] gap-x-4 border-b border-line py-4"
        >
          <h2 className="pt-0.5 font-display text-base text-muted">
            <time dateTime={group.iso}>{group.day}</time>
          </h2>
          <ol className="flex flex-col gap-4">
            {group.outings.map((outing) => (
              <li key={outing.id} className="flex min-w-0 flex-col gap-0.5">
                <p className="truncate font-bold text-ink">{outing.destination ?? "Outing"}</p>
                <p className="font-display text-sm tabular-nums text-muted">
                  {formatTime(outing.left_at)} →{" "}
                  {outing.returned_at ? formatTime(outing.returned_at) : "…"}
                  {outing.duration_minutes !== null &&
                    ` · ${formatMinutes(outing.duration_minutes)}`}
                </p>
                <p className="flex flex-wrap gap-x-3 text-sm font-bold">
                  <Outcome outing={outing} />
                  <span className="font-normal text-muted">
                    {outing.out_via === "gate" ? "Verified at gate" : "Self-reported"}
                  </span>
                </p>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  );
}
