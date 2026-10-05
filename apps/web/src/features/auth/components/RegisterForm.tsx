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
      <Field label="Full name" name="name" autoComplete="name" placeholder="Riya Sharma" required />
      <Field
        label="University email"
        name="email"
        type="email"
        autoComplete="email"
        inputMode="email"
        placeholder="riya.sharma@geu.ac.in"
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
      <div className="grid grid-cols-2 gap-3">
        <Field label="Roll no. (optional)" name="roll_no" placeholder="2312345678" />
        <Field label="Hostel (optional)" name="hostel" placeholder="Hostel 3" />
      </div>
      <FormError message={state.error} />
      <SubmitButton pendingLabel="Creating account…">Create account</SubmitButton>
      <p className="text-center text-sm text-stone">
        Already registered?{" "}
        <Link href="/" className="font-bold text-pine underline-offset-4 hover:underline">
          Sign in
        </Link>
      </p>
    </form>
  );
}
