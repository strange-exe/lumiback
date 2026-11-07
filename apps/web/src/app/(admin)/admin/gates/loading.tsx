import type { ReactNode } from "react";

import { Bone, Loading, TitleBones } from "@/components/ui/Skeleton";

/** Gates: title and explanation with the list of gates, and the add-a-gate form beside it. */
export default function GatesLoading(): ReactNode {
  return (
    <Loading>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-start">
        <div className="flex flex-col gap-5">
          <TitleBones lines={2} />
          <div className="flex flex-col divide-y divide-line border-y border-line">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="flex flex-col gap-3 py-5">
                <div className="flex flex-wrap items-baseline justify-between gap-4">
                  <Bone className="h-6 w-40 rounded-control" />
                  <Bone className="h-4 w-28 rounded-control" />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Bone className="h-11 w-28 rounded-control" />
                  <Bone className="h-11 w-36 rounded-control" />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-4 rounded-sheet border border-line bg-surface p-5">
          <Bone className="h-6 w-32 rounded-control" />
          <Bone className="h-12 w-full rounded-control" />
          <Bone className="h-12 w-full rounded-control" />
          <Bone className="h-12 w-full rounded-control" />
          <Bone className="h-12 w-28 rounded-control" />
        </div>
      </div>
    </Loading>
  );
}
