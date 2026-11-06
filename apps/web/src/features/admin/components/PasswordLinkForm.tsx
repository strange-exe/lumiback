"use client";

import { useActionState, type ReactNode } from "react";

import { SubmitButton } from "@/components/ui/SubmitButton";
import { sendPasswordLink } from "@/features/admin/actions";
import type { AdminUser, FormState } from "@/lib/types";

const EMPTY: FormState = { error: null };

/** What sending the link does to this account, said before it's sent. */
function question(person: AdminUser): string {
  if (person.account === "invited") {
    return `Send ${person.name} their set-up link again? They get an email to choose a password; the link works for 7 days and the earlier one stops working.`;
  }
  if (person.account === "reset") {
    return `Send ${person.name} a new password link? They get an email to choose a new password (the link works for 24 h); the earlier link stops working.`;
  }
  return `Send ${person.name} a password link? Their current password stops working now and they're signed out everywhere. They get an email to choose a new one (the link works for 24 h).`;
}

/** Someone who can't sign in: an admin emails them a link to choose a password. */
export function PasswordLinkForm({ person }: { person: AdminUser }): ReactNode {
  const [state, action] = useActionState(sendPasswordLink, EMPTY);
  return (
    <form
      action={action}
      onSubmit={(event) => {
        if (!window.confirm(question(person))) event.preventDefault();
      }}
      className="flex flex-wrap items-center gap-3"
    >
      <input type="hidden" name="user_id" value={person.id} />
      <SubmitButton variant="secondary" pendingLabel="Sending…" className="min-h-11 text-sm">
        Send password link
      </SubmitButton>
      <p aria-live="polite" className="text-sm">
        {state.error ? (
          <span className="font-bold text-danger">{state.error}</span>
        ) : state.notice ? (
          <span className="text-good">{state.notice}</span>
        ) : null}
      </p>
    </form>
  );
}
