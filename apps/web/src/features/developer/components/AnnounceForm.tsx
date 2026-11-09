"use client";

import Image from "next/image";
import { useActionState, useEffect, useId, useRef, useState, type ReactNode } from "react";

import { FormError } from "@/components/ui/Field";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { announceUpdate } from "@/features/developer/actions";
import {
  ANNOUNCE_KINDS,
  AUDIENCE_ROLES,
  announceBody,
  audienceLabel,
  historyAudience,
  KIND_LABEL,
  KIND_PATTERN,
  MAX_ANNOUNCE_BODY,
  MAX_ANNOUNCE_TITLE,
  titleGuidance,
  type AnnounceDraft,
  type AnnounceKind,
  type AnnouncementRecord,
  type Audience,
  type AudienceRole,
  type Banner,
} from "@/features/developer/announce";
import type { FormState } from "@/lib/types";

const EMPTY: FormState = { error: null };

export type SentRow = AnnouncementRecord & { when: string };

const DIALOG =
  "m-auto max-h-[calc(100dvh-2rem)] w-[min(32rem,calc(100vw-2rem))] overflow-y-auto rounded-sheet border border-line bg-surface p-5 text-left text-ink backdrop:bg-[rgba(var(--tint),0.55)] sm:p-6";
const INPUT =
  "min-h-12 rounded-control border border-field bg-page px-4 text-base text-ink focus:border-accent focus:outline-none";
/** One choice of several (radio), the same chip as Running late's. */
const CHOICE =
  "relative flex min-h-11 cursor-pointer items-center justify-center rounded-control border border-line bg-surface px-4 text-sm font-bold text-ink has-[:checked]:border-accent has-[:checked]:bg-accent has-[:checked]:text-on-accent has-[:focus-visible]:outline has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent";
/** Any number of choices (checkbox), the same chip as the role form's. */
const TICK =
  "relative flex min-h-11 cursor-pointer items-center gap-2 rounded-control border border-line px-3 text-sm text-ink has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:focus-visible]:outline has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent";

const ROLE_LABEL: Record<AudienceRole, string> = {
  student: "Students",
  warden: "Wardens",
  head_warden: "Head wardens",
  admin: "Admins",
  developer: "Developers",
};

/**
 * "Announce an update" for developers: what kind it is, who gets it (everyone, or chosen
 * roles), a title and one line, and for a feature launch an optional banner. A live preview
 * shows it as Android draws it, closed and opened; it goes out once confirmed. `last` says
 * when the last one went out and `history` lists the recent ones. There is no daily limit
 * (owner, 2026-11-09), so the confirm step is the guard.
 */
export function AnnounceForm({
  last,
  draft,
  history,
  banners,
}: {
  last: string;
  /** What the fields start with: this release's title, summary and kind (the changelog). */
  draft: AnnounceDraft;
  /** The last 20 sent, newest first, with `when` formatted on the server; null when the API
   * couldn't say. */
  history: SentRow[] | null;
  /** The banner pictures the API accepts (feature launches only). */
  banners: Banner[];
}): ReactNode {
  const [title, setTitle] = useState(draft.title);
  const [body, setBody] = useState(draft.body);
  const [kind, setKind] = useState<AnnounceKind>(draft.kind);
  const [everyone, setEveryone] = useState(true);
  const [roles, setRoles] = useState<AudienceRole[]>([]);
  const [image, setImage] = useState<string | null>(null);
  const [state, action] = useActionState(async (prev: FormState, form: FormData) => {
    const answer = await announceUpdate(prev, form);
    if (answer.notice) {
      // Sent: the form empties, it isn't a draft any more.
      setTitle("");
      setBody("");
      setKind("notice");
      setEveryone(true);
      setRoles([]);
      setImage(null);
    }
    return answer;
  }, EMPTY);
  const [problem, setProblem] = useState<string | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();

  const audience: Audience = everyone ? "everyone" : roles;
  const banner = kind === "feature" ? (banners.find((b) => b.name === image) ?? null) : null;
  const who = audienceLabel(audience);

  useEffect(() => {
    dialog.current?.close(); // the action answered: sent (notice) or refused (error below)
  }, [state]);

  function ask(): void {
    const checked = announceBody(title, body, { kind, audience, image });
    if (!checked.ok) {
      setProblem(checked.error);
      return;
    }
    setProblem(null);
    dialog.current?.showModal();
  }

  function toggle(role: AudienceRole, on: boolean): void {
    setRoles((now) => (on ? [...now, role] : now.filter((r) => r !== role)));
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
          A notification to every phone with Lumiback, or to the roles you choose. A newer one
          replaces the last one in the shade. Each one is recorded in the audit log.
        </p>
        <p className="text-sm text-ink">{last}</p>
      </div>
      <form
        ref={form}
        action={action}
        // Enter in a field submits the form through its first submit button, which is the
        // closed dialog's "Send". Every submit goes through the confirm step instead: only one
        // made while the dialog is open (its own button; the page behind a modal dialog
        // takes no input) reaches the action. React skips the action when this prevents it.
        onSubmit={(event) => {
          if (dialog.current?.open) return;
          event.preventDefault();
          ask();
        }}
        className="flex flex-col gap-5"
      >
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-bold text-ink">Kind</legend>
          <div className="flex flex-wrap gap-2">
            {ANNOUNCE_KINDS.map((k) => (
              <label key={k} className={CHOICE}>
                <input
                  type="radio"
                  name="kind"
                  value={k}
                  checked={kind === k}
                  onChange={() => setKind(k)}
                  className="sr-only"
                />
                {KIND_LABEL[k]}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-bold text-ink">Send to</legend>
          <div className="flex flex-wrap gap-2">
            <label className={CHOICE}>
              <input
                type="radio"
                name="audience"
                value="everyone"
                checked={everyone}
                onChange={() => setEveryone(true)}
                className="sr-only"
              />
              Everyone
            </label>
            <label className={CHOICE}>
              <input
                type="radio"
                name="audience"
                value="roles"
                checked={!everyone}
                onChange={() => setEveryone(false)}
                className="sr-only"
              />
              Choose roles
            </label>
          </div>
          {everyone ? null : (
            <fieldset className="flex flex-col gap-2 pt-1">
              <legend className="mb-1 text-sm text-muted">Roles (one or more)</legend>
              <div className="flex flex-wrap gap-2">
                {AUDIENCE_ROLES.map((role) => (
                  <label key={role} className={TICK}>
                    <input
                      type="checkbox"
                      name="role"
                      value={role}
                      checked={roles.includes(role)}
                      onChange={(event) => toggle(role, event.target.checked)}
                      className="size-4 accent-[var(--accent)]"
                    />
                    {ROLE_LABEL[role]}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
        </fieldset>

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
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={KIND_PATTERN[kind]}
            aria-describedby={`${id}-title-hint`}
            className={INPUT}
          />
          <p id={`${id}-title-hint`} className="text-sm text-muted">
            {titleGuidance(title)} Pattern: {KIND_PATTERN[kind]}
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
            value={body}
            onChange={(event) => setBody(event.target.value)}
            placeholder="Shift your due-back time once per outing. The office is notified."
            aria-describedby={`${id}-body-hint`}
            className={INPUT}
          />
          <p id={`${id}-body-hint`} className="text-sm text-muted">
            One line, up to {MAX_ANNOUNCE_BODY} characters: what it does, then what to do.
          </p>
        </div>

        {kind === "feature" && banners.length > 0 ? (
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-bold text-ink">Banner (optional)</legend>
            <p className="text-sm text-muted">Shown when the notification is opened.</p>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2">
              <label className={`${TICK} justify-center`}>
                <input
                  type="radio"
                  name="image"
                  value=""
                  checked={image === null}
                  onChange={() => setImage(null)}
                  className="sr-only"
                />
                No banner
              </label>
              {banners.map((b) => (
                <label key={b.name} className={`${TICK} flex-col items-stretch gap-1 p-1.5`}>
                  <input
                    type="radio"
                    name="image"
                    value={b.name}
                    checked={image === b.name}
                    onChange={() => setImage(b.name)}
                    className="sr-only"
                  />
                  <BannerPicture name={b.name} />
                  <span className="px-1">{b.name.charAt(0).toUpperCase() + b.name.slice(1)}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ) : null}

        <NotificationPreview title={title} body={body} banner={banner?.name ?? null} />

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
              Send this to {who}?
            </h3>
            <p>
              {KIND_LABEL[kind]}. It goes out as soon as you send it, and can&apos;t be taken back.
            </p>
            <div className="flex flex-col gap-0.5 rounded-control bg-accent-soft px-4 py-3">
              <p className="break-words font-bold text-ink">{title.trim()}</p>
              <p className="break-words text-ink">{body.trim()}</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <SubmitButton pendingLabel="Sending…">
                {everyone ? "Send to every phone" : `Send to ${who}`}
              </SubmitButton>
              <button
                type="button"
                onClick={() => dialog.current?.close()}
                className="min-h-12 rounded-control px-5 font-bold text-accent-text ring-1 ring-line hover:bg-accent-soft"
              >
                Cancel
              </button>
            </div>
          </div>
        </dialog>
      </form>

      <AnnounceHistory history={history} />
    </section>
  );
}

function BannerPicture({ name, className = "" }: { name: string; className?: string }): ReactNode {
  // The website's own file (the API sends phones the same file from the configured web address).
  return (
    <Image
      src={`/app/banners/${name}.png`}
      alt=""
      width={1024}
      height={512}
      unoptimized
      className={`aspect-[2/1] h-auto w-full rounded-[10px] bg-board object-cover ${className}`}
    />
  );
}

/**
 * Android's notification, closed (one line each, cut short as a phone would) and opened (the
 * whole text, the banner, and the Changelog and Update buttons). A picture of the notification:
 * the buttons here do nothing.
 */
function NotificationPreview({
  title,
  body,
  banner,
}: {
  title: string;
  body: string;
  banner: string | null;
}): ReactNode {
  const shownTitle = title.trim() || "Title";
  const shownBody = body.trim() || "What's new";
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-sm font-bold text-ink">Preview (Android)</figcaption>
      <div className="flex flex-col gap-3 rounded-board bg-board p-3 text-on-board">
        <div className="flex flex-col gap-1">
          <p className="px-1 text-xs text-board-muted">Closed</p>
          <div className="flex items-start gap-3 rounded-card border border-board-line p-3">
            <AppMark />
            <div className="flex min-w-0 flex-1 flex-col">
              <AppLine />
              <p className="truncate text-sm font-bold">{shownTitle}</p>
              <p className="truncate text-sm text-board-muted">{shownBody}</p>
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <p className="px-1 text-xs text-board-muted">Opened</p>
          <div className="flex flex-col gap-2 rounded-card border border-board-line p-3">
            <div className="flex items-start gap-3">
              <AppMark />
              <div className="flex min-w-0 flex-1 flex-col">
                <AppLine />
                <p className="break-words text-sm font-bold">{shownTitle}</p>
                <p className="break-words text-sm text-board-muted">{shownBody}</p>
              </div>
            </div>
            {banner ? <BannerPicture name={banner} /> : null}
            <p className="flex gap-6 px-1 pt-1 text-sm font-bold text-led">
              <span>Changelog</span>
              <span>Update</span>
            </p>
          </div>
        </div>
      </div>
    </figure>
  );
}

function AppLine(): ReactNode {
  return (
    <p className="flex gap-2 text-xs text-board-muted">
      <span>Lumiback</span>
      <span>now</span>
    </p>
  );
}

function AppMark(): ReactNode {
  return <span aria-hidden className="mt-0.5 size-6 shrink-0 rounded-full bg-led" />;
}

function AnnounceHistory({ history }: { history: SentRow[] | null }): ReactNode {
  const id = useId();
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-4">
      <h3 id={`${id}-history`} className="font-display text-lg text-ink">
        Sent recently
      </h3>
      {history === null ? (
        <p className="text-sm text-muted">Couldn&apos;t load the recent announcements.</p>
      ) : history.length === 0 ? (
        <p className="text-sm text-muted">Nothing announced yet.</p>
      ) : (
        <div
          role="region"
          aria-labelledby={`${id}-history`}
          tabIndex={0}
          className="overflow-x-auto rounded-control border border-line"
        >
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="border-b border-line text-muted">
              <tr>
                <th scope="col" className="px-3 py-2 font-normal">
                  When
                </th>
                <th scope="col" className="px-3 py-2 font-normal">
                  Kind
                </th>
                <th scope="col" className="px-3 py-2 font-normal">
                  Title
                </th>
                <th scope="col" className="px-3 py-2 font-normal">
                  To
                </th>
                <th scope="col" className="px-3 py-2 text-right font-normal">
                  Phones
                </th>
                <th scope="col" className="px-3 py-2 font-normal">
                  By
                </th>
              </tr>
            </thead>
            <tbody>
              {history.map((h) => (
                <tr key={`${h.at}-${h.title}`} className="border-b border-line last:border-b-0">
                  <td className="whitespace-nowrap px-3 py-2 tabular-nums text-ink">
                    <time dateTime={h.at}>{h.when}</time>
                  </td>
                  <td className="px-3 py-2 text-ink">{h.kind ? KIND_LABEL[h.kind] : "Update"}</td>
                  <td className="break-words px-3 py-2 text-ink">{h.title}</td>
                  <td className="px-3 py-2 text-ink">{historyAudience(h.audience)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-ink">
                    {h.devices ?? "Not recorded"}
                  </td>
                  <td className="px-3 py-2 text-ink">{h.by ?? "Former account"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
