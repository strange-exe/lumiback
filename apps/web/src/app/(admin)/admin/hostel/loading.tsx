import type { ReactNode } from "react";

import { Bone, Loading, TitleBones } from "@/components/ui/Skeleton";

/** My hostel: title and explanation, then the hostel's contact form. */
export default function HostelLoading(): ReactNode {
  return (
    <Loading>
      <div className="flex max-w-2xl flex-col gap-6">
        <TitleBones lines={3} />
        <div className="flex flex-col gap-4 rounded-sheet border border-line bg-surface p-5">
          <Bone className="h-6 w-32 rounded-control" />
          <Bone className="h-12 w-full rounded-control" />
          <Bone className="h-12 w-full rounded-control" />
          <Bone className="h-12 w-32 rounded-control" />
        </div>
      </div>
    </Loading>
  );
}
