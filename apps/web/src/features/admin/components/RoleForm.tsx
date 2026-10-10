"use client";

import { useActionState, type ReactNode } from "react";

import { SubmitButton } from "@/components/ui/SubmitButton";
import { setRole } from "@/features/admin/actions";
import type { AdminUser, FormState } from "@/lib/types";

const EMPTY: FormState = { error: null };

export function RoleForm({ person, isMe }: { person: AdminUser; isMe: boolean }): ReactNode {
  const [state, action] = useActionState(setRole, EMPTY);
  const promote = person.role === "student";
  return (
    <form
      action={action}
      onSubmit={(event) => {
        const question = promote
          ? `Make ${person.name} an admin? They'll see the register, outing requests (with phone numbers), escalations (with emergency and warden contacts), gate scans, rules and settings. Never a live location, except a sharing student's last position when that student is late and hasn't answered.`
          : isMe
            ? "Remove your own admin access? You'll need another admin to give it back."
            : `Remove ${person.name}'s admin access?`;
        if (!window.confirm(question)) event.preventDefault();
      }}
      className="flex flex-col items-end gap-1"
    >
      <input type="hidden" name="user_id" value={person.id} />
      <input type="hidden" name="role" value={promote ? "admin" : "student"} />
      <SubmitButton
        variant={promote ? "secondary" : "quiet"}
        pendingLabel="Saving…"
        className="min-h-11 text-sm"
      >
        {promote ? "Make admin" : "Remove admin"}
      </SubmitButton>
      <p aria-live="polite" className="text-sm">
        {state.error ? (
          <span className="font-bold text-danger">{state.error}</span>
        ) : (
          <span className="text-good">{state.notice}</span>
        )}
      </p>
    </form>
  );
}
