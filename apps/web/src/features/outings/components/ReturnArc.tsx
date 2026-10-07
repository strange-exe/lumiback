"use client";

import { useEffect, useState, type ReactNode } from "react";

import { Lantern } from "@/components/illustrations/Lantern";
import { formatTime, progress } from "@/features/outings/time";

interface ReturnArcProps {
  leftAt: string;
  expectedAt: string;
  overdue: boolean;
  /** The server's clock at render time, so the first client render matches the HTML. */
  serverNow: string;
}

// Semicircle from (20,130) to (240,130), radius 110, centre (130,130).
const R = 110;
const CX = 130;
const CY = 130;

function pointAt(fraction: number): { x: number; y: number } {
  const angle = Math.PI * (1 - fraction); // 180deg (left) -> 0deg (right)
  return { x: CX + R * Math.cos(angle), y: CY - R * Math.sin(angle) };
}

/**
 * The signature element: an arc from when you left to when you're due back, with the lantern
 * travelling along it. Advances once a minute; overdue turns the whole arc red.
 */
export function ReturnArc({ leftAt, expectedAt, overdue, serverNow }: ReturnArcProps): ReactNode {
  const [now, setNow] = useState(() => new Date(serverNow));
  useEffect(() => {
    // Catch up right after hydration, then tick once a minute.
    const catchUp = setTimeout(() => setNow(new Date()), 0);
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => {
      clearTimeout(catchUp);
      clearInterval(timer);
    };
  }, []);

  const done = overdue ? 1 : progress(leftAt, expectedAt, now);
  const lantern = pointAt(done);
  const travelled = done > 0.001 ? `M20 130 A${R} ${R} 0 0 1 ${lantern.x} ${lantern.y}` : "";
  const percent = Math.round(done * 100);

  return (
    <figure className="relative mx-auto w-full max-w-[22rem] md:max-w-[28rem]">
      <svg
        viewBox="0 0 260 150"
        className="w-full overflow-visible"
        role="img"
        aria-label={`Left at ${formatTime(leftAt)}, due back at ${formatTime(expectedAt)}. ${
          overdue ? "Past your return time." : `${percent}% of the planned time has passed.`
        }`}
      >
        <path
          d={`M20 130 A${R} ${R} 0 0 1 240 130`}
          fill="none"
          stroke="var(--line)"
          strokeWidth="10"
          strokeLinecap="round"
        />
        {travelled && (
          <path
            d={travelled}
            fill="none"
            stroke={overdue ? "var(--danger)" : "var(--accent)"}
            strokeWidth="10"
            strokeLinecap="round"
          />
        )}
        <text x="20" y="149" textAnchor="middle" className="fill-muted font-display text-[12px]">
          {formatTime(leftAt)}
        </text>
        <text x="240" y="149" textAnchor="middle" className="fill-muted font-display text-[12px]">
          {formatTime(expectedAt)}
        </text>
      </svg>
      <Lantern
        lit
        className="pointer-events-none absolute h-16 w-12 -translate-x-1/2 -translate-y-[78%]"
        style={{ left: `${(lantern.x / 260) * 100}%`, top: `${(lantern.y / 150) * 100}%` }}
      />
    </figure>
  );
}
