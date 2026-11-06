import type { ReactNode } from "react";

import { AskCorrection } from "@/features/outings/components/AskCorrection";
import { canAsk, correctionLine, inViaLabel, isCancelled } from "@/features/outings/corrections";
import { formatDay, formatMinutes, formatTime } from "@/features/outings/time";
import type { Outing } from "@/lib/types";

function Outcome({ outing }: { outing: Outing }): ReactNode {
  if (isCancelled(outing)) return <span className="text-muted">Cancelled</span>;
  if (outing.status !== "returned") {
    const overdue = outing.status === "overdue";
    return (
      <span className={overdue ? "text-danger" : "text-ink"}>
        <span aria-hidden="true" className={overdue ? undefined : "text-accent"}>
          ●{" "}
        </span>
        {overdue ? "Late" : "Out now"}
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

/** Left, back and how long; a cancelled trip has no return, an unrecorded one no known time. */
function Times({ outing }: { outing: Outing }): ReactNode {
  if (isCancelled(outing)) return <>Left {formatTime(outing.left_at)}</>;
  let back = "…";
  if (outing.in_via === "unrecorded") back = "time not recorded";
  else if (outing.returned_at) back = formatTime(outing.returned_at);
  return (
    <>
      {formatTime(outing.left_at)} → {back}
      {outing.duration_minutes !== null &&
        outing.in_via !== "unrecorded" &&
        ` · ${formatMinutes(outing.duration_minutes)}`}
    </>
  );
}

/** The latest correction, in words (never colour alone): waiting, corrected or not changed. */
function CorrectionStatus({ outing }: { outing: Outing }): ReactNode {
  const line = outing.correction ? correctionLine(outing.correction, outing.left_at) : null;
  if (!line) return null;
  const tone = { waiting: "text-accent", done: "text-ink", refused: "text-danger" }[line.tone];
  return (
    <div className="flex flex-col gap-0.5 text-sm">
      <p className={`font-bold ${tone}`}>
        {line.label}
        {line.was ? (
          <span className="font-normal text-muted">
            {" "}
            · was <del>{line.was}</del>
          </span>
        ) : null}
      </p>
      {line.detail ? <p className="break-words text-muted">{line.detail}</p> : null}
    </div>
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
export function HistoryLedger({
  items,
  nowIso,
  openId,
}: {
  items: Outing[];
  /** The server's request time: decides which outings can still be asked about. */
  nowIso: string;
  /** The outing whose "Something wrong?" starts open (from Today's "Forgot to tap in?"). */
  openId?: string;
}): ReactNode {
  const now = Date.parse(nowIso);
  return (
    <div className="border-t border-line">
      {byDay(items).map((group) => (
        <section
          key={group.iso}
          aria-label={group.day}
          className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-4 border-b border-line py-4"
        >
          <h2 className="pt-0.5 font-display text-base text-muted">
            <time dateTime={group.iso}>{group.day}</time>
          </h2>
          <ol className="flex flex-col gap-4">
            {group.outings.map((outing) => {
              // An office correction already says how the return was recorded.
              const via =
                outing.correction?.status === "approved" ? null : inViaLabel(outing.in_via);
              return (
                <li
                  key={outing.id}
                  id={`outing-${outing.id}`}
                  className="flex min-w-0 scroll-mt-24 flex-col gap-0.5"
                >
                  <p className="truncate font-bold text-ink">{outing.destination ?? "Outing"}</p>
                  <p className="font-display text-sm tabular-nums text-muted">
                    <Times outing={outing} />
                  </p>
                  <p className="flex flex-wrap gap-x-3 text-sm font-bold">
                    <Outcome outing={outing} />
                    <span className="font-normal text-muted">
                      {outing.out_via === "gate" ? "Verified at gate" : "Self-reported"}
                    </span>
                    {via ? <span className="font-normal text-muted">{via}</span> : null}
                  </p>
                  <CorrectionStatus outing={outing} />
                  {canAsk(outing, now) ? (
                    <AskCorrection outing={outing} nowIso={nowIso} open={outing.id === openId} />
                  ) : null}
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
