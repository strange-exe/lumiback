import type { Metadata } from "next";
import type { ReactNode } from "react";

import { adminApi } from "@/features/admin/api";
import { formatWhen } from "@/features/admin/format";
import { requireDeveloper } from "@/lib/session";
import type { ErrorGroup } from "@/lib/types";

export const metadata: Metadata = { title: "Errors" };

const PLATFORM: Record<ErrorGroup["platform"], string> = {
  web: "Website",
  android: "Android app",
  ios: "iPhone app",
};

/**
 * For developers: what broke on the website and in the app, the same error grouped together,
 * the most recent first. Everything here was scrubbed by the API before it was stored (no
 * emails, phone numbers, roll numbers, names, places or tokens), and nothing says who it was.
 */
export default async function ErrorsPage(): Promise<ReactNode> {
  const { token } = await requireDeveloper();
  const { items } = await adminApi.errors(token);

  return (
    <section aria-labelledby="errors-heading" className="flex max-w-4xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 id="errors-heading" className="font-display text-title text-ink">
          Errors
        </h1>
        <p className="max-w-[65ch] text-muted">
          What broke on the website and in the app, with the same error counted together. Each one
          is kept for 30 days after it was last seen. Reload to check again.
        </p>
      </div>

      {items.length === 0 ? (
        <p
          data-state="empty"
          className="rounded-sheet border border-dashed border-line px-5 py-10 text-center text-muted"
        >
          No errors in the last 30 days.
        </p>
      ) : (
        <ol
          aria-labelledby="errors-heading"
          data-state="ready"
          className="divide-y divide-line border-y border-line"
        >
          {items.map((group) => (
            <ErrorRow key={group.id} group={group} />
          ))}
        </ol>
      )}
    </section>
  );
}

function ErrorRow({ group }: { group: ErrorGroup }): ReactNode {
  const seen = group.count === 1 ? "Once" : `${group.count} times`;
  const facts = [
    PLATFORM[group.platform],
    group.app_version ? `version ${group.app_version}` : null,
    group.route ? `on ${group.route}` : null,
    group.signed_in ? "signed in" : "signed out",
  ].filter(Boolean);
  return (
    <li className="flex flex-col gap-1.5 py-4">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4">
        <p className="min-w-0 break-words font-bold text-ink">{group.message}</p>
        <p className="text-sm font-bold tabular-nums text-ink">{seen}</p>
      </div>
      <p className="min-w-0 break-words text-sm text-muted">{facts.join(", ")}</p>
      <p className="text-sm tabular-nums text-muted">
        Last seen <time dateTime={group.last_seen_at}>{formatWhen(group.last_seen_at)}</time>, first
        seen <time dateTime={group.first_seen_at}>{formatWhen(group.first_seen_at)}</time>
      </p>
      {group.stack ? (
        <details>
          <summary className="flex min-h-11 cursor-pointer items-center self-start text-sm font-bold text-accent-text">
            Stack
          </summary>
          {/* Scrolls inside itself; focusable so a keyboard can scroll it too. */}
          <pre
            tabIndex={0}
            aria-label="Stack"
            className="max-h-80 overflow-auto rounded-control border border-line bg-surface p-3 text-xs text-ink"
          >
            {group.stack}
          </pre>
        </details>
      ) : group.top_frame ? (
        <p className="min-w-0 break-all font-mono text-xs text-muted">{group.top_frame}</p>
      ) : null}
    </li>
  );
}
