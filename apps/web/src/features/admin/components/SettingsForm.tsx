"use client";

import { useActionState, useState, type ReactNode } from "react";

import { Field, FormError } from "@/components/ui/Field";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { saveSettings } from "@/features/admin/actions";
import type { CampusSettings, FormState } from "@/lib/types";

const EMPTY: FormState = { error: null };

export function SettingsForm({ current }: { current: CampusSettings }): ReactNode {
  const [state, action] = useActionState(saveSettings, EMPTY);
  const [quiet, setQuiet] = useState(Boolean(current.kiosk_quiet_from));
  return (
    <form
      action={action}
      className="flex flex-col gap-5 rounded-sheet border border-line bg-surface p-5 sm:p-6"
    >
      <Field
        label="Keep campus records for (days)"
        name="retention"
        type="number"
        min={7}
        max={730}
        required
        defaultValue={state.fields?.retention ?? String(current.scan_retention_days)}
        hint="Gate scans, outing requests, handled late escalations, and records of who viewed a shared location are deleted automatically after this. Open escalations stay until handled. Trips in the register are kept until the student deletes their account."
      />
      <fieldset className="flex flex-col gap-4 border-t border-line pt-5">
        <legend className="float-left mb-1 w-full font-bold text-ink">Kiosk quiet hours</legend>
        <label className="clear-left flex min-h-11 cursor-pointer items-center gap-3 text-ink">
          <input
            type="checkbox"
            name="quiet"
            // Uncontrolled: React resets the form after the action, back to this default, so
            // the box and the times it shows can't disagree.
            defaultChecked={quiet}
            onChange={(event) => setQuiet(event.target.checked)}
            aria-describedby="quiet-hint"
            className="size-5 accent-[var(--accent-text)]"
          />
          Switch gate kiosks off at night
        </label>
        {/* The explanation shows with the times, so the closed section stays short and Save
            stays in a phone's first screen. */}
        <div hidden={!quiet} className="grid gap-4 sm:grid-cols-2">
          <p id="quiet-hint" className="text-sm text-muted sm:col-span-2">
            During these hours gate tablets show when they open instead of a code, so nobody scans
            at a gate. Students tap in or out from the app or website instead, under the usual
            outing rules. Times are IST and can run past midnight.
          </p>
          <Field
            label="Off from"
            name="quiet_from"
            type="time"
            required={quiet}
            disabled={!quiet}
            defaultValue={state.fields?.quiet_from ?? current.kiosk_quiet_from ?? "23:00"}
          />
          <Field
            label="Back on at"
            name="quiet_until"
            type="time"
            required={quiet}
            disabled={!quiet}
            defaultValue={state.fields?.quiet_until ?? current.kiosk_quiet_until ?? "05:00"}
          />
        </div>
      </fieldset>
      <FormError message={state.error} />
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel="Saving…">Save settings</SubmitButton>
        <p aria-live="polite" className="text-sm text-good">
          {state.notice ?? ""}
        </p>
      </div>
    </form>
  );
}
