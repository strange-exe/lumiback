"use client";

import { useState, type ReactNode } from "react";

import type { DayRule, DayType } from "@/lib/types";

export const DAY_LABEL: Record<DayType, string> = {
  weekday: "Weekdays",
  saturday: "Saturday",
  sunday: "Sunday",
  holiday: "Holidays",
};

const input =
  "min-h-11 w-full rounded-control border border-line bg-page px-3 text-ink focus:border-accent focus:outline-none";

/** "18:00" -> "6:00 PM" (no clock involved, so server and browser agree). */
function clock(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** What students will see for this day, in words. Exported for tests. */
export function daySummary(d: {
  opens: string;
  back: string;
  needsForm: boolean;
  maxHours: string;
  noFormFrom: string;
}): string {
  if (!d.opens || !d.back) return "Set both times";
  if (d.back <= d.opens) return "“Back by” must be after “Outings from”";
  const parts = [`${clock(d.opens)}–${clock(d.back)}`];
  if (d.needsForm) {
    parts.push("needs approval");
    const hours = Number(d.maxHours);
    if (d.maxHours && hours > 0) parts.push(`up to ${hours} h`);
    if (d.noFormFrom) parts.push(`no form needed from ${clock(d.noFormFrom)}`);
  } else {
    parts.push("no form needed");
  }
  return parts.join(" · ");
}

/**
 * One day type of a rule set. The approval switch reveals the settings that only apply to
 * approved outings (maximum length, a no-form evening), so form-free days stay short.
 * Field names match daysFrom() in rules-actions.ts.
 */
export function DayRuleRow({ setId, rule }: { setId: string; rule: DayRule }): ReactNode {
  const day = rule.day_type;
  const label = DAY_LABEL[day];
  const [opens, setOpens] = useState(rule.opens_at);
  const [back, setBack] = useState(rule.return_by);
  const [needsForm, setNeedsForm] = useState(rule.needs_form);
  const [maxHours, setMaxHours] = useState(rule.max_minutes ? String(rule.max_minutes / 60) : "");
  const [noFormFrom, setNoFormFrom] = useState(rule.no_form_from ?? "");
  const summaryId = `${setId}-${day}-summary`;
  const summary = daySummary({ opens, back, needsForm, maxHours, noFormFrom });
  const invalid = summary.startsWith("“") || summary === "Set both times";

  return (
    <fieldset
      aria-describedby={summaryId}
      className="flex flex-col gap-3 border-t border-line py-4 first:border-t-0"
    >
      <legend className="sr-only">{label}</legend>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span aria-hidden="true" className="font-bold text-ink">
          {label}
        </span>
        <span
          id={summaryId}
          aria-live="polite"
          className={`text-sm ${invalid ? "font-bold text-danger" : "text-muted"}`}
        >
          {summary}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <label className="flex flex-col gap-1.5 text-sm text-muted">
          Outings from
          <input
            type="time"
            name={`${day}.opens_at`}
            value={opens}
            onChange={(e) => setOpens(e.target.value)}
            required
            aria-label={`${label}: outings from`}
            className={input}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm text-muted">
          Back by
          <input
            type="time"
            name={`${day}.return_by`}
            value={back}
            onChange={(e) => setBack(e.target.value)}
            required
            aria-label={`${label}: back by`}
            className={input}
          />
        </label>
        <label className="col-span-2 flex min-h-11 cursor-pointer items-center gap-3 self-end rounded-control border border-line bg-page px-3 text-sm font-bold text-ink has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent sm:col-span-1">
          <input
            type="checkbox"
            name={`${day}.needs_form`}
            checked={needsForm}
            onChange={(e) => setNeedsForm(e.target.checked)}
            aria-label={`${label}: needs a form approved by an admin`}
            className="size-5 accent-[var(--accent)]"
          />
          Needs approval
        </label>
      </div>
      {needsForm ? (
        <div className="grid grid-cols-2 gap-3 rounded-control bg-accent-soft/40 p-3 sm:grid-cols-[1fr_1fr_auto]">
          <label className="flex flex-col gap-1.5 text-sm text-muted">
            Longest outing (hours)
            <input
              type="number"
              name={`${day}.max_hours`}
              min={0.5}
              max={12}
              step={0.5}
              value={maxHours}
              onChange={(e) => setMaxHours(e.target.value)}
              placeholder="Until “Back by”"
              aria-label={`${label}: maximum hours (empty: until back-by)`}
              className={input}
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm text-muted">
            No form needed from
            <input
              type="time"
              name={`${day}.no_form_from`}
              value={noFormFrom}
              onChange={(e) => setNoFormFrom(e.target.value)}
              aria-label={`${label}: no form needed from (empty: always needed)`}
              className={input}
            />
          </label>
          <p className="col-span-2 self-center text-xs text-muted sm:col-span-1 sm:max-w-[16ch]">
            Leave empty if not needed.
          </p>
        </div>
      ) : null}
    </fieldset>
  );
}
