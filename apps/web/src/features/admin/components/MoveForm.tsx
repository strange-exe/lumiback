"use client";

import { useActionState, useId, type ReactNode } from "react";

import { SubmitButton } from "@/components/ui/SubmitButton";
import { moveStudent } from "@/features/admin/actions";
import type { AdminUser, FormState, Hostel } from "@/lib/types";

const EMPTY: FormState = { error: null };

/** Students choose their hostel once; this is how the office moves them afterwards. */
export function MoveForm({ person, hostels }: { person: AdminUser; hostels: Hostel[] }): ReactNode {
  const [state, action] = useActionState(moveStudent, EMPTY);
  const id = useId();
  const others = hostels.filter((h) => h.id !== person.home_hostel_id);
  if (others.length === 0) return null;
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="user_id" value={person.id} />
      <label htmlFor={`${id}-hostel`} className="text-sm font-bold text-ink">
        Hostel: {person.home_hostel ?? "not chosen"}
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <select
          id={`${id}-hostel`}
          name="hostel_id"
          defaultValue=""
          className="min-h-11 min-w-0 flex-1 rounded-control border border-line bg-page px-3 text-ink focus:border-accent focus:outline-none"
        >
          <option value="">Move to…</option>
          {others.map((h) => (
            <option key={h.id} value={h.id}>
              {h.name}
            </option>
          ))}
        </select>
        <SubmitButton variant="secondary" pendingLabel="Moving…">
          Move
        </SubmitButton>
      </div>
      <p aria-live="polite" className="text-sm">
        {state.error ? (
          <span className="font-bold text-danger">{state.error}</span>
        ) : (
          <span className="text-good">{state.notice ?? ""}</span>
        )}
      </p>
    </form>
  );
}
