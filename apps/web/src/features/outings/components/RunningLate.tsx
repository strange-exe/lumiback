"use client";

import { useActionState, useEffect, useId, useRef, useState, type ReactNode } from "react";

import { FormError } from "@/components/ui/Field";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { sayRunningLate } from "@/features/outings/actions";
import {
  confirmLine,
  lateReason,
  MAX_LATE_REASON,
  type LateMinutes,
} from "@/features/outings/running-late";
import { formatMinutes } from "@/features/outings/time";
import type { FormState } from "@/lib/types";

const EMPTY: FormState = { error: null };

const DIALOG =
  "m-auto max-h-[calc(100dvh-2rem)] w-[min(32rem,calc(100vw-2rem))] overflow-y-auto rounded-sheet border border-line bg-surface p-5 text-left text-ink backdrop:bg-[rgba(var(--tint),0.55)] sm:p-6";
const QUIET =
  "min-h-12 rounded-control px-5 font-bold text-accent ring-1 ring-line hover:bg-accent-soft";
const CHOICE =
  "flex min-h-12 min-w-20 cursor-pointer items-center justify-center rounded-control border border-line bg-surface px-4 font-bold text-ink tabular-nums has-[:checked]:border-accent has-[:checked]:bg-accent has-[:checked]:text-on-accent has-[:focus-visible]:outline has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent";

type Step = { kind: "choose" } | { kind: "confirm"; minutes: LateMinutes; reason: string | null };

/**
 * "Running late?": move the due-back time by one of the offered amounts, once per outing, with
 * an optional reason only the hostel office sees. Asks first, stating the new time. Shown only
 * while the server offers a choice; after it is used the page reloads without it.
 */
export function RunningLate({
  dueAt,
  choices,
}: {
  /** The current due-back time (ISO, IST). */
  dueAt: string;
  /** What the server offers now: never empty here. */
  choices: LateMinutes[];
}): ReactNode {
  const [state, action] = useActionState(sayRunningLate, EMPTY);
  const [step, setStep] = useState<Step>({ kind: "choose" });
  const [picked, setPicked] = useState<LateMinutes>(choices[0]);
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  // The answer already seen when the dialog last opened: a refusal shows once, not again
  // on the next try's confirm step.
  const [seen, setSeen] = useState<FormState | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();

  useEffect(() => {
    if (state.notice) dialog.current?.close();
  }, [state]);

  function open(): void {
    setStep({ kind: "choose" });
    setProblem(null);
    setSeen(state);
    if (!choices.includes(picked)) setPicked(choices[0]);
    dialog.current?.showModal();
  }

  function next(): void {
    const checked = lateReason(reason);
    if (!checked.ok) {
      setProblem(checked.error);
      return;
    }
    setProblem(null);
    setStep({ kind: "confirm", minutes: picked, reason: checked.value });
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={open}
        aria-describedby={`${id}-hint`}
        className="press min-h-12 rounded-control bg-surface px-5 font-bold text-accent ring-1 ring-line hover:ring-accent/40"
      >
        Running late?
      </button>
      <p id={`${id}-hint`} className="text-sm text-muted">
        Tell the hostel office you&apos;ll be back a little later. Once per outing.
      </p>

      <dialog
        ref={dialog}
        aria-labelledby={`${id}-title`}
        className={DIALOG}
        onClose={() => setStep({ kind: "choose" })}
      >
        {step.kind === "choose" ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              next();
            }}
            className="flex flex-col gap-4"
          >
            <h3 id={`${id}-title`} className="font-display text-xl text-ink">
              How much later will you be?
            </h3>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-sm font-bold text-ink">Extra time</legend>
              <div className="flex flex-wrap gap-2">
                {choices.map((m) => (
                  <label key={m} className={CHOICE}>
                    <input
                      type="radio"
                      name="minutes-choice"
                      value={m}
                      checked={picked === m}
                      onChange={() => setPicked(m)}
                      className="sr-only"
                    />
                    {formatMinutes(m)}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${id}-reason`} className="text-sm font-bold text-ink">
                Reason (optional)
              </label>
              <input
                id={`${id}-reason`}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={MAX_LATE_REASON}
                autoComplete="off"
                placeholder="Bus is running late"
                aria-describedby={`${id}-reason-hint`}
                className="min-h-12 rounded-control border border-line bg-page px-4 text-base text-ink placeholder:text-muted/70 focus:border-accent focus:outline-none"
              />
              <p id={`${id}-reason-hint`} className="text-sm text-muted">
                Only the hostel office sees it. People you share your location with see just the new
                time.
              </p>
            </div>
            <FormError message={problem} />
            <div className="flex flex-wrap gap-3">
              <button
                type="submit"
                className="press min-h-12 rounded-control bg-accent px-5 font-bold text-on-accent hover:brightness-105"
              >
                Next
              </button>
              <button type="button" onClick={() => dialog.current?.close()} className={QUIET}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <form action={action} className="flex flex-col gap-4">
            <h3 id={`${id}-title`} className="font-display text-xl text-ink">
              Move your due-back time?
            </h3>
            <p>{confirmLine(dueAt, step.minutes)}</p>
            {step.reason ? (
              <p className="break-words text-sm text-muted">Reason: {step.reason}</p>
            ) : null}
            <input type="hidden" name="minutes" value={step.minutes} />
            <input type="hidden" name="reason" value={step.reason ?? ""} />
            <FormError message={state === seen ? null : state.error} />
            <div className="flex flex-wrap gap-3">
              <SubmitButton pendingLabel="Telling the office…">Tell the hostel office</SubmitButton>
              <button type="button" onClick={() => setStep({ kind: "choose" })} className={QUIET}>
                Back
              </button>
            </div>
          </form>
        )}
      </dialog>
    </div>
  );
}
