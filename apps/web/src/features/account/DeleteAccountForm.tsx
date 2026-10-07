"use client";

import { CaretDown } from "@phosphor-icons/react";
import { useActionState, type ReactNode } from "react";

import { Field, FormError } from "@/components/ui/Field";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { deleteAccount } from "@/features/auth/actions";
import type { FormState } from "@/lib/types";

const INITIAL: FormState = { error: null };

/** Tucked behind a disclosure: a destructive action should take a deliberate step to reach. */
export function DeleteAccountForm(): ReactNode {
  const [state, action] = useActionState(deleteAccount, INITIAL);
  return (
    <details className="group rounded-sheet border border-line bg-surface">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-5 font-bold text-danger">
        Delete account
        <CaretDown
          size={18}
          weight="bold"
          aria-hidden="true"
          className="text-muted transition-transform group-open:rotate-180"
        />
      </summary>
      <form action={action} className="flex flex-col gap-4 border-t border-line px-5 pb-5 pt-4">
        <p className="leading-relaxed text-ink">
          This erases your account, outings, shares and everything tied to them, right away. Anyone
          following you loses access. It can&apos;t be undone.
        </p>
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
        <Field
          label='Type "delete" to confirm'
          name="confirm"
          defaultValue={state.fields?.confirm}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          required
        />
        <FormError message={state.error} />
        <SubmitButton variant="danger" pendingLabel="Deleting…">
          Delete my account
        </SubmitButton>
      </form>
    </details>
  );
}
