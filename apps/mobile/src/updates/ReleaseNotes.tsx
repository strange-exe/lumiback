import type { ReactNode } from "react";
import { View } from "react-native";

import { formatDate } from "@/lib/time";
import { T } from "@/ui/kit";
import { space, useColors } from "@/ui/theme";

import type { Release } from "./changelog";

/** One release: version and date, its title, and what changed as short points. */
export function ReleaseNotes({
  release,
  heading = true,
}: {
  release: Release;
  /** false when the surrounding sheet already names the release. */
  heading?: boolean;
}): ReactNode {
  const c = useColors();
  return (
    <View style={{ gap: space(2) }}>
      {heading ? (
        <View style={{ gap: 2 }}>
          <T tone="label">{release.title}</T>
          <T tone="caption">
            Version {release.version} · {formatDate(release.date)}
          </T>
        </View>
      ) : null}
      {release.points.map((point) => (
        <View key={point} style={{ flexDirection: "row", gap: space(2) }}>
          <View
            style={{
              width: 6,
              height: 6,
              borderRadius: 3,
              marginTop: 8,
              backgroundColor: c.accent,
            }}
          />
          <T style={{ flex: 1 }}>{point}</T>
        </View>
      ))}
    </View>
  );
}
