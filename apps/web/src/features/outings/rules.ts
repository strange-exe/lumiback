import type { TodayRules } from "../../lib/types.ts";
import { formatMinutes, formatTime } from "./time.ts";

/**
 * Today's rules, worked out against a given clock. The server decides (backend
 * services/rules.py); these only explain and preview. Pages pass the server's request time, so
 * nothing here reads the clock and server and browser HTML always agree.
 */

/** Outings haven't opened yet ("before"), are over for today ("after"), or are open (null). */
export function closedAt(rules: TodayRules, nowMs: number): "before" | "after" | null {
  if (nowMs < Date.parse(rules.opens_at)) return "before";
  if (nowMs >= Date.parse(rules.return_by)) return "after";
  return null;
}

/** One choice on the request form; `minutes` null is the day's full allowance. */
export interface LengthOption {
  minutes: number | null;
  label: string;
}

/**
 * "How long" on the request form, like the app: the full allowance first (the default), then
 * every whole hour shorter than it. The allowance is the day's maximum, capped by the time left
 * before the return time (counted from opening time when asking early); without a maximum, the
 * time left. A request can only shorten an outing, never lengthen it.
 */
export function lengthOptions(rules: TodayRules, nowMs: number): LengthOption[] {
  const start = Math.max(nowMs, Date.parse(rules.opens_at));
  const left = Math.max(0, Math.floor((Date.parse(rules.return_by) - start) / 60_000));
  const cap = rules.max_minutes ? Math.min(rules.max_minutes, left) : left;
  const full: LengthOption = {
    minutes: null,
    label: rules.max_minutes
      ? `Up to ${formatMinutes(rules.max_minutes)}`
      : `Until ${formatTime(rules.return_by)}`,
  };
  const shorter: LengthOption[] = [];
  for (let h = 1; h * 60 < cap; h++) {
    shorter.push({ minutes: h * 60, label: formatMinutes(h * 60) });
  }
  return [full, ...shorter];
}

/**
 * When an approved student is due back, in words that stay true whenever they leave:
 * "2 h after you leave, by 8:00 PM at the latest" or "by 8:00 PM".
 */
export function approvedDue(rules: TodayRules, requestedMinutes: number | null): string {
  const latest = formatTime(rules.return_by);
  const minutes =
    rules.max_minutes && requestedMinutes
      ? Math.min(rules.max_minutes, requestedMinutes)
      : (rules.max_minutes ?? requestedMinutes);
  return minutes
    ? `${formatMinutes(minutes)} after you leave, by ${latest} at the latest`
    : `by ${latest}`;
}
