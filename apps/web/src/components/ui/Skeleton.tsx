import type { ReactNode } from "react";

/**
 * Loading placeholders shaped like the page they stand in for, so the real page replaces them
 * without a jump. The pulse stops under reduced motion (globals.css).
 */
export function Loading({ children }: { children: ReactNode }): ReactNode {
  return (
    <div role="status" aria-busy="true" data-state="loading" className="flex flex-col gap-6">
      <span className="sr-only">Loading…</span>
      <div aria-hidden="true" className="contents">
        {children}
      </div>
    </div>
  );
}

/** One grey shape; size and radius come from `className`. */
export function Bone({ className }: { className: string }): ReactNode {
  return <div className={`animate-pulse bg-line/60 ${className}`} />;
}

/** A page title with its explanation line(s) under it. */
export function TitleBones({ lines = 2 }: { lines?: number }): ReactNode {
  return (
    <div className="flex flex-col gap-2">
      <Bone className="h-9 w-56 rounded-control bg-line" />
      {Array.from({ length: lines }, (_, i) => (
        <Bone
          key={i}
          className={`h-4 rounded-control ${i === lines - 1 ? "w-2/3" : "w-full max-w-xl"}`}
        />
      ))}
    </div>
  );
}

/** A list of rows between hairlines, like the scans list or the late-today list. */
export function RowBones({ rows = 5 }: { rows?: number }): ReactNode {
  return (
    <div className="flex flex-col divide-y divide-line border-y border-line">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center justify-between gap-4 py-3.5">
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Bone className="h-4 w-40 rounded-control" />
            <Bone className="h-3.5 w-56 max-w-full rounded-control" />
          </div>
          <Bone className="h-7 w-20 rounded-full" />
        </div>
      ))}
    </div>
  );
}

/** Cards, like an escalation or a request. */
export function CardBones({
  cards = 3,
  grid = false,
}: {
  cards?: number;
  grid?: boolean;
}): ReactNode {
  return (
    <div className={grid ? "grid gap-4 xl:grid-cols-2" : "flex flex-col gap-4"}>
      {Array.from({ length: cards }, (_, i) => (
        <div
          key={i}
          className="flex flex-col gap-3 rounded-sheet border border-line bg-surface p-5"
        >
          <Bone className="h-5 w-44 rounded-control" />
          <Bone className="h-4 w-64 max-w-full rounded-control" />
          <div className="flex gap-2 pt-1">
            <Bone className="h-11 w-28 rounded-control" />
            <Bone className="h-11 w-28 rounded-control" />
          </div>
        </div>
      ))}
    </div>
  );
}
