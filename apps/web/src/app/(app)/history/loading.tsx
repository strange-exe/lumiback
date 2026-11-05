import type { ReactNode } from "react";

import { Bone, Loading } from "@/components/ui/Skeleton";

/** History: title, the three counts, then the ledger (a day on the left, its trips on the right). */
export default function HistoryLoading(): ReactNode {
  return (
    <Loading>
      <Bone className="h-9 w-48 rounded-control bg-line" />
      <div className="grid grid-cols-3 divide-x divide-line">
        {Array.from({ length: 3 }, (_, i) => (
          <div key={i} className="flex flex-col gap-2 px-3 first:pl-0">
            <Bone className="h-9 w-14 rounded-control" />
            <Bone className="h-4 w-20 rounded-control" />
          </div>
        ))}
      </div>
      <div className="border-t border-line">
        {Array.from({ length: 3 }, (_, day) => (
          <div key={day} className="grid grid-cols-[5.5rem_1fr] gap-x-4 border-b border-line py-4">
            <Bone className="h-4 w-16 rounded-control" />
            <div className="flex flex-col gap-4">
              {Array.from({ length: day === 0 ? 2 : 1 }, (_, trip) => (
                <div key={trip} className="flex flex-col gap-1.5">
                  <Bone className="h-4 w-36 rounded-control" />
                  <Bone className="h-3.5 w-44 rounded-control" />
                  <Bone className="h-3.5 w-28 rounded-control" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Loading>
  );
}
