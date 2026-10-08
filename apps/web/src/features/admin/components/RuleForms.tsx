"use client";

import { useActionState, type ReactNode } from "react";

import { Field, FormError } from "@/components/ui/Field";
import { SubmitButton } from "@/components/ui/SubmitButton";
import {
  addHoliday,
  createRuleSet,
  deleteHoliday,
  deleteHostel,
  deleteRuleSet,
  makeDefaultRuleSet,
  saveHostel,
  saveRuleSet,
} from "@/features/admin/rules-actions";
import type { DayType, FormState, Holiday, Hostel, RuleSet } from "@/lib/types";

const EMPTY: FormState = { error: null };

const DAY_LABEL: Record<DayType, string> = {
  weekday: "Weekdays",
  saturday: "Saturday",
  sunday: "Sunday",
  holiday: "Holidays",
};

const input =
  "min-h-11 w-full rounded-control border border-line bg-page px-3 text-ink focus:border-accent focus:outline-none";

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

// ---------- rule sets ----------

/** Edit one rule set: for each day type, when outings open, the return time(s), limits, form. */
export function RuleSetForm({ ruleSet }: { ruleSet: RuleSet }): ReactNode {
  const [state, action] = useActionState(saveRuleSet, EMPTY);
  const [defaultState, makeDefault] = useActionState(makeDefaultRuleSet, EMPTY);
  const [deleteState, remove] = useActionState(deleteRuleSet, EMPTY);
  const id = ruleSet.id;
  return (
    <article
      aria-labelledby={`set-${id}`}
      className="flex flex-col gap-4 rounded-sheet border border-line bg-surface p-5 sm:p-6"
    >
      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="rule_set_id" value={id} />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <label className="flex min-w-0 flex-col gap-1.5 text-sm font-bold text-ink sm:flex-1">
            <span id={`set-${id}`}>Rules name</span>
            <input
              name="name"
              defaultValue={ruleSet.name}
              required
              maxLength={60}
              className={input}
            />
          </label>
          {ruleSet.is_default ? (
            <span className="rounded-full bg-accent-soft px-2.5 py-1 text-sm font-bold text-accent">
              Default for students without a hostel
            </span>
          ) : null}
        </div>
        <p className="text-sm text-muted">
          {ruleSet.hostels.length
            ? `Followed by ${ruleSet.hostels.join(", ")}.`
            : "No hostel follows these rules yet."}
        </p>

        <div className="-mx-5 overflow-x-auto px-5 sm:mx-0 sm:px-0">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="text-muted">
              <tr>
                <th scope="col" className="py-2 pr-3 font-normal">
                  Day
                </th>
                <th scope="col" className="py-2 pr-3 font-normal">
                  Outings from
                </th>
                <th scope="col" className="py-2 pr-3 font-normal">
                  Back by
                </th>
                <th scope="col" className="py-2 pr-3 font-normal">
                  Later, with a reason
                </th>
                <th scope="col" className="py-2 pr-3 font-normal">
                  Max hours
                </th>
                <th scope="col" className="py-2 font-normal">
                  Form + approval
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line border-y border-line">
              {ruleSet.days.map((d) => {
                const key = `${id}-${d.day_type}`;
                return (
                  <tr key={d.day_type}>
                    <th scope="row" className="py-2 pr-3 font-bold text-ink">
                      {DAY_LABEL[d.day_type]}
                    </th>
                    <td className="py-2 pr-3">
                      <input
                        type="time"
                        name={`${d.day_type}.opens_at`}
                        defaultValue={d.opens_at}
                        required
                        aria-label={`${DAY_LABEL[d.day_type]}: outings from`}
                        className={input}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="time"
                        name={`${d.day_type}.return_by`}
                        defaultValue={d.return_by}
                        required
                        aria-label={`${DAY_LABEL[d.day_type]}: back by`}
                        className={input}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="time"
                        name={`${d.day_type}.late_until`}
                        defaultValue={d.late_until ?? ""}
                        aria-label={`${DAY_LABEL[d.day_type]}: later return with a reason (empty: not allowed)`}
                        className={input}
                      />
                    </td>
                    <td className="py-2 pr-3">
                      <input
                        type="number"
                        name={`${d.day_type}.max_hours`}
                        min={0.5}
                        max={12}
                        step={0.5}
                        defaultValue={d.max_minutes ? d.max_minutes / 60 : ""}
                        placeholder="No limit"
                        aria-label={`${DAY_LABEL[d.day_type]}: maximum hours (empty: until back-by)`}
                        className={input}
                      />
                    </td>
                    <td className="py-2">
                      <input
                        id={key}
                        type="checkbox"
                        name={`${d.day_type}.needs_form`}
                        defaultChecked={d.needs_form}
                        aria-label={`${DAY_LABEL[d.day_type]}: needs a form approved by an admin`}
                        className="size-5 accent-[var(--accent)]"
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-sm text-muted">
          Leave &ldquo;Later, with a reason&rdquo; empty where it isn&apos;t allowed. Holidays are
          the dates in the list below, whatever day they fall on.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton pendingLabel="Saving…">Save rules</SubmitButton>
          <Notice state={state} />
        </div>
      </form>

      {ruleSet.is_default ? null : (
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <form action={makeDefault}>
            <input type="hidden" name="rule_set_id" value={id} />
            <SubmitButton variant="secondary" pendingLabel="Saving…" className="min-h-11 text-sm">
              Make default
            </SubmitButton>
          </form>
          <form
            action={remove}
            onSubmit={(event) => {
              if (!window.confirm(`Delete "${ruleSet.name}"?`)) event.preventDefault();
            }}
          >
            <input type="hidden" name="rule_set_id" value={id} />
            <SubmitButton variant="quiet" pendingLabel="Deleting…" className="min-h-11 text-sm">
              Delete
            </SubmitButton>
          </form>
          <Notice state={defaultState.error ? defaultState : deleteState} />
        </div>
      )}
    </article>
  );
}

export function NewRuleSetForm({ sets }: { sets: RuleSet[] }): ReactNode {
  const [state, action] = useActionState(createRuleSet, EMPTY);
  return (
    <form
      action={action}
      className="flex flex-col gap-4 rounded-sheet border border-dashed border-line p-5 sm:p-6"
    >
      <h3 className="font-display text-lg text-ink">Add another set of rules</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Name"
          name="name"
          id="new-rules-name"
          required
          maxLength={60}
          defaultValue={state.fields?.name}
        />
        <label className="flex flex-col gap-1.5 text-sm font-bold text-ink">
          Start from a copy of
          <select name="copy_from" className={`${input} min-h-12`}>
            {sets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <FormError message={state.error} />
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton variant="secondary" pendingLabel="Adding…">
          Add rules
        </SubmitButton>
        <Notice state={{ error: null, notice: state.notice }} />
      </div>
    </form>
  );
}

// ---------- hostels ----------

export function HostelForm({ hostel, sets }: { hostel?: Hostel; sets: RuleSet[] }): ReactNode {
  const [state, action] = useActionState(saveHostel, EMPTY);
  const [deleteState, remove] = useActionState(deleteHostel, EMPTY);
  const value = (field: string, fallback: string | null | undefined): string =>
    state.fields?.[field] ?? fallback ?? "";
  return (
    <div className="flex flex-col gap-3 py-4">
      <form
        action={action}
        className="grid items-end gap-3 sm:grid-cols-[1.2fr_1.2fr_1fr_1fr_auto]"
      >
        {hostel ? <input type="hidden" name="hostel_id" value={hostel.id} /> : null}
        <label className="flex flex-col gap-1.5 text-sm font-bold text-ink">
          Hostel
          <input
            name="name"
            required
            maxLength={60}
            defaultValue={value("name", hostel?.name)}
            className={input}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-bold text-ink">
          Follows
          <select
            name="rule_set_id"
            required
            defaultValue={value("rule_set_id", hostel?.rule_set_id ?? sets[0]?.id)}
            className={input}
          >
            {sets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-bold text-ink">
          Warden
          <input
            name="warden_name"
            maxLength={80}
            defaultValue={value("warden_name", hostel?.warden_name)}
            className={input}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-bold text-ink">
          Warden&apos;s phone
          <input
            name="warden_phone"
            type="tel"
            inputMode="tel"
            maxLength={24}
            defaultValue={value("warden_phone", hostel?.warden_phone)}
            className={input}
          />
        </label>
        <SubmitButton
          variant={hostel ? "secondary" : "primary"}
          pendingLabel="Saving…"
          className="min-h-11 text-sm"
        >
          {hostel ? "Save" : "Add hostel"}
        </SubmitButton>
      </form>
      <div className="flex flex-wrap items-center gap-3">
        {hostel ? (
          <>
            <span className="text-sm text-muted">
              {hostel.students} {hostel.students === 1 ? "student" : "students"}
            </span>
            <form
              action={remove}
              onSubmit={(event) => {
                if (
                  !window.confirm(
                    `Remove ${hostel.name}? Its students follow the default rules until they pick another hostel.`,
                  )
                )
                  event.preventDefault();
              }}
            >
              <input type="hidden" name="hostel_id" value={hostel.id} />
              <SubmitButton variant="quiet" pendingLabel="Removing…" className="min-h-11 text-sm">
                Remove
              </SubmitButton>
            </form>
          </>
        ) : null}
        <Notice state={state.error || state.notice ? state : deleteState} />
      </div>
    </div>
  );
}

// ---------- holidays ----------

export function HolidayRow({ holiday }: { holiday: Holiday }): ReactNode {
  const [state, remove] = useActionState(deleteHoliday, EMPTY);
  const label = new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${holiday.day}T00:00:00Z`));
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <span className="text-ink">
        <span className="tabular-nums text-muted">{label}</span> · {holiday.name}
      </span>
      <form action={remove} className="flex items-center gap-2">
        <input type="hidden" name="day" value={holiday.day} />
        <SubmitButton variant="quiet" pendingLabel="Removing…" className="min-h-11 text-sm">
          Remove
        </SubmitButton>
        <Notice state={state} />
      </form>
    </li>
  );
}

export function NewHolidayForm({ today }: { today: string }): ReactNode {
  const [state, action] = useActionState(addHoliday, EMPTY);
  return (
    <form action={action} className="grid items-end gap-3 sm:grid-cols-[auto_1fr_auto]">
      <label className="flex flex-col gap-1.5 text-sm font-bold text-ink">
        Date
        <input
          type="date"
          name="day"
          required
          min={today}
          defaultValue={state.fields?.day}
          className={input}
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-bold text-ink">
        Holiday
        <input
          name="name"
          required
          maxLength={60}
          placeholder="Diwali"
          defaultValue={state.fields?.name}
          className={input}
        />
      </label>
      <SubmitButton pendingLabel="Adding…" className="min-h-11 text-sm">
        Add holiday
      </SubmitButton>
      <div className="sm:col-span-3">
        <Notice state={state} />
      </div>
    </form>
  );
}
