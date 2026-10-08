import { useColorScheme, type TextStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * White, black and deep cobalt (chosen 2026-10-07; see .claude/DESIGN-mobile-v2.md).
 * Cool monochrome neutrals with exactly one accent. Red and green are semantic only
 * (overdue / done), never decoration.
 */
const light = {
  page: "#fafafb",
  surface: "#ffffff",
  raised: "#ffffff",
  ink: "#0b0c10",
  muted: "#5b606b",
  line: "#e7e8ec",
  /** The one accent: primary action, active nav, live state, progress. */
  accent: "#1f3fd1",
  onAccent: "#ffffff",
  accentSoft: "#e9edfc",
  // Same as the web: AA (4.5:1) as text on their soft backgrounds, not just on white.
  good: "#187349",
  goodSoft: "#e3f3eb",
  danger: "#b8322a",
  dangerSoft: "#fbe6e4",
  /** The status card: near-black in light mode, a lifted panel in dark mode. */
  hero: "#0b0c10",
  onHero: "#f5f6f8",
  heroMuted: "#9aa0ad",
  heroLine: "#262932",
  heroAccent: "#6d86ff",
  heroDanger: "#ff8a7a",
  shadow: "0 1px 2px rgba(11, 12, 16, 0.05), 0 8px 24px rgba(11, 12, 16, 0.08)",
  dock: "#0b0c10",
  onDock: "#f5f6f8",
  dockMuted: "#8a909c",
};

const dark: typeof light = {
  page: "#08090c",
  surface: "#121318",
  raised: "#181a20",
  ink: "#f2f3f5",
  muted: "#9ca1ac",
  line: "#23262e",
  accent: "#5b78ff",
  // White on this lighter cobalt is only 3.8:1; near-black is 5.3:1 (AA), as on the web.
  onAccent: "#08090c",
  accentSoft: "#161d3d",
  good: "#5fd39b",
  goodSoft: "#12261d",
  danger: "#ff7a6b",
  dangerSoft: "#2e1614",
  hero: "#14161c",
  onHero: "#f2f3f5",
  heroMuted: "#9ca1ac",
  heroLine: "#2a2e38",
  heroAccent: "#6d86ff",
  heroDanger: "#ff8a7a",
  shadow: "0 1px 2px rgba(0, 0, 0, 0.4), 0 8px 24px rgba(0, 0, 0, 0.35)",
  dock: "#181a20",
  onDock: "#f2f3f5",
  dockMuted: "#8a909c",
};

export type Colors = typeof light;

export const fonts = {
  regular: "Geist_400Regular",
  medium: "Geist_500Medium",
  semibold: "Geist_600SemiBold",
  bold: "Geist_700Bold",
} as const;

/** One type scale for the whole app (see .claude/design.md). */
export const type = {
  display: { fontFamily: fonts.semibold, fontSize: 40, lineHeight: 44, letterSpacing: -1.2 },
  title: { fontFamily: fonts.semibold, fontSize: 28, lineHeight: 34, letterSpacing: -0.6 },
  headline: { fontFamily: fonts.semibold, fontSize: 20, lineHeight: 26, letterSpacing: -0.3 },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 24 },
  label: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 20 },
  caption: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  eyebrow: {
    fontFamily: fonts.semibold,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
} satisfies Record<string, TextStyle>;

export const radius = { control: 14, sheet: 24, pill: 999 } as const;
export const space = (n: number): number => n * 4;
/** Screen edge padding and the gap between sections. */
export const layout = { gutter: 20, section: 28 } as const;

/** The floating dock: its height, and how far it floats above the system navigation. */
export const dock = { height: 68, lift: 10 } as const;

/**
 * Room a scrolling page keeps clear at the bottom so its end can scroll above the dock. Depends
 * on the system navigation: 3-button navigation is about twice as tall as the gesture bar, so a
 * fixed number hid the end of every page on those phones.
 */
export function useDockClearance(): number {
  return useSafeAreaInsets().bottom + dock.lift + dock.height + space(6);
}

export function useColors(): Colors {
  return useColorScheme() === "dark" ? dark : light;
}

export function useIsDark(): boolean {
  return useColorScheme() === "dark";
}
