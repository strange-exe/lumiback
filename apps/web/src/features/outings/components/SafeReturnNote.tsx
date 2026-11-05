"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { useShare } from "@/features/share/ShareProvider";

/**
 * Safe return while out:
 * - "live": the emergency contact is following; says whether this tab is sending the location.
 * - "stopped": the student stopped sharing, so the contact's link and emails ended.
 * - "failed": ticked at check-out, but it couldn't start (today's email limit).
 * - "off": not chosen; shows nothing.
 */
export type SafeReturnState = "live" | "stopped" | "failed" | "off";

const LINK = "font-bold text-accent underline-offset-4 hover:underline";

export function SafeReturnNote({
  sessionId,
  state,
}: {
  sessionId: string | null;
  state: SafeReturnState;
}): ReactNode {
  const { session, problem } = useShare();

  if (state === "off") return null;
  if (state === "failed") {
    return (
      <p role="status" className="rounded-control bg-danger-soft px-4 py-3 text-ink">
        <strong>Your emergency contact wasn&apos;t emailed.</strong> Too many safe-return emails
        went out today. You can still{" "}
        <Link href="/share" className={LINK}>
          share your location
        </Link>{" "}
        with a code.
      </p>
    );
  }
  if (state === "stopped") {
    return (
      <p role="status" className="rounded-control bg-accent-soft px-4 py-3 text-sm text-ink">
        You stopped sharing with your emergency contact. Their link no longer works, and they
        won&apos;t be emailed about this outing again.
      </p>
    );
  }

  const here = session?.id === sessionId;
  return (
    <div role="status" className="flex flex-col gap-1 rounded-control bg-accent-soft px-4 py-3">
      <p className="font-bold text-ink">
        Your emergency contact can follow you until you&apos;re back
      </p>
      <p className="text-sm leading-relaxed text-ink">
        {here
          ? problem
            ? `Your location isn't coming through. ${problem}`
            : "This tab is sending your location. Keep it open, or share from the app, so they can see where you are."
          : "They see your location only while you share it from the app or this website."}{" "}
        <Link href="/share" className={LINK}>
          Manage
        </Link>
      </p>
    </div>
  );
}
