import type { ReactNode } from "react";

import { Bone, Loading, RowBones, TitleBones } from "@/components/ui/Skeleton";

/**
 * People: title and explanation, the add/import row, the search box and filters, then the list.
 * Lives in the (list) group so it wraps only this page: over people/import it would stream that
 * admin-only page with a 200, and its "not for you" answer must stay a real 404.
 */
export default function PeopleLoading(): ReactNode {
  return (
    <Loading>
      <div className="flex max-w-3xl flex-col gap-6">
        <TitleBones lines={2} />
        <div className="flex flex-wrap items-center gap-4">
          <Bone className="h-12 w-36 rounded-control" />
          <Bone className="h-5 w-32 rounded-control" />
        </div>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <Bone className="h-12 min-w-0 flex-1 rounded-control" />
            <Bone className="h-12 w-24 rounded-control" />
          </div>
          <div className="flex flex-wrap gap-1">
            <Bone className="h-11 w-20 rounded-full" />
            <Bone className="h-11 w-28 rounded-full" />
            <Bone className="h-11 w-24 rounded-full" />
          </div>
        </div>
        <RowBones rows={6} />
      </div>
    </Loading>
  );
}
