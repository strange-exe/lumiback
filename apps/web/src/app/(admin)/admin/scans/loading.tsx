import type { ReactNode } from "react";

import { Bone, Loading, RowBones, TitleBones } from "@/components/ui/Skeleton";

/** Gate scans: title, the filter row, then the list of scans. */
export default function ScansLoading(): ReactNode {
  return (
    <Loading>
      <TitleBones />
      <div className="flex flex-wrap items-end gap-3">
        <Bone className="h-11 w-44 rounded-control" />
        <Bone className="h-11 w-44 rounded-control" />
        <Bone className="h-11 w-20 rounded-control" />
      </div>
      <RowBones rows={8} />
    </Loading>
  );
}
