"use client";

import { useActionState, type ReactNode } from "react";

import { Field, FormError } from "@/components/ui/Field";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { resendCode, verifyEmail } from "@/features/auth/actions";
import type { FormState } from "@/lib/types";

const INITIAL: FormState = { error: null };

export function VerifyForm({ email }: { email: string }): ReactNode {
  const [state, action] = useActionState(verifyEmail, INITIAL);
  const [resent, resend] = useActionState(resendCode, INITIAL);
  return (
    <div className="flex flex-col gap-6">
      <form action={action} className="flex flex-col gap-4" noValidate>
        <input type="hidden" name="email" value={email} />
        <Field
          label="6-digit code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          placeholder="482915"
          className="tracking-[0.4em]"
          required
        />
        <FormError message={state.error} />
        <SubmitButton pendingLabel="Checking…">Verify email</SubmitButton>
      </form>
      <form action={resend} className="flex flex-col items-center gap-1">
        <input type="hidden" name="email" value={email} />
        <SubmitButton variant="quiet" pendingLabel="Sending…">
          Send a new code
        </SubmitButton>
        <p role="status" className="min-h-5 text-sm text-muted">
          {resent.error ?? resent.notice ?? ""}
        </p>
      </form>
    </div>
  );
}
