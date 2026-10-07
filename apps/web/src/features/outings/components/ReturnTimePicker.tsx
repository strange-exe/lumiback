"use client";

import { useState, type ReactNode } from "react";

import { expectedReturn, formatTime } from "@/features/outings/time";
import { useNow } from "@/lib/use-now";

const QUICK = [
  { value: "60", label: "+1 h" },
  { value: "120", label: "+2 h" },
  { value: "180", label: "+3 h" },
  { value: "custom", label: "Pick a time" },
] as const;

/** "Back by" chooser. Submits `quick` (minutes or "custom") and, for custom, `time` (HH:MM IST). */
export function ReturnTimePicker({ legend }: { legend: string }): ReactNode {
  const [quick, setQuick] = useState<string>("120");
  const [time, setTime] = useState("");
  // From the browser's clock after mount, never during server rendering: "+2 h" rendered at
  // 8:46:59 on the server and 8:47:00 in the browser would be a hydration mismatch.
  const now = useNow(15_000);
  const preview = now ? expectedReturn(quick === "custom" ? time : quick, new Date(now)) : null;

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-sm font-bold text-ink">{legend}</legend>
      <div className="grid grid-cols-4 gap-2">
        {QUICK.map((option) => (
          <label
            key={option.value}
            className="flex min-h-14 cursor-pointer items-center justify-center rounded-control border border-line bg-surface px-2 text-center text-sm font-bold text-ink transition has-[:checked]:border-accent has-[:checked]:bg-accent has-[:checked]:text-on-accent has-[:focus-visible]:outline has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent"
          >
            <input
              type="radio"
              name="quick"
              value={option.value}
              checked={quick === option.value}
              onChange={() => setQuick(option.value)}
              className="sr-only"
            />
            {option.label}
          </label>
        ))}
      </div>
      {quick === "custom" && (
        <label className="flex flex-col gap-1.5 text-sm font-bold text-ink">
          Time (IST)
          <input
            type="time"
            name="time"
            value={time}
            onChange={(event) => setTime(event.target.value)}
            required
            className="min-h-12 rounded-control border border-line bg-surface px-4 text-base text-ink focus:border-accent focus:outline-none"
          />
        </label>
      )}
      <p className="text-sm text-muted" aria-live="polite">
        {now === 0 ? (
          <span aria-hidden="true">&nbsp;</span>
        ) : preview ? (
          <>
            Back by{" "}
            <span className="font-display text-base tabular-nums text-ink">
              {formatTime(preview)}
            </span>
          </>
        ) : (
          "Choose a time"
        )}
      </p>
    </fieldset>
  );
}
