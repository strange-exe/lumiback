import type { Metadata } from "next";
import type { ReactNode } from "react";

import { adminApi } from "@/features/admin/api";
import {
  HolidayRow,
  HostelForm,
  NewHolidayForm,
  NewRuleSetForm,
  RuleSetForm,
} from "@/features/admin/components/RuleForms";
import { istToday } from "@/features/admin/format";
import { requireAdmin } from "@/lib/session";

export const metadata: Metadata = { title: "Outing rules" };

export default async function RulesPage(): Promise<ReactNode> {
  const { token } = await requireAdmin();
  const today = istToday();
  const year = Number(today.slice(0, 4));
  const [sets, hostels, thisYear, nextYear] = await Promise.all([
    adminApi.ruleSets(token),
    adminApi.hostels(token),
    adminApi.holidays(token, year),
    adminApi.holidays(token, year + 1),
  ]);
  const upcoming = [...thisYear, ...nextYear].filter((h) => h.day >= today);

  return (
    <div className="flex flex-col gap-12">
      <section aria-labelledby="rules-heading" className="flex flex-col gap-5">
        <div className="flex flex-col gap-1">
          <h1 id="rules-heading" className="font-display text-title text-ink">
            Outing rules
          </h1>
          <p className="max-w-[65ch] text-muted">
            Each hostel follows a set of rules: when students may go out, when they must be back,
            and on which days they need an approved form. The app and the gates apply them; return
            times can&apos;t be extended once a student is out.
          </p>
        </div>
        {sets.map((set) => (
          <RuleSetForm key={set.id} ruleSet={set} />
        ))}
        <NewRuleSetForm sets={sets} />
      </section>

      <section aria-labelledby="hostels-heading" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="hostels-heading" className="font-display text-xl text-ink">
            Hostels
          </h2>
          <p className="max-w-[65ch] text-sm text-muted">
            Students choose their hostel from a list grouped like this. The warden&apos;s number is
            shown when a late student doesn&apos;t answer.
          </p>
        </div>
        {sets.map((set) => {
          const inSet = hostels.filter((h) => h.rule_set_id === set.id);
          return (
            <div
              key={set.id}
              role="group"
              aria-labelledby={`hostels-${set.id}`}
              className="flex flex-col gap-1"
            >
              <h3 id={`hostels-${set.id}`} className="mt-3 font-bold text-ink">
                {set.name}{" "}
                <span className="font-normal text-muted">
                  · {inSet.length} {inSet.length === 1 ? "hostel" : "hostels"}
                </span>
              </h3>
              <div className="flex flex-col divide-y divide-line border-y border-line">
                {inSet.map((h) => (
                  <HostelForm key={h.id} hostel={h} sets={sets} />
                ))}
                <HostelForm sets={sets} group={set.id} />
              </div>
            </div>
          );
        })}
      </section>

      <section aria-labelledby="holidays-heading" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 id="holidays-heading" className="font-display text-xl text-ink">
            Holidays
          </h2>
          <p className="max-w-[65ch] text-sm text-muted">
            On these dates the holiday rules apply instead of the weekday or weekend ones.
          </p>
        </div>
        {upcoming.length ? (
          <ul className="flex flex-col divide-y divide-line border-y border-line">
            {upcoming.map((h) => (
              <HolidayRow key={h.day} holiday={h} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No upcoming holidays.</p>
        )}
        <NewHolidayForm today={today} />
      </section>
    </div>
  );
}
