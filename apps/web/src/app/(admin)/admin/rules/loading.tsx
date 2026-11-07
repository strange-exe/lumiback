import type { ReactNode } from "react";

import { Bone, CardBones, Loading, RowBones, TitleBones } from "@/components/ui/Skeleton";

/** Outing rules: title and the rule sets, then hostels, then holidays. */
export default function RulesLoading(): ReactNode {
  return (
    <Loading>
      <div className="flex flex-col gap-12">
        <div className="flex flex-col gap-5">
          <TitleBones lines={3} />
          <CardBones cards={2} />
        </div>
        <div className="flex flex-col gap-3">
          <Bone className="h-7 w-28 rounded-control" />
          <Bone className="h-4 w-full max-w-xl rounded-control" />
          <RowBones rows={3} />
        </div>
        <div className="flex flex-col gap-3">
          <Bone className="h-7 w-28 rounded-control" />
          <RowBones rows={2} />
        </div>
      </div>
    </Loading>
  );
}
