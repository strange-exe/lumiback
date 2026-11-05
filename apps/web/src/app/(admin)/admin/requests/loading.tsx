import type { ReactNode } from "react";

import { CardBones, Loading, TitleBones } from "@/components/ui/Skeleton";

/** Outing requests: title and explanation, then request cards (two columns on wide screens). */
export default function RequestsLoading(): ReactNode {
  return (
    <Loading>
      <TitleBones lines={3} />
      <CardBones cards={4} grid />
    </Loading>
  );
}
