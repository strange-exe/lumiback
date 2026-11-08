import { useEffect, useState, type ReactNode } from "react";
import { View } from "react-native";

import { SLOW_AFTER_MS, startingLines } from "@/lib/starting";
import { Illustration } from "@/ui/illustration";
import { Screen, T } from "@/ui/kit";
import { FadeIn } from "@/ui/motion";
import { space } from "@/ui/theme";

/**
 * Shown at launch while a stored session is being checked: the app's own screen instead of the
 * splash staying up (which looked like a black screen while a sleeping server woke). The scan
 * band says it is working (still for "Remove animations"); after a few seconds it also says why
 * it is slow. It ends on its own: signed in, signed out, or "Can't reach Lumiback".
 */
export function StartingScreen(): ReactNode {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SLOW_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);
  const { title, detail } = startingLines(slow ? SLOW_AFTER_MS : 0);

  return (
    <Screen scan>
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={detail ? `${title}. ${detail}` : title}
        accessibilityLiveRegion="polite"
        style={{ flex: 1, justifyContent: "center", gap: space(3) }}
      >
        <Illustration name="lantern-lit" size={120} />
        <T tone="title" accessibilityRole="header">
          {title}
        </T>
        {detail ? (
          <FadeIn>
            <T tone="muted">{detail}</T>
          </FadeIn>
        ) : null}
      </View>
    </Screen>
  );
}
