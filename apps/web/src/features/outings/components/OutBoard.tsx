"use client";

import { useEffect, useState, type ReactNode } from "react";

import { countdown } from "@/components/led/led";
import { BoardFact, LedBoard } from "@/components/led/LedBoard";
import { LedFigure } from "@/components/led/LedFigure";

/**
 * The student's status board while out: time left to the return time (orange), or how late
 * they are (red), ticking in place. Times arrive formatted by the server (IST).
 */
export function OutBoard({
  dueAt,
  serverNow,
  leftLabel,
  dueLabel,
  via,
  ticker,
}: {
  /** ISO, the return time. */
  dueAt: string;
  /** The server's clock at render time, so the first client render matches the HTML. */
  serverNow: string;
  leftLabel: string;
  dueLabel: string;
  via: string;
  /** Decorative; the same facts must be on the page as text. */
  ticker?: string | null;
}): ReactNode {
  const [now, setNow] = useState(() => Date.parse(serverNow));
  useEffect(() => {
    // Catch up right after hydration, then tick; minutes change in place.
    const tick = (): void => setNow(Date.now());
    const first = window.setTimeout(tick, 0);
    const timer = window.setInterval(tick, 1_000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, []);

  const left = countdown(Date.parse(dueAt) - now);
  return (
    <LedBoard ticker={ticker}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-sm text-board-muted">
        <span>{left.state === "late" ? "Past your return time" : "Time left"}</span>
        <span>{via}</span>
      </div>
      <LedFigure
        text={left.text}
        unit={left.unit}
        label={left.label}
        state={left.state}
        className="py-1 text-[clamp(4.25rem,22vw,6.5rem)]"
      />
      <dl className="grid grid-cols-2 gap-4 border-t border-board-line pt-3">
        <BoardFact term="Left" value={leftLabel} />
        <BoardFact term="Back by" value={dueLabel} />
      </dl>
    </LedBoard>
  );
}
