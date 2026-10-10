"use client";

import Link from "next/link";
import { useActionState, type ReactNode } from "react";

import { Field, FormError } from "@/components/ui/Field";
import { PasswordField } from "@/components/ui/PasswordField";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { requestPasswordReset, resendPasswordReset, resetPassword } from "@/features/auth/actions";
import type { FormState } from "@/lib/types";

const INITIAL: FormState = { error: null };

export function RequestResetForm({ email }: { email?: string }): ReactNode {
  const [state, action] = useActionState(requestPasswordReset, INITIAL);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <Field
        label="University email"
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        placeholder="student_id@geu.ac.in"
        defaultValue={state.fields?.email ?? email}
        required
      />
      <FormError message={state.error} />
      <SubmitButton pendingLabel="Sending…">Send code</SubmitButton>
      <Link
        href="/sign-in"
        className="self-center text-sm font-bold text-accent underline-offset-4 hover:underline"
      >
        Back to sign in
      </Link>
    </form>
  );
}

export function SetNewPasswordForm({ email }: { email: string }): ReactNode {
  const [state, action] = useActionState(resetPassword, INITIAL);
  const [resent, resend] = useActionState(resendPasswordReset, INITIAL);
  return (
    <div className="flex flex-col gap-4">
      <form action={action} className="flex flex-col gap-4" noValidate>
        <input type="hidden" name="email" value={email} />
        <Field
          label="Code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          placeholder="482915"
          className="text-2xl tracking-[0.3em]"
          required
        />
        <PasswordField
          label="New password"
          name="password"
          autoComplete="new-password"
          hint="At least 10 characters. Avoid your name or email. You'll be signed out on other devices."
          required
        />
        <FormError message={state.error} />
        <SubmitButton pendingLabel="Saving…">Set new password</SubmitButton>
      </form>
      <form action={resend} className="flex flex-col items-center gap-1">
        <input type="hidden" name="email" value={email} />
        <SubmitButton variant="quiet" pendingLabel="Sending…">
          Send a new code
        </SubmitButton>
        <p
          role="status"
          className={`min-h-5 text-sm ${resent.error ? "font-bold text-danger" : "text-muted"}`}
        >
          {resent.error ?? resent.notice ?? ""}
        </p>
      </form>
    </div>
  );
}
