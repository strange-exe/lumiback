"use client";

import { MapPin, Warning } from "@phosphor-icons/react";
import { useActionState, useId, type ReactNode } from "react";

import { FormError } from "@/components/ui/Field";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { handleHelp } from "@/features/admin/alert-actions";
import { accuracyText, osmLink } from "@/features/admin/alerts";
import { Contact } from "@/features/admin/components/Contact";
import { formatWhen } from "@/features/admin/format";
import type { FormState, HelpRequest } from "@/lib/types";

const EMPTY: FormState = { error: null };

/**
 * A student who pressed Help while out: who, when, their number, and the one location their
 * phone sent with it (no tracking). Marked handled once someone has dealt with it.
 */
export function HelpCard({ help: h }: { help: HelpRequest }): ReactNode {
  const [state, action] = useActionState(handleHelp, EMPTY);
  const headingId = useId();
  const noteId = useId();
  const map = osmLink(h.lat, h.lng);
  return (
    <article
      aria-labelledby={headingId}
      className="flex flex-col gap-4 rounded-sheet border border-danger/50 bg-surface p-5 sm:p-6"
    >
      <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h3 id={headingId} className="font-display text-xl text-ink">
            {h.name}
          </h3>
          <p className="truncate text-sm text-muted">
            {[h.roll_no, h.hostel ?? "No hostel chosen", `asked ${formatWhen(h.created_at)}`]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <span
          className={`rounded-full px-2.5 py-0.5 text-sm font-bold ${
            h.returned ? "bg-good-soft text-good" : "bg-danger-soft text-danger"
          }`}
        >
          {h.returned ? "Back now" : "Still out"}
        </span>
      </header>

      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-3">
        <Contact label="Student" phone={h.phone} />
      </dl>

      {map ? (
        <div className="flex flex-col gap-2 rounded-control bg-accent-soft px-4 py-3 text-sm text-ink">
          <p className="flex gap-2">
            <MapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent" />
            <span>
              Location sent with the alert, {accuracyText(h.accuracy_m)}.{" "}
              <a
                href={map}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-6 items-center font-bold text-accent underline-offset-4 hover:underline"
              >
                Open map
              </a>
            </span>
          </p>
          {h.mocked ? (
            <p className="flex gap-2 font-bold text-danger">
              <Warning aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              <span>Their phone marked this as a mock location. It may be faked.</span>
            </p>
          ) : null}
        </div>
      ) : (
        <p className="rounded-control bg-accent-soft px-4 py-3 text-sm text-ink">
          No location: their phone didn&apos;t give one, or it was more than a day ago.
        </p>
      )}

      <form action={action} className="flex flex-col gap-3 border-t border-line pt-4">
        <input type="hidden" name="help_id" value={h.id} />
        <div className="flex flex-col gap-1.5">
          <label htmlFor={noteId} className="text-sm font-bold text-ink">
            What happened (optional)
          </label>
          <input
            id={noteId}
            name="note"
            defaultValue={state.fields?.note}
            maxLength={200}
            placeholder="Called him: phone battery was low, he's fine"
            className="min-h-12 rounded-control border border-line bg-page px-4 text-ink focus:border-accent focus:outline-none"
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton pendingLabel="Saving…">Mark handled</SubmitButton>
        </div>
        <FormError message={state.error} />
      </form>
    </article>
  );
}
