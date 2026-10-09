import type { ReactNode } from "react";
import { View } from "react-native";

import { CHANGELOG } from "@/updates/changelog";
import { ReleaseNotes } from "@/updates/ReleaseNotes";
import { Screen } from "@/ui/kit";
import { space, useColors } from "@/ui/theme";

/** Every release, newest first. */
export default function WhatsNewScreen(): ReactNode {
  const c = useColors();
  return (
    <Screen edges={["bottom"]}>
      {CHANGELOG.map((release, i) => (
        <View
          key={release.version}
          style={
            i === 0
              ? undefined
              : { borderTopWidth: 1, borderTopColor: c.line, paddingTop: space(5) }
          }
        >
          <ReleaseNotes release={release} />
        </View>
      ))}
    </Screen>
  );
}
