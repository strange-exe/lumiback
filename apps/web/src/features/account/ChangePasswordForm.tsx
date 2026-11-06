"use client";

import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";

import { FormError } from "@/components/ui/Field";
import { PasswordField } from "@/components/ui/PasswordField";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { changePasswordProblem, NEW_PASSWORD_HINT } from "@/features/account/password";
import { changePassword } from "@/features/auth/actions";
import type { FormState } from "@/lib/types";

const INITIAL: FormState = { error: null };

/**
 * Current password, then the new one twice. The two new ones are compared here first, so a typo
 * never costs a round trip (or one of the five wrong-password tries an hour); the Server Action
 * checks again. On success this device stays signed in and the page says how many others were
 * signed out.
 */
export function ChangePasswordForm(): ReactNode {
  const [state, action] = useActionState(changePassword, INITIAL);
  // A problem found before sending; cleared when the form is sent.
  const [early, setEarly] = useState<string | null>(null);
  const done = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (state.notice) done.current?.focus();
  }, [state]);

  // The page's own "Back to account" link above is the way on from here.
  if (state.notice) {
    return (
      <p
        ref={done}
        tabIndex={-1}
        role="status"
        className="rounded-control bg-good-soft px-4 py-3 text-ink focus:outline-none"
      >
        {state.notice}
      </p>
    );
  }

  return (
    <form
      action={action}
      onSubmit={(event) => {
        const data = new FormData(event.currentTarget);
        const problem = changePasswordProblem(
          data.get("current_password"),
          data.get("password"),
          data.get("confirm"),
        );
        setEarly(problem);
        if (problem) event.preventDefault(); // React then doesn't run the action
      }}
      className="flex flex-col gap-4"
      noValidate
    >
      <PasswordField
        label="Current password"
        name="current_password"
        autoComplete="current-password"
        required
      />
      <PasswordField
        label="New password"
        name="password"
        autoComplete="new-password"
        hint={NEW_PASSWORD_HINT}
        required
      />
      <PasswordField
        label="New password again"
        name="confirm"
        autoComplete="new-password"
        required
      />
      <FormError message={early ?? state.error} />
      <SubmitButton pendingLabel="Changing…" className="self-start">
        Change password
      </SubmitButton>
    </form>
  );
}
