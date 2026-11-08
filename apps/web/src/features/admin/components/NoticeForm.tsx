"use client";

import { useActionState, useId, type ReactNode } from "react";

import { FormError } from "@/components/ui/Field";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { sendNotice } from "@/features/admin/alert-actions";
import { MAX_SHORT_TEXT } from "@/features/admin/alerts";
import type { FormState } from "@/lib/types";

const EMPTY: FormState = { error: null };

/**
 * A short notice to the students out now (a notification in the app, or an email), or a
 * recall asking them to come back now. The hostel choice shows only to someone with more than
 * one hostel; the API keeps it to the sender's own.
 */
export function NoticeForm({ hostels }: { hostels: { id: string; name: string }[] }): ReactNode {
  const [state, action] = useActionState(sendNotice, EMPTY);
  const id = useId();
  const input =
    "min-h-12 rounded-control border border-line bg-page px-4 text-ink focus:border-accent focus:outline-none";
  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="flex flex-col gap-4 rounded-sheet border border-line bg-surface p-5 sm:p-6"
    >
      <div className="flex flex-col gap-1">
        <h2 id={`${id}-heading`} className="font-display text-xl text-ink">
          Send a notice to students who are out
        </h2>
        <p className="text-sm text-muted">
          They get it as a notification in the app, or by email if they only use the website. It is
          recorded in the audit log.
        </p>
      </div>
      <form action={action} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-message`} className="text-sm font-bold text-ink">
            Message
          </label>
          <input
            id={`${id}-message`}
            name="message"
            required
            maxLength={MAX_SHORT_TEXT}
            defaultValue={state.fields?.message}
            placeholder="Heavy rain near Clock Tower. Take a cab back if you can."
            aria-describedby={`${id}-message-hint`}
            className={input}
          />
          <p id={`${id}-message-hint`} className="text-sm text-muted">
            One line, up to {MAX_SHORT_TEXT} characters.
          </p>
        </div>
        {hostels.length > 1 ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-hostel`} className="text-sm font-bold text-ink">
              Send to
            </label>
            <select
              id={`${id}-hostel`}
              name="hostel_id"
              defaultValue={state.fields?.hostel_id ?? ""}
              className={`${input} px-3`}
            >
              <option value="">All my hostels</option>
              {hostels.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <label className="flex min-h-11 cursor-pointer items-center gap-3 text-ink">
          <input
            type="checkbox"
            name="recall"
            defaultChecked={state.fields?.recall === "on"}
            className="size-5 accent-[var(--accent-text)]"
          />
          Ask them to come back now
        </label>
        <FormError message={state.error} />
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton pendingLabel="Sending…">Send notice</SubmitButton>
          <p aria-live="polite" className="text-sm font-bold text-ink empty:hidden">
            {state.notice ?? ""}
          </p>
        </div>
      </form>
    </section>
  );
}
