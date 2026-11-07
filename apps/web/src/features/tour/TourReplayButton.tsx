"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

import { requestReplay } from "./store";

/**
 * "Take the tour again": goes to the page the tour starts on (Today, or the register) and
 * asks the tour there to run from the start.
 */
export function TourReplayButton({
  to,
  className,
  children = "Take the tour again",
  label,
  pointedAt = false,
}: {
  /** The hostel office's header button, which the staff tour points at. */
  pointedAt?: boolean;
  /** The tour's first page: "/home" for students, "/admin" for the hostel office. */
  to: "/home" | "/admin";
  className: string;
  children?: ReactNode;
  /** An accessible name when the visible text is shorter; it must contain that text. */
  label?: string;
}): ReactNode {
  const router = useRouter();
  return (
    <button
      type="button"
      data-tour={pointedAt ? "tour-replay" : undefined}
      aria-label={label}
      className={className}
      onClick={() => {
        requestReplay();
        router.push(to);
      }}
    >
      {children}
    </button>
  );
}
