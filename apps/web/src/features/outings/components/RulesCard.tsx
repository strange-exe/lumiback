import type { ReactNode } from "react";

import { formatMinutes, formatTime } from "@/features/outings/time";
import type { TodayRules } from "@/lib/types";

/** "Back by 8:00 PM" or "Up to 3 h, back by 8:00 PM at the latest". Clock-free, so it can be
 * rendered on the server without disagreeing with the browser. */
export function dueText(rules: TodayRules): string {
  return rules.max_minutes
    ? `Up to ${formatMinutes(rules.max_minutes)}, back by ${formatTime(rules.return_by)} at the latest`
    : `Back by ${formatTime(rules.return_by)}`;
}

/** Today's outing rules from the student's hostel (or the default until they pick one). */
export function RulesCard({ rules }: { rules: TodayRules }): ReactNode {
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
        {dueText(rules)}.{rules.needs_form ? " Needs the hostel office's OK first." : ""} Coming
        back later is recorded as late.
      </p>
      <p className="text-sm text-muted">
        {rules.hostel
          ? `Rules for ${rules.hostel}.`
          : "Choose your hostel in Account to get its rules."}
      </p>
    </div>
  );
}
