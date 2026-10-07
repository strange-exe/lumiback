"use client";

import { useState, useTransition, type ReactNode } from "react";

import { formatTime } from "@/features/outings/time";
import { createJoinCode } from "@/features/share/actions";
import type { JoinCode } from "@/lib/types";

/**
 * A single-use code, valid ~10 minutes. The link carries it after `#`, which browsers never send
 * to a server, so the code stays out of logs and history on the way in. Whoever uses it still
 * needs the student's approval before seeing anything.
 */
export function InviteCode({ sessionId }: { sessionId: string }): ReactNode {
  const [code, setCode] = useState<JoinCode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  const create = (): void => {
    setError(null);
    setCopied(false);
    startTransition(async () => {
      const result = await createJoinCode(sessionId);
      if (result.ok) setCode(result.data);
      else setError(result.error);
    });
  };

  const link = code ? `${window.location.origin}/join#code=${encodeURIComponent(code.code)}` : "";
  const message = code
    ? `Follow my way back on Lumiback: ${link}\nOr enter code ${code.code}. It works once, until ${formatTime(code.expires_at)}.`
    : "";

  const shareIt = async (): Promise<void> => {
    try {
      if (navigator.share) {
        await navigator.share({ title: "Lumiback", text: message });
        return;
      }
      await navigator.clipboard.writeText(message);
      setCopied(true);
    } catch {
      // Dismissed the share sheet, or clipboard blocked: the code is on screen to read out.
    }
  };

  return (
    <section
      aria-labelledby="invite-heading"
      className="rounded-sheet border border-line bg-surface p-5"
    >
      <h2 id="invite-heading" className="font-display text-xl text-ink">
        Invite someone
      </h2>
      {code ? (
        <div className="mt-3 flex flex-col gap-3">
          <p className="rounded-control border-2 border-dashed border-accent bg-accent-soft py-4 text-center font-mono text-3xl font-bold tracking-[0.2em] text-accent">
            <span aria-hidden="true">{code.code}</span>
            {/* Read out one character at a time, so it can be repeated over the phone. */}
            <span className="sr-only">Join code: {code.code.split("").join(" ")}</span>
          </p>
          <p className="text-sm text-muted">
            Works once, until {formatTime(code.expires_at)}. You&apos;ll approve them before they
            see anything.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void shareIt()}
              className="min-h-12 flex-1 rounded-control bg-accent px-5 font-bold text-on-accent hover:brightness-110"
            >
              Send invite
            </button>
            <button
              type="button"
              onClick={create}
              disabled={pending}
              className="min-h-12 rounded-control px-4 font-bold text-accent ring-1 ring-line hover:ring-accent/40 disabled:opacity-60"
            >
              New code
            </button>
          </div>
          <p aria-live="polite" className="text-sm font-bold text-good empty:hidden">
            {copied ? "Invite copied. Paste it in a chat." : ""}
          </p>
        </div>
      ) : (
        <div className="mt-2 flex flex-col gap-3">
          <p className="text-muted">
            Get a one-time code for a friend or family member. No account needed.
          </p>
          <button
            type="button"
            onClick={create}
            disabled={pending}
            className="min-h-12 rounded-control px-5 font-bold text-accent ring-1 ring-line hover:ring-accent/40 disabled:opacity-60"
          >
            {pending ? "Making a code…" : "Get a join code"}
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm font-bold text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
