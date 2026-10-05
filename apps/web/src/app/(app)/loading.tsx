import type { ReactNode } from "react";

import { Lantern } from "@/components/illustrations/Lantern";

export default function Loading(): ReactNode {
  return (
    <div role="status" className="flex flex-col items-center gap-3 py-16 text-stone">
      <Lantern lit={false} className="h-16 w-12 opacity-60" />
      <p>Loading…</p>
    </div>
  );
}
