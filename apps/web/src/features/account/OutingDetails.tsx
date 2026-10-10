"use client";

import { useActionState, type ReactNode } from "react";

import { Field } from "@/components/ui/Field";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { formatPhone } from "@/features/admin/format";
import { saveContacts, saveHostel } from "@/features/outings/actions";
import type { FormState, HostelChoice, Profile } from "@/lib/types";

const INITIAL: FormState = { error: null };

/** Hostels grouped by the rule set they follow, in the order the API sorts them. */
function groupBy(hostels: HostelChoice[]): [string, HostelChoice[]][] {
  const groups = new Map<string, HostelChoice[]>();
  for (const h of hostels) groups.set(h.rule_set, [...(groups.get(h.rule_set) ?? []), h]);
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function Notice({ state }: { state: FormState }): ReactNode {
  return (
    <p aria-live="polite" className="text-sm">
      {state.error ? (
        <span className="font-bold text-danger">{state.error}</span>
      ) : (
        <span className="text-good">{state.notice ?? ""}</span>
      )}
    </p>
  );
}

/** The hostel (it decides the outing rules) and contacts for when a student is late. */
export function OutingDetails({
  profile,
  hostels,
}: {
  profile: Profile;
  hostels: HostelChoice[];
}): ReactNode {
  const [hostelState, hostelAction] = useActionState(saveHostel, INITIAL);
  const [contactState, contactAction] = useActionState(saveContacts, INITIAL);
  const saved = (name: keyof Profile): string => {
    const v = profile[name] ?? "";
    return name.endsWith("phone") && v ? formatPhone(v) : v;
  };
  const value = (name: keyof Profile): string => contactState.fields?.[name] ?? saved(name);
  return (
    <section aria-labelledby="outing-details-heading" className="flex flex-col gap-5">
      <div className="flex flex-col gap-1">
        <h2 id="outing-details-heading" className="font-display text-xl text-ink">
          Hostel and contacts
        </h2>
        <p className="text-sm text-muted">
          Your hostel decides your outing hours and how long outings can be on days that need
          approval. If you&apos;re late and don&apos;t answer, the hostel office may call you or
          your emergency contact.
        </p>
      </div>

      <form
        action={hostelAction}
        className="flex flex-col gap-3 rounded-sheet border border-line bg-surface p-5"
      >
        <label className="flex flex-col gap-1.5 text-sm font-bold text-ink">
          Hostel
          <select
            name="hostel_id"
            defaultValue={profile.hostel_id ?? ""}
            className="min-h-12 rounded-control border border-line bg-page px-3 font-normal text-ink focus:border-accent focus:outline-none"
          >
            <option value="">Choose your hostel</option>
            {/* Grouped by the rules they follow: "Boys' hostels", "Girls' hostels". */}
            {groupBy(hostels).map(([group, list]) => (
              <optgroup key={group} label={group}>
                {list.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton variant="secondary" pendingLabel="Saving…">
            Save hostel
          </SubmitButton>
          <Notice state={hostelState} />
        </div>
      </form>

      <form
        action={contactAction}
        className="flex flex-col gap-4 rounded-sheet border border-line bg-surface p-5"
      >
        <Field
          label="Your phone number"
          name="phone"
          id="account-phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          maxLength={24}
          defaultValue={value("phone")}
        />
        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label="Emergency contact"
            name="emergency_name"
            id="account-emergency-name"
            maxLength={80}
            defaultValue={value("emergency_name")}
          />
          <Field
            label="Relation"
            name="emergency_relation"
            id="account-emergency-relation"
            maxLength={40}
            placeholder="Mother"
            defaultValue={value("emergency_relation")}
          />
          <Field
            label="Their phone"
            name="emergency_phone"
            id="account-emergency-phone"
            type="tel"
            inputMode="tel"
            maxLength={24}
            defaultValue={value("emergency_phone")}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton variant="secondary" pendingLabel="Saving…">
            Save contacts
          </SubmitButton>
          <Notice state={contactState} />
        </div>
      </form>
    </section>
  );
}
