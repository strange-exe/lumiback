"use client";

import Link from "next/link";
import { useActionState, type ReactNode } from "react";

import { Field, FormError } from "@/components/ui/Field";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { register } from "@/features/auth/actions";
import type { FormState } from "@/lib/types";

const INITIAL: FormState = { error: null };

export function RegisterForm(): ReactNode {
  const [state, action] = useActionState(register, INITIAL);
  return (
    <form action={action} className="flex flex-col gap-4" noValidate>
      <Field
        label="Full name"
        name="name"
        autoComplete="name"
        placeholder="Abhinesh Gangwar"
        defaultValue={state.fields?.name}
        required
      />
      <Field
        label="University email"
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        placeholder="abhinesh.gangwar@geu.ac.in"
        defaultValue={state.fields?.email}
        hint="We'll send a 6-digit code to confirm it's yours."
        required
      />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        hint="At least 10 characters. Avoid your name or email."
        required
      />
      <Field
        label="Roll number (optional)"
        name="roll_no"
        inputMode="numeric"
        defaultValue={state.fields?.roll_no}
      />
      <FormError message={state.error} />
      <SubmitButton pendingLabel="Creating account…">Create account</SubmitButton>
      <p className="text-center text-sm text-stone">
        By creating an account you agree to how we handle your data, described in our{" "}
        <Link href="/privacy" className="font-bold text-pine underline-offset-4 hover:underline">
          privacy notice
        </Link>
        .
      </p>
      <p className="text-center text-sm text-stone">
        Already registered?{" "}
        <Link href="/sign-in" className="font-bold text-pine underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
