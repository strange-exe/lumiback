"use client";

import { MapPin, Warning } from "@phosphor-icons/react";
import { useActionState, type ReactNode } from "react";

import { SubmitButton } from "@/components/ui/SubmitButton";
import { Contact } from "@/features/admin/components/Contact";
import { formatWhen } from "@/features/admin/format";
import { resolveEscalation } from "@/features/admin/rules-actions";
import { formatMinutes } from "@/features/outings/time";
import type { Escalation, FormState } from "@/lib/types";

const EMPTY: FormState = { error: null };

const REPLY = { on_my_way: "Answered: on the way", safe: "Answered: safe" } as const;

/** A late student who didn't answer the app's alert: who to call, where they were last seen. */
export function EscalationCard({ escalation: e }: { escalation: Escalation }): ReactNode {
  const [state, action] = useActionState(resolveEscalation, EMPTY);
  const open = e.resolved_at === null;
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
        <span
          className={`rounded-full px-2.5 py-0.5 text-sm font-bold ${
            e.returned_at ? "bg-good-soft text-good" : "bg-danger-soft text-danger"
          }`}
        >
          {e.returned_at
            ? `Back ${formatWhen(e.returned_at)}`
            : `${formatMinutes(e.late_minutes)} late`}
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

      {open ? <LastSeen escalation={e} /> : null}

      {open ? (
        <form action={action} className="flex flex-col gap-3 border-t border-line pt-4">
          <input type="hidden" name="escalation_id" value={e.id} />
          <label className="flex flex-col gap-1.5 text-sm font-bold text-ink">
            What happened
            <input
              name="note"
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
        Last seen at <strong>{seen.gate}</strong>, {formatWhen(seen.at)} (gate scan).
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
          Their phone has reported a faked location since {formatWhen(seen.mock_since)}.
        </p>
      ) : null}
      <p className="text-muted">They can see in the app that the hostel office looked at this.</p>
    </div>
  );
}
