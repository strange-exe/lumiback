"use client";

import Link from "next/link";
import { useActionState, type ReactNode } from "react";

import { Field, FormError } from "@/components/ui/Field";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { checkOut } from "@/features/outings/actions";
import type { FormState, Profile } from "@/lib/types";

const INITIAL: FormState = { error: null };

/**
 * Check out without the gate. The hostel's rules (shown above it) set the return time.
 * `profile` (null if it couldn't be loaded) decides whether safe return can be offered.
 */
export function CheckOutForm({ profile }: { profile: Profile | null }): ReactNode {
  const [state, action] = useActionState(checkOut, INITIAL);
  const contact = profile?.emergency_name?.split(" ")[0] || "your emergency contact";
  return (
    <form action={action} className="flex flex-col gap-5">
      <p className="text-sm text-muted">
        Your return time is set by your hostel&apos;s rules, and it can&apos;t be changed once
        you&apos;re out.
      </p>
      <Field
        label="Where to? (optional)"
        name="destination"
        defaultValue={state.fields?.destination}
        placeholder="Clock Tower market"
        maxLength={100}
        autoComplete="off"
      />
      {profile?.emergency_email ? (
        <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-control border border-line bg-surface px-4 py-3 has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent">
          <input
            type="checkbox"
            name="safe_return"
            aria-describedby="safe-return-hint"
            className="mt-0.5 size-5 shrink-0 accent-[var(--accent)]"
          />
          <span className="flex flex-col gap-1">
            <span className="font-bold text-ink">Let {contact} follow until I&apos;m back</span>
            <span id="safe-return-hint" className="text-sm text-muted">
              We email them a link to your live location while you share it from this tab or the
              app. It stops when you&apos;re back, and they&apos;re told if you&apos;re 30 minutes
              late.
            </span>
          </span>
        </label>
      ) : profile ? (
        <p className="text-sm text-muted">
          Want someone at home to follow your way back?{" "}
          <Link
            href="/account#outing-details-heading"
            className="font-bold text-accent underline-offset-4 hover:underline"
          >
            Add your emergency contact&apos;s email
          </Link>
          .
        </p>
      ) : null}
      <FormError message={state.error} />
      <SubmitButton pendingLabel="Checking out…" className="w-full">
        Check out
      </SubmitButton>
    </form>
  );
}
