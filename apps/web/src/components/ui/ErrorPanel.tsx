"use client";

import Link from "next/link";
import { useEffect, useRef, useTransition, type ReactNode } from "react";

import { errorCopy, supportHref } from "@/lib/error-copy";
import { useOnline } from "@/lib/use-online";

interface ErrorPanelProps {
  error: Error & { digest?: string };
  /** From the error boundary: fetches and renders the segment again. */
  retry: () => void;
  /** Where to go instead, e.g. Today or the Register. */
  away: { href: string; label: string };
}

/**
 * What every error boundary shows: a plain reason, a retry, and a way out. The heading takes focus
 * so a screen reader announces the change, as it would a new page.
 */
export function ErrorPanel({ error, retry, away }: ErrorPanelProps): ReactNode {
  const online = useOnline();
  const [retrying, startRetry] = useTransition();
  const heading = useRef<HTMLHeadingElement>(null);
  const copy = errorCopy({ online });

  useEffect(() => {
    console.error(error);
    heading.current?.focus();
  }, [error]);

  return (
    <section
      aria-labelledby="error-heading"
      data-state="error"
      className="flex max-w-lg flex-col gap-5 py-6"
    >
      <div className="flex flex-col gap-2">
        <h1
          id="error-heading"
          ref={heading}
          tabIndex={-1}
          className="font-display text-title text-ink"
        >
          {copy.title}
        </h1>
        <p className="text-muted">{copy.body}</p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => startRetry(() => retry())}
          disabled={retrying}
          className="min-h-12 rounded-control bg-accent px-6 font-bold text-on-accent hover:brightness-110 disabled:opacity-60"
        >
          {retrying ? "Trying again…" : "Try again"}
        </button>
        <Link
          href={away.href}
          className="flex min-h-12 items-center rounded-control px-3 font-bold text-accent hover:bg-accent-soft"
        >
          {away.label}
        </Link>
      </div>
      <p className="text-sm text-muted">
        Still not working?{" "}
        <a
          href={supportHref(error.digest)}
          className="font-bold text-accent underline-offset-4 hover:underline"
        >
          Email us
        </a>
        {error.digest ? (
          <>
            {" "}
            and quote reference <span className="tabular-nums text-ink">{error.digest}</span>.
          </>
        ) : (
          "."
        )}
      </p>
    </section>
  );
}
