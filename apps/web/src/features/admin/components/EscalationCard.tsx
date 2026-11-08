"use client";

import { CheckCircle, MapPin, Warning } from "@phosphor-icons/react";
import { useActionState, useId, type ReactNode } from "react";

import { FormError } from "@/components/ui/Field";
import { SubmitButton } from "@/components/ui/SubmitButton";
import {
  claimEscalation,
  logEscalationCall,
  releaseEscalation,
} from "@/features/admin/alert-actions";
import { CALL_OUTCOMES, canGiveBack, OUTCOME_LABELS } from "@/features/admin/alerts";
import { Contact } from "@/features/admin/components/Contact";
import { formatWhen } from "@/features/admin/format";
import { resolveEscalation } from "@/features/admin/rules-actions";
import { formatMinutes } from "@/features/outings/time";
import type { Escalation, FormState, Role } from "@/lib/types";

const EMPTY: FormState = { error: null };

const REPLY = { on_my_way: "Answered: on the way", safe: "Answered: safe" } as const;

/**
 * A late student who didn't answer the "are you OK?" alert (a notification in the app, or an
 * email if they only use the website): who to call, and where they were last seen. `role`: the
 * viewer's, for who may give back someone else's claim (the API decides again).
 */
export function EscalationCard({
  escalation: e,
  role,
}: {
  escalation: Escalation;
  role: Role;
}): ReactNode {
  const [state, action] = useActionState(resolveEscalation, EMPTY);
  const open = e.resolved_at === null;
  const calls = e.calls ?? [];
  return (
    <article
      aria-labelledby={`escalation-${e.id}`}
      className={`flex flex-col gap-5 rounded-sheet border bg-surface p-5 sm:p-6 ${
        open ? "border-danger/50" : "border-line"
      }`}
    >
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id={`escalation-${e.id}`} className="font-display text-xl text-ink">
            {e.name}
          </h2>
          <p className="truncate text-sm text-muted">
            {[e.roll_no, e.hostel ?? "No hostel chosen", e.email].filter(Boolean).join(" · ")}
          </p>
        </div>
        <span className="flex flex-wrap gap-1.5">
          {open && e.handed_over_at ? (
            <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-sm font-bold text-accent">
              With the head warden
            </span>
          ) : null}
          <span
            className={`rounded-full px-2.5 py-0.5 text-sm font-bold ${
              e.returned_at ? "bg-good-soft text-good" : "bg-danger-soft text-danger"
            }`}
          >
            {e.returned_at
              ? `Back at ${formatWhen(e.returned_at)}`
              : `${formatMinutes(e.late_minutes)} late`}
          </span>
        </span>
      </header>

      <p className="text-sm text-muted">
        Left {formatWhen(e.left_at)}
        {e.destination ? ` for ${e.destination}` : ""}
        {e.purpose ? ` (${e.purpose})` : ""} · due back {formatWhen(e.expected_return_at)}
        {e.alert_at ? ` · alerted ${formatWhen(e.alert_at)}` : ""}
        {e.late_reply ? (
          <strong className="text-ink"> · {REPLY[e.late_reply]}</strong>
        ) : (
          " · no answer"
        )}
      </p>

      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
        <Contact label="Student" phone={e.phone} />
        <Contact
          label={`Emergency contact${e.emergency_relation ? ` (${e.emergency_relation})` : ""}`}
          name={e.emergency_name}
          phone={e.emergency_phone}
        />
        <Contact
          label={`Warden${e.hostel ? `, ${e.hostel}` : ""}`}
          name={e.warden_name}
          phone={e.warden_phone}
        />
      </dl>

      {open && e.returned_at ? (
        <p
          role="status"
          className="flex items-center gap-2 rounded-control bg-good-soft px-4 py-3 text-ink"
        >
          <CheckCircle aria-hidden="true" weight="fill" className="size-5 shrink-0 text-good" />
          <span>
            <strong className="text-lg">Back at {formatWhen(e.returned_at)}</strong>. Mark this as
            handled once you&apos;ve checked in with them.
          </span>
        </p>
      ) : null}

      {open && !e.returned_at ? <LastSeen escalation={e} /> : null}

      {open ? <Claim escalation={e} role={role} /> : null}

      {calls.length > 0 || open ? (
        <section aria-labelledby={`calls-${e.id}`} className="flex flex-col gap-3">
          <h3 id={`calls-${e.id}`} className="font-bold text-ink">
            Calls
          </h3>
          {calls.length > 0 ? (
            <ol className="flex flex-col divide-y divide-line border-y border-line text-sm">
              {calls.map((call, index) => (
                <li key={`${call.at}-${index}`} className="flex flex-col gap-0.5 py-2">
                  <p className="text-ink">
                    <strong>{OUTCOME_LABELS[call.outcome]}</strong>
                    <span className="text-muted">
                      {" "}
                      · {formatWhen(call.at)}, {call.by ?? "a former staff member"}
                    </span>
                  </p>
                  {call.note ? <p className="text-muted">{call.note}</p> : null}
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted">No calls logged yet.</p>
          )}
          {open ? <LogCall escalationId={e.id} /> : null}
        </section>
      ) : null}

      {open ? (
        <form action={action} className="flex flex-col gap-3 border-t border-line pt-4">
          <input type="hidden" name="escalation_id" value={e.id} />
          <label className="flex flex-col gap-1.5 text-sm font-bold text-ink">
            What happened
            <input
              name="note"
              defaultValue={state.fields?.note}
              maxLength={200}
              placeholder="Called her mother: the bus was late"
              className="min-h-12 rounded-control border border-line bg-page px-4 font-normal text-ink focus:border-accent focus:outline-none"
            />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <SubmitButton pendingLabel="Saving…">Mark as handled</SubmitButton>
            <p role="alert" className="text-sm font-bold text-danger">
              {state.error ?? ""}
            </p>
          </div>
        </form>
      ) : (
        <p className="border-t border-line pt-3 text-sm text-muted">
          Handled by {e.resolved_by ?? "an admin"}
          {e.resolved_at ? `, ${formatWhen(e.resolved_at)}` : ""}
          {e.note ? `: “${e.note}”` : ""}
        </p>
      )}
    </article>
  );
}

/** "I'm on it" and "Give back": who is following this up, so two people don't both call. */
function Claim({ escalation: e, role }: { escalation: Escalation; role: Role }): ReactNode {
  // One state for both, so the line below always says what happened last.
  const [state, action] = useActionState(
    (previous: FormState, form: FormData) =>
      form.get("intent") === "release"
        ? releaseEscalation(previous, form)
        : claimEscalation(previous, form),
    EMPTY,
  );
  const claimedBy = e.claimed_by ?? null;
  const giveBack = canGiveBack(
    { claimed_by: claimedBy, claimed_by_me: Boolean(e.claimed_by_me) },
    role,
  );
  const realerts = e.realerts ?? 0;
  return (
    <form action={action} className="flex flex-col gap-3 border-t border-line pt-4">
      <input type="hidden" name="escalation_id" value={e.id} />
      <p className="text-sm text-ink">
        {claimedBy ? (
          <>
            <strong>Claimed by {e.claimed_by_me ? "you" : claimedBy}</strong>
            {e.claimed_at ? `, ${formatWhen(e.claimed_at)}` : ""}.
          </>
        ) : (
          <>Nobody has said they&apos;re on it yet.</>
        )}
        {realerts > 0 && !claimedBy
          ? ` The office was alerted again ${realerts === 1 ? "once" : `${realerts} times`}.`
          : ""}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        {claimedBy ? null : (
          <SubmitButton name="intent" value="claim" pendingLabel="Saving…">
            I&apos;m on it
          </SubmitButton>
        )}
        {giveBack ? (
          <SubmitButton name="intent" value="release" variant="secondary" pendingLabel="Saving…">
            Give back
          </SubmitButton>
        ) : null}
        <p aria-live="polite" className="text-sm empty:hidden">
          {state.error ? (
            <span className="font-bold text-danger">{state.error}</span>
          ) : state.notice ? (
            <span className="text-good">{state.notice}</span>
          ) : null}
        </p>
      </div>
    </form>
  );
}

/** A call the office made: how it went, and a short note. Logging one also claims it. */
function LogCall({ escalationId }: { escalationId: string }): ReactNode {
  const [state, action] = useActionState(logEscalationCall, EMPTY);
  const id = useId();
  const input =
    "min-h-12 rounded-control border border-line bg-page px-3 text-ink focus:border-accent focus:outline-none";
  return (
    <form
      action={action}
      aria-label="Log a call"
      className="flex flex-col gap-3 rounded-control border border-line p-4"
    >
      <input type="hidden" name="escalation_id" value={escalationId} />
      <div className="grid gap-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-outcome`} className="text-sm font-bold text-ink">
            How the call went
          </label>
          <select
            id={`${id}-outcome`}
            name="outcome"
            required
            defaultValue={state.fields?.outcome ?? ""}
            className={input}
          >
            <option value="" disabled>
              Choose…
            </option>
            {CALL_OUTCOMES.map((outcome) => (
              <option key={outcome} value={outcome}>
                {OUTCOME_LABELS[outcome]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <label htmlFor={`${id}-note`} className="text-sm font-bold text-ink">
            Note (optional)
          </label>
          <input
            id={`${id}-note`}
            name="note"
            maxLength={200}
            defaultValue={state.fields?.note}
            placeholder="Mother says the bus is stuck at Clock Tower"
            className={`${input} px-4`}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton variant="secondary" pendingLabel="Saving…">
          Log call
        </SubmitButton>
        <p aria-live="polite" className="text-sm text-good empty:hidden">
          {state.notice ?? ""}
        </p>
      </div>
      <FormError message={state.error} />
    </form>
  );
}

function LastSeen({ escalation: e }: { escalation: Escalation }): ReactNode {
  const seen = e.last_seen;
  if (!seen) {
    return (
      <p className="rounded-control bg-accent-soft px-4 py-3 text-sm text-ink">
        No known position: they aren&apos;t sharing their location and haven&apos;t scanned at a
        gate. Lumiback doesn&apos;t track students.
      </p>
    );
  }
  if (seen.kind === "gate") {
    return (
      <p className="flex gap-2 rounded-control bg-accent-soft px-4 py-3 text-sm text-ink">
        <MapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent" />
        <span>
          Last seen at <strong>{seen.gate}</strong>, {formatWhen(seen.at)} (gate scan).
        </span>
      </p>
    );
  }
  if (seen.lat === null || seen.lng === null) {
    // Sharing, but the phone only ever sent a faked (mock) location: nothing real to show.
    return (
      <p className="flex gap-2 rounded-control bg-danger-soft px-4 py-3 text-sm font-bold text-ink">
        <Warning aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-danger" />
        <span>
          Sharing, but only a faked location
          {seen.mock_since ? ` (since ${formatWhen(seen.mock_since)})` : ""}. There is no real
          position to show.
        </span>
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-control bg-accent-soft px-4 py-3 text-sm text-ink">
      <p className="flex gap-2">
        <MapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent" />
        <span>
          Sharing live: last real position {formatWhen(seen.at)}, accurate to about{" "}
          {Math.round(seen.accuracy_m ?? 0)} m.{" "}
          <a
            href={`https://www.openstreetmap.org/?mlat=${seen.lat}&mlon=${seen.lng}#map=17/${seen.lat}/${seen.lng}`}
            target="_blank"
            rel="noreferrer"
            className="font-bold text-accent underline-offset-4 hover:underline"
          >
            Open map
          </a>
        </span>
      </p>
      {seen.mock_since ? (
        <p className="flex gap-2 font-bold text-danger">
          <Warning aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>
            Their phone has reported a faked location since {formatWhen(seen.mock_since)}.
          </span>
        </p>
      ) : null}
      <p className="text-muted">
        They can see in their share&apos;s viewer history that the hostel office looked at this.
      </p>
    </div>
  );
}
