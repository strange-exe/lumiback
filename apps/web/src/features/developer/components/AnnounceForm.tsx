"use client";

import { useActionState, useEffect, useId, useRef, useState, type ReactNode } from "react";

import { FormError } from "@/components/ui/Field";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { announceUpdate } from "@/features/developer/actions";
import { announceBody, MAX_ANNOUNCE_BODY, MAX_ANNOUNCE_TITLE } from "@/features/developer/announce";
import type { FormState } from "@/lib/types";

const EMPTY: FormState = { error: null };

const DIALOG =
  "m-auto max-h-[calc(100dvh-2rem)] w-[min(32rem,calc(100vw-2rem))] overflow-y-auto rounded-sheet border border-line bg-surface p-5 text-left text-ink backdrop:bg-[rgba(var(--tint),0.55)] sm:p-6";
const INPUT =
  "min-h-12 rounded-control border border-line bg-page px-4 text-base text-ink focus:border-accent focus:outline-none";

/**
 * "Announce an update" for developers: a title and one line, pushed to every phone with
 * Lumiback once confirmed. `last` and `next` say when the last one went out and when the next
 * is allowed (the API refuses a second within a day).
 */
export function AnnounceForm({ last, next }: { last: string; next: string }): ReactNode {
  const [state, action] = useActionState(announceUpdate, EMPTY);
  const [problem, setProblem] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ title: string; body: string } | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();

  useEffect(() => {
    dialog.current?.close(); // the action answered: sent (notice) or refused (error below)
    if (state.notice) form.current?.reset();
  }, [state]);

  function ask(): void {
    const data = new FormData(form.current ?? undefined);
    const checked = announceBody(String(data.get("title") ?? ""), String(data.get("body") ?? ""));
    if (!checked.ok) {
      setProblem(checked.error);
      return;
    }
    setProblem(null);
    setPreview(checked.body);
    dialog.current?.showModal();
  }

  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="flex flex-col gap-4 rounded-sheet border border-line bg-surface p-5"
    >
      <div className="flex flex-col gap-1">
        <h2 id={`${id}-heading`} className="font-display text-xl text-ink">
          Announce an update
        </h2>
        <p className="text-sm text-muted">
          A notification to every phone with Lumiback, for a release people will notice. Once a day,
          recorded in the audit log.
        </p>
        <p className="text-sm text-ink">
          {last} {next}
        </p>
      </div>
      <form ref={form} action={action} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-title`} className="text-sm font-bold text-ink">
            Title
          </label>
          <input
            id={`${id}-title`}
            name="title"
            required
            maxLength={MAX_ANNOUNCE_TITLE}
            autoComplete="off"
            defaultValue={state.fields?.title}
            placeholder="Lumiback has been updated"
            aria-describedby={`${id}-title-hint`}
            className={INPUT}
          />
          <p id={`${id}-title-hint`} className="text-sm text-muted">
            Up to {MAX_ANNOUNCE_TITLE} characters.
          </p>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-body`} className="text-sm font-bold text-ink">
            What&apos;s new
          </label>
          <input
            id={`${id}-body`}
            name="body"
            required
            maxLength={MAX_ANNOUNCE_BODY}
            autoComplete="off"
            defaultValue={state.fields?.body}
            placeholder="Running late? Move your due-back time once per outing."
            aria-describedby={`${id}-body-hint`}
            className={INPUT}
          />
          <p id={`${id}-body-hint`} className="text-sm text-muted">
            One line, up to {MAX_ANNOUNCE_BODY} characters.
          </p>
        </div>
        <FormError message={problem ?? state.error} />
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={ask}
            className="press min-h-12 rounded-control bg-accent px-5 font-bold text-on-accent hover:brightness-105"
          >
            Announce
          </button>
          <p aria-live="polite" className="text-sm font-bold text-good empty:hidden">
            {state.notice ?? ""}
          </p>
        </div>

        <dialog ref={dialog} aria-labelledby={`${id}-confirm`} className={DIALOG}>
          <div className="flex flex-col gap-4">
            <h3 id={`${id}-confirm`} className="font-display text-xl text-ink">
              Send this to every phone with Lumiback?
            </h3>
            <p>You can announce once a day.</p>
            {preview ? (
              <div className="flex flex-col gap-0.5 rounded-control bg-accent-soft px-4 py-3">
                <p className="break-words font-bold text-ink">{preview.title}</p>
                <p className="break-words text-ink">{preview.body}</p>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-3">
              <SubmitButton pendingLabel="Sending…">Send to every phone</SubmitButton>
              <button
                type="button"
                onClick={() => dialog.current?.close()}
                className="min-h-12 rounded-control px-5 font-bold text-accent ring-1 ring-line hover:bg-accent-soft"
              >
                Cancel
              </button>
            </div>
          </div>
        </dialog>
      </form>
    </section>
  );
}
