import type { ReactNode } from "react";

import { Bone, Loading, RowBones, TitleBones } from "@/components/ui/Skeleton";

/** Hostel board: title, the new-post form, then the posts on the board. */
export default function BoardLoading(): ReactNode {
  return (
    <Loading>
      <div className="flex max-w-3xl flex-col gap-8">
        <TitleBones lines={2} />
        <div className="flex flex-col gap-4 rounded-sheet border border-line bg-surface p-5">
          <Bone className="h-6 w-40 rounded-control" />
          <Bone className="h-12 w-full rounded-control" />
          <Bone className="h-12 w-full rounded-control" />
          <Bone className="h-40 w-full rounded-control" />
          <Bone className="h-12 w-40 rounded-control" />
        </div>
        <RowBones rows={3} />
      </div>
    </Loading>
  );
}
