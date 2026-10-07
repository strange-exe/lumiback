import { SealCheck } from "@phosphor-icons/react/dist/ssr";
import type { ReactNode } from "react";

/** How a trip was recorded: scanned at a gate (with a GPS check) or logged by the student. */
export function Via({ via, gate }: { via: "self" | "gate"; gate?: string | null }): ReactNode {
  if (via === "gate") {
    return (
      <span className="inline-flex items-center gap-1 text-good">
        <SealCheck weight="fill" className="size-4 shrink-0" aria-hidden="true" />
        {gate ? `Verified at ${gate}` : "Verified at gate"}
      </span>
    );
  }
  return <span className="text-muted">Self-reported</span>;
}
