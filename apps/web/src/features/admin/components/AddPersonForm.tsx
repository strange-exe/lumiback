"use client";

import Link from "next/link";
import { useActionState, useEffect, useId, useRef, useState, type ReactNode } from "react";

import { Field, FormError } from "@/components/ui/Field";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { ROLES, asRole } from "@/features/admin/accounts";
import { addPerson, type AddPersonState } from "@/features/admin/actions";
import type { Hostel, Role } from "@/lib/types";

const EMPTY: AddPersonState = { error: null };

const SELECT =
  "min-h-12 rounded-control border border-line bg-surface px-4 text-base text-ink focus:border-accent focus:outline-none";

/** Hostel field wording by role: where a student lives, or what a warden looks after. */
function hostelField(role: Role): { label: string; hint: string; required: boolean } | null {
  if (role === "student") {
    return { label: "Hostel (optional)", hint: "Where they live.", required: false };
  }
  if (role === "warden") {
    return {
      label: "Looks after",
      hint: "They see this hostel's students only. Add more hostels later under their role.",
      required: true,
    };
  }
  return null; // head wardens and admins cover every hostel
}

/**
 * "Add a person" (admins): one student or staff member, checked like a CSV row by the backend,
 * which emails them a link to choose a password. A native modal dialog, like the account
 * controls; the result shows beside the button once it closes.
 */
export function AddPersonForm({ hostels }: { hostels: Hostel[] }): ReactNode {
  const [state, action] = useActionState(addPerson, EMPTY);
  const [role, setRole] = useState<Role>("student");
  // React resets a form after its action, and a select's defaultValue isn't applied again after
  // it first renders: so each result remounts the selects (`round` is their key) with what was
  // picked, or a fresh form after someone was added.
  const [round, setRound] = useState(0);
  const [seen, setSeen] = useState(state);
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  // Adjusted while rendering, not in an effect.
  if (seen !== state) {
    setSeen(state);
    setRound(round + 1);
    setRole(state.added ? "student" : asRole(state.fields?.role ?? role));
  }
  useEffect(() => {
    if (state.added) dialog.current?.close();
  }, [state]);

  const student = role === "student";
  const hostel = hostelField(role);
  const value = (name: string) => state.fields?.[name] ?? "";
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => dialog.current?.showModal()}
        className="press min-h-12 self-start rounded-control bg-accent px-5 font-bold text-on-accent shadow-[0_2px_0_rgba(0,0,0,0.12)] hover:brightness-105"
      >
        Add a person
      </button>
      <p aria-live="polite" className="text-sm empty:hidden">
        {state.added ? (
          <span className="text-good">
            Added {state.added.name}. A link to set up their account was emailed to{" "}
            <span className="break-all">{state.added.email}</span>.{" "}
            <Link
              href={`/admin/people?q=${encodeURIComponent(state.added.email)}`}
              className="font-bold text-accent underline underline-offset-4"
            >
              Show them
            </Link>
          </span>
        ) : null}
      </p>
      <dialog
        ref={dialog}
        aria-labelledby={`${id}-title`}
        className="m-auto max-h-[calc(100dvh-2rem)] w-[min(36rem,calc(100vw-2rem))] overflow-y-auto rounded-sheet border border-line bg-surface p-5 text-left text-ink backdrop:bg-[rgba(var(--tint),0.55)] sm:p-6"
      >
        <form action={action} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 id={`${id}-title`} className="font-display text-xl text-ink">
              Add a person
            </h2>
            <p className="text-sm text-muted">
              They get an email with a link to choose a password. Adding many? Use a CSV instead.
            </p>
          </div>
          <Field
            id={`${id}-name`}
            name="name"
            label="Name"
            defaultValue={value("name")}
            maxLength={100}
            required
            autoComplete="off"
          />
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-role`} className="text-sm font-bold text-ink">
              Role
            </label>
            <select
              id={`${id}-role`}
              name="role"
              key={`role-${round}`}
              defaultValue={role}
              onChange={(e) => setRole(asRole(e.target.value))}
              className={SELECT}
            >
              {ROLES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
          <Field
            id={`${id}-student-id`}
            name="student_id"
            label={student ? "Student ID" : "Student ID (optional)"}
            hint={student ? "Their roll number." : undefined}
            defaultValue={value("student_id")}
            maxLength={64}
            required={student}
            autoComplete="off"
          />
          <Field
            id={`${id}-email`}
            name="email"
            type="email"
            label={student ? "University email (optional)" : "University email"}
            hint={
              student
                ? "Leave it blank to use their student ID address (<student ID>@geu.ac.in)."
                : "Needed unless you gave a student ID; it then defaults to that address."
            }
            defaultValue={value("email")}
            maxLength={254}
            autoComplete="off"
          />
          {hostel && (
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${id}-hostel`} className="text-sm font-bold text-ink">
                {hostel.label}
              </label>
              <select
                id={`${id}-hostel`}
                name="hostel_id"
                key={`hostel-${round}`}
                defaultValue={value("hostel_id")}
                required={hostel.required}
                aria-describedby={`${id}-hostel-hint`}
                className={SELECT}
              >
                <option value="">{hostel.required ? "Choose a hostel" : "Not chosen yet"}</option>
                {hostels.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
              <p id={`${id}-hostel-hint`} className="text-sm text-muted">
                {hostel.hint}
              </p>
            </div>
          )}
          <Field
            id={`${id}-phone`}
            name="phone"
            type="tel"
            label="Phone (optional)"
            defaultValue={value("phone")}
            maxLength={24}
            autoComplete="off"
          />
          {student && (
            <fieldset className="flex flex-col gap-4">
              <legend className="mb-1 text-sm text-muted">
                Parent (optional): their emergency contact. Give both or neither.
              </legend>
              <Field
                id={`${id}-parent-name`}
                name="parent_name"
                label="Parent's name"
                defaultValue={value("parent_name")}
                maxLength={100}
                autoComplete="off"
              />
              <Field
                id={`${id}-parent-phone`}
                name="parent_phone"
                type="tel"
                label="Parent's number"
                defaultValue={value("parent_phone")}
                maxLength={24}
                autoComplete="off"
              />
            </fieldset>
          )}
          <FormError message={state.error} />
          <div className="flex flex-wrap gap-2">
            <SubmitButton pendingLabel="Adding…">Add and email link</SubmitButton>
            <button
              type="button"
              onClick={() => dialog.current?.close()}
              className="min-h-12 rounded-control px-5 font-bold text-accent ring-1 ring-line hover:bg-accent-soft"
            >
              Close
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
