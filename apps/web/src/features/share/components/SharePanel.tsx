"use client";

import { DeviceMobile } from "@phosphor-icons/react";
import { useState, useTransition, type ReactNode } from "react";

import { Lantern } from "@/components/illustrations/Lantern";
import { LiveMap } from "@/components/map/LiveMap";
import { formatTime } from "@/features/outings/time";
import { InviteCode } from "@/features/share/components/InviteCode";
import { ViewerList } from "@/features/share/components/ViewerList";
import { useShare } from "@/features/share/ShareProvider";
import { ago } from "@/lib/ago";
import { useNow } from "@/lib/use-now";

const DURATIONS = [
  { minutes: 60, label: "1 h" },
  { minutes: 120, label: "2 h" },
  { minutes: 240, label: "4 h" },
] as const;

const ENDED: Record<string, string> = {
  stopped_by_sharer: "You stopped sharing.",
  tab_closed: "Sharing stopped when the tab closed.",
  expired: "Your share time ran out.",
};

function StartShare(): ReactNode {
  const { start, starting, problem, endedReason } = useShare();
  const [minutes, setMinutes] = useState<number>(60);
  const [error, setError] = useState<string | null>(null);

  return (
    <section aria-labelledby="share-heading" className="flex flex-col gap-6">
      {endedReason && (
        <p role="status" className="rounded-control bg-good-soft px-4 py-3 text-ink">
          <strong>{ENDED[endedReason] ?? "Sharing ended."}</strong> Your location was deleted and
          nobody can see it now.
        </p>
      )}
      <div>
        <h1 id="share-heading" className="font-display text-title text-ink">
          Share your way back
        </h1>
        <p className="mt-2 text-muted">
          Let someone follow your location live while this tab is open.
        </p>
      </div>
      <Lantern lit={false} className="mx-auto w-full max-w-[7rem]" />
      <ul className="flex flex-col gap-2 text-ink">
        <li>
          <strong>Only people you approve.</strong> They join with a one-time code, then you say
          yes.
        </li>
        <li>
          <strong>Only while you&apos;re here.</strong> Closing this tab or tapping Stop ends it.
        </li>
        <li>
          <strong>Nothing kept.</strong> Just your latest position, deleted when sharing ends.
        </li>
      </ul>
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          void start(minutes).then(setError);
        }}
      >
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-bold text-ink">Share for at most</legend>
          <div className="grid grid-cols-3 gap-2">
            {DURATIONS.map((option) => (
              <label
                key={option.minutes}
                className="flex min-h-14 cursor-pointer items-center justify-center rounded-control border border-line bg-surface px-2 text-center text-sm font-bold text-ink transition has-[:checked]:border-accent has-[:checked]:bg-accent has-[:checked]:text-on-accent has-[:focus-visible]:outline has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent"
              >
                <input
                  type="radio"
                  name="minutes"
                  value={option.minutes}
                  checked={minutes === option.minutes}
                  onChange={() => setMinutes(option.minutes)}
                  className="sr-only"
                />
                {option.label}
              </label>
            ))}
          </div>
        </fieldset>
        <p role="alert" className="text-sm font-bold text-danger empty:hidden">
          {error ?? problem ?? ""}
        </p>
        <button
          type="submit"
          aria-disabled={starting}
          className="min-h-12 rounded-control bg-accent px-5 text-lg font-bold text-on-accent shadow-[0_2px_0_rgba(0,0,0,0.12)] hover:brightness-110 aria-disabled:cursor-progress aria-disabled:opacity-75"
        >
          {starting ? "Finding your location…" : "Start sharing"}
        </button>
        <p className="text-sm text-muted">Your browser will ask to use your location.</p>
      </form>
    </section>
  );
}

function LiveShare(): ReactNode {
  const { session, fix, sentAt, problem, screenAwake, stop, retry } = useShare();
  const now = useNow(5_000);
  const [stopping, startStop] = useTransition();
  const [error, setError] = useState<string | null>(null);
  if (!session) return null;

  const status = problem
    ? "Paused: we can't get your location"
    : sentAt && now
      ? `Live · updated ${ago(sentAt, now)}`
      : "Live · finding you…";

  return (
    <section aria-labelledby="live-heading" className="flex flex-col gap-6">
      <div>
        <p className="flex items-center gap-2 text-sm font-bold text-accent">
          <span
            aria-hidden="true"
            className={`size-2.5 rounded-full ${problem ? "bg-muted" : "bg-accent"}`}
          />
          <span aria-live="polite">{status}</span>
        </p>
        <h1 id="live-heading" className="mt-1 font-display text-title text-ink">
          You&apos;re sharing your location
        </h1>
        <p className="mt-1 text-muted">
          Until {formatTime(session.ends_at)} at the latest, or until you close this tab.
        </p>
      </div>

      <p className="flex gap-3 rounded-control bg-accent-soft px-4 py-3 text-sm leading-relaxed text-ink">
        <DeviceMobile size={20} weight="duotone" aria-hidden="true" className="mt-0.5 shrink-0" />
        <span>
          {screenAwake
            ? "Your screen will stay on while you share. "
            : "Keep this tab open with your screen on. "}
          Locking your phone or switching apps pauses sharing, and it ends after 5 minutes away.
        </span>
      </p>

      {problem && (
        <div role="alert" className="flex flex-col gap-3 rounded-control bg-danger-soft p-4">
          <p className="text-ink">{problem}</p>
          <button
            type="button"
            onClick={retry}
            className="min-h-11 self-start rounded-control bg-surface px-4 font-bold text-accent ring-1 ring-line"
          >
            Try again
          </button>
        </div>
      )}

      <LiveMap
        point={fix}
        paused={Boolean(problem)}
        label={
          fix
            ? `Map of the location you're sharing, accurate to about ${Math.round(fix.accuracy_m)} metres.`
            : "Map. Waiting for your first location."
        }
      />

      <ViewerList viewers={session.viewers} sessionId={session.id} />
      <InviteCode sessionId={session.id} />

      <div className="flex flex-col gap-2 border-t border-line pt-6">
        <button
          type="button"
          aria-disabled={stopping}
          onClick={() =>
            startStop(async () => {
              setError(await stop());
            })
          }
          className="min-h-12 rounded-control bg-danger px-5 text-lg font-bold text-surface hover:brightness-110 aria-disabled:opacity-75"
        >
          {stopping ? "Stopping…" : "Stop sharing"}
        </button>
        <p className="text-center text-sm text-muted">
          Everyone loses access at once and your location is deleted.
        </p>
        <p role="alert" className="text-sm font-bold text-danger empty:hidden">
          {error ?? ""}
        </p>
      </div>
    </section>
  );
}

export function SharePanel(): ReactNode {
  const { session } = useShare();
  return session ? <LiveShare /> : <StartShare />;
}
