"use client";

import { useActionState, type ReactNode } from "react";

import { Field, FormError } from "@/components/ui/Field";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { formatPhone } from "@/features/admin/format";
import { cancelRequest, sendRequest } from "@/features/outings/actions";
import { approvedDue, lengthOptions } from "@/features/outings/rules";
import type { FormState, OutingRequest, Profile, TodayRules } from "@/lib/types";

const INITIAL: FormState = { error: null };

/** End the student's own text with one full stop, whatever punctuation they typed. */
function sentence(text: string): string {
  return `${text.trim().replace(/[.!?]$/, "")}.`;
}

/**
 * Days that need approval (currently Sundays and holidays): the form (sent on the day), then
 * its status. Contacts are prefilled from the student's profile and saved back to it.
 */
export function RequestPanel({
  rules,
  request,
  profile,
  now,
}: {
  rules: TodayRules;
  request: OutingRequest | null;
  profile: Profile | null;
  /** The server's request time (ms), so the length choices match on server and browser. */
  now: number;
}): ReactNode {
  const live = request && request.status !== "cancelled" ? request : null;
  if (live?.status === "pending") return <Pending request={live} />;
  if (live?.status === "approved") {
    return (
      <p role="status" className="rounded-control bg-good-soft px-4 py-3 text-ink">
        <strong className="text-good">Approved.</strong>{" "}
        {live.used
          ? "You've used today's approval."
          : `Tap out at the gate, or check out below. You'll be due back ${approvedDue(rules, live.requested_minutes)}.`}
      </p>
    );
  }
  return <RequestForm rules={rules} profile={profile} declined={live} now={now} />;
}

function Pending({ request }: { request: OutingRequest }): ReactNode {
  const [state, action] = useActionState(cancelRequest, INITIAL);
  return (
    <div role="status" className="flex flex-col gap-2 rounded-control bg-accent-soft px-4 py-3">
      <p className="text-ink">
        <strong className="text-accent">Waiting for approval.</strong> {sentence(request.purpose)}{" "}
        The hostel office will decide soon; this page shows it when they do.
      </p>
      <form action={action}>
        <input type="hidden" name="request_id" value={request.id} />
        <SubmitButton variant="quiet" pendingLabel="Cancelling…" className="min-h-11 text-sm">
          Cancel request
        </SubmitButton>
      </form>
      <FormError message={state.error} />
    </div>
  );
}

function RequestForm({
  rules,
  profile,
  declined,
  now,
}: {
  rules: TodayRules;
  profile: Profile | null;
  declined: OutingRequest | null;
  now: number;
}): ReactNode {
  const [state, action] = useActionState(sendRequest, INITIAL);
  const value = (name: string, fallback: string | null | undefined): string =>
    state.fields?.[name] ?? fallback ?? "";
  const lengths = lengthOptions(rules, now).map((o) => ({
    value: o.minutes === null ? "" : String(o.minutes),
    label: o.label,
  }));
  return (
    <form
      action={action}
      aria-labelledby="request-heading"
      className="flex flex-col gap-4 rounded-sheet border border-line bg-surface p-5"
    >
      <div className="flex flex-col gap-1">
        <h2 id="request-heading" className="font-display text-xl text-ink">
          Ask for today&apos;s outing
        </h2>
        <p className="text-sm text-muted">
          {rules.label} outings need the hostel office&apos;s OK. Send this today; once it&apos;s
          approved you can tap out at the gate or check out here.
        </p>
        {declined?.status === "declined" ? (
          <p className="text-sm font-bold text-danger">
            Your earlier request was declined{declined.note ? `: ${sentence(declined.note)}` : "."}{" "}
            You can ask again.
          </p>
        ) : null}
      </div>
      <Field
        label="Where and why"
        name="purpose"
        id="request-purpose"
        required
        maxLength={200}
        placeholder="Shopping at Pacific Mall"
        defaultValue={value("purpose", "")}
      />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-bold text-ink">
          Shorter than the limit? (optional)
        </legend>
        <div className="flex flex-wrap gap-2">
          {lengths.map((l, i) => (
            <label
              key={l.label}
              className="flex min-h-11 cursor-pointer items-center rounded-control border border-line bg-surface px-4 text-sm font-bold text-ink has-[:checked]:border-accent has-[:checked]:bg-accent has-[:checked]:text-on-accent has-[:focus-visible]:outline has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent"
            >
              <input
                type="radio"
                name="length"
                value={l.value}
                defaultChecked={
                  (state.fields?.length ?? "") === l.value || (i === 0 && !state.fields)
                }
                className="sr-only"
              />
              {l.label}
            </label>
          ))}
        </div>
      </fieldset>
      <Field
        label="Your phone number"
        name="phone"
        id="request-phone"
        type="tel"
        inputMode="tel"
        autoComplete="tel"
        required
        maxLength={24}
        defaultValue={value("phone", profile?.phone ? formatPhone(profile.phone) : null)}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field
          label="Emergency contact"
          name="emergency_name"
          id="request-emergency-name"
          required
          maxLength={80}
          defaultValue={value("emergency_name", profile?.emergency_name)}
        />
        <Field
          label="Relation"
          name="emergency_relation"
          id="request-emergency-relation"
          required
          maxLength={40}
          placeholder="Mother"
          defaultValue={value("emergency_relation", profile?.emergency_relation)}
        />
        <Field
          label="Their phone"
          name="emergency_phone"
          id="request-emergency-phone"
          type="tel"
          inputMode="tel"
          required
          maxLength={24}
          defaultValue={value(
            "emergency_phone",
            profile?.emergency_phone ? formatPhone(profile.emergency_phone) : null,
          )}
        />
      </div>
      <FormError message={state.error} />
      <SubmitButton pendingLabel="Sending…">Send for approval</SubmitButton>
    </form>
  );
}
