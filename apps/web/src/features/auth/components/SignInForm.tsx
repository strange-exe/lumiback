"use client";

import Link from "next/link";
import { useActionState, type ReactNode } from "react";

import { Field, FormError } from "@/components/ui/Field";
import { PasswordField } from "@/components/ui/PasswordField";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { signIn } from "@/features/auth/actions";
import type { FormState } from "@/lib/types";

const INITIAL: FormState = { error: null };

export function SignInForm({ email }: { email?: string }): ReactNode {
  const [state, action] = useActionState(signIn, INITIAL);
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
      <PasswordField label="Password" name="password" autoComplete="current-password" required />
      <Link
        href="/forgot-password"
        className="-mt-2 self-end text-sm font-bold text-accent underline-offset-4 hover:underline"
      >
        Forgot password?
      </Link>
      <FormError message={state.error} />
      <SubmitButton pendingLabel="Signing in…">Sign in</SubmitButton>
      <p className="text-center text-sm text-muted">
        New here?{" "}
        <Link href="/register" className="font-bold text-accent underline-offset-4 hover:underline">
          Create your account
        </Link>
      </p>
    </form>
  );
}
