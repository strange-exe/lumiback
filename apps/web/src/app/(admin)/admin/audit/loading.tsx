import type { ReactNode } from "react";

import { Bone, Loading, RowBones, TitleBones } from "@/components/ui/Skeleton";

/** Audit log: title, the filter row, then the list of changes. */
export default function AuditLoading(): ReactNode {
  return (
    <Loading>
      <TitleBones />
      <div className="flex flex-wrap items-end gap-3">
        <Bone className="h-11 w-64 rounded-control" />
        <Bone className="h-11 w-40 rounded-control" />
        <Bone className="h-11 w-40 rounded-control" />
        <Bone className="h-11 w-44 rounded-control" />
      </div>
      <RowBones rows={8} />
    </Loading>
  );
}
