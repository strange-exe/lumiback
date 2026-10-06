import type { ReactNode } from "react";

/** Shaped like a page (heading, then content), so the real page replaces it without a jump. */
export default function Loading(): ReactNode {
  return (
    <div role="status" className="flex flex-col gap-6" aria-busy="true">
      <span className="sr-only">Loading…</span>
      <div aria-hidden="true" className="flex flex-col gap-3">
        <div className="h-5 w-24 animate-pulse rounded-control bg-line/70" />
        <div className="h-9 w-56 animate-pulse rounded-control bg-line" />
      </div>
      <div aria-hidden="true" className="h-40 animate-pulse rounded-sheet bg-line/60" />
      <div aria-hidden="true" className="flex flex-col gap-3">
        <div className="h-12 animate-pulse rounded-control bg-line/60" />
        <div className="h-12 animate-pulse rounded-control bg-line/60" />
      </div>
    </div>
  );
}
