"use client";

import { useActionState, type ReactNode } from "react";

import { Field, FormError } from "@/components/ui/Field";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { checkOut } from "@/features/outings/actions";
import type { FormState } from "@/lib/types";

const INITIAL: FormState = { error: null };

/** Check out without the gate. The hostel's rules (shown above it) set the return time. */
export function CheckOutForm(): ReactNode {
  const [state, action] = useActionState(checkOut, INITIAL);
  return (
    <form action={action} className="flex flex-col gap-5">
      <p className="text-sm text-muted">
        Your return time is set by your hostel&apos;s rules, and it can&apos;t be changed once
        you&apos;re out.
      </p>
      <Field
        label="Where to? (optional)"
        name="destination"
        defaultValue={state.fields?.destination}
        placeholder="Clock Tower market"
        maxLength={100}
        autoComplete="off"
      />
      <FormError message={state.error} />
      <SubmitButton pendingLabel="Checking out…" className="w-full">
        Check out
      </SubmitButton>
    </form>
  );
}
