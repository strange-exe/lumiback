import type { ReactNode } from "react";

import { Bone, Loading, RowBones } from "@/components/ui/Skeleton";

/**
 * The Register: title, the four counts, who's out, late today. Lives in the (register) group so
 * it wraps only this page: a loading boundary over the setup pages would stream them with a 200,
 * and their "not for you" answer must stay a real 404.
 */
export default function RegisterLoading(): ReactNode {
  return (
    <Loading>
      <div className="flex flex-col gap-5">
        <Bone className="h-9 w-40 rounded-control bg-line" />
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-sheet border border-line bg-line sm:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex flex-col gap-2 bg-surface px-5 py-4">
              <Bone className="h-9 w-12 rounded-control" />
              <Bone className="h-4 w-24 rounded-control" />
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-4 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Bone className="h-7 w-32 rounded-control" />
          <Bone className="h-12 w-64 max-w-full rounded-control" />
        </div>
        <RowBones rows={4} />
      </div>
    </Loading>
  );
}
