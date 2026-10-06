"use client";

import { useState, useTransition, type ReactNode } from "react";

import { approveViewer, removeViewer } from "@/features/share/actions";
import { useShare } from "@/features/share/ShareProvider";
import type { Viewer } from "@/lib/types";

function ViewerRow({ viewer, sessionId }: { viewer: Viewer; sessionId: string }): ReactNode {
  const { update } = useShare();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const who = viewer.kind === "guest" ? `${viewer.name} (guest)` : viewer.name;

  const act = (action: typeof approveViewer): void => {
    setError(null);
    startTransition(async () => {
      const result = await action(sessionId, viewer.id);
      if (result.ok) update(result.data);
      else setError(result.error);
    });
  };

  return (
    <li className="flex flex-col gap-2 border-t border-line py-3 first:border-t-0">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="min-w-0 flex-1">
          <span className="font-bold text-ink">{who}</span>
          <span className="block text-sm text-stone">
            {viewer.status === "pending" ? "wants to see your location" : "can see your location"}
          </span>
        </p>
        {viewer.status === "pending" ? (
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => act(approveViewer)}
              aria-label={`Approve ${who}`}
              className="min-h-11 rounded-control bg-pine px-4 text-sm font-bold text-on-pine hover:brightness-110 disabled:opacity-60"
            >
              Approve
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => act(removeViewer)}
              aria-label={`Decline ${who}`}
              className="min-h-11 rounded-control px-4 text-sm font-bold text-pine ring-1 ring-line hover:ring-pine/40 disabled:opacity-60"
            >
              Decline
            </button>
          </div>
        ) : (
          <button
            type="button"
            disabled={pending}
            onClick={() => act(removeViewer)}
            aria-label={`Remove ${who}`}
            className="min-h-11 rounded-control px-3 text-sm font-bold text-ember underline-offset-4 hover:underline disabled:opacity-60"
          >
            Remove
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm font-bold text-ember">
          {error}
        </p>
      )}
    </li>
  );
}

/** Requests first (they need a decision), then the people who can see you now. */
export function ViewerList({
  viewers,
  sessionId,
}: {
  viewers: Viewer[];
  sessionId: string;
}): ReactNode {
  const requests = viewers.filter((v) => v.status === "pending");
  const watching = viewers.filter((v) => v.status === "granted");

  return (
    <div className="flex flex-col gap-6">
      {requests.length > 0 && (
        <section aria-labelledby="requests-heading" aria-live="polite">
          <h2 id="requests-heading" className="font-display text-xl text-ink">
            Waiting for you
          </h2>
          <p className="text-sm text-stone">
            They used your code. They see nothing until you approve.
          </p>
          <ul className="mt-2">
            {requests.map((v) => (
              <ViewerRow key={v.id} viewer={v} sessionId={sessionId} />
            ))}
          </ul>
        </section>
      )}
      <section aria-labelledby="watching-heading">
        <h2 id="watching-heading" className="font-display text-xl text-ink">
          Who can see you
        </h2>
        {watching.length === 0 ? (
          <p className="mt-1 text-stone">Nobody yet. Send someone a join code.</p>
        ) : (
          <ul className="mt-2">
            {watching.map((v) => (
              <ViewerRow key={v.id} viewer={v} sessionId={sessionId} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
