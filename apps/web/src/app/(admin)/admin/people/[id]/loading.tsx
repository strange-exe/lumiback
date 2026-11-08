import type { ReactNode } from "react";

import { Bone, CardBones, Loading, TitleBones } from "@/components/ui/Skeleton";

/** A student's record: name and contacts, the four counts, the tabs, then outing cards. */
export default function StudentRecordLoading(): ReactNode {
  return (
    <Loading>
      <Bone className="h-11 w-20 rounded-control" />
      <TitleBones />
      <div className="grid gap-3 sm:grid-cols-2">
        <Bone className="h-16 rounded-control" />
        <Bone className="h-16 rounded-control" />
      </div>
      <Bone className="h-20 rounded-sheet" />
      <Bone className="h-12 w-72 max-w-full rounded-control" />
      <CardBones />
    </Loading>
  );
}
