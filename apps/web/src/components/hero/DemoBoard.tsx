"use client";

import { useEffect, useState, type ReactNode } from "react";

import { countdown } from "@/components/led/led";
import { BoardFact, LedBoard, LedStage } from "@/components/led/LedBoard";
import { LedFigure } from "@/components/led/LedFigure";

const START = 72; // minutes: "1:12 h"
const END = 58;
const STEP_MS = 3_000;

/**
 * The landing hero: a large LED board running an example countdown, one minute every few
 * seconds, so visitors see the board at work. Labelled as an example; with reduced motion it
 * holds still. The caption gives screen readers the same example in words.
 */
export function DemoBoard({ className = "" }: { className?: string }): ReactNode {
  const [minutes, setMinutes] = useState(START);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => setMinutes((m) => (m <= END ? START : m - 1)), STEP_MS);
    return () => window.clearInterval(timer);
  }, []);

  const left = countdown(minutes * 60_000);
  return (
    <figure className={className}>
      <figcaption className="sr-only">
        An example of the status board a student sees while out: time left until they&apos;re due
        back at 9:30 PM, after tapping out at the main gate at 8:18 PM, while sharing their location
        with two people.
      </figcaption>
      <LedStage>
        <LedBoard
          className="sm:p-8"
          ticker="Sharing your location with Ananya and Dad until you're back"
        >
          <div className="flex items-center justify-between gap-4 text-sm text-board-muted">
            <span>Time left</span>
            <span className="rounded-full px-2.5 py-0.5 ring-1 ring-board-line">Example</span>
          </div>
          <LedFigure
            text={left.text}
            unit={left.unit}
            label={`Example: ${left.label}`}
            className="py-2 text-[clamp(4.5rem,22vw,8.5rem)] md:text-[clamp(5rem,10vw,8.5rem)]"
          />
          <dl className="grid grid-cols-2 gap-4 border-t border-board-line pt-3">
            <BoardFact term="Left" value="Main Gate, 8:18 PM" />
            <BoardFact term="Back by" value="9:30 PM" />
          </dl>
        </LedBoard>
      </LedStage>
    </figure>
  );
}
