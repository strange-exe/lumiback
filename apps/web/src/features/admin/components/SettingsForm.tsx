"use client";

import { useActionState, type ReactNode } from "react";

import { Field, FormError } from "@/components/ui/Field";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { saveSettings } from "@/features/admin/actions";
import type { CampusSettings, FormState } from "@/lib/types";

const EMPTY: FormState = { error: null };

export function SettingsForm({ current }: { current: CampusSettings }): ReactNode {
  const [state, action] = useActionState(saveSettings, EMPTY);
  return (
    <form
      action={action}
      className="flex flex-col gap-5 rounded-sheet border border-line bg-surface p-5 sm:p-6"
    >
      <Field
        label="Keep gate scans for (days)"
        name="retention"
        type="number"
        min={7}
        max={730}
        required
        defaultValue={state.fields?.retention ?? String(current.scan_retention_days)}
        hint="Older scans are deleted automatically. Trips in the register are kept until the student deletes their account."
      />
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
