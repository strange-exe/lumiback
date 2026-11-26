/**
 * Colour themes (owner's pick, 2026-11-25/26; .claude/design.md "Re-theme 2026-11-25"): Gate
 * glass by default, LED night and Dusk on request. The colours themselves live in globals.css
 * (one block of CSS variables per theme and mode); this file only names the themes and reads
 * the choice. Light or dark still follows the device. Pure (no Next.js imports), so
 * `node --test` can load it.
 */
import { cookieBase } from "./cookies.ts";

/** This browser's choice. Per device, like the app's; never sent to the API. */
export const THEME_COOKIE = "lumiback_theme";
export const THEME_MAX_AGE = 365 * 24 * 60 * 60;

export const THEME_NAMES = ["gate", "led", "dusk"] as const;
export type ThemeName = (typeof THEME_NAMES)[number];
export const DEFAULT_THEME: ThemeName = "gate";

export interface ThemeInfo {
  id: ThemeName;
  name: string;
  /** One plain line under the name in the picker. */
  line: string;
}

export const THEMES: readonly ThemeInfo[] = [
  // The app's Appearance screen uses these same three lines (owner, 2026-11-26).
  { id: "gate", name: "Gate glass", line: "Calm paper and dark ink, teal when you're out" },
  { id: "led", name: "LED night", line: "Graphite and signal orange, like a station's LED board" },
  { id: "dusk", name: "Dusk", line: "Soft paper with orchid and indigo" },
];

/** The stored choice, or Gate glass for anything that isn't one of the three. */
export function parseTheme(value: string | null | undefined): ThemeName {
  return (THEME_NAMES as readonly string[]).includes(value ?? "")
    ? (value as ThemeName)
    : DEFAULT_THEME;
}

/** httpOnly: the server reads it to set <html data-theme>, so no page script needs it. */
export function themeCookieOptions(nodeEnv: string | undefined) {
  return { ...cookieBase(nodeEnv), maxAge: THEME_MAX_AGE };
}

/**
 * Browser-bar colours (the theme-color meta): each theme's --page, or --board for the gate
 * kiosk whose whole screen is the board. theme-css.test.ts checks them against globals.css.
 */
const BAR: Record<ThemeName, Record<"page" | "board", [light: string, dark: string]>> = {
  gate: { page: ["#f3f0e8", "#090e10"], board: ["#e2ece9", "#051417"] },
  led: { page: ["#f1f1f2", "#08090a"], board: ["#ffffff", "#121316"] },
  dusk: { page: ["#f4f1ea", "#0e0f16"], board: ["#ebe6db", "#11121b"] },
};

export function themeColor(
  theme: ThemeName,
  surface: "page" | "board",
): { media: string; color: string }[] {
  const [light, dark] = BAR[theme][surface];
  return [
    { media: "(prefers-color-scheme: light)", color: light },
    { media: "(prefers-color-scheme: dark)", color: dark },
  ];
}
