import type { ReactNode } from "react";

import { LateReply, ReturnButton } from "@/features/outings/components/OutingControls";
import { ReturnArc } from "@/features/outings/components/ReturnArc";
import { clockParts, formatMinutes } from "@/features/outings/time";
import type { Outing } from "@/lib/types";

/** Shown while the student is out: where, the return arc, when they're due, and "I'm back". */
export function OutView({ outing, serverNow }: { outing: Outing; serverNow: string }): ReactNode {
  const overdue = outing.status === "overdue";
  const due = clockParts(outing.expected_return_at);

  return (
    <section aria-labelledby="out-heading" className="flex flex-col gap-6">
      <div>
        <p className="font-display text-lg text-muted">
          {overdue ? "Still out at" : "You're out at"}
        </p>
        <h1 id="out-heading" className="font-display text-title text-accent">
          {outing.destination ?? "Your outing"}
        </h1>
      </div>

      <ReturnArc
        leftAt={outing.left_at}
        expectedAt={outing.expected_return_at}
        overdue={overdue}
        serverNow={serverNow}
      />

      <div className="text-center">
        <p className="text-sm text-muted">Back by</p>
        <p className="font-display text-hero tabular-nums text-ink md:text-[3.8rem]">
          {due.time} <span className="text-2xl">{due.period}</span>
        </p>
        {overdue && (
          <p
            role="status"
            className="mx-auto mt-3 max-w-xs rounded-control bg-danger-soft px-4 py-3 text-danger"
          >
            You&apos;re {formatMinutes(outing.late_minutes)} late.
          </p>
        )}
      </div>

      {overdue ? (
        outing.late_reply ? (
          <p role="status" className="rounded-control bg-accent-soft px-4 py-3 text-ink">
            Thanks. You said you&apos;re {outing.late_reply === "safe" ? "safe" : "on your way"};
            the hostel office can see your answer.
          </p>
        ) : (
          <LateReply />
        )
      ) : null}
      <ReturnButton />
    </section>
  );
}
