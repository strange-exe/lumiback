import { useColorScheme, type TextStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { usePrefs, type Prefs, type ThemeName } from "@/lib/prefs";

export type { ThemeName } from "@/lib/prefs";

/**
 * Three colour themes, each with a light and a dark palette of the same tokens (owner,
 * 2026-11-25/26; the contract is .claude/tasks/theme-tokens.json, decisions in .claude/design.md
 * "Re-theme 2026-11-25"). Screens never ask which theme is on: every colour decision goes
 * through a role token below, so one screen reads right in all six palettes.
 *
 * Gate glass (the default): warm paper neutrals, ink/chalk primary buttons, teal for "out" only,
 * red for "late" only, a celadon status board.
 */
const gateLight = {
  page: "#f3f0e8",
  surface: "#fbfaf6",
  raised: "#ffffff",
  ink: "#141c22",
  muted: "#525a5e",
  line: "#e0dbd0",
  /** Input borders: 3:1 against the field, unlike the decorative `line`. */
  field: "#7d786d",
  /** The primary action as a fill (I'm back, selections). Never body text. */
  accent: "#15252c",
  onAccent: "#f7f4ec",
  /** The accent as text and icons beside text (AA on page and surface). */
  accentText: "#08626b",
  accentSoft: "#c8f1f3",
  // AA (4.5:1) as text on their soft backgrounds, not just on white.
  good: "#20581b",
  goodSoft: "#e4f4cc",
  warn: "#7a5005",
  warnSoft: "#ffe2b2",
  danger: "#ba2b28",
  dangerSoft: "#ffdcdb",
  /**
   * The status board follows the light or dark mode (owner, 2026-11-14: "Board matches
   * theme"). The LED colours on it are AA text colours, since labels on the board are written
   * in them; they glow only in dark mode (ui/led.tsx).
   */
  board: "#e2ece9",
  onBoard: "#121c20",
  boardMuted: "#4b5a5b",
  boardLine: "#c4d3d0",
  /** Lit LED cells by state: out, back (in), late. */
  led: "#056068",
  ledGood: "#1d5618",
  ledDanger: "#b32322",
  /** Unlit LED cells: a neutral tint. */
  ledGhost: "#121c2014",
  /** The background dot grid. */
  dot: "#d8d2c5",
  // Always-dark surfaces in both modes: the camera screen (scan.tsx) and the profile monogram.
  // Content on a status board uses the board tokens above, never these.
  hero: "#0b1619",
  onHero: "#edf3f1",
  heroMuted: "#94a5a4",
  heroLine: "#21302f",
  heroAccent: "#5fe0cf",
  heroDanger: "#ff7d72",
  shadow: "0 1px 2px rgba(20, 28, 34, 0.06), 0 8px 24px rgba(20, 28, 34, 0.08)",
  dock: "#15232a",
  /** The dock's glass fill: the dock colour at 85%, laid over the blur (or alone where there is none). */
  dockGlass: "#15232ad9",
  /** The glass edge: a 1 px light hairline. */
  glassLine: "#ffffff1f",
  onDock: "#f1eee6",
  dockMuted: "#a4b1b3",
  dockActive: "#273840",
  /** Scan's fill and its glyph (3:1 at least; light or dark glyph, whichever the fill needs). */
  scan: "#0a6f73",
  onScan: "#f7f4ec",
  scrim: "rgba(10, 18, 20, 0.72)",
  /** Focus: a focused input's border, its caret and selection. */
  focus: "#08626b",
  /** Text links and the words on secondary and quiet buttons. */
  link: "#141c22",
  /** The "out" status: its word and chip text, and the chip's soft fill. */
  outText: "#08626b",
  outSoft: "#c8f1f3",
  /** Scan's lift off the page: a soft shadow, per theme. */
  scanShadow: "0 10px 24px rgba(21, 35, 42, 0.30)",
};

export type Colors = typeof gateLight;

const gateDark: Colors = {
  page: "#090e10",
  surface: "#10171a",
  raised: "#172024",
  ink: "#ebf0ee",
  muted: "#97a4a4",
  line: "#233033",
  field: "#687878",
  accent: "#e3ebe7",
  onAccent: "#0d1518",
  accentText: "#6fd8cd",
  accentSoft: "#05323a",
  good: "#8bd47b",
  goodSoft: "#1e3013",
  warn: "#f9d46b",
  warnSoft: "#3d2a08",
  danger: "#f47b74",
  dangerSoft: "#3e1e1e",
  board: "#051417",
  onBoard: "#e6f1ee",
  boardMuted: "#8ea6a4",
  boardLine: "#1a3034",
  led: "#4fe3cf",
  ledGood: "#98e17f",
  ledDanger: "#f75e54",
  ledGhost: "#4fe3cf1a",
  dot: "#19242a",
  hero: "#08171a",
  onHero: "#e6f1ee",
  heroMuted: "#8ea6a4",
  heroLine: "#1a3034",
  heroAccent: "#4fe3cf",
  heroDanger: "#f75e54",
  shadow: "0 1px 2px rgba(0, 0, 0, 0.45), 0 8px 24px rgba(0, 0, 0, 0.35)",
  dock: "#18232a",
  dockGlass: "#18232ad9",
  glassLine: "#ffffff1f",
  onDock: "#ebf0ee",
  dockMuted: "#97a4a4",
  dockActive: "#2a3a42",
  scan: "#3fd2c0",
  onScan: "#06191b",
  scrim: "rgba(0, 6, 8, 0.78)",
  focus: "#6fd8cd",
  link: "#ebf0ee",
  outText: "#6fd8cd",
  outSoft: "#05323a",
  scanShadow: "0 10px 24px rgba(0, 0, 0, 0.45)",
};

/**
 * LED night (owner's pick 2026-11-07, kept as a choice): graphite neutrals, one signal orange
 * (a fill with ink on it; as text it is the deeper `accentText`), and the breathing board glow.
 */
const ledLight: Colors = {
  page: "#f1f1f2",
  surface: "#ffffff",
  raised: "#ffffff",
  ink: "#111113",
  muted: "#56565d",
  line: "#dcdce0",
  field: "#7d7d86",
  accent: "#e8501a",
  onAccent: "#111113",
  accentText: "#b33a0c",
  accentSoft: "#fde6db",
  good: "#17703f",
  goodSoft: "#e0f1e6",
  warn: "#8a4b00",
  warnSoft: "#fdecd0",
  danger: "#b42318",
  dangerSoft: "#fbe5e2",
  board: "#ffffff",
  onBoard: "#111113",
  boardMuted: "#56565d",
  boardLine: "#dcdce0",
  led: "#b33a0c",
  ledGood: "#17703f",
  ledDanger: "#b42318",
  ledGhost: "#1111130f",
  dot: "#d2d2d7",
  hero: "#0d0e10",
  onHero: "#f2f2f3",
  heroMuted: "#9a9aa3",
  heroLine: "#24252a",
  heroAccent: "#ff6a2b",
  heroDanger: "#ff5a4e",
  shadow: "0 1px 2px rgba(17, 17, 19, 0.05), 0 8px 24px rgba(17, 17, 19, 0.08)",
  dock: "#111113",
  dockGlass: "#111113d9",
  glassLine: "#ffffff1f",
  onDock: "#f2f2f3",
  dockMuted: "#9a9aa3",
  dockActive: "#2b2c31",
  scan: "#e8501a",
  onScan: "#f1f1f2",
  scrim: "rgba(8, 9, 10, 0.72)",
  focus: "#b33a0c",
  link: "#b33a0c",
  outText: "#b33a0c",
  outSoft: "#fde6db",
  scanShadow: "0 10px 24px rgba(232, 80, 26, 0.38)",
};

const ledDark: Colors = {
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
  // The dark accent (#ff6a2b) is too bright for a light glyph (2.9:1): Scan keeps the deeper one.
  scan: "#e8501a",
  onScan: "#f2f2f3",
  scrim: "rgba(0, 0, 0, 0.78)",
  focus: "#ff7f45",
  link: "#ff7f45",
  outText: "#ff7f45",
  outSoft: "#2a140b",
  scanShadow: "0 10px 24px rgba(232, 80, 26, 0.38)",
};

/**
 * Dusk (owner, 2026-11-26: Brass and night with its action colour moved to the purple family):
 * an orchid action colour (I'm back, Scan, selections), indigo for "out", and ink links.
 */
const duskLight: Colors = {
  page: "#f4f1ea",
  surface: "#fcfbf8",
  raised: "#ffffff",
  ink: "#1b1b25",
  muted: "#57566a",
  line: "#e2ddd2",
  field: "#827c74",
  accent: "#94539a",
  onAccent: "#fbf9f4",
  accentText: "#1b1b25",
  accentSoft: "#f9d9f5",
  good: "#0f6353",
  goodSoft: "#d0f3e4",
  warn: "#945913",
  warnSoft: "#feebcc",
  danger: "#870f0e",
  dangerSoft: "#fdd4d4",
  board: "#ebe6db",
  onBoard: "#1b1b25",
  boardMuted: "#545262",
  boardLine: "#d4cdbf",
  led: "#333881",
  ledGood: "#0f6353",
  ledDanger: "#870f0e",
  ledGhost: "#1b1b2514",
  dot: "#dbd5c9",
  hero: "#14151e",
  onHero: "#efeef5",
  heroMuted: "#a6a5b8",
  heroLine: "#2a2b39",
  heroAccent: "#ca94d6",
  heroDanger: "#ff8378",
  shadow: "0 1px 2px rgba(27, 27, 37, 0.05), 0 8px 24px rgba(27, 27, 37, 0.07)",
  dock: "#191a24",
  dockGlass: "#191a24d9",
  glassLine: "#ffffff1f",
  onDock: "#efeef5",
  dockMuted: "#a6a5b8",
  dockActive: "#2e2f3e",
  scan: "#94539a",
  onScan: "#fbf9f4",
  scrim: "rgba(14, 15, 22, 0.72)",
  focus: "#7d3d83",
  link: "#1b1b25",
  outText: "#333881",
  outSoft: "#dee1ee",
  scanShadow: "0 10px 24px rgba(148, 83, 154, 0.34)",
};

const duskDark: Colors = {
  page: "#0e0f16",
  surface: "#171822",
  raised: "#1f202c",
  ink: "#efeef5",
  muted: "#a6a5b8",
  line: "#2a2b39",
  field: "#727189",
  accent: "#b478c2",
  onAccent: "#16161f",
  accentText: "#efeef5",
  accentSoft: "#341c35",
  good: "#59dbce",
  goodSoft: "#073829",
  warn: "#f29f49",
  warnSoft: "#492603",
  danger: "#ed695e",
  dangerSoft: "#4a191d",
  board: "#11121b",
  onBoard: "#efeef5",
  boardMuted: "#a6a5b8",
  boardLine: "#2a2b39",
  led: "#a9b5ff",
  ledGood: "#59dbce",
  ledDanger: "#ed695e",
  ledGhost: "#efeef512",
  dot: "#1d1e29",
  hero: "#11121b",
  onHero: "#efeef5",
  heroMuted: "#a6a5b8",
  heroLine: "#2a2b39",
  heroAccent: "#ca94d6",
  heroDanger: "#ff8378",
  shadow: "0 1px 2px rgba(0, 0, 0, 0.4), 0 8px 24px rgba(0, 0, 0, 0.32)",
  dock: "#20212e",
  dockGlass: "#20212ed9",
  glassLine: "#ffffff1a",
  onDock: "#efeef5",
  dockMuted: "#a6a5b8",
  dockActive: "#34354a",
  // A light orchid fill: its glyph is dark (5.48:1).
  scan: "#b478c2",
  onScan: "#16161f",
  scrim: "rgba(5, 5, 10, 0.78)",
  focus: "#d09add",
  link: "#efeef5",
  outText: "#a9b5ff",
  outSoft: "#252a4e",
  scanShadow: "0 10px 24px rgba(0, 0, 0, 0.45)",
};

export interface Theme {
  /** What Profile > Appearance calls it. */
  name: string;
  /** Decorative glow (the board's breathing light, the scan band): LED night only. */
  glow: boolean;
  light: Colors;
  dark: Colors;
}

/** The colour themes, in the order Profile > Appearance lists them. */
export const themes: Record<ThemeName, Theme> = {
  gate: { name: "Gate glass", glow: false, light: gateLight, dark: gateDark },
  led: { name: "LED night", glow: true, light: ledLight, dark: ledDark },
  dusk: { name: "Dusk", glow: false, light: duskLight, dark: duskDark },
};

export const DEFAULT_THEME: ThemeName = "gate";

/**
 * Android's tint for a local notification's small icon and app name: the theme's Scan colour
 * (light: the shade is light). Server pushes keep app.json's colour until a native build.
 */
export function notificationColour(theme: ThemeName): string {
  return themes[theme].light.scan;
}

const MODE_WORDS: Record<Prefs["appearance"], string> = {
  system: "match phone",
  light: "light",
  dark: "dark",
};

/** Profile's Appearance row: "Gate glass, match phone". */
export function appearanceSummary(theme: ThemeName, appearance: Prefs["appearance"]): string {
  return `${themes[theme].name}, ${MODE_WORDS[appearance]}`;
}

/** All six palettes ("gate/light" ... "dusk/dark"), for tests that check every theme. */
export const palettes: Record<`${ThemeName}/${"light" | "dark"}`, Colors> = {
  "gate/light": gateLight,
  "gate/dark": gateDark,
  "led/light": ledLight,
  "led/dark": ledDark,
  "dusk/light": duskLight,
  "dusk/dark": duskDark,
};

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

/** The palette for the chosen colour theme (Profile > Appearance) and the current light or dark. */
export function useColors(): Colors {
  const theme = themes[usePrefs().theme];
  return useColorScheme() === "dark" ? theme.dark : theme.light;
}

/** Whether the chosen theme has decorative glow (the board's breathing light, the scan band). */
export function useGlow(): boolean {
  return themes[usePrefs().theme].glow;
}

export function useIsDark(): boolean {
  return useColorScheme() === "dark";
}
