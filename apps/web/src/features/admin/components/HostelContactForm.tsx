"use client";

import { useActionState, type ReactNode } from "react";

import { Field, FormError } from "@/components/ui/Field";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { saveHostelContact } from "@/features/admin/rules-actions";
import type { FormState, Hostel } from "@/lib/types";

const EMPTY: FormState = { error: null };

/** The warden contact the hostel office calls about a late student (shown on escalations). */
export function HostelContactForm({ hostel }: { hostel: Hostel }): ReactNode {
  const [state, action] = useActionState(saveHostelContact, EMPTY);
  const value = (field: string, fallback: string | null): string =>
    state.fields?.[field] ?? fallback ?? "";
  return (
    <form
      action={action}
      aria-labelledby={`hostel-${hostel.id}`}
      className="flex flex-col gap-5 rounded-sheet border border-line bg-surface p-5 sm:p-6"
    >
      <input type="hidden" name="hostel_id" value={hostel.id} />
      <div className="flex flex-col gap-1">
        <h2 id={`hostel-${hostel.id}`} className="font-display text-xl text-ink">
          {hostel.name}
        </h2>
        <p className="text-sm text-muted">
          {hostel.students} {hostel.students === 1 ? "student" : "students"} · follows{" "}
          {hostel.rule_set}
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id={`warden-name-${hostel.id}`}
          label="Warden"
          name="warden_name"
          maxLength={80}
          autoComplete="name"
          defaultValue={value("warden_name", hostel.warden_name)}
        />
        <Field
          id={`warden-phone-${hostel.id}`}
          label="Warden's phone"
          name="warden_phone"
          type="tel"
          inputMode="tel"
          maxLength={24}
          autoComplete="tel"
          defaultValue={value("warden_phone", hostel.warden_phone)}
        />
      </div>
      <FormError message={state.error} />
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton pendingLabel="Saving…">Save contact</SubmitButton>
        <p aria-live="polite" className="text-sm text-good">
          {state.notice ?? ""}
        </p>
      </div>
    </form>
  );
}
