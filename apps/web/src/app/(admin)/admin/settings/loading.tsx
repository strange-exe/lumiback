import type { ReactNode } from "react";

import { Bone, Loading, TitleBones } from "@/components/ui/Skeleton";

/** Settings: title and explanation, then the campus settings form. */
export default function SettingsLoading(): ReactNode {
  return (
    <Loading>
      <div className="flex max-w-2xl flex-col gap-6">
        <TitleBones lines={2} />
        <div className="flex flex-col gap-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <Bone className="h-4 w-40 rounded-control" />
              <Bone className="h-12 w-full rounded-control" />
            </div>
          ))}
          <Bone className="h-12 w-36 rounded-control" />
        </div>
      </div>
    </Loading>
  );
}
