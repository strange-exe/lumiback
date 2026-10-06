"use client";

import Link from "next/link";
import { useActionState, type ReactNode } from "react";

import { Field, FormError } from "@/components/ui/Field";
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
        placeholder="abhinesh.gangwar@geu.ac.in"
        defaultValue={state.fields?.email ?? email}
        required
      />
      <Field
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
      />
      <FormError message={state.error} />
      <SubmitButton pendingLabel="Signing in…">Sign in</SubmitButton>
      <p className="text-center text-sm text-stone">
        New here?{" "}
        <Link href="/register" className="font-bold text-pine underline-offset-4 hover:underline">
          Create your account
        </Link>
      </p>
    </form>
  );
}
