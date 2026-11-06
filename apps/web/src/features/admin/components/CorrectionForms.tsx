"use client";

import { useActionState, useEffect, useId, useRef, type ReactNode } from "react";

import { Field, FormError } from "@/components/ui/Field";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { correctOuting, decideCorrection } from "@/features/admin/actions";
import { formatWhen } from "@/features/admin/format";
import { askedFor, inViaLabel } from "@/features/outings/corrections";
import { istInputValue } from "@/features/outings/time";
import type { AdminOuting, CorrectionAsk, CorrectionKind, FormState } from "@/lib/types";

const EMPTY: FormState = { error: null };

const TITLE: Record<CorrectionKind, string> = {
  return: "Record return",
  return_time: "Fix return time",
  cancel: "It didn't happen",
};

const SUBMIT: Record<CorrectionKind, string> = {
  return: "Record return",
  return_time: "Save return time",
  cancel: "Cancel this outing",
};

/** Where, when they left, and how it ended so far: one line under a name. */
function outingLine(outing: AdminOuting, now: Date): string {
  const back = outing.returned_at
    ? outing.in_via === "unrecorded"
      ? "return time not recorded"
      : `back ${formatWhen(outing.returned_at, now)}`
    : "not back yet";
  return [
    outing.destination ? `to ${outing.destination}` : null,
    `left ${formatWhen(outing.left_at, now)}`,
    `due ${formatWhen(outing.expected_return_at, now)}`,
    back,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The time (unless cancelling) and the reason. Hidden fields say which outing and what kind. */
function CorrectionFields({
  outing,
  kind,
  nowIso,
  state,
}: {
  outing: AdminOuting;
  kind: CorrectionKind;
  nowIso: string;
  state: FormState;
}): ReactNode {
  const id = useId();
  // Recording a return: now. Fixing one: the time on record. Unrecorded: no guess (the time on
  // record is when they next tapped out, so it is only an upper bound).
  let time = state.fields?.returned_at ?? "";
  if (!time && kind === "return") time = istInputValue(nowIso);
  if (!time && outing.returned_at && outing.in_via !== "unrecorded") {
    time = istInputValue(outing.returned_at);
  }
  return (
    <>
      <input type="hidden" name="outing_id" value={outing.id} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="left_at" value={outing.left_at} />
      {kind === "cancel" ? (
        <p className="text-ink">
          For a mistaken tap: the outing stays on the record as cancelled and isn&apos;t counted as
          a trip or as late.
        </p>
      ) : (
        <Field
          id={`${id}-time`}
          type="datetime-local"
          name="returned_at"
          label="Came back at (IST)"
          hint={`They left ${formatWhen(outing.left_at, new Date(nowIso))}.`}
          defaultValue={time}
          min={istInputValue(outing.left_at)}
          required
        />
      )}
      <Field
        id={`${id}-reason`}
        name="reason"
        label="Reason"
        hint="Kept on the record with your name. The student sees the change, not the reason."
        defaultValue={state.fields?.reason}
        minLength={3}
        maxLength={300}
        required
        autoComplete="off"
      />
    </>
  );
}

/**
 * A register row's correction (record a return, fix a return time, cancel a mistaken tap),
 * in a native modal dialog: it keeps focus inside, closes on Escape, and gives focus back to
 * the button that opened it.
 */
export function CorrectionDialog({
  outing,
  kind,
  nowIso,
}: {
  outing: AdminOuting;
  kind: CorrectionKind;
  nowIso: string;
}): ReactNode {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [state, action] = useActionState(correctOuting, EMPTY);
  useEffect(() => {
    if (state.notice) dialog.current?.close();
  }, [state]);
  return (
    <>
      <button
        type="button"
        onClick={() => dialog.current?.showModal()}
        className={`inline-flex min-h-10 items-center rounded-control px-3 text-sm font-bold ring-1 ring-line hover:bg-accent-soft ${
          kind === "cancel" ? "text-danger" : "text-accent"
        }`}
      >
        {TITLE[kind]}
        <span className="sr-only">: {outing.name}</span>
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        className="m-auto max-h-[calc(100dvh-2rem)] w-[min(32rem,calc(100vw-2rem))] overflow-y-auto rounded-sheet border border-line bg-surface p-5 text-left text-ink backdrop:bg-[rgba(var(--tint),0.55)] sm:p-6"
      >
        <form action={action} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h2 id={titleId} className="font-display text-xl text-ink">
              {TITLE[kind]}: {outing.name}
            </h2>
            <p className="text-sm text-muted">{outingLine(outing, new Date(nowIso))}</p>
          </div>
          <CorrectionFields outing={outing} kind={kind} nowIso={nowIso} state={state} />
          <FormError message={state.error} />
          <div className="flex flex-wrap gap-2">
            <SubmitButton pendingLabel="Saving…" variant={kind === "cancel" ? "danger" : "primary"}>
              {SUBMIT[kind]}
            </SubmitButton>
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
    </>
  );
}

/** Who and which hostel, as a card heading. */
function CardHeader({ outing, headingId }: { outing: AdminOuting; headingId: string }): ReactNode {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <h3 id={headingId} className="font-display text-xl text-ink">
        {outing.name}
      </h3>
      <p className="truncate text-sm text-muted">
        {[outing.roll_no, outing.hostel ?? "No hostel chosen", outing.email]
          .filter(Boolean)
          .join(" · ")}
      </p>
    </div>
  );
}

const CARD = "flex flex-col gap-4 rounded-sheet border border-line bg-surface p-5 sm:p-6";
const PAIR = "flex flex-col gap-0.5 sm:contents";

/** A student's ask: what happened by their account, and Approve / Decline. */
export function CorrectionAskCard({
  ask,
  nowIso,
}: {
  ask: CorrectionAsk;
  nowIso: string;
}): ReactNode {
  const { correction, outing } = ask;
  const [state, action] = useActionState(decideCorrection, EMPTY);
  const headingId = `ask-${correction.id}`;
  const via = outing.in_via === "staff" ? inViaLabel(outing.in_via) : null; // unrecorded: in the line
  const now = new Date(nowIso);
  return (
    <article aria-labelledby={headingId} className={CARD}>
      <CardHeader outing={outing} headingId={headingId} />
      {/* Label above value on a phone (each pair grouped), side by side from sm up. */}
      <dl className="flex flex-col gap-3 sm:grid sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-x-6">
        <div className={PAIR}>
          <dt className="text-sm text-muted">Outing</dt>
          <dd className="text-sm text-ink">
            {outingLine(outing, now)}
            {via ? ` (${via.toLowerCase()})` : ""}
          </dd>
        </div>
        <div className={PAIR}>
          <dt className="text-sm text-muted">They say</dt>
          <dd className="font-bold text-ink">
            {correction.kind === "cancel"
              ? "This trip didn't happen"
              : `They ${askedFor(correction, outing.left_at)}`}
          </dd>
        </div>
        <div className={PAIR}>
          <dt className="text-sm text-muted">Why</dt>
          <dd className="break-words text-ink">{correction.reason}</dd>
        </div>
        <div className={PAIR}>
          <dt className="text-sm text-muted">Asked</dt>
          <dd className="text-sm text-ink">{formatWhen(correction.created_at, now)}</dd>
        </div>
      </dl>
      <form action={action} className="flex flex-col gap-3 border-t border-line pt-4">
        <input type="hidden" name="correction_id" value={correction.id} />
        <Field
          id={`${headingId}-note`}
          name="note"
          label="Note to the student (optional)"
          hint="They see it with your answer."
          maxLength={300}
          defaultValue={state.fields?.note}
          autoComplete="off"
        />
        <div className="flex flex-wrap items-center gap-2">
          <SubmitButton name="decision" value="approve" pendingLabel="Saving…">
            Approve
          </SubmitButton>
          <SubmitButton name="decision" value="decline" variant="secondary" pendingLabel="Saving…">
            Decline
          </SubmitButton>
        </div>
        <FormError message={state.error} />
      </form>
    </article>
  );
}

/** An outing closed without a known return time: set it, with a reason. */
export function UnrecordedCard({
  outing,
  nowIso,
}: {
  outing: AdminOuting;
  nowIso: string;
}): ReactNode {
  const [state, action] = useActionState(correctOuting, EMPTY);
  const headingId = `unrecorded-${outing.id}`;
  return (
    <article aria-labelledby={headingId} className={CARD}>
      <CardHeader outing={outing} headingId={headingId} />
      <p className="text-sm text-ink">{outingLine(outing, new Date(nowIso))}</p>
      <form action={action} className="flex flex-col gap-3 border-t border-line pt-4">
        <CorrectionFields outing={outing} kind="return_time" nowIso={nowIso} state={state} />
        <FormError message={state.error} />
        <SubmitButton pendingLabel="Saving…" className="self-start">
          Save return time
        </SubmitButton>
      </form>
    </article>
  );
}
