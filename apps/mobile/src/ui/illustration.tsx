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
    hero: require("../../assets/illustrations/lantern-lit-hero.webp"),
  },
  "lantern-unlit": {
    light: require("../../assets/illustrations/lantern-unlit-light.webp"),
    dark: require("../../assets/illustrations/lantern-unlit-dark.webp"),
    hero: require("../../assets/illustrations/lantern-unlit-hero.webp"),
  },
  gate: {
    light: require("../../assets/illustrations/gate-light.webp"),
    dark: require("../../assets/illustrations/gate-dark.webp"),
    hero: require("../../assets/illustrations/gate-hero.webp"),
  },
  pin: {
    light: require("../../assets/illustrations/pin-light.webp"),
    dark: require("../../assets/illustrations/pin-dark.webp"),
    hero: require("../../assets/illustrations/pin-hero.webp"),
  },
} as const;

export type IllustrationName = keyof typeof SOURCES;

export function Illustration({
  name,
  size = 160,
  variant,
}: {
  name: IllustrationName;
  size?: number;
  /** "hero": made for the near-black status card (light objects, grey trim). */
  variant?: "light" | "dark" | "hero";
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
