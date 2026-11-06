"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useId, useRef, useTransition, type ReactNode } from "react";

import { FormError } from "@/components/ui/Field";
import { SubmitButton } from "@/components/ui/SubmitButton";
import {
  canSignOut,
  canSignOutOthers,
  knowsThisDevice,
  type DeviceRow,
} from "@/features/account/devices";
import { signOutDevice, signOutOtherDevices } from "@/features/auth/actions";
import type { FormState } from "@/lib/types";

const EMPTY: FormState = { error: null };

// The same confirm-then-act dialog as the People page's account controls.
const TRIGGER =
  "inline-flex min-h-11 items-center rounded-control px-3.5 text-sm font-bold text-danger ring-1 ring-line hover:bg-danger-soft";
const CLOSE =
  "min-h-12 rounded-control px-5 font-bold text-accent ring-1 ring-line hover:bg-accent-soft";
const DIALOG =
  "m-auto max-h-[calc(100dvh-2rem)] w-[min(32rem,calc(100vw-2rem))] overflow-y-auto rounded-sheet border border-line bg-surface p-5 text-left text-ink backdrop:bg-[rgba(var(--tint),0.55)] sm:p-6";

/**
 * A button that opens a native modal dialog (focus stays inside, Escape closes it, focus returns
 * to the button). It closes once its form reports success.
 */
function ConfirmDialog({
  label,
  name,
  title,
  result,
  children,
}: {
  label: string;
  /** The button's accessible name, starting with its visible words. */
  name: string;
  title: string;
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
        aria-label={name}
        className={TRIGGER}
      >
        {label}
      </button>
      <dialog ref={dialog} aria-labelledby={titleId} className={DIALOG}>
        <div className="flex flex-col gap-4">
          <h3 id={titleId} className="font-display text-xl text-ink">
            {title}
          </h3>
          {children}
        </div>
      </dialog>
    </>
  );
}

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
 * The signed-in devices with a Sign out on every row but this one, and "Sign out of all other
 * devices". Rows come with their times already formatted on the server (IST), so the HTML the
 * server sends and the one React hydrates are the same.
 */
export function DeviceList({
  rows,
  headingId,
}: {
  rows: DeviceRow[];
  headingId: string;
}): ReactNode {
  // One state for both actions, so the status line always says what happened last.
  const [state, act] = useActionState(
    (previous: FormState, form: FormData) =>
      form.get("intent") === "others"
        ? signOutOtherDevices(previous)
        : signOutDevice(previous, form),
    EMPTY,
  );
  // The button that was used may be gone with its row: put focus somewhere that makes sense.
  useEffect(() => {
    if (state.notice) document.getElementById(headingId)?.focus();
  }, [state, headingId]);

  const thisKnown = knowsThisDevice(rows);
  const onlyThis = thisKnown && rows.length === 1;
  const otherCount = rows.filter(canSignOut).length;

  return (
    <div className="flex flex-col gap-3" data-state="ready">
      {!thisKnown && rows.length > 0 && (
        <p className="rounded-control bg-accent-soft px-4 py-3 text-sm text-ink">
          This browser signed in before Lumiback named devices, so it isn&apos;t marked below. To
          sign out of every other device at once, sign out here and sign back in first.
        </p>
      )}
      {rows.length === 0 ? (
        <p className="text-muted">No devices are signed in.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line rounded-sheet border border-line bg-surface">
          {rows.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-4"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="break-words font-bold text-ink">{row.name}</span>
                  {row.current && (
                    <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-bold text-accent">
                      This device
                    </span>
                  )}
                </p>
                <p className="text-sm tabular-nums text-muted">Signed in {row.signedIn}</p>
                <p className="text-sm tabular-nums text-muted">Last active {row.lastActive}</p>
              </div>
              {canSignOut(row) && (
                <ConfirmDialog
                  label="Sign out"
                  name={`Sign out: ${row.name}`}
                  title={`Sign out of ${row.name}?`}
                  result={state}
                >
                  <form action={act} className="flex flex-col gap-4">
                    <input type="hidden" name="device_id" value={row.id} />
                    <input type="hidden" name="device_name" value={row.name} />
                    <p className="text-ink">
                      {row.name} (last active {row.lastActive}) is signed out right away and gets no
                      more notifications. Signing in there again needs your password.
                    </p>
                    <FormError message={state.error} />
                    <div className="flex flex-wrap gap-2">
                      <SubmitButton variant="danger" pendingLabel="Signing out…">
                        Sign out
                      </SubmitButton>
                      <CloseButton>Keep it signed in</CloseButton>
                    </div>
                  </form>
                </ConfirmDialog>
              )}
            </li>
          ))}
        </ul>
      )}
      {onlyThis && <p className="text-sm text-muted">No other devices are signed in.</p>}
      {canSignOutOthers(rows) && (
        <div className="flex">
          <ConfirmDialog
            label="Sign out of all other devices"
            name="Sign out of all other devices"
            title={
              otherCount === 1
                ? "Sign out of 1 other device?"
                : `Sign out of ${otherCount} other devices?`
            }
            result={state}
          >
            <form action={act} className="flex flex-col gap-4">
              <input type="hidden" name="intent" value="others" />
              <p className="text-ink">
                Every device except this one is signed out right away and gets no more
                notifications. You stay signed in here.
              </p>
              <FormError message={state.error} />
              <div className="flex flex-wrap gap-2">
                <SubmitButton variant="danger" pendingLabel="Signing out…">
                  Sign out of others
                </SubmitButton>
                <CloseButton>Cancel</CloseButton>
              </div>
            </form>
          </ConfirmDialog>
        </div>
      )}
      <p aria-live="polite" className="text-sm empty:hidden">
        {state.error ? (
          <span className="font-bold text-danger">{state.error}</span>
        ) : state.notice ? (
          <span className="text-good">{state.notice}</span>
        ) : null}
      </p>
    </div>
  );
}

/** The list couldn't be loaded: say so, and try again in place. */
export function DevicesError(): ReactNode {
  const router = useRouter();
  const [retrying, startRetry] = useTransition();
  return (
    <div
      data-state="error"
      className="flex flex-col items-start gap-3 rounded-sheet border border-line bg-surface px-5 py-4"
    >
      <p role="alert" className="text-ink">
        Your devices couldn&apos;t be loaded just now.
      </p>
      <button
        type="button"
        onClick={() => startRetry(() => router.refresh())}
        aria-disabled={retrying}
        className="min-h-11 rounded-control px-4 text-sm font-bold text-accent ring-1 ring-line hover:bg-accent-soft"
      >
        {retrying ? "Trying again…" : "Try again"}
      </button>
    </div>
  );
}
