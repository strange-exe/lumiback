import { useColorScheme, type TextStyle } from "react-native";

/** "Dusk Courtyard", the same tokens as the web app (apps/web/src/app/globals.css). */
const light = {
  page: "#f4efe6",
  surface: "#fbf8f2",
  raised: "#ffffff",
  ink: "#1b2422",
  stone: "#5c605a",
  line: "#e3dccf",
  pine: "#234e46",
  onPine: "#f4efe6",
  pineSoft: "#dbe7e2",
  lantern: "#e59a3a",
  lanternSoft: "#f8e6cc",
  /** Lantern as text on light surfaces (the bright lantern fails contrast there). */
  lanternText: "#8a5413",
  ember: "#ad432c",
  emberSoft: "#f5ded6",
  sage: "#3f7253",
  sageSoft: "#dce9e0",
  /** The status card: deep pine in both themes, so the 3D object always sits on the same stage. */
  hero: "#234e46",
  onHero: "#f4efe6",
  heroMuted: "#b9cfc8",
  heroLine: "#3a655c",
  shadow: "0 1px 2px rgba(27, 36, 34, 0.06), 0 8px 24px rgba(35, 78, 70, 0.10)",
};

const dark: typeof light = {
  page: "#121a18",
  surface: "#1a2421",
  raised: "#202c28",
  ink: "#ede7dc",
  stone: "#a9aea6",
  line: "#2d3935",
  pine: "#8fc1b5",
  onPine: "#0f1f1b",
  pineSoft: "#1f3530",
  lantern: "#f0a94b",
  lanternSoft: "#3a2c19",
  lanternText: "#f0a94b",
  ember: "#ee927a",
  emberSoft: "#3a211b",
  sage: "#93c4a3",
  sageSoft: "#1d3326",
  hero: "#1d3a34",
  onHero: "#ede7dc",
  heroMuted: "#a7c2ba",
  heroLine: "#2c4f47",
  shadow: "0 1px 2px rgba(0, 0, 0, 0.30), 0 8px 24px rgba(0, 0, 0, 0.25)",
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

export function useColors(): Colors {
  return useColorScheme() === "dark" ? dark : light;
}

export function useIsDark(): boolean {
  return useColorScheme() === "dark";
}
