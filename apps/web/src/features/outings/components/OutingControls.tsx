"use client";

import { useActionState, type ReactNode } from "react";

import { FormError } from "@/components/ui/Field";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { markReturn, updateReturn } from "@/features/outings/actions";
import { ReturnTimePicker } from "@/features/outings/components/ReturnTimePicker";
import type { FormState } from "@/lib/types";

const INITIAL: FormState = { error: null };

export function ReturnButton(): ReactNode {
  const [state, action] = useActionState(markReturn, INITIAL);
  return (
    <form action={action} className="flex flex-col gap-2">
      <SubmitButton pendingLabel="Welcome back…" className="w-full text-lg">
        I&apos;m back
      </SubmitButton>
      <FormError message={state.error} />
    </form>
  );
}

export function UpdateReturnForm(): ReactNode {
  const [state, action] = useActionState(updateReturn, INITIAL);
  return (
    <details className="group rounded-control">
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-center font-bold text-pine underline-offset-4 hover:underline">
        Running late? Update your time
      </summary>
      <form action={action} className="mt-3 flex flex-col gap-4 border-t border-line pt-4">
        <ReturnTimePicker legend="New return time" />
        <FormError message={state.error} />
        <SubmitButton variant="secondary" pendingLabel="Updating…">
          Update return time
        </SubmitButton>
      </form>
    </details>
  );
}
