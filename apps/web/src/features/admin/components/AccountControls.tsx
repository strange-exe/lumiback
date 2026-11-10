"use client";

import { useActionState, useEffect, useId, useRef, type ReactNode } from "react";

import { Field, FormError } from "@/components/ui/Field";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { cancelInvite, editAccount, setAccountOn } from "@/features/admin/actions";
import type { BackTo } from "@/features/admin/people-roles";
import type { AccountState, FormState, Role } from "@/lib/types";

const EMPTY: FormState = { error: null };

/** What the account controls need to know about one person. */
export interface AccountPerson {
  id: string;
  name: string;
  email: string;
  roll_no: string | null;
  role: Role;
  account: AccountState;
  /** Undefined when the list didn't include it: a blank field then keeps the number. */
  phone?: string | null;
}

const TRIGGER =
  "inline-flex min-h-11 items-center rounded-control px-3.5 text-sm font-bold ring-1 ring-line hover:bg-accent-soft";
const CLOSE =
  "min-h-12 rounded-control px-5 font-bold text-accent ring-1 ring-line hover:bg-accent-soft";
const DIALOG =
  "m-auto max-h-[calc(100dvh-2rem)] w-[min(32rem,calc(100vw-2rem))] overflow-y-auto rounded-sheet border border-line bg-surface p-5 text-left text-ink backdrop:bg-[rgba(var(--tint),0.55)] sm:p-6";

/** Closes the dialog it sits in, without sending its form. */
function CloseButton({ children }: { children: ReactNode }): ReactNode {
  return (
    <button
      type="button"
      onClick={(event) => event.currentTarget.closest("dialog")?.close()}
      className={CLOSE}
    >
      {children}
    </button>
  );
}

/**
 * A button that opens a native modal dialog (focus stays inside, Escape closes it, and focus
 * returns to the button), like the register's correction dialogs. It closes itself once its
 * form reports success.
 */
function ActionDialog({
  label,
  person,
  title,
  tone = "accent",
  result,
  children,
}: {
  label: string;
  person: string;
  title: string;
  tone?: "accent" | "danger";
  /** The form's latest result: a notice means it succeeded (each result is a new object). */
  result: FormState;
  children: ReactNode;
}): ReactNode {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (result.notice) dialog.current?.close();
  }, [result]);
  return (
    <>
      <button
        type="button"
        onClick={() => dialog.current?.showModal()}
        // The name starts with the visible words, then whose: "Turn off: Kabir Mehta". (An
        // sr-only span would be read as "Turn off : Kabir Mehta".)
        aria-label={`${label}: ${person}`}
        className={`${TRIGGER} ${tone === "danger" ? "text-danger" : "text-accent"}`}
      >
        {label}
      </button>
      <dialog ref={dialog} aria-labelledby={titleId} className={DIALOG}>
        <div className="flex flex-col gap-4">
          <h2 id={titleId} className="font-display text-xl text-ink">
            {title}
          </h2>
          {children}
        </div>
      </dialog>
    </>
  );
}

/** A control's result, after the buttons, announced to screen readers. */
function Status({ state }: { state: FormState }): ReactNode {
  return (
    <p aria-live="polite" className="order-last basis-full text-sm empty:hidden">
      {state.error ? (
        <span className="font-bold text-danger">{state.error}</span>
      ) : state.notice ? (
        <span className="text-good">{state.notice}</span>
      ) : null}
    </p>
  );
}

function EditDetails({
  person,
  canEditEmail,
}: {
  person: AccountPerson;
  canEditEmail: boolean;
}): ReactNode {
  const [state, action] = useActionState(editAccount, EMPTY);
  const id = useId();
  const phoneKnown = person.phone !== undefined;
  return (
    <>
      <ActionDialog
        label="Edit details"
        person={person.name}
        title={`Edit details: ${person.name}`}
        result={state}
      >
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="user_id" value={person.id} />
          <input type="hidden" name="phone_known" value={String(phoneKnown)} />
          <Field
            id={`${id}-name`}
            name="name"
            label="Name"
            defaultValue={state.fields?.name ?? person.name}
            maxLength={100}
            required
            autoComplete="off"
          />
          {canEditEmail && (
            <>
              <input type="hidden" name="email_was" value={person.email} />
              <Field
                id={`${id}-email`}
                name="email"
                type="email"
                label="University email"
                hint="They sign in with it. A new address signs them out and ends their password: we email it a link to choose a new one."
                defaultValue={state.fields?.email ?? person.email}
                maxLength={254}
                required
                autoComplete="off"
              />
            </>
          )}
          <Field
            id={`${id}-roll`}
            name="roll_no"
            label="Roll no. (optional)"
            hint="3 to 32 letters or digits. Leave it blank to remove it."
            defaultValue={state.fields?.roll_no ?? person.roll_no ?? ""}
            pattern="[A-Za-z0-9]{3,32}"
            maxLength={32}
            autoComplete="off"
          />
          <Field
            id={`${id}-phone`}
            name="phone"
            type="tel"
            label="Phone (optional)"
            hint={
              phoneKnown
                ? "Leave it blank to remove it."
                : "Leave it blank to keep the number on record."
            }
            defaultValue={state.fields?.phone ?? person.phone ?? ""}
            maxLength={24}
            autoComplete="off"
          />
          <FormError message={state.error} />
          <div className="flex flex-wrap gap-2">
            <SubmitButton pendingLabel="Saving…">Save details</SubmitButton>
            <CloseButton>Close</CloseButton>
          </div>
        </form>
      </ActionDialog>
      <Status state={state} />
    </>
  );
}

/** Turning off asks first and says what it does; turning back on doesn't need to. */
function TurnOnOff({ person }: { person: AccountPerson }): ReactNode {
  const [state, action] = useActionState(setAccountOn, EMPTY);
  if (person.account === "off") {
    return (
      <form action={action} className="contents">
        <input type="hidden" name="user_id" value={person.id} />
        <input type="hidden" name="on" value="true" />
        {/* Named by its row (the person's list item), like Move and Send password link. */}
        <SubmitButton variant="secondary" pendingLabel="Turning on…" className="min-h-11 text-sm">
          Turn on
        </SubmitButton>
        <Status state={state} />
      </form>
    );
  }
  return (
    <>
      <ActionDialog
        label="Turn off"
        person={person.name}
        title={`Turn off ${person.name}'s account?`}
        tone="danger"
        result={state}
      >
        <form action={action} className="flex flex-col gap-4">
          <input type="hidden" name="user_id" value={person.id} />
          <input type="hidden" name="on" value="false" />
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-ink">
            <li>They&apos;re signed out on every phone and browser, and live shares end.</li>
            <li>They can&apos;t sign in until the account is turned back on.</li>
            {person.role !== "student" && (
              <li>Asks for their hostels go to the rest of the hostel office.</li>
            )}
            <li>Their outings and history are kept.</li>
          </ul>
          <FormError message={state.error} />
          <div className="flex flex-wrap gap-2">
            <SubmitButton variant="danger" pendingLabel="Turning off…">
              Turn off
            </SubmitButton>
            <CloseButton>Keep it on</CloseButton>
          </div>
        </form>
      </ActionDialog>
      <Status state={state} />
    </>
  );
}

/** Admins only, for an account nobody has set up. Success reloads the list without the row. */
function CancelInvite({ person, back }: { person: AccountPerson; back: BackTo }): ReactNode {
  const [state, action] = useActionState(cancelInvite, EMPTY);
  return (
    <ActionDialog
      label="Cancel invite"
      person={person.name}
      title={`Cancel ${person.name}'s invite?`}
      tone="danger"
      result={state}
    >
      <form action={action} className="flex flex-col gap-4">
        <input type="hidden" name="user_id" value={person.id} />
        {/* The list it came from (search, filters, role chip, page): reloaded as it was. */}
        {(Object.keys(back) as (keyof BackTo)[]).map((key) => (
          <input key={key} type="hidden" name={key} value={back[key]} />
        ))}
        <p className="text-ink">
          Their account is removed and the set-up link emailed to{" "}
          <span className="break-all font-bold">{person.email}</span> stops working. You can add
          them again later.
        </p>
        <FormError message={state.error} />
        <div className="flex flex-wrap gap-2">
          <SubmitButton variant="danger" pendingLabel="Cancelling…">
            Cancel invite
          </SubmitButton>
          <CloseButton>Keep invite</CloseButton>
        </div>
      </form>
    </ActionDialog>
  );
}

/**
 * Edit details, turn off / on, and (admins, unset-up accounts) cancel the invite. The page shows
 * this only for people the signed-in role may change: never their own account.
 */
export function AccountControls({
  person,
  isAdmin,
  back,
}: {
  person: AccountPerson;
  isAdmin: boolean;
  back: BackTo;
}): ReactNode {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <EditDetails person={person} canEditEmail={isAdmin} />
      <TurnOnOff person={person} />
      {isAdmin && person.account === "invited" && <CancelInvite person={person} back={back} />}
    </div>
  );
}
