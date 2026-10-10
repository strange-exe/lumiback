"use client";

import { Eye, ShieldCheck } from "@phosphor-icons/react";
import { useEffect, useState, type ReactNode } from "react";

import { formatTime } from "@/features/outings/time";
import type { AccessLogEntry } from "@/lib/types";

const POLL_MS = 15_000; // reads are logged as they happen; a short delay here is fine

interface Person {
  key: string;
  entry: AccessLogEntry; // their latest read (the log is newest first)
  count: number;
}

function group(log: AccessLogEntry[]): Person[] {
  const people = new Map<string, Person>();
  for (const entry of log) {
    const key = `${entry.kind}:${entry.viewer_id ?? entry.viewer_name}`;
    const seen = people.get(key);
    if (seen) seen.count += 1;
    else people.set(key, { key, entry, count: 1 });
  }
  return [...people.values()];
}

/**
 * Everyone who has read this share's location, grouped by person, like the app's "Who looked".
 * An admin read means the hostel office followed up a late return: it is always listed.
 */
export function WhoLooked({ sessionId }: { sessionId: string }): ReactNode {
  const [log, setLog] = useState<AccessLogEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      const response = await fetch(`/api/share/${sessionId}/access-log`, {
        cache: "no-store",
      }).catch(() => null);
      if (!response?.ok || cancelled) return; // a missed poll is fine; the next one catches up
      const fresh = (await response.json().catch(() => null)) as AccessLogEntry[] | null;
      if (!cancelled && Array.isArray(fresh)) setLog(fresh);
    };
    void load();
    const poll = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(poll);
    };
  }, [sessionId]);

  const people = group(log);
  if (people.length === 0) return null;

  return (
    <section aria-labelledby="looked-heading">
      <h2 id="looked-heading" className="font-display text-xl text-ink">
        Who looked
      </h2>
      <ul className="mt-2">
        {people.slice(0, 6).map(({ key, entry, count }) => (
          <li
            key={key}
            className="flex items-start gap-3 border-t border-line py-3 first:border-t-0"
          >
            {entry.kind === "admin" ? (
              <ShieldCheck
                size={20}
                weight="duotone"
                aria-hidden="true"
                className="mt-0.5 shrink-0 text-danger"
              />
            ) : (
              <Eye size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-muted" />
            )}
            <p className="min-w-0 flex-1">
              <span className="font-bold text-ink">
                {entry.kind === "guest" ? `${entry.viewer_name} (guest)` : entry.viewer_name}
              </span>
              <span className="block text-sm text-muted">
                {entry.kind === "admin"
                  ? `Viewed your location at ${formatTime(entry.viewed_at)} because you were late`
                  : `${count === 1 ? "Once" : `${count} times`}, last at ${formatTime(entry.viewed_at)}`}
              </span>
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}
