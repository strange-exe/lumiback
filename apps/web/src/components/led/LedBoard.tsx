import type { ReactNode } from "react";

/**
 * The dark LED panel: a label row, a figure (LedFigure), details, and an optional ticker.
 * The ticker scrolls slowly and is hidden from screen readers, so whatever it says must also be
 * on the page as text. No hooks: works in server and client components.
 */
export function LedBoard({
  children,
  ticker,
  className = "",
}: {
  children: ReactNode;
  ticker?: string | null;
  className?: string;
}): ReactNode {
  return (
    <div className={`led-board flex flex-col gap-3 p-5 sm:p-6 ${className}`}>
      {children}
      {ticker ? (
        // Two copies in one track: it loops seamlessly, and the text is in view from the start.
        <p className="led-ticker" aria-hidden="true">
          <span>
            <span>{ticker}</span>
            <span>{ticker}</span>
          </span>
        </p>
      ) : null}
    </div>
  );
}

/** A label and its value on the board, in body type ("Back by" / "9:30 PM"). */
export function BoardFact({ term, value }: { term: string; value: ReactNode }): ReactNode {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="text-sm text-board-muted">{term}</dt>
      <dd className="truncate font-medium tabular-nums text-on-board">{value}</dd>
    </div>
  );
}

/**
 * Wraps the status board on Today-style screens: a soft orange glow breathes behind it and a
 * scan band passes over the page's dot grid. Both stop under reduced motion.
 */
export function LedStage({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}): ReactNode {
  return (
    <div className={`led-stage ${className}`}>
      <div className="led-stage-fx" aria-hidden="true" />
      {children}
    </div>
  );
}
