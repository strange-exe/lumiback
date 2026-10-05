"use client";

import { useState, type ReactNode } from "react";

import { expectedReturn, formatTime } from "@/features/outings/time";

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
  const preview = expectedReturn(quick === "custom" ? time : quick);

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-1 text-sm font-bold text-ink">{legend}</legend>
      <div className="grid grid-cols-4 gap-2">
        {QUICK.map((option) => (
          <label
            key={option.value}
            className="flex min-h-14 cursor-pointer items-center justify-center rounded-control border border-line bg-surface px-2 text-center text-sm font-bold text-ink transition has-[:checked]:border-pine has-[:checked]:bg-pine has-[:checked]:text-on-pine has-[:focus-visible]:outline has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-lantern"
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
            className="min-h-12 rounded-control border border-line bg-surface px-4 text-base text-ink focus:border-pine focus:outline-none"
          />
        </label>
      )}
      <p className="text-sm text-stone" aria-live="polite">
        {preview ? (
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
