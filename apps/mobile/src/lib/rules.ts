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
    };
  }
  if (nowMs >= returnBy) {
    return {
      title: "Outings are over for today",
      detail: `${rules.label} hours: ${window}`,
      urgent: false,
      open: false,
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
  if (rules.max_minutes && !isFreeAt(rules, nowMs)) {
    const minutes = Math.min(rules.max_minutes, requestedMinutes ?? rules.max_minutes);
    latest = Math.min(latest, nowMs + minutes * 60_000);
  }
  return new Date(latest);
}
