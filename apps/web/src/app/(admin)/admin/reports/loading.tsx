import type { ReactNode } from "react";

import { Bone, Loading, RowBones, TitleBones } from "@/components/ui/Skeleton";

/** Reports: title, the dates, the four figures, then the table. */
export default function ReportsLoading(): ReactNode {
  return (
    <Loading>
      <TitleBones />
      <div className="flex flex-wrap items-end gap-3">
        <Bone className="h-12 w-44 rounded-control" />
        <Bone className="h-12 w-44 rounded-control" />
        <Bone className="h-12 w-24 rounded-control" />
      </div>
      <Bone className="h-28 w-full rounded-sheet" />
      <RowBones rows={5} />
    </Loading>
  );
}
