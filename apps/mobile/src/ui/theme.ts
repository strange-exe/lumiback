import { useColorScheme, type TextStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * "LED night" (owner's pick, 2026-11-07; frozen spec in .claude/design.md). Graphite neutrals,
 * one signal orange, and a dark LED board as every status screen's focal surface. The orange
 * accent is a fill (with ink text on it); as text or links it is `accentText`, which passes AA.
 * Red and green are semantic only (late / back), never decoration.
 */
const light = {
  page: "#f1f1f2",
  surface: "#ffffff",
  raised: "#ffffff",
  ink: "#111113",
  muted: "#56565d",
  line: "#dcdce0",
  /** Input borders: 3:1 against the field, unlike the decorative `line`. */
  field: "#7d7d86",
  /** The one accent, as a fill: primary action, active state, progress. Never body text. */
  accent: "#e8501a",
  onAccent: "#111113",
  /** The accent as text, icons beside text, and links (AA on page and surface). */
  accentText: "#b33a0c",
  accentSoft: "#fde6db",
  // AA (4.5:1) as text on their soft backgrounds, not just on white.
  good: "#17703f",
  goodSoft: "#e0f1e6",
  warn: "#8a4b00",
  warnSoft: "#fdecd0",
  danger: "#b42318",
  dangerSoft: "#fbe5e2",
  /** The dark LED panel (the status board). Same in both modes, a touch lifted in dark. */
  board: "#0d0e10",
  onBoard: "#f2f2f3",
  boardMuted: "#9a9aa3",
  boardLine: "#24252a",
  /** Lit LED cells by state: out, back (in), late. */
  led: "#ff6a2b",
  ledGood: "#5ed38c",
  ledDanger: "#ff5a4e",
  /** Unlit LED cells: the led colour at 12% alpha. */
  ledGhost: "#ff6a2b1f",
  /** The background dot grid. */
  dot: "#d2d2d7",
  // Older names for the board, kept so every screen reads the board tokens through them.
  hero: "#0d0e10",
  onHero: "#f2f2f3",
  heroMuted: "#9a9aa3",
  heroLine: "#24252a",
  heroAccent: "#ff6a2b",
  heroDanger: "#ff5a4e",
  shadow: "0 1px 2px rgba(17, 17, 19, 0.05), 0 8px 24px rgba(17, 17, 19, 0.08)",
  dock: "#111113",
  /** The dock's glass fill: the dock colour at 85%, laid over the blur (or alone where there is none). */
  dockGlass: "#111113d9",
  /** The glass edge: a 1 px light hairline. */
  glassLine: "#ffffff1f",
  onDock: "#f2f2f3",
  dockMuted: "#9a9aa3",
  dockActive: "#2b2c31",
  scrim: "rgba(8, 9, 10, 0.72)",
};

const dark: typeof light = {
  page: "#08090a",
  surface: "#141518",
  raised: "#1b1c20",
  ink: "#f2f2f3",
  muted: "#9a9aa3",
  line: "#26272c",
  field: "#6b6b74",
  accent: "#ff6a2b",
  onAccent: "#111113",
  accentText: "#ff7f45",
  accentSoft: "#2a140b",
  good: "#5ed38c",
  goodSoft: "#11281b",
  warn: "#ffc061",
  warnSoft: "#2d2110",
  danger: "#ff8a80",
  dangerSoft: "#2e1614",
  board: "#121316",
  onBoard: "#f2f2f3",
  boardMuted: "#9a9aa3",
  boardLine: "#24252a",
  led: "#ff6a2b",
  ledGood: "#5ed38c",
  ledDanger: "#ff5a4e",
  ledGhost: "#ff6a2b1f",
  dot: "#1d1e22",
  hero: "#121316",
  onHero: "#f2f2f3",
  heroMuted: "#9a9aa3",
  heroLine: "#24252a",
  heroAccent: "#ff6a2b",
  heroDanger: "#ff5a4e",
  shadow: "0 1px 2px rgba(0, 0, 0, 0.4), 0 8px 24px rgba(0, 0, 0, 0.35)",
  dock: "#1b1c20",
  dockGlass: "#1b1c20d9",
  glassLine: "#ffffff1f",
  onDock: "#f2f2f3",
  dockMuted: "#9a9aa3",
  dockActive: "#303137",
  scrim: "rgba(0, 0, 0, 0.78)",
};

export type Colors = typeof light;

/** Instrument Sans for every word in the app. LED figures are dots (ui/led.tsx), not a font. */
export const fonts = {
  regular: "InstrumentSans_400Regular",
  medium: "InstrumentSans_500Medium",
  semibold: "InstrumentSans_600SemiBold",
} as const;

/** One type scale for the whole app (see .claude/design.md). No weight above 600. */
export const type = {
  display: { fontFamily: fonts.semibold, fontSize: 40, lineHeight: 44, letterSpacing: -0.8 },
  title: { fontFamily: fonts.semibold, fontSize: 28, lineHeight: 34, letterSpacing: -0.4 },
  headline: { fontFamily: fonts.semibold, fontSize: 20, lineHeight: 26, letterSpacing: -0.2 },
  body: { fontFamily: fonts.regular, fontSize: 16, lineHeight: 24 },
  label: { fontFamily: fonts.semibold, fontSize: 14, lineHeight: 20 },
  caption: { fontFamily: fonts.regular, fontSize: 13, lineHeight: 18 },
  /** A small sentence-case line above a title (callers colour it muted). */
  eyebrow: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16 },
} satisfies Record<string, TextStyle>;

export const radius = { control: 14, card: 20, board: 22, sheet: 24, pill: 999 } as const;
export const space = (n: number): number => n * 4;
/** Screen edge padding and the gap between sections. */
export const layout = { gutter: 20, section: 28 } as const;

/**
 * The floating dock: its height, how far it floats above the system navigation, and the Scan
 * button in its middle: the accent circle's size, the page-coloured ring around it, and how far
 * the circle's top rises above the dock's top edge.
 */
export const dock = { height: 64, lift: 10, scan: 60, ring: 4, rise: 22 } as const;

/**
 * Room a scrolling page keeps clear at the bottom so its end can scroll above the dock and the
 * Scan button rising out of it. Depends on the system navigation: 3-button navigation is about
 * twice as tall as the gesture bar, so a fixed number hid the end of every page on those phones.
 */
export function dockClearance(bottomInset: number): number {
  return bottomInset + dock.lift + dock.height + dock.rise + dock.ring + space(6);
}

export function useDockClearance(): number {
  return dockClearance(useSafeAreaInsets().bottom);
}

export function useColors(): Colors {
  return useColorScheme() === "dark" ? dark : light;
}

export function useIsDark(): boolean {
  return useColorScheme() === "dark";
}
