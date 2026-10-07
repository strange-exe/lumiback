import { router, useLocalSearchParams } from "expo-router";
import type { ReactNode } from "react";

import { FollowPanel } from "@/screens/follow-panel";
import { SharePanel } from "@/screens/share-panel";
import { haptic } from "@/ui/haptics";
import { Segmented } from "@/ui/kit";

type View = "share" | "follow";

/** Live: sharing your way back and following someone else's, one switch apart. */
export default function Live(): ReactNode {
  const { view } = useLocalSearchParams<{ view?: string }>();
  const current: View = view === "follow" ? "follow" : "share";
  const header = (
    <Segmented<View>
      label="Live location"
      value={current}
      options={[
        { value: "share", label: "Share mine" },
        { value: "follow", label: "Follow someone" },
      ]}
      onChange={(next) => {
        haptic.tap();
        router.setParams({ view: next });
      }}
    />
  );
  return current === "follow" ? <FollowPanel header={header} /> : <SharePanel header={header} />;
}
