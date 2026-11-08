import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { dueLine } from "@/features/outings/running-late";
import { formatTime } from "@/features/outings/time";
import { shareApi } from "@/features/share/api";
import { SharePanel } from "@/features/share/components/SharePanel";
import { requireUser } from "@/lib/session";
import type { Watching } from "@/lib/types";

export const metadata: Metadata = { title: "Share" };

/** Their due-back time while they're out (never the running-late reason). */
function DueBack({ share }: { share: Watching }): ReactNode {
  const line = dueLine(share.due_back_at, share.original_due_at);
  return line ? <span className="tabular-nums text-ink">{line}</span> : null;
}

export default async function SharePage(): Promise<ReactNode> {
  const { token } = await requireUser();
  const watching = await shareApi.watching(token);

  return (
    <div className="flex flex-col gap-10">
      <SharePanel />

      <section aria-labelledby="shared-with-you" className="flex flex-col gap-2">
        <h2 id="shared-with-you" className="font-display text-xl text-ink">
          Shared with you
        </h2>
        {watching.length === 0 ? (
          <p className="text-muted">Nobody is sharing with you right now.</p>
        ) : (
          <ul>
            {watching.map((share) => (
              <li key={share.id} className="border-t border-line first:border-t-0">
                <Link
                  href={`/watch/${share.id}`}
                  className="flex min-h-12 items-center justify-between gap-3 py-2 hover:text-accent"
                >
                  <span className="font-bold text-ink">{share.sharer.name}</span>
                  <span className="flex flex-col items-end text-right text-sm text-muted">
                    <span>until {formatTime(share.ends_at)}</span>
                    <DueBack share={share} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Link
          href="/join"
          className="mt-1 self-start font-bold text-accent underline-offset-4 hover:underline"
        >
          Have a join code?
        </Link>
      </section>
    </div>
  );
}
