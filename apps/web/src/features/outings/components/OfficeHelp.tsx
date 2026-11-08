"use client";

import { Phone } from "@phosphor-icons/react";
import {
  startTransition,
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import { FormError } from "@/components/ui/Field";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { telHref } from "@/features/admin/alerts";
import { formatPhone } from "@/features/admin/format";
import { askForHelp, askOfficeToCall, type HelpState } from "@/features/outings/actions";
import { helpTold, officeChoice } from "@/features/outings/alerts";
import type { FormState, OfficeContact } from "@/lib/types";

const EMPTY: FormState = { error: null };
const NO_HELP_YET: HelpState = { error: null, sent: null };

const DIALOG =
  "m-auto max-h-[calc(100dvh-2rem)] w-[min(32rem,calc(100vw-2rem))] overflow-y-auto rounded-sheet border border-line bg-surface p-5 text-left text-ink backdrop:bg-[rgba(var(--tint),0.55)] sm:p-6";
const CLOSE =
  "min-h-12 rounded-control px-5 font-bold text-accent ring-1 ring-line hover:bg-accent-soft";

/** How long to wait for the one location fix before sending without it. */
const FIX_TIMEOUT_MS = 10_000;

/**
 * One location fix from the browser, or null if it can't or won't give one in time. Some
 * browsers never answer while their permission prompt is ignored, so a timer of our own ends
 * the wait too.
 */
function oneFix(): Promise<GeolocationCoordinates | null> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) {
      resolve(null);
      return;
    }
    const timer = window.setTimeout(() => resolve(null), FIX_TIMEOUT_MS + 2_000);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        window.clearTimeout(timer);
        resolve(position.coords);
      },
      () => {
        window.clearTimeout(timer);
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: FIX_TIMEOUT_MS, maximumAge: 60_000 },
    );
  });
}

/** The office number as a big tap-to-call link. */
function CallLink({ phone, who }: { phone: string; who: string | null }): ReactNode {
  return (
    <a
      href={telHref(phone)}
      className="press flex min-h-12 items-center gap-3 rounded-control bg-surface px-5 py-2 text-accent ring-1 ring-line hover:ring-accent/40"
    >
      <Phone aria-hidden="true" weight="bold" className="size-5 shrink-0" />
      <span className="flex min-w-0 flex-col">
        <span className="font-bold">Call the hostel office</span>
        <span className="truncate text-sm text-muted">
          {who ? `${who}, ` : ""}
          <span className="tabular-nums">{formatPhone(phone)}</span>
        </span>
      </span>
    </a>
  );
}

/** For a hostel with no office number: the office is told to call the student. */
function AskForCall(): ReactNode {
  const [state, action] = useActionState(askOfficeToCall, EMPTY);
  return (
    <form action={action} className="flex flex-col gap-2">
      <p className="text-sm text-muted">
        Your hostel hasn&apos;t added an office number yet. The office can call the number on your
        profile.
      </p>
      <SubmitButton variant="secondary" pendingLabel="Asking…" className="w-full">
        Ask the office to call me
      </SubmitButton>
      <p aria-live="polite" className="text-sm font-bold text-good empty:hidden">
        {state.notice ?? ""}
      </p>
      <FormError message={state.error} />
    </form>
  );
}

/**
 * While out or late: a way to reach the hostel office (its number, or "ask the office to call
 * me"), and Help, which asks first, then sends an urgent alert with one location fix.
 */
export function OfficeHelp({ office }: { office: OfficeContact | null | undefined }): ReactNode {
  const choice = officeChoice(office);
  const [state, dispatch, sending] = useActionState(askForHelp, NO_HELP_YET);
  const [locating, setLocating] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  // Set at once on submit, unlike state (read from the last render): a second submit in the
  // same frame, before React re-renders, still sees it and sends nothing.
  const inFlight = useRef(false);
  const id = useId();
  const busy = locating || sending;

  useEffect(() => {
    inFlight.current = false; // the action answered (a new state each time): sent or failed
    if (state.sent) dialog.current?.close();
  }, [state]);

  async function send(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (inFlight.current) return;
    inFlight.current = true;
    setLocating(true);
    const fix = await oneFix();
    setLocating(false);
    const form = new FormData();
    if (fix) {
      form.set("lat", String(fix.latitude));
      form.set("lng", String(fix.longitude));
      form.set("accuracy_m", String(fix.accuracy));
    }
    startTransition(() => dispatch(form));
  }

  // The number the API answered with is the freshest; else the one the page loaded with.
  const after = state.sent ? officeChoice(state.sent.office ?? office) : choice;
  const told = state.sent ? helpTold(state.sent) : null;

  return (
    <section aria-labelledby={`${id}-heading`} className="flex flex-col gap-3">
      <h2 id={`${id}-heading`} className="font-display text-xl text-ink">
        Hostel office
      </h2>

      {state.sent ? (
        <div
          role="status"
          className="flex flex-col gap-3 rounded-control bg-danger-soft px-4 py-3 text-ink"
        >
          <p>
            <strong className="text-lg">Help is on its way to the hostel office.</strong>
            {told ? ` ${told}` : ""}
          </p>
          {after.kind === "call" ? (
            <CallLink phone={after.phone} who={after.who} />
          ) : (
            <p className="text-sm">
              Your hostel has no office number yet. If you can, call your emergency contact too.
            </p>
          )}
        </div>
      ) : null}

      {!state.sent && choice.kind === "call" ? (
        <CallLink phone={choice.phone} who={choice.who} />
      ) : null}
      {choice.kind === "ask" ? <AskForCall /> : null}

      <button
        type="button"
        onClick={() => dialog.current?.showModal()}
        aria-describedby={`${id}-help-hint`}
        className="press min-h-12 rounded-control bg-danger px-5 text-base font-bold text-surface hover:brightness-110"
      >
        Help
      </button>
      <p id={`${id}-help-hint`} className="text-sm text-muted">
        If you&apos;re in trouble or feel unsafe. It asks before sending anything.
      </p>

      <dialog ref={dialog} aria-labelledby={`${id}-title`} className={DIALOG}>
        <form onSubmit={send} className="flex flex-col gap-4">
          <h3 id={`${id}-title`} className="font-display text-xl text-ink">
            Send a help alert?
          </h3>
          <p>
            The hostel office, the people you share your location with and your emergency contact
            are told. One location is sent, not tracking.
          </p>
          <FormError message={state.error} />
          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              aria-disabled={busy}
              className={`press min-h-12 rounded-control bg-danger px-5 text-base font-bold text-surface hover:brightness-110 ${
                busy ? "cursor-progress opacity-75" : ""
              }`}
            >
              <span aria-live="polite">
                {locating ? "Getting your location…" : sending ? "Sending…" : "Send help alert"}
              </span>
            </button>
            <button type="button" onClick={() => dialog.current?.close()} className={CLOSE}>
              Cancel
            </button>
          </div>
        </form>
      </dialog>
    </section>
  );
}
