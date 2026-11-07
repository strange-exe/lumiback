"use client";

import {
  useActionState,
  useEffect,
  useId,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { FormError } from "@/components/ui/Field";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { actOnPeople, type BulkState } from "@/features/admin/actions";
import { BULK_LINK_MAX, BULK_MAX } from "@/features/admin/bulk";
import type { Hostel } from "@/lib/types";

const EMPTY: BulkState = { error: null };

/** The form every row's checkbox belongs to (its `form` attribute). */
export const BULK_FORM = "people-bulk";

/** Who's ticked now, and how many of them each action applies to (the rows' data-* marks). */
interface Ticked {
  all: number;
  move: number;
  link: number;
  off: number;
  shown: number;
}

function boxes(): HTMLInputElement[] {
  return [...document.querySelectorAll<HTMLInputElement>(`input[data-bulk][form="${BULK_FORM}"]`)];
}

/** The counts as one string, so an unchanged count is the same snapshot. */
function countKey(): string {
  const all = boxes();
  const on = all.filter((b) => b.checked);
  const marked = (mark: string) => on.filter((b) => b.dataset[mark] === "1").length;
  return [on.length, marked("move"), marked("link"), marked("off"), all.length].join(",");
}

function subscribeTicks(onChange: () => void): () => void {
  // A reset (after a submit) clears the boxes after its event: count once it has. A new list
  // (after a submit, or a filter) changes the boxes without an event: watch the document.
  const later = () => window.setTimeout(onChange, 0);
  const observer = new MutationObserver(onChange);
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener("change", onChange);
  document.addEventListener("reset", later, true);
  return () => {
    observer.disconnect();
    document.removeEventListener("change", onChange);
    document.removeEventListener("reset", later, true);
  };
}

/** Who's ticked, re-counted on every tick, select-all and reset. Nothing on the server. */
function useTicked(): Ticked {
  const key = useSyncExternalStore(subscribeTicks, countKey, () => "0,0,0,0,0");
  const [all, move, link, off, shown] = key.split(",").map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  return { all, move, link, off, shown };
}

const noop = () => () => undefined;

/** True once the page runs JavaScript (false while rendering on the server). */
function useHasJs(): boolean {
  return useSyncExternalStore(
    noop,
    () => true,
    () => false,
  );
}

/**
 * "Select all shown": ticks (or clears) every row's checkbox on this page. Needs JavaScript, so
 * it appears only once the page has it; without it, rows are ticked one by one.
 */
export function SelectAllShown(): ReactNode {
  const ticked = useTicked();
  const box = useRef<HTMLInputElement>(null);
  const ready = useHasJs();
  // "All" is as many as one submit takes: in a list longer than BULK_MAX, the first BULK_MAX
  // ticked counts as all, so a second click clears them instead of re-ticking the same ones.
  const most = Math.min(ticked.shown, BULK_MAX);
  const every = most > 0 && ticked.all >= most;
  useEffect(() => {
    if (box.current) box.current.indeterminate = ticked.all > 0 && !every;
  }, [ticked, every]);
  if (!ready || ticked.shown === 0) return null;
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-3 self-start rounded-control px-3 text-sm font-bold text-ink ring-1 ring-line hover:bg-accent-soft">
      <input
        ref={box}
        type="checkbox"
        checked={every}
        onChange={() => {
          const on = !every;
          // Never more than one submit can take; the rest stay as they were.
          let room = BULK_MAX;
          for (const b of boxes()) {
            b.checked = on && room-- > 0;
          }
          document.dispatchEvent(new Event("change"));
        }}
        className="size-5 accent-[var(--color-accent)]"
      />
      Select all shown ({ticked.shown})
    </label>
  );
}

/**
 * The action bar for the ticked people, fixed to the bottom of the screen while anyone is
 * ticked (CSS :has in globals.css, so it shows without JavaScript too), and the results of the
 * last submit, per person. Moving and set-up links work without JavaScript, like the rows'
 * own forms; turning off asks first, naming how many, in a dialog (as each row's Turn off does).
 */
export function BulkActions({
  isAdmin,
  hostels,
  names,
}: {
  isAdmin: boolean;
  hostels: Hostel[];
  /** Who each id is, for the results (a refusal carries no name). */
  names: Record<string, string>;
}): ReactNode {
  const [state, action] = useActionState(actOnPeople, EMPTY);
  const ticked = useTicked();
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const summary = useRef<HTMLParagraphElement>(null);
  const js = useHasJs();

  // A result: close the dialog and bring the reader to what happened.
  useEffect(() => {
    if (!state.summary && !state.error) return;
    dialog.current?.close();
    if (state.summary) summary.current?.focus();
  }, [state]);

  // "Move (2)" when only some of the ticked people can be moved.
  const label = (text: string, n: number) =>
    js && n > 0 && n !== ticked.all ? `${text} (${n})` : text;
  const named = (who: string, name: string | null) =>
    name ?? names[who] ?? "Someone no longer listed";

  return (
    <div className="flex flex-col gap-3">
      {/* Above the list, not in the bar: the bar hides once the ticks are cleared. */}
      <div id={`${BULK_FORM}-error`} className="empty:hidden">
        {state.error ? <FormError message={state.error} /> : null}
      </div>
      <div role="status" aria-label="What happened" className="empty:hidden">
        {state.summary ? (
          <div className="flex flex-col gap-2 rounded-sheet border border-line bg-surface px-4 py-3">
            <p ref={summary} tabIndex={-1} className="font-bold text-ink">
              {state.summary}
            </p>
            <ul className="flex flex-col gap-1 text-sm">
              {state.outcomes?.map((o) => (
                <li key={o.id} className="flex flex-wrap gap-x-2">
                  <span className="font-bold text-ink">{named(o.id, o.name)}</span>
                  {/* Done or not is said in words; the colour only repeats it. */}
                  <span className={o.done ? "text-good" : "text-danger"}>
                    {o.done ? "Done: " : "Not done: "}
                    {o.message}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <form
        id={BULK_FORM}
        action={action}
        aria-labelledby={`${id}-title`}
        className="people-bulk-bar"
      >
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:px-6">
          <h2 id={`${id}-title`} className="text-sm font-bold text-ink">
            {js ? `${ticked.all} ticked` : "With the people ticked:"}
          </h2>
          {isAdmin && hostels.length > 1 && (!js || ticked.move > 0) ? (
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor={`${id}-hostel`} className="sr-only">
                Hostel to move them to
              </label>
              <select
                id={`${id}-hostel`}
                name="hostel_id"
                defaultValue=""
                className="min-h-11 min-w-0 rounded-control border border-field bg-page px-3 text-sm text-ink"
              >
                <option value="">Move to…</option>
                {hostels.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </select>
              <SubmitButton
                name="op"
                value="move"
                variant="secondary"
                pendingLabel="Moving…"
                className="min-h-11 text-sm"
              >
                {label("Move", ticked.move)}
              </SubmitButton>
            </div>
          ) : null}
          {isAdmin && (!js || ticked.link > 0) ? (
            <SubmitButton
              name="op"
              value="link"
              variant="secondary"
              pendingLabel="Sending…"
              className="min-h-11 text-sm"
            >
              {label("Send set-up link again", ticked.link)}
            </SubmitButton>
          ) : null}
          {isAdmin && js && ticked.link > BULK_LINK_MAX ? (
            <p className="w-full text-sm text-muted">
              Links go to {BULK_LINK_MAX} people an hour; the rest will say not tried.
            </p>
          ) : null}
          {js && ticked.off > 0 ? (
            <button
              type="button"
              onClick={() => dialog.current?.showModal()}
              className="inline-flex min-h-11 items-center rounded-control px-3.5 text-sm font-bold text-danger ring-1 ring-line hover:bg-accent-soft"
            >
              {label("Turn off", ticked.off)}
            </button>
          ) : null}
        </div>

        <dialog
          ref={dialog}
          aria-labelledby={`${id}-off-title`}
          className="m-auto max-h-[calc(100dvh-2rem)] w-[min(32rem,calc(100vw-2rem))] overflow-y-auto rounded-sheet border border-line bg-surface p-5 text-left text-ink backdrop:bg-[rgba(var(--tint),0.55)] sm:p-6"
        >
          <div className="flex flex-col gap-4">
            <h2 id={`${id}-off-title`} className="font-display text-xl text-ink">
              Turn off {ticked.all} {ticked.all === 1 ? "account" : "accounts"}?
            </h2>
            <input type="hidden" name="confirm_count" value={String(ticked.all)} />
            <ul className="flex list-disc flex-col gap-1.5 pl-5 text-ink">
              <li>They&apos;re signed out on every phone and browser, and live shares end.</li>
              <li>They can&apos;t sign in until an account is turned back on.</li>
              <li>Their outings and history are kept.</li>
              <li>Anyone out right now is skipped: record their return first.</li>
            </ul>
            <div className="flex flex-wrap gap-2">
              <SubmitButton name="op" value="off" variant="danger" pendingLabel="Turning off…">
                Turn off {ticked.all}
              </SubmitButton>
              <button
                type="button"
                onClick={() => dialog.current?.close()}
                className="min-h-12 rounded-control px-5 font-bold text-accent ring-1 ring-line hover:bg-accent-soft"
              >
                Keep them on
              </button>
            </div>
          </div>
        </dialog>
      </form>
    </div>
  );
}
