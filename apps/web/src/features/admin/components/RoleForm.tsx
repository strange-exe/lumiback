"use client";

import { useActionState, useId, useState, type ReactNode } from "react";

import { SubmitButton } from "@/components/ui/SubmitButton";
import { setRole } from "@/features/admin/actions";
import type { AdminUser, FormState, Hostel, Role } from "@/lib/types";

const EMPTY: FormState = { error: null };

const ROLES: { value: Role; label: string }[] = [
  { value: "student", label: "Student" },
  { value: "warden", label: "Warden" },
  { value: "admin", label: "Admin" },
];

/** What the new role can see, said before it's given. */
function question(person: AdminUser, role: Role, hostels: string[], isMe: boolean): string {
  if (role === "admin") {
    return `Make ${person.name} an admin? They'll see every hostel's register, outing requests (with phone numbers), escalations (with emergency and warden contacts) and gate scans, and can change gates, rules, people and settings. Never a live location, except a sharing student's last position when that student is late and hasn't answered.`;
  }
  if (role === "warden") {
    return `Make ${person.name} the warden of ${hostels.join(", ")}? For those hostels' students only, they'll decide outing requests, handle escalations (with emergency contacts), and see who's out and gate scans. They can't change rules, gates, people or settings.`;
  }
  return isMe
    ? "Remove your own access to the hostel office? You'll need an admin to give it back."
    : `Make ${person.name} a student again? They lose access to the hostel office.`;
}

export function RoleForm({
  person,
  hostels,
  isMe,
}: {
  person: AdminUser;
  hostels: Hostel[];
  isMe: boolean;
}): ReactNode {
  const [state, action] = useActionState(setRole, EMPTY);
  const [role, setRoleChoice] = useState<Role>(person.role);
  const [chosen, setChosen] = useState<string[]>(person.hostel_ids);
  const id = useId();
  // The save button appears only once something differs from the saved role.
  const changed =
    role !== person.role ||
    (role === "warden" && [...chosen].sort().join() !== [...person.hostel_ids].sort().join());
  return (
    <form
      action={action}
      onSubmit={(event) => {
        const names = hostels.filter((h) => chosen.includes(h.id)).map((h) => h.name);
        // Nothing to confirm without a hostel: the server explains what's missing.
        if (role === "warden" && names.length === 0) return;
        if (!window.confirm(question(person, role, names, isMe))) event.preventDefault();
      }}
      className="flex flex-col gap-3"
    >
      <input type="hidden" name="user_id" value={person.id} />
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">Role for {person.name}</legend>
        <div className="flex flex-wrap gap-1 rounded-control bg-accent-soft/60 p-1">
          {ROLES.map((r) => (
            <label
              key={r.value}
              className={`flex min-h-11 flex-1 cursor-pointer items-center justify-center rounded-control px-3 text-sm font-bold transition has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent ${
                role === r.value ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"
              }`}
            >
              <input
                type="radio"
                name="role"
                value={r.value}
                checked={role === r.value}
                onChange={() => setRoleChoice(r.value)}
                className="sr-only"
              />
              {r.label}
            </label>
          ))}
        </div>
      </fieldset>
      {role === "warden" && (
        <fieldset className="flex flex-col gap-1.5" aria-describedby={`${id}-hint`}>
          <legend className="text-sm font-bold text-ink">Warden of</legend>
          <p id={`${id}-hint`} className="text-sm text-muted">
            They see only these hostels&apos; students.
          </p>
          {hostels.length === 0 ? (
            <p className="text-sm text-danger">Add a hostel under Rules first.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {hostels.map((h) => (
                <label
                  key={h.id}
                  className="flex min-h-11 cursor-pointer items-center gap-2 rounded-control border border-line px-3 text-sm text-ink has-[:checked]:border-accent has-[:checked]:bg-accent-soft"
                >
                  <input
                    type="checkbox"
                    name="hostel_ids"
                    value={h.id}
                    checked={chosen.includes(h.id)}
                    onChange={(e) =>
                      setChosen((now) =>
                        e.target.checked ? [...now, h.id] : now.filter((x) => x !== h.id),
                      )
                    }
                    className="size-4 accent-[var(--color-accent)]"
                  />
                  {h.name}
                </label>
              ))}
            </div>
          )}
        </fieldset>
      )}
      <div className="flex flex-wrap items-center gap-3 empty:hidden">
        {changed && (
          <SubmitButton variant="primary" pendingLabel="Saving…" className="min-h-11 text-sm">
            Save role
          </SubmitButton>
        )}
        <p aria-live="polite" className="text-sm empty:hidden">
          {state.error ? (
            <span className="font-bold text-danger">{state.error}</span>
          ) : (
            <span className="text-good">{state.notice}</span>
          )}
        </p>
      </div>
    </form>
  );
}
