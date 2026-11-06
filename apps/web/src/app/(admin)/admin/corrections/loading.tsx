import type { ReactNode } from "react";

import { CardBones, Loading, TitleBones } from "@/components/ui/Skeleton";

/** Corrections: title and explanation, then students' asks as cards. */
export default function CorrectionsLoading(): ReactNode {
  return (
    <Loading>
      <TitleBones lines={2} />
      <CardBones cards={2} grid />
    </Loading>
  );
}
