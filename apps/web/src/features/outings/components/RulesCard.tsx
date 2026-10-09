import type { ReactNode } from "react";

import { formatMinutes, formatTime } from "@/features/outings/time";
import type { TodayRules } from "@/lib/types";

/** In the no-form part of a form day (e.g. boys' Sunday evenings): no form, no maximum. */
export function isFreeNow(rules: TodayRules, now: Date): boolean {
  return (
    rules.needs_form && !!rules.no_form_from && now.getTime() >= Date.parse(rules.no_form_from)
  );
}

/** "Back by 8:00 PM" or "Up to 3 h, back by 8:00 PM at the latest". Clock-free, so it can be
 * rendered on the server without disagreeing with the browser. */
export function dueText(rules: TodayRules, free = false): string {
  return rules.max_minutes && !free
    ? `Up to ${formatMinutes(rules.max_minutes)}, back by ${formatTime(rules.return_by)} at the latest`
    : `Back by ${formatTime(rules.return_by)}`;
}

/** Today's outing rules from the student's hostel (or the default until they pick one).
 * `free`: the page decided it's the no-form part of the day (see isFreeNow). */
export function RulesCard({
  rules,
  free = false,
}: {
  rules: TodayRules;
  free?: boolean;
}): ReactNode {
  const evening = rules.needs_form && rules.no_form_from ? formatTime(rules.no_form_from) : null;
  const form = !rules.needs_form
    ? ""
    : free
      ? ` No form needed from ${evening}.`
      : ` Needs the hostel office's OK first.${evening ? ` From ${evening}, no form is needed.` : ""}`;
  return (
    <div
      aria-labelledby="rules-heading"
      role="region"
      className="flex flex-col gap-1 rounded-sheet border border-line bg-surface px-5 py-4"
    >
      <h2 id="rules-heading" className="font-bold text-ink">
        {rules.label} outings: {formatTime(rules.opens_at)}–{formatTime(rules.return_by)}
      </h2>
      <p className="text-sm text-muted">
        {dueText(rules, free)}.{form} Coming back later is recorded as late.
      </p>
      <p className="text-sm text-muted">
        {rules.hostel
          ? `Rules for ${rules.hostel}.`
          : "Choose your hostel in Account to get its rules."}
      </p>
    </div>
  );
}
