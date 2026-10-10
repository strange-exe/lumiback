import { formatMinutes, formatTime } from "@/lib/time";
import type { TodayRules } from "@/lib/types";

/**
 * Today's outing rules, in words. The server decides (backend/app/services/rules.py); this only
 * explains, and previews the return time the server will set.
 */
export interface RulesLine {
  title: string;
  detail: string;
  /** Under an hour until outings close: worth a second look. */
  urgent: boolean;
  /** Can a student tap out right now (ignoring the form)? */
  open: boolean;
  /** When not open: outings haven't started yet ("before") or are over for today ("after"). */
  closed?: "before" | "after";
}

const hours = (minutes: number): string => formatMinutes(minutes);

/** In the no-form part of a form day (e.g. boys' Sunday evenings): no form, no maximum. */
export function isFreeAt(rules: TodayRules, nowMs: number): boolean {
  return rules.needs_form && !!rules.no_form_from && nowMs >= Date.parse(rules.no_form_from);
}

/** Does tapping out right now need an approved form? */
export function formNeededAt(rules: TodayRules, nowMs: number): boolean {
  return rules.needs_form && !isFreeAt(rules, nowMs);
}

export function rulesLine(rules: TodayRules, nowMs: number): RulesLine {
  const opens = Date.parse(rules.opens_at);
  const returnBy = Date.parse(rules.return_by);
  const window = `${formatTime(rules.opens_at)}–${formatTime(rules.return_by)}`;
  const free = isFreeAt(rules, nowMs);
  const form = free
    ? "No form needed now"
    : !rules.needs_form
      ? null
      : rules.no_form_from
        ? `Needs an approved form until ${formatTime(rules.no_form_from)}`
        : "Needs an approved form";
  if (nowMs < opens) {
    return {
      title: `${rules.label} outings ${window}`,
      detail: [`Opens in ${formatMinutes(Math.ceil((opens - nowMs) / 60_000))}`, form]
        .filter(Boolean)
        .join(" · "),
      urgent: false,
      open: false,
      closed: "before",
    };
  }
  if (nowMs >= returnBy) {
    return {
      title: "Outings are over for today",
      detail: `${rules.label} hours: ${window}`,
      urgent: false,
      open: false,
      closed: "after",
    };
  }
  const left = Math.ceil((returnBy - nowMs) / 60_000);
  return {
    title:
      rules.max_minutes && !free
        ? `Up to ${hours(rules.max_minutes)}, back by ${formatTime(rules.return_by)}`
        : `Back by ${formatTime(rules.return_by)}`,
    detail: [`Outings close in ${formatMinutes(left)}`, form].filter(Boolean).join(" · "),
    urgent: left <= 60,
    open: true,
  };
}

/** The return time the server will set for a tap-out now (a preview; the server decides). */
export function plannedReturn(
  rules: TodayRules,
  nowMs: number,
  { requestedMinutes }: { requestedMinutes?: number | null } = {},
): Date {
  let latest = Date.parse(rules.return_by);
  if (!isFreeAt(rules, nowMs)) {
    // The tighter of the day's maximum and a shorter length asked for (either may be absent),
    // matching the server's return_time.
    const caps = [rules.max_minutes, requestedMinutes].filter((m): m is number => !!m);
    if (caps.length) latest = Math.min(latest, nowMs + Math.min(...caps) * 60_000);
  }
  return new Date(latest);
}

/** Can today's outing still be asked for? Needs a form now, and outings aren't over yet. */
export function canAskAt(rules: TodayRules, nowMs: number): boolean {
  return formNeededAt(rules, nowMs) && nowMs < Date.parse(rules.return_by);
}

/**
 * The no-form evening still ahead on a form day (e.g. boys' Sundays from 6 PM), or null. Lets
 * Today say "From 6:00 PM you can go out without one" once the day's approval is used.
 */
export function freeEveningAhead(rules: TodayRules, nowMs: number): string | null {
  if (!rules.needs_form || !rules.no_form_from) return null;
  const from = Date.parse(rules.no_form_from);
  return nowMs < from && from < Date.parse(rules.return_by) ? rules.no_form_from : null;
}

/** One choice on the request form: null is the day's full allowance. */
export interface LengthOption {
  minutes: number | null;
  label: string;
}

/**
 * "How long" on the request form: the full allowance first (the default), then every whole hour
 * shorter than it. The allowance is the day's maximum, capped by the time left before the return
 * time (counted from opening time when asking early); without a maximum, the time left.
 * A request can only shorten an outing, never lengthen it.
 */
export function lengthOptions(rules: TodayRules, nowMs: number): LengthOption[] {
  const start = Math.max(nowMs, Date.parse(rules.opens_at));
  const left = Math.max(0, Math.floor((Date.parse(rules.return_by) - start) / 60_000));
  const cap = rules.max_minutes ? Math.min(rules.max_minutes, left) : left;
  const full: LengthOption = {
    minutes: null,
    label: rules.max_minutes
      ? `Up to ${hours(rules.max_minutes)}`
      : `Until ${formatTime(rules.return_by)}`,
  };
  const shorter: LengthOption[] = [];
  for (let h = 1; h * 60 < cap; h++) shorter.push({ minutes: h * 60, label: hours(h * 60) });
  return [full, ...shorter];
}
