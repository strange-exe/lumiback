import Ionicons from "@expo/vector-icons/Ionicons";
import type { ReactNode } from "react";
import { View } from "react-native";

import { ago } from "@/lib/ago";
import { formatTime } from "@/lib/time";
import { formatDistance, type MockState } from "@/location/mock";
import { T } from "@/ui/kit";
import { radius, space, useColors } from "@/ui/theme";

/**
 * Explains a red dot on the map. `first` is the sharer's first name for viewers; omit it on the
 * sharer's own screen. Wording says "flagged as fake", because Android's flag is what we know.
 */
export function MockNotice({
  state,
  first,
  now,
}: {
  state: MockState;
  first?: string;
  /** Needed for viewers, to say how old the last real position is. */
  now?: number;
}): ReactNode {
  const c = useColors();
  if (state.kind === "none") return null;

  if (state.kind === "earlier") {
    return (
      <View style={{ flexDirection: "row", gap: space(2), alignItems: "flex-start" }}>
        <Ionicons name="alert-circle-outline" size={18} color={c.danger} style={{ marginTop: 1 }} />
        <T tone="small" style={{ flex: 1 }}>
          {first ? `${first}'s phone` : "Your phone"} used a mock-location app at{" "}
          {formatTime(state.at)}. Positions since then aren&apos;t flagged as fake.
        </T>
      </View>
    );
  }

  const { real, apartM } = state;
  const body = first
    ? real
      ? `${first}'s phone is using an app that fakes its location. Red is the faked position; the other dot is ${first}'s last real one, from ${ago(Date.parse(real.recorded_at), now ?? Date.parse(real.recorded_at))}${apartM === null ? "" : `, ${formatDistance(apartM)} away`}.`
      : `${first}'s phone has used an app that fakes its location since this share began, so there's no real position to show. Red is the faked one.`
    : "People following you see the faked position in red, next to your last real one. Turn off the mock-location app (Developer options) to share normally.";

  return (
    <View
      accessibilityRole="alert"
      style={{
        backgroundColor: c.dangerSoft,
        borderRadius: radius.control,
        borderCurve: "continuous",
        padding: space(4),
        gap: space(1),
      }}
    >
      <View style={{ flexDirection: "row", gap: space(2), alignItems: "center" }}>
        <Ionicons name="warning-outline" size={20} color={c.danger} />
        <T tone="headline" style={{ color: c.danger, flex: 1 }}>
          {first ? "Location is being faked" : "A mock-location app is on"}
        </T>
      </View>
      <T tone="small" style={{ color: c.ink }}>
        {body}
      </T>
    </View>
  );
}
