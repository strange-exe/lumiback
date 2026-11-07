import Link from "next/link";
import type { ReactNode } from "react";

import { LedStage } from "@/components/led/LedBoard";
import { OutBoard } from "@/features/outings/components/OutBoard";
import { LateReply, ReturnButton } from "@/features/outings/components/OutingControls";
import { SafeReturnNote, type SafeReturnState } from "@/features/outings/components/SafeReturnNote";
import { formatMinutes, formatTime } from "@/features/outings/time";
import type { Outing } from "@/lib/types";

/** Shown while the student is out: where, the status board, when they're due, and "I'm back". */
export function OutView({
  outing,
  serverNow,
  safeReturn = "off",
}: {
  outing: Outing;
  serverNow: string;
  safeReturn?: SafeReturnState;
}): ReactNode {
  const overdue = outing.status === "overdue";

  return (
    <section aria-labelledby="out-heading" className="flex flex-col gap-6">
      <div>
        <p className="font-display text-lg text-muted">
          {overdue ? "Still out at" : "You're out at"}
        </p>
        <h1 id="out-heading" className="font-display text-title text-ink">
          {outing.destination ?? "Your outing"}
        </h1>
      </div>

      <LedStage>
        <OutBoard
          dueAt={outing.expected_return_at}
          serverNow={serverNow}
          leftLabel={formatTime(outing.left_at)}
          dueLabel={formatTime(outing.expected_return_at)}
          via={outing.out_via === "gate" ? "Tapped out at a gate" : "Checked out in the app"}
          ticker={
            safeReturn === "live" ? "Your emergency contact can follow you until you're back" : null
          }
        />
      </LedStage>

      {overdue && (
        <p role="status" className="rounded-control bg-danger-soft px-4 py-3 text-danger">
          You&apos;re {formatMinutes(outing.late_minutes)} late.
        </p>
      )}

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
      <SafeReturnNote sessionId={outing.safe_return_session_id ?? null} state={safeReturn} />
      <ReturnButton />
      {outing.correction?.status === "pending" ? (
        <p className="text-center text-sm text-muted">
          You asked the hostel office to correct this outing. Waiting for their answer.
        </p>
      ) : (
        <Link
          href={`/history?fix=${encodeURIComponent(outing.id)}#outing-${encodeURIComponent(outing.id)}`}
          className="flex min-h-11 items-center justify-center self-center px-2 text-sm font-bold text-accent underline-offset-4 hover:underline"
        >
          Forgot to tap in?
        </Link>
      )}
    </section>
  );
}
