"use client";

import Link from "next/link";
import { useActionState, useEffect, useId, useRef, type ReactNode } from "react";

import { Field, FormError } from "@/components/ui/Field";
import { PasswordField } from "@/components/ui/PasswordField";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { signIn } from "@/features/auth/actions";
import type { FormState } from "@/lib/types";

const INITIAL: FormState = { error: null };

/** The API's answer to the 5th wrong password in a row for one email. */
export const LOGIN_LOCKED = "login_locked";

const DIALOG =
  "m-auto max-h-[calc(100dvh-2rem)] w-[min(28rem,calc(100vw-2rem))] overflow-y-auto rounded-sheet border border-line bg-surface p-5 text-left text-ink backdrop:bg-[rgba(var(--tint),0.55)] sm:p-6";

/**
 * Shown once sign-in is paused for this email: a password reset (a code by email) lets the
 * student in now, and the reset also lifts the pause.
 */
function LockedDialog({ state }: { state: FormState }): ReactNode {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const bodyId = useId();
  useEffect(() => {
    if (state.code === LOGIN_LOCKED && !dialog.current?.open) dialog.current?.showModal();
  }, [state]);
  const email = state.fields?.email;
  const reset = email ? `/forgot-password?email=${encodeURIComponent(email)}` : "/forgot-password";
  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      data-testid="login-locked"
      className={DIALOG}
    >
      <div className="flex flex-col gap-4">
        <h2 id={titleId} className="font-display text-xl text-ink">
          Forgot your password?
        </h2>
        <p id={bodyId} className="text-muted">
          That&apos;s 5 wrong passwords in a row, so sign-in for this email is paused for up to 15
          minutes. Reset your password with a code we email you to sign in now.
        </p>
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            className="min-h-12 rounded-control px-5 font-bold text-accent ring-1 ring-line hover:bg-accent-soft"
          >
            Not now
          </button>
          <Link
            href={reset}
            autoFocus
            className="press inline-flex min-h-12 items-center justify-center rounded-control bg-accent px-5 text-base font-bold text-on-accent shadow-[0_2px_0_rgba(0,0,0,0.12)] hover:brightness-105"
          >
            Reset password
          </Link>
        </div>
      </div>
    </dialog>
  );
}

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
      <LockedDialog state={state} />
    </form>
  );
}
