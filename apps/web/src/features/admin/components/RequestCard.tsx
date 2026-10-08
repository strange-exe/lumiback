"use client";

import { useActionState, type ReactNode } from "react";

import { SubmitButton } from "@/components/ui/SubmitButton";
import { Contact } from "@/features/admin/components/Contact";
import { formatHours, formatWhen } from "@/features/admin/format";
import { decideRequest } from "@/features/admin/rules-actions";
import type { AdminRequest, FormState } from "@/lib/types";

const EMPTY: FormState = { error: null };

const STATUS: Record<AdminRequest["status"], { label: string; className: string }> = {
  pending: { label: "Waiting for you", className: "bg-accent-soft text-accent" },
  approved: { label: "Approved", className: "bg-good-soft text-good" },
  declined: { label: "Declined", className: "bg-danger-soft text-danger" },
  cancelled: { label: "Cancelled by student", className: "bg-line text-muted" },
};

/** One weekend/holiday outing request: who, why, for how long, whom to call; and a decision. */
export function RequestCard({ request }: { request: AdminRequest }): ReactNode {
  const [state, action] = useActionState(decideRequest, EMPTY);
  const status = STATUS[request.status];
  const minutes = request.requested_minutes ?? request.max_minutes;
  return (
    <article
      aria-labelledby={`request-${request.id}`}
      className="flex flex-col gap-4 rounded-sheet border border-line bg-surface p-5 sm:p-6"
    >
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 id={`request-${request.id}`} className="font-display text-xl text-ink">
            {request.name}
          </h2>
          <p className="truncate text-sm text-muted">
            {[request.roll_no, request.hostel ?? "No hostel chosen", request.email]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <span className={`rounded-full px-2.5 py-0.5 text-sm font-bold ${status.className}`}>
          {status.label}
          {request.used ? " · used" : ""}
        </span>
      </header>

      <div className="flex flex-col gap-1">
        <p className="text-ink">{request.purpose}</p>
        <p className="text-sm text-muted">
          {minutes ? `For ${formatHours(minutes)}` : "For the day's limit"}
          {request.requested_minutes && request.max_minutes
            ? ` (allowed up to ${formatHours(request.max_minutes)})`
            : ""}
          {" · asked "}
          {formatWhen(request.created_at)}
        </p>
      </div>

      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        <Contact label="Student" phone={request.phone} />
        <Contact
          label={`Emergency contact (${request.emergency_relation})`}
          name={request.emergency_name}
          phone={request.emergency_phone}
        />
      </dl>

      {request.status === "pending" ? (
        <form action={action} className="flex flex-col gap-3 border-t border-line pt-4">
          <input type="hidden" name="request_id" value={request.id} />
          <label className="flex flex-col gap-1.5 text-sm font-bold text-ink">
            Note to the student
            <span className="font-normal text-muted">Needed when declining.</span>
            <input
              name="note"
              maxLength={200}
              defaultValue={state.fields?.note}
              className="min-h-12 rounded-control border border-line bg-page px-4 font-normal text-ink focus:border-accent focus:outline-none"
            />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <SubmitButton name="decision" value="approve" pendingLabel="Saving…">
              Approve
            </SubmitButton>
            <SubmitButton
              name="decision"
              value="decline"
              variant="secondary"
              pendingLabel="Saving…"
            >
              Decline
            </SubmitButton>
            <p role="alert" className="text-sm font-bold text-danger">
              {state.error ?? ""}
            </p>
          </div>
        </form>
      ) : request.decided_by ? (
        <p className="border-t border-line pt-3 text-sm text-muted">
          {request.status === "approved" ? "Approved" : "Declined"} by {request.decided_by}
          {request.decided_at ? `, ${formatWhen(request.decided_at)}` : ""}
          {request.note ? `: “${request.note}”` : ""}
        </p>
      ) : null}
    </article>
  );
}
