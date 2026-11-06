"use client";

import { CaretDown } from "@phosphor-icons/react";
import { useActionState, useId, useState, type ReactNode } from "react";

import { Field, FormError } from "@/components/ui/Field";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { askCorrection } from "@/features/outings/actions";
import { timeKind } from "@/features/outings/corrections";
import { istInputValue } from "@/features/outings/time";
import type { CorrectionKind, FormState, Outing } from "@/lib/types";

const EMPTY: FormState = { error: null };

/**
 * "Something wrong?" under a history item: the student tells the hostel office when they
 * really came back (a forgotten tap-in), or that the trip didn't happen. The office decides.
 */
export function AskCorrection({
  outing,
  nowIso,
  open = false,
}: {
  outing: Outing;
  /** The server's request time: the default "came back at" for an open outing. */
  nowIso: string;
  /** Opened from Today's "Forgot to tap in?". */
  open?: boolean;
}): ReactNode {
  const id = useId();
  const [state, action] = useActionState(askCorrection, EMPTY);
  const fixTime = timeKind(outing);
  const [kind, setKind] = useState<CorrectionKind>(
    state.fields?.kind === "cancel" ? "cancel" : fixTime,
  );
  const unknownReturn = outing.in_via === "unrecorded";
  const defaultTime =
    state.fields?.returned_at ||
    (outing.returned_at && !unknownReturn
      ? istInputValue(outing.returned_at)
      : fixTime === "return"
        ? istInputValue(nowIso)
        : "");

  return (
    <details open={open} className="group mt-1">
      <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-sm font-bold text-accent">
        Something wrong?
        <CaretDown
          size={14}
          weight="bold"
          aria-hidden="true"
          className="transition-transform group-open:rotate-180 motion-reduce:transition-none"
        />
      </summary>
      <form
        action={action}
        className="mt-1 flex flex-col gap-4 rounded-control border border-line bg-surface p-4"
      >
        <input type="hidden" name="outing_id" value={outing.id} />
        <input type="hidden" name="left_at" value={outing.left_at} />
        <fieldset className="flex flex-col gap-1">
          <legend className="mb-1 text-sm font-bold text-ink">What&apos;s wrong?</legend>
          {(
            [
              {
                value: fixTime,
                label:
                  fixTime === "return"
                    ? "I'm back, I forgot to tap in"
                    : "I came back at a different time",
              },
              { value: "cancel", label: "This trip didn't happen" },
            ] as const
          ).map((choice) => (
            <label
              key={choice.value}
              className="flex min-h-11 cursor-pointer items-center gap-3 text-ink"
            >
              <input
                type="radio"
                name="kind"
                value={choice.value}
                checked={kind === choice.value}
                onChange={() => setKind(choice.value)}
                className="size-5 accent-accent"
              />
              {choice.label}
            </label>
          ))}
        </fieldset>
        {kind === "cancel" ? null : (
          <Field
            id={`${id}-time`}
            type="datetime-local"
            name="returned_at"
            label="When did you come back? (IST)"
            defaultValue={defaultTime}
            min={istInputValue(outing.left_at)}
            required
          />
        )}
        <Field
          id={`${id}-reason`}
          name="reason"
          label="What happened?"
          hint="A few words for the hostel office, like: my phone died at the gate."
          defaultValue={state.fields?.reason}
          minLength={3}
          maxLength={300}
          required
          autoComplete="off"
        />
        <FormError message={state.error} />
        <SubmitButton pendingLabel="Sending…" className="self-start">
          Send to the hostel office
        </SubmitButton>
      </form>
    </details>
  );
}
