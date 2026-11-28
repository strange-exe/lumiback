"use client";

import {
  startTransition,
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { FormError } from "@/components/ui/Field";
import { boardDraft, boardReach, postToBoard } from "@/features/board/actions";
import {
  BOARD_CATEGORIES,
  boardPost,
  bodyCounter,
  CATEGORY_LABEL,
  defaultExpiry,
  draftArrival,
  EXPIRY_CHOICES,
  EXPIRY_LABEL,
  MAX_BODY,
  MAX_LINES,
  MAX_TITLE,
  olderTimings,
  reachText,
  replaceLabel,
  untilText,
  type BoardTargetsBody,
  type DraftText,
} from "@/features/board/board";
import type {
  BoardCategory,
  BoardDraft,
  BoardHostel,
  BoardReach,
  FormState,
  StaffBoardPost,
} from "@/lib/types";

const EMPTY: FormState = { error: null };
const ELLIPSIS = String.fromCodePoint(0x2026);

const INPUT =
  "min-h-12 rounded-control border border-line bg-page px-4 text-base text-ink focus:border-focus focus:outline-none disabled:opacity-60";
const LABEL = "text-sm font-bold text-ink";
const PRIMARY =
  "press min-h-12 rounded-control bg-accent px-5 text-base font-bold text-on-accent shadow-[0_2px_0_rgba(0,0,0,0.12)] hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60";
const SECONDARY =
  "press min-h-11 rounded-control bg-surface px-4 text-sm font-bold text-accent ring-1 ring-line hover:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-60";
const CLOSE =
  "min-h-12 rounded-control px-5 font-bold text-accent ring-1 ring-line hover:bg-accent-soft";
const DIALOG =
  "m-auto max-h-[calc(100dvh-2rem)] w-[min(34rem,calc(100vw-2rem))] overflow-y-auto rounded-sheet border border-line bg-surface p-5 text-left text-ink backdrop:bg-[rgba(var(--tint),0.55)] sm:p-6";

type Reach =
  { kind: "none" } | { kind: "loading" } | { kind: "error" } | { kind: "ready"; value: BoardReach };

function reachLine(reach: Reach): string {
  switch (reach.kind) {
    case "none":
      return "Choose who it's for to see how many students it reaches.";
    case "loading":
      return `Counting students${ELLIPSIS}`;
    case "error":
      return "Couldn't count the students just now. You can still post.";
    case "ready":
      return `${reachText(reach.value)}.`;
  }
}

function forText(targets: BoardTargetsBody, hostels: readonly BoardHostel[]): string {
  if (targets.all_hostels) return "All hostels, and students without a hostel";
  return hostels
    .filter((h) => targets.hostel_ids.includes(h.id))
    .map((h) => h.name)
    .join(", ");
}

/**
 * A new board post: what it's about, who it's for, the words, how long it shows. "Review and
 * post" checks it as the API will and opens a native confirm dialog with who it reaches and
 * when it ends; only the dialog's Post sends it. Inputs are controlled, so an error never loses
 * what was typed. `readOnly` (a developer viewing as a role) disables everything.
 */
export function BoardForm({
  hostels,
  allHostels,
  start,
  startReach,
  startDraft,
  posts,
  readOnly,
}: {
  /** The hostels this person may post to, sorted by name. */
  hostels: BoardHostel[];
  /** Head wardens, admins and developers: the hostel checkboxes and "All hostels". */
  allHostels: boolean;
  start: BoardTargetsBody;
  startReach: BoardReach | null;
  /** From ?draft=<rule set id>: the outing rules, written out. */
  startDraft: BoardDraft | null;
  /** The list below, for "Take down the older timings post". */
  posts: StaffBoardPost[];
  /** Why nothing can be sent ("Read-only while viewing as ..."), else null. */
  readOnly: string | null;
}): ReactNode {
  const id = useId();
  const confirm = useRef<HTMLDialogElement>(null);
  const replaceDialog = useRef<HTMLDialogElement>(null);
  const reachTicket = useRef(0);

  const startCategory: BoardCategory = startDraft ? "timings" : "general";
  const [category, setCategory] = useState<BoardCategory>(startCategory);
  const [expires, setExpires] = useState(String(defaultExpiry(startCategory)));
  const [expiresChosen, setExpiresChosen] = useState(false);
  const [title, setTitle] = useState(startDraft?.title ?? "");
  const [body, setBody] = useState(startDraft?.body ?? "");
  const [targets, setTargets] = useState<BoardTargetsBody>(start);
  const [reach, setReach] = useState<Reach>(
    startReach
      ? { kind: "ready", value: startReach }
      : start.all_hostels || start.hostel_ids.length > 0
        ? { kind: "error" }
        : { kind: "none" },
  );
  const [problem, setProblem] = useState<string | null>(null);
  const [draftNote, setDraftNote] = useState<string | null>(
    startDraft?.too_long ? tooLongNote() : null,
  );
  const [drafting, setDrafting] = useState(false);
  const [pendingDraft, setPendingDraft] = useState<DraftText | null>(null);
  const [until, setUntil] = useState("");
  const [replace, setReplace] = useState(true);
  const [confirmOpen, setConfirmOpen] = useState(false);
  // The last post's error, until the next review: shown in the dialog, or beside "Review and
  // post" when the dialog was closed before the answer came.
  const [postError, setPostError] = useState<string | null>(null);

  // What the fields hold now, for a draft that comes back after they were edited.
  const latest = useRef({ title, body, targets, expiresChosen });
  useEffect(() => {
    latest.current = { title, body, targets, expiresChosen };
  }, [title, body, targets, expiresChosen]);

  const [state, act, posting] = useActionState(async (previous: FormState, form: FormData) => {
    const result = await postToBoard(previous, form);
    setPostError(result.error);
    if (result.notice) {
      confirm.current?.close();
      setTitle("");
      setBody("");
      setDraftNote(null);
    }
    return result;
  }, EMPTY);

  const counter = bodyCounter(body);
  const older = category === "timings" ? olderTimings(posts, targets) : [];
  const picker = allHostels || hostels.length > 1;

  function chooseCategory(next: BoardCategory): void {
    setCategory(next);
    if (!expiresChosen) setExpires(String(defaultExpiry(next)));
  }

  function chooseTargets(next: BoardTargetsBody): void {
    setTargets(next);
    const ticket = ++reachTicket.current;
    if (!next.all_hostels && next.hostel_ids.length === 0) {
      setReach({ kind: "none" });
      return;
    }
    setReach({ kind: "loading" });
    void boardReach(next).then(
      (result) => {
        if (ticket !== reachTicket.current) return; // a newer choice is being counted
        setReach("error" in result ? { kind: "error" } : { kind: "ready", value: result.ok });
      },
      () => {
        if (ticket === reachTicket.current) setReach({ kind: "error" });
      },
    );
  }

  function toggleHostel(hostelId: string, on: boolean): void {
    const ids = on
      ? hostels
          .filter((h) => h.id === hostelId || targets.hostel_ids.includes(h.id))
          .map((h) => h.id)
      : targets.hostel_ids.filter((other) => other !== hostelId);
    chooseTargets({ hostel_ids: ids, all_hostels: false });
  }

  function applyDraft(draft: DraftText): void {
    setTitle(draft.title);
    setBody(draft.body);
    chooseCategory("timings");
  }

  async function loadDraft(): Promise<void> {
    if (drafting) return;
    setDraftNote(null);
    if (!targets.all_hostels && targets.hostel_ids.length === 0) {
      setDraftNote("Choose who it's for first: the draft uses their hostels' outing rules.");
      return;
    }
    setDrafting(true);
    const asked = targets;
    try {
      const result = await boardDraft(asked);
      if ("error" in result) {
        setDraftNote(result.error);
        return;
      }
      const draft = result.ok;
      const now = latest.current;
      const arrived = draftArrival(asked, now, draft);
      if (arrived === null) {
        setDraftNote(
          "Who it's for changed while the rules were written out. Use the outing rules again.",
        );
        return;
      }
      const { fill, ask } = arrived;
      if (fill.title !== undefined) setTitle(fill.title);
      if (fill.body !== undefined) setBody(fill.body);
      if (fill.title !== undefined || fill.body !== undefined) {
        setCategory("timings");
        if (!now.expiresChosen) setExpires(String(defaultExpiry("timings")));
      }
      if (draft.too_long) setDraftNote(tooLongNote());
      if (ask) {
        setPendingDraft(draft);
        replaceDialog.current?.showModal();
      }
    } catch {
      setDraftNote("Couldn't write the outing rules out just now. Try again.");
    } finally {
      setDrafting(false);
    }
  }

  /** The API's checks, here first; then the confirm step. */
  function review(): void {
    const checked = boardPost({
      category,
      title,
      body,
      hostel_ids: targets.hostel_ids,
      all_hostels: targets.all_hostels,
      expires_in_days: expires,
      replace_timings: false,
    });
    if (!checked.ok) {
      setProblem(checked.error);
      return;
    }
    setProblem(null);
    setPostError(null);
    setUntil(untilText(checked.value.expires_in_days));
    setReplace(true);
    confirm.current?.showModal();
    setConfirmOpen(true);
  }

  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="flex flex-col gap-5 rounded-sheet border border-line bg-surface p-5 sm:p-6"
    >
      <div className="flex flex-col gap-1">
        <h2 id={`${id}-heading`} className="font-display text-xl text-ink">
          New board post
        </h2>
        <p className="max-w-[65ch] text-sm text-muted">
          Students see it on their home page, and the app sends a notification. Board posts go to
          every student in the hostel: don&apos;t name students.
        </p>
      </div>
      {readOnly ? (
        <p className="rounded-control bg-accent-soft px-4 py-3 text-sm font-bold text-ink">
          {readOnly}
        </p>
      ) : null}
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          // Enter in the title submits the form: that only opens the confirm step.
          if (!confirm.current?.open) {
            review();
            return;
          }
          if (posting) return;
          const form = new FormData(event.currentTarget);
          startTransition(() => act(form));
        }}
      >
        <fieldset disabled={readOnly !== null} className="flex min-w-0 flex-col gap-5">
          <legend className="sr-only">New board post</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${id}-category`} className={LABEL}>
                About
              </label>
              <select
                id={`${id}-category`}
                name="category"
                value={category}
                onChange={(event) => chooseCategory(event.target.value as BoardCategory)}
                className={`${INPUT} px-3`}
              >
                {BOARD_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABEL[c]}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor={`${id}-expires`} className={LABEL}>
                Shows for
              </label>
              <select
                id={`${id}-expires`}
                name="expires_in_days"
                value={expires}
                onChange={(event) => {
                  setExpires(event.target.value);
                  setExpiresChosen(true);
                }}
                aria-describedby={`${id}-expires-hint`}
                className={`${INPUT} px-3`}
              >
                {EXPIRY_CHOICES.map((days) => (
                  <option key={days} value={days}>
                    {EXPIRY_LABEL[days]}
                  </option>
                ))}
              </select>
              <p id={`${id}-expires-hint`} className="text-sm text-muted">
                Timings posts show for 30 days unless you choose, others for a week.
              </p>
            </div>
          </div>

          {picker ? (
            <fieldset className="flex min-w-0 flex-col gap-1">
              <legend className={`${LABEL} mb-1.5`}>Who it&apos;s for</legend>
              {allHostels ? (
                <label className="flex min-h-11 cursor-pointer items-center gap-3 font-bold text-ink">
                  <input
                    type="checkbox"
                    name="all_hostels"
                    checked={targets.all_hostels}
                    onChange={(event) =>
                      chooseTargets(
                        event.target.checked
                          ? { hostel_ids: [], all_hostels: true }
                          : { hostel_ids: [], all_hostels: false },
                      )
                    }
                    className="size-5 accent-[var(--accent-text)]"
                  />
                  All hostels, and students without a hostel
                </label>
              ) : null}
              <div className="grid gap-x-4 sm:grid-cols-2">
                {hostels.map((hostel) => (
                  <label
                    key={hostel.id}
                    className="flex min-h-11 cursor-pointer items-center gap-3 text-ink has-[:disabled]:cursor-not-allowed has-[:disabled]:text-muted"
                  >
                    <input
                      type="checkbox"
                      name="hostel_ids"
                      value={hostel.id}
                      checked={targets.all_hostels || targets.hostel_ids.includes(hostel.id)}
                      disabled={targets.all_hostels}
                      onChange={(event) => toggleHostel(hostel.id, event.target.checked)}
                      className="size-5 accent-[var(--accent-text)]"
                    />
                    <span className="min-w-0 break-words">{hostel.name}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ) : (
            <p className="text-sm text-ink">
              <span className="font-bold">For</span> the students in {hostels[0]?.name}
              <input type="hidden" name="hostel_ids" value={hostels[0]?.id ?? ""} />
            </p>
          )}
          <p aria-live="polite" className="text-sm text-muted" data-state={reach.kind}>
            {reachLine(reach)}
          </p>

          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void loadDraft()}
                aria-disabled={drafting}
                className={SECONDARY}
              >
                {drafting ? `Writing the rules out${ELLIPSIS}` : "Use the outing rules"}
              </button>
              <p className="text-sm text-muted">
                Writes out the outing hours the chosen hostels follow now.
              </p>
            </div>
            <p aria-live="polite" className="text-sm font-bold text-ink empty:hidden">
              {draftNote ?? ""}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-title`} className={LABEL}>
              Title
            </label>
            <input
              id={`${id}-title`}
              name="title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              autoComplete="off"
              placeholder="Mess closed for Sunday lunch"
              aria-describedby={`${id}-title-hint`}
              className={INPUT}
            />
            <p id={`${id}-title-hint`} className="text-sm text-muted">
              One line, up to {MAX_TITLE} characters. It is also the notification&apos;s title.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-body`} className={LABEL}>
              Post
            </label>
            <textarea
              id={`${id}-body`}
              name="body"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              rows={7}
              placeholder="Lunch is served in the B block mess on Sunday while the kitchen is cleaned."
              aria-describedby={`${id}-body-hint ${id}-body-count`}
              aria-invalid={counter.over || undefined}
              className={`${INPUT} min-h-40 py-3 leading-relaxed`}
            />
            <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 text-sm">
              <p id={`${id}-body-hint`} className="text-muted">
                Plain text. Line breaks show as typed.
              </p>
              <p
                id={`${id}-body-count`}
                className={`tabular-nums ${counter.over ? "font-bold text-danger" : "text-muted"}`}
              >
                {counter.text}
              </p>
            </div>
            <p aria-live="polite" className="sr-only">
              {counter.announce}
            </p>
          </div>

          <FormError message={problem} />
          <FormError message={confirmOpen ? null : postError} />
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={review} className={PRIMARY}>
              Review and post
            </button>
            <p aria-live="polite" className="text-sm font-bold text-good empty:hidden">
              {state.notice ?? ""}
            </p>
          </div>

          <dialog
            ref={confirm}
            aria-labelledby={`${id}-confirm`}
            className={DIALOG}
            data-state={posting ? "posting" : "ready"}
            onCancel={(event) => {
              // Escape mid-post would hide the answer: wait for it.
              if (posting) event.preventDefault();
            }}
            onClose={() => setConfirmOpen(false)}
          >
            <div className="flex flex-col gap-4">
              <h3 id={`${id}-confirm`} className="font-display text-xl text-ink">
                Post to the board?
              </h3>
              <dl className="flex flex-col gap-2 text-sm">
                <div>
                  <dt className="font-bold text-ink">Title</dt>
                  <dd className="break-words text-ink">{title.trim()}</dd>
                </div>
                <div>
                  <dt className="font-bold text-ink">For</dt>
                  <dd className="break-words text-ink">{forText(targets, hostels)}</dd>
                  <dd className="text-muted">{reachLine(reach)}</dd>
                </div>
                <div>
                  <dt className="font-bold text-ink">How long</dt>
                  <dd className="text-ink">{until}, campus time</dd>
                </div>
              </dl>
              {older.length > 0 ? (
                <div className="flex flex-col gap-1">
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 font-bold text-ink">
                    <input
                      type="checkbox"
                      name="replace_timings"
                      checked={replace}
                      onChange={(event) => setReplace(event.target.checked)}
                      aria-describedby={`${id}-older`}
                      className="size-5 accent-[var(--accent-text)]"
                    />
                    {replaceLabel(older.length)}
                  </label>
                  <p id={`${id}-older`} className="break-words text-sm text-muted">
                    Now on the board: {older.map((p) => p.title).join(", ")}
                  </p>
                </div>
              ) : null}
              <FormError message={confirmOpen ? postError : null} />
              <div className="flex flex-wrap gap-2">
                <button type="submit" aria-disabled={posting} className={PRIMARY}>
                  <span aria-live="polite">{posting ? `Posting${ELLIPSIS}` : "Post"}</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!posting) confirm.current?.close();
                  }}
                  aria-disabled={posting}
                  className={CLOSE}
                >
                  Go back and edit
                </button>
              </div>
            </div>
          </dialog>
        </fieldset>
      </form>

      <dialog
        ref={replaceDialog}
        aria-labelledby={`${id}-replace`}
        className={DIALOG}
        onClose={() => setPendingDraft(null)}
      >
        <div className="flex flex-col gap-4">
          <h3 id={`${id}-replace`} className="font-display text-xl text-ink">
            Replace what you wrote?
          </h3>
          <p className="text-ink">
            The outing rules draft replaces the title and post you wrote. Empty fields were already
            filled in.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                if (pendingDraft) applyDraft(pendingDraft);
                replaceDialog.current?.close();
              }}
              className={PRIMARY}
            >
              Replace
            </button>
            <button type="button" onClick={() => replaceDialog.current?.close()} className={CLOSE}>
              Keep what I wrote
            </button>
          </div>
        </div>
      </dialog>
    </section>
  );
}

function tooLongNote(): string {
  return `The rules make a long post: shorten it to ${MAX_BODY} characters and ${MAX_LINES} lines before posting.`;
}
