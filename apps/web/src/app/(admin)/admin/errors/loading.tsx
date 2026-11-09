import type { ReactNode } from "react";

import { Loading, RowBones, TitleBones } from "@/components/ui/Skeleton";

/** Errors: title, then the list of groups. */
export default function ErrorsLoading(): ReactNode {
  return (
    <Loading>
      <TitleBones />
      <RowBones rows={6} />
    </Loading>
  );
}
