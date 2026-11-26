"use client";

import { useActionState, useEffect, useId, useRef, useState, type ReactNode } from "react";

import { FormError } from "@/components/ui/Field";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { withdrawBoardPost } from "@/features/board/actions";
import type { BoardRow } from "@/features/board/board";
import type { FormState } from "@/lib/types";

const EMPTY: FormState = { error: null };
const ELLIPSIS = String.fromCodePoint(0x2026);

// The same confirm-then-act dialog as the account page's device list.
const TRIGGER =
  "inline-flex min-h-11 items-center rounded-control px-3.5 text-sm font-bold text-danger ring-1 ring-line hover:bg-danger-soft";
const CLOSE =
  "min-h-12 rounded-control px-5 font-bold text-accent ring-1 ring-line hover:bg-accent-soft";
const DIALOG =
  "m-auto max-h-[calc(100dvh-2rem)] w-[min(32rem,calc(100vw-2rem))] overflow-y-auto rounded-sheet border border-line bg-surface p-5 text-left text-ink backdrop:bg-[rgba(var(--tint),0.55)] sm:p-6";

/** One row's confirm dialog, with its own action state: an error shows only where it happened. */
function WithdrawDialog({
  row,
  onResult,
}: {
  row: BoardRow;
  /** Every answer, for the list's live region and focus. */
  onResult: (result: FormState) => void;
}): ReactNode {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [result, act] = useActionState(async (previous: FormState, form: FormData) => {
    const answer = await withdrawBoardPost(previous, form);
    if (answer.notice) dialog.current?.close();
    onResult(answer);
    return answer;
  }, EMPTY);
  return (
    <>
      <button
        type="button"
        onClick={() => dialog.current?.showModal()}
        aria-label={`Withdraw: ${row.title}`}
        className={TRIGGER}
      >
        Withdraw
      </button>
      <dialog ref={dialog} aria-labelledby={titleId} className={DIALOG}>
        <form action={act} className="flex flex-col gap-4">
          <h3 id={titleId} className="break-words font-display text-xl text-ink">
            Take down &ldquo;{row.title}&rdquo;?
          </h3>
          <input type="hidden" name="post_id" value={row.id} />
          <p className="text-ink">
            Students stop seeing it straight away. It stays in this list as Withdrawn, and it
            can&apos;t be put back: post it again if you need it.
          </p>
          <FormError message={result.error} />
          <div className="flex flex-wrap gap-2">
            <SubmitButton variant="danger" pendingLabel={`Taking it down${ELLIPSIS}`}>
              Take it down
            </SubmitButton>
            <button type="button" onClick={() => dialog.current?.close()} className={CLOSE}>
              Keep it up
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}

/**
 * "On the board for your hostels": stacked rows (no wide table), each with its status as text,
 * who it went to, its dates, "Sent to M students, seen by N to N+4" and who posted it. Withdraw is on
 * the rows this person may take down; others say why it's missing. Rows arrive formatted on
 * the server (campus time), so the HTML and the hydrated page agree.
 */
export function BoardList({
  rows,
  readOnly,
  headingId,
}: {
  rows: BoardRow[];
  readOnly: boolean;
  headingId: string;
}): ReactNode {
  const [state, setState] = useState<FormState>(EMPTY);
  // The Withdraw button that was used is gone with its row's status: put focus on the heading.
  useEffect(() => {
    if (state.notice) document.getElementById(headingId)?.focus();
  }, [state, headingId]);

  if (rows.length === 0) {
    return (
      <p className="rounded-sheet border border-dashed border-line px-5 py-8 text-center text-muted">
        Nothing on the board for your hostels yet. Posts show here once they&apos;re sent.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3" data-state="ready">
      <ul className="flex flex-col divide-y divide-line rounded-sheet border border-line bg-surface">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-col gap-3 px-5 py-4" data-status={row.status}>
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
              <h3 className="min-w-0 break-words font-bold text-ink">{row.title}</h3>
              <p className="shrink-0 rounded-full border border-line px-2.5 py-0.5 text-sm font-bold text-ink">
                {row.status}
              </p>
            </div>
            <p className="text-sm text-muted">
              {row.category}, for <span className="text-ink">{row.hostels}</span>
            </p>
            <p className="max-w-[65ch] whitespace-pre-line break-words text-ink">{row.body}</p>
            <div className="flex flex-col gap-0.5 text-sm text-muted">
              <p className="tabular-nums">
                {row.posted}. {row.until}.
              </p>
              <p className="tabular-nums text-ink">{row.counts}</p>
              <p>{row.from}</p>
            </div>
            {readOnly ? null : row.canWithdraw ? (
              <div className="flex">
                <WithdrawDialog row={row} onResult={setState} />
              </div>
            ) : row.reason ? (
              <p className="text-sm text-muted">{row.reason}</p>
            ) : null}
          </li>
        ))}
      </ul>
      <p aria-live="polite" className="text-sm empty:hidden">
        {state.error ? (
          <span className="font-bold text-danger">{state.error}</span>
        ) : state.notice ? (
          <span className="text-good">{state.notice}</span>
        ) : null}
      </p>
    </div>
  );
}
