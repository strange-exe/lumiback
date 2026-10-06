import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { formatTime } from "@/features/outings/time";
import { shareApi } from "@/features/share/api";
import { SharePanel } from "@/features/share/components/SharePanel";
import { requireUser } from "@/lib/session";

export const metadata: Metadata = { title: "Share" };

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
          <p className="text-stone">Nobody is sharing with you right now.</p>
        ) : (
          <ul>
            {watching.map((share) => (
              <li key={share.id} className="border-t border-line first:border-t-0">
                <Link
                  href={`/watch/${share.id}`}
                  className="flex min-h-12 items-center justify-between gap-3 py-2 hover:text-pine"
                >
                  <span className="font-bold text-ink">{share.sharer.name}</span>
                  <span className="text-sm text-stone">until {formatTime(share.ends_at)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Link
          href="/join"
          className="mt-1 self-start font-bold text-pine underline-offset-4 hover:underline"
        >
          Have a join code?
        </Link>
      </section>
    </div>
  );
}
