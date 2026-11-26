import { readFileSync } from "fs";
import { join } from "path";
import { createElement } from "react";
import * as RN from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { setPrefs } from "@/lib/prefs";
import {
  appearanceSummary,
  DEFAULT_THEME,
  palettes,
  themes,
  useColors,
  useGlow,
  type Colors,
} from "@/ui/theme";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
}));

/** WCAG relative luminance of #rrggbb (any alpha byte is ignored: these are opaque pairs). */
function lum(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

type Key = keyof Colors;
/**
 * The pairs the token contract checks (.claude/tasks/theme-tokens.json), each with the WCAG
 * minimum it needs: 4.5 for text, 3 for icons, input borders, focus rings and Scan's edge.
 */
const PAIRS: [Key, Key, number][] = [
  ["ink", "page", 4.5],
  ["ink", "surface", 4.5],
  ["muted", "surface", 4.5],
  ["muted", "page", 4.5],
  ["link", "surface", 4.5],
  ["link", "page", 4.5],
  ["onAccent", "accent", 4.5],
  ["onBoard", "board", 4.5],
  ["boardMuted", "board", 4.5],
  ["led", "board", 4.5],
  ["ledDanger", "board", 4.5],
  ["ledGood", "board", 4.5],
  ["outText", "outSoft", 4.5],
  ["outText", "surface", 4.5],
  ["good", "goodSoft", 4.5],
  ["danger", "dangerSoft", 4.5],
  ["warn", "warnSoft", 4.5],
  ["danger", "surface", 4.5],
  ["onDock", "dock", 4.5],
  ["dockMuted", "dock", 4.5],
  ["onHero", "hero", 4.5],
  ["heroAccent", "hero", 4.5],
  ["onScan", "scan", 3],
  ["field", "surface", 3],
  ["scan", "page", 3],
  ["focus", "page", 3],
  ["focus", "surface", 3],
];

const NAMES = ["gate", "led", "dusk"] as const;

describe("colour themes", () => {
  it("are Gate glass (the default), LED night and Dusk; only LED night glows", () => {
    expect(Object.keys(themes)).toEqual([...NAMES]);
    expect(DEFAULT_THEME).toBe("gate");
    expect(themes.gate.name).toBe("Gate glass");
    expect(themes.led.name).toBe("LED night");
    expect(themes.dusk.name).toBe("Dusk");
    expect(NAMES.filter((n) => themes[n].glow)).toEqual(["led"]);
  });

  it("give tests all six palettes, each with every token", () => {
    expect(Object.keys(palettes).sort()).toEqual(
      NAMES.flatMap((n) => [`${n}/dark`, `${n}/light`]).sort(),
    );
    const keys = Object.keys(palettes["gate/light"]).sort();
    for (const name of ["focus", "link", "outText", "outSoft", "scanShadow"]) {
      expect(keys).toContain(name);
    }
    for (const p of Object.values(palettes)) {
      expect(Object.keys(p).sort()).toEqual(keys);
      for (const [key, value] of Object.entries(p)) {
        if (key === "shadow" || key === "scanShadow")
          expect(value).toMatch(/^0 \d+px \d+px rgba\(/);
        else if (key === "scrim") expect(value).toMatch(/^rgba\(\d+, \d+, \d+, 0\.\d+\)$/);
        else expect(value).toMatch(/^#[0-9a-f]{6}([0-9a-f]{2})?$/);
      }
    }
  });

  it("match the owner-approved token contract exactly: every token of all six palettes", () => {
    // theme-tokens.json is the contract's themes (.claude/tasks/theme-tokens.json, which isn't
    // in the repo), checked in so a token can't drift while still passing its contrast minimum.
    const contract = JSON.parse(
      readFileSync(join(__dirname, "theme-tokens.json"), "utf8"),
    ) as Record<string, { name: string; glow: boolean; light: Colors; dark: Colors }>;
    expect(Object.keys(contract)).toEqual([...NAMES]);
    for (const name of NAMES) {
      const { light, dark, ...meta } = contract[name]!;
      expect({ name: themes[name].name, glow: themes[name].glow }).toEqual(meta);
      expect(palettes[`${name}/light`]).toEqual(light);
      expect(palettes[`${name}/dark`]).toEqual(dark);
    }
  });

  it("use the contract's values (spot checks)", () => {
    expect(palettes["gate/light"]).toMatchObject({
      page: "#f3f0e8",
      accent: "#15252c",
      led: "#056068",
      link: "#141c22",
      outText: "#08626b",
    });
    expect(palettes["gate/dark"]).toMatchObject({ accent: "#e3ebe7", scan: "#3fd2c0" });
    expect(palettes["led/light"]).toMatchObject({ accent: "#e8501a", ledGhost: "#1111130f" });
    expect(palettes["dusk/light"]).toMatchObject({ accent: "#94539a", outText: "#333881" });
    expect(palettes["dusk/dark"]).toMatchObject({ scan: "#b478c2", onScan: "#16161f" });
  });

  for (const [theme, p] of Object.entries(palettes)) {
    it(`${theme}: every contract pair meets its contrast minimum`, () => {
      const failing = PAIRS.filter(([fg, bg, min]) => ratio(p[fg], p[bg]) < min).map(
        ([fg, bg, min]) => `${fg} on ${bg}: ${ratio(p[fg], p[bg]).toFixed(2)} < ${min}`,
      );
      expect(failing).toEqual([]);
    });
  }
});

describe("appearanceSummary", () => {
  it("names the theme, then light or dark, for Profile's Appearance row", () => {
    expect(appearanceSummary("gate", "system")).toBe("Gate glass, match phone");
    expect(appearanceSummary("led", "dark")).toBe("LED night, dark");
    expect(appearanceSummary("dusk", "light")).toBe("Dusk, light");
  });
});

describe("useColors", () => {
  let tree: ReactTestRenderer | undefined;
  let seen: { colors: Colors; glow: boolean } | undefined;
  function Probe(): null {
    seen = { colors: useColors(), glow: useGlow() };
    return null;
  }

  afterEach(async () => {
    act(() => tree?.unmount());
    tree = undefined;
    await act(async () => setPrefs({ theme: "gate" }));
    jest.restoreAllMocks();
  });

  it("follows the chosen theme and the phone's light or dark setting", async () => {
    await act(async () => {
      tree = create(createElement(Probe));
    });
    expect(seen!.colors).toBe(palettes["gate/light"]);
    expect(seen!.glow).toBe(false);

    await act(async () => setPrefs({ theme: "dusk" }));
    expect(seen!.colors).toBe(palettes["dusk/light"]);

    await act(async () => setPrefs({ theme: "led" }));
    expect(seen!.colors).toBe(palettes["led/light"]);
    expect(seen!.glow).toBe(true);

    const scheme = jest.spyOn(RN, "useColorScheme").mockReturnValue("dark");
    try {
      act(() => tree!.update(createElement(Probe)));
      expect(seen!.colors).toBe(palettes["led/dark"]);
    } finally {
      scheme.mockReturnValue("light");
    }
  });
});
