import type { ReactNode } from "react";

import { CardBones, Loading, TitleBones } from "@/components/ui/Skeleton";

/** Escalations: title and explanation, then a card per late student. */
export default function EscalationsLoading(): ReactNode {
  return (
    <Loading>
      <TitleBones lines={3} />
      <CardBones cards={2} />
    </Loading>
  );
}
