"use client";

import { useActionState, type ReactNode } from "react";

import { Field, FormError } from "@/components/ui/Field";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { checkOut } from "@/features/outings/actions";
import { ReturnTimePicker } from "@/features/outings/components/ReturnTimePicker";
import type { FormState } from "@/lib/types";

const INITIAL: FormState = { error: null };

export function CheckOutForm(): ReactNode {
  const [state, action] = useActionState(checkOut, INITIAL);
  return (
    <form action={action} className="flex flex-col gap-5">
      <ReturnTimePicker legend="When will you be back?" />
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
