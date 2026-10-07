import { Image } from "expo-image";
import type { ReactNode } from "react";

import { useIsDark } from "@/ui/theme";

/**
 * Clay renders made from the web hero's scene (same material, light and camera), so the app and
 * the site share one visual language. Decorative: the screen's text always says the same thing.
 */
const SOURCES = {
  "lantern-lit": {
    light: require("../../assets/illustrations/lantern-lit-light.webp"),
    dark: require("../../assets/illustrations/lantern-lit-dark.webp"),
  },
  "lantern-unlit": {
    light: require("../../assets/illustrations/lantern-unlit-light.webp"),
    dark: require("../../assets/illustrations/lantern-unlit-dark.webp"),
  },
  gate: {
    light: require("../../assets/illustrations/gate-light.webp"),
    dark: require("../../assets/illustrations/gate-dark.webp"),
  },
  pin: {
    light: require("../../assets/illustrations/pin-light.webp"),
    dark: require("../../assets/illustrations/pin-dark.webp"),
  },
} as const;

export type IllustrationName = keyof typeof SOURCES;

export function Illustration({
  name,
  size = 160,
  /** On the pine hero card the light render reads best in both themes. */
  variant,
}: {
  name: IllustrationName;
  size?: number;
  variant?: "light" | "dark";
}): ReactNode {
  const dark = useIsDark();
  const source = SOURCES[name][variant ?? (dark ? "dark" : "light")];
  return (
    <Image
      source={source}
      style={{ width: size, height: size }}
      contentFit="contain"
      transition={150}
      accessible={false}
      importantForAccessibility="no"
    />
  );
}
