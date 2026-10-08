"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { Lantern } from "@/components/illustrations/Lantern";
import { LiveMap } from "@/components/map/LiveMap";
import { formatTime } from "@/features/outings/time";
import { TERMINAL, type WatchEvent } from "@/features/watch/events";
import { ago } from "@/lib/ago";
import { formatDistance, mockState, type Positions } from "@/lib/mock";
import type { Watching } from "@/lib/types";
import { useNow } from "@/lib/use-now";

type Phase = "connecting" | "pending" | "live" | "ended" | "gone" | "offline";

const STALE_MS = 60_000; // matches the backend: no update for a minute reads as paused
const MAX_SILENT_RETRIES = 5;

function endedText(reason: string, name: string): string {
  switch (reason) {
    case "revoked":
      return `${name} removed you from their share.`;
    case "stopped_by_sharer":
    case "tab_closed":
      return `${name} stopped sharing.`;
    default:
      return "This share has ended.";
  }
}

export function LiveView({ sessionId }: { sessionId: string }): ReactNode {
  const [phase, setPhase] = useState<Phase>("connecting");
  const [positions, setPositions] = useState<Positions>({ location: null });
  const [share, setShare] = useState<Watching | null>(null);
  const [reason, setReason] = useState("ended");
  const [connection, setConnection] = useState(0); // bump to reconnect after going offline
  const now = useNow(5_000);

  const handle = useCallback((event: WatchEvent) => {
    switch (event.type) {
      case "pending":
        setPhase("pending");
        break;
      case "live":
        setPhase("live");
        setPositions({ location: event.location, mocked_location: event.mocked_location });
        if (event.share) setShare(event.share);
        break;
      case "ended":
        setPhase("ended");
        setPositions({ location: null }); // never leave a last position on screen after access ends
        setReason(event.reason);
        break;
      case "gone":
        setPhase("gone");
        setPositions({ location: null });
        break;
    }
  }, []);

  useEffect(() => {
    const source = new EventSource(`/api/watch/${sessionId}/stream`);
    let silentRetries = 0;
    source.onmessage = (message) => {
      silentRetries = 0;
      const event = JSON.parse(message.data as string) as WatchEvent;
      handle(event);
      if (TERMINAL.has(event.type)) source.close(); // otherwise EventSource reconnects forever
    };
    source.onerror = () => {
      silentRetries += 1;
      if (source.readyState === EventSource.CLOSED || silentRetries > MAX_SILENT_RETRIES) {
        source.close();
        setPhase((current) => (current === "ended" || current === "gone" ? current : "offline"));
      }
    };
    return () => source.close();
  }, [sessionId, handle, connection]);

  const { location } = positions;
  const mock = mockState(positions);
  const fake = mock.kind === "now" ? mock.fake : null;
  const name = share?.sharer.name ?? "They";
  const first = share ? (share.sharer.name.split(" ")[0] ?? share.sharer.name) : null;
  const recordedAt = location ? Date.parse(location.recorded_at) : null;
  const paused = recordedAt !== null && now > 0 && now - recordedAt > STALE_MS;

  if (phase === "connecting") {
    return <p className="text-muted">Connecting…</p>;
  }

  if (phase === "pending") {
    return (
      <section aria-labelledby="watch-heading" className="flex flex-col items-start gap-5">
        <Lantern lit={false} className="w-20" />
        <h1 id="watch-heading" className="font-display text-title text-ink">
          Waiting for approval
        </h1>
        <p className="text-muted">
          We&apos;ve asked them. Keep this page open: it updates by itself the moment they say yes.
        </p>
      </section>
    );
  }

  if (phase === "ended" || phase === "gone") {
    return (
      <section aria-labelledby="watch-heading" className="flex flex-col items-start gap-5">
        <Lantern lit={false} className="w-20" />
        <h1 id="watch-heading" className="font-display text-title text-ink">
          {phase === "ended" ? endedText(reason, name) : "This share isn't available"}
        </h1>
        <p className="text-muted">
          {phase === "ended"
            ? "Their location is no longer visible to you."
            : "It may have ended, or this browser hasn't joined it. Ask them for a new code."}
        </p>
        <Link href="/join" className="font-bold text-accent underline-offset-4 hover:underline">
          Enter a new code
        </Link>
      </section>
    );
  }

  if (phase === "offline") {
    return (
      <section aria-labelledby="watch-heading" className="flex flex-col items-start gap-4">
        <h1 id="watch-heading" className="font-display text-title text-ink">
          Can&apos;t reach Lumiback
        </h1>
        <p className="text-muted">Check your connection, then try again.</p>
        <button
          type="button"
          onClick={() => {
            setPhase("connecting");
            setConnection((n) => n + 1);
          }}
          className="min-h-12 rounded-control bg-accent px-5 font-bold text-on-accent hover:brightness-110"
        >
          Try again
        </button>
      </section>
    );
  }

  const status = fake
    ? "Location faked by a mock-location app"
    : !location
      ? "Waiting for their first location…"
      : paused
        ? `Paused · last update ${ago(recordedAt ?? 0, now)}. Their phone may be locked or offline.`
        : `Live · updated ${now ? ago(recordedAt ?? 0, now) : "just now"}`;

  return (
    <section aria-labelledby="watch-heading" className="flex flex-col gap-5">
      <div>
        <p
          className={`flex items-center gap-2 text-sm font-bold ${fake ? "text-danger" : "text-accent"}`}
        >
          <span
            aria-hidden="true"
            className={`size-2.5 rounded-full ${fake ? "bg-danger" : location && !paused ? "bg-accent" : "bg-muted"}`}
          />
          <span aria-live="polite">{status}</span>
        </p>
        <h1 id="watch-heading" className="mt-1 font-display text-title text-ink">
          {share ? `${share.sharer.name}'s way back` : "Live location"}
        </h1>
        {share && (
          <p className="mt-1 text-muted">Shared with you until {formatTime(share.ends_at)}.</p>
        )}
      </div>
      <LiveMap
        point={location}
        fake={fake}
        paused={paused || fake !== null}
        label={[
          location
            ? `Map of ${name === "They" ? "their" : `${name}'s`} ${fake ? "last real " : ""}location, accurate to about ${Math.round(location.accuracy_m)} metres.`
            : "Map. No real location yet.",
          fake ? "A faked location is shown in red." : "",
        ]
          .filter(Boolean)
          .join(" ")}
      />
      {mock.kind === "now" && (
        <div role="alert" className="flex flex-col gap-1 rounded-control bg-danger-soft px-4 py-3">
          <p className="font-bold text-danger">Location is being faked</p>
          <p className="text-sm leading-relaxed text-ink">
            {mock.real
              ? `${first ? `${first}'s` : "Their"} phone is using an app that fakes its location. Red is the faked position; the other dot is the last real one, from ${now ? ago(Date.parse(mock.real.recorded_at), now) : "earlier"}${mock.apartM === null ? "" : `, ${formatDistance(mock.apartM)} away`}.`
              : `${first ? `${first}'s` : "Their"} phone has used an app that fakes its location since this share began, so there's no real position to show. Red is the faked one.`}
          </p>
        </div>
      )}
      {mock.kind === "earlier" && (
        <p className="text-sm text-muted">
          <strong className="text-danger">Heads up:</strong> {first ? `${first}'s` : "Their"} phone
          used a mock-location app at {formatTime(mock.at)}. Positions since then aren&apos;t
          flagged as fake.
        </p>
      )}
      {location && (
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${location.lat},${location.lng}`}
          target="_blank"
          rel="noopener noreferrer"
          className="self-start font-bold text-accent underline-offset-4 hover:underline"
        >
          Open in Google Maps
        </a>
      )}
      <p className="text-sm text-muted">
        They can see that you&apos;re following, and can stop it at any time.
      </p>
    </section>
  );
}
