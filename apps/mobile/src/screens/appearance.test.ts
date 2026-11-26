import { createElement, type ReactNode } from "react";
import * as RN from "react-native";
import { AccessibilityInfo, Text, View } from "react-native";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";

import Appearance from "@/app/(app)/profile/appearance";
import { setPrefs, usePrefs } from "@/lib/prefs";
import { haptic } from "@/ui/haptics";
import { palettes, useColors, type Colors } from "@/ui/theme";

jest.mock("@expo/vector-icons/Ionicons", () => () => null);
jest.mock("@/ui/haptics", () => ({ haptic: { tap: jest.fn() } }));
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
}));
// The page shell (safe areas, dot grid) isn't what these tests are about.
jest.mock("@/ui/kit", () => {
  const actual = jest.requireActual("@/ui/kit");
  const { createElement: h } = jest.requireActual("react");
  const { View: V } = jest.requireActual("react-native");
  return {
    ...actual,
    Screen: ({ children }: { children: ReactNode }) => h(V, null, children),
  };
});

let tree: ReactTestRenderer | undefined;
type Seen = { colors: Colors; theme: string };
/** Told, on each render, what the rest of the app sees while the screen is open. */
const report = jest.fn<void, [Seen]>();
const seen = (): Seen => report.mock.calls.at(-1)![0];

function Probe({ onRender }: { onRender: (s: Seen) => void }): null {
  onRender({ colors: useColors(), theme: usePrefs().theme });
  return null;
}

async function render(): Promise<ReactTestInstance> {
  await act(async () => {
    tree = create(
      createElement(
        View,
        null,
        createElement(Appearance),
        createElement(Probe, { onRender: report }),
      ),
    );
  });
  return tree!.root;
}

/**
 * The options' pressables (what reaches Android's accessibility tree: the outermost element with
 * an accessibility state, not the Row around it), in screen order.
 */
const radios = (root: ReactTestInstance): ReactTestInstance[] =>
  root.findAll(
    (n) =>
      n.props.accessibilityRole === "radio" &&
      n.props.accessibilityState !== undefined &&
      typeof n.props.onPress === "function",
    { deep: false },
  );

const labels = (root: ReactTestInstance): string[] =>
  radios(root).map((n) => n.props.accessibilityLabel as string);

/** Which options are checked, in screen order (the state a screen reader announces). */
const checked = (root: ReactTestInstance): boolean[] =>
  radios(root).map((n) => (n.props.accessibilityState as { checked: boolean }).checked);

beforeEach(() => {
  jest
    .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
    .mockReturnValue(new Promise<boolean>(() => undefined));
});

afterEach(async () => {
  act(() => tree?.unmount());
  tree = undefined;
  jest.restoreAllMocks();
  await act(async () => setPrefs({ theme: "gate", appearance: "system" }));
});

describe("Profile > Appearance", () => {
  it("lists the colour themes first, Gate glass chosen, then light or dark", async () => {
    const root = await render();
    // The names alone: the chosen one is announced once, by its checked state.
    expect(labels(root)).toEqual([
      "Gate glass",
      "LED night",
      "Dusk",
      "Match phone",
      "Light",
      "Dark",
    ]);
    expect(checked(root)).toEqual([true, false, false, true, false, false]);
    const headings = root
      .findAllByType(Text)
      .map((n) => n.props.children)
      .filter((t) => t === "Colour theme" || t === "Light or dark");
    expect(headings).toEqual(["Colour theme", "Light or dark"]);
  });

  it("groups each set of options as a named radio group", async () => {
    const root = await render();
    const groups = root.findAll((n) => n.props.accessibilityRole === "radiogroup", {
      deep: false,
    });
    expect(groups.map((g) => g.props.accessibilityLabel)).toEqual([
      "Colour theme",
      "Light or dark",
    ]);
    const inGroup = groups.map((g) => radios(g).map((n) => n.props.accessibilityLabel as string));
    expect(inGroup).toEqual([
      ["Gate glass", "LED night", "Dusk"],
      ["Match phone", "Light", "Dark"],
    ]);
  });

  it("switches the whole app's colours when a theme is tapped", async () => {
    const root = await render();
    expect(seen().colors).toBe(palettes["gate/light"]);
    await act(async () => (radios(root)[2]!.props.onPress as () => void)());
    expect(haptic.tap).toHaveBeenCalledTimes(1);
    expect(seen().theme).toBe("dusk");
    expect(seen().colors).toBe(palettes["dusk/light"]);
    expect(checked(root).slice(0, 3)).toEqual([false, false, true]);
  });

  it("describes each theme in the website's words (owner, 2026-11-26)", async () => {
    // The same three lines are in apps/web/src/lib/theme.ts, pinned by its theme.test.ts.
    const root = await render();
    const texts = root
      .findAllByType(Text)
      .map((n) => n.props.children)
      .filter((t): t is string => typeof t === "string");
    for (const line of [
      "Calm paper and dark ink, teal when you're out",
      "Graphite and signal orange, like a station's LED board",
      "Soft paper with orchid and indigo",
    ]) {
      expect(texts).toContain(line);
    }
    expect(texts.join(" ")).not.toMatch(/warm paper/i);
  });

  for (const mode of ["light", "dark"] as const) {
    it(`shows each theme's page, accent and LED colours as a small swatch (${mode})`, async () => {
      // The phone's scheme, as the rest of these tests see it (jest's Appearance doesn't switch).
      jest.spyOn(RN, "useColorScheme").mockReturnValue(mode);
      const root = await render();
      expect(seen().colors).toBe(palettes[`gate/${mode}`]);
      expectSwatches(root, mode);
    });
  }
});

/** Each theme row's swatch shows that theme's page, accent and LED colours in this mode. */
function expectSwatches(root: ReactTestInstance, mode: "light" | "dark"): void {
  for (const [i, theme] of (["gate", "led", "dusk"] as const).entries()) {
    const c = palettes[`${theme}/${mode}`];
    const swatch = radios(root)[i]!.findAll((n) => n.props.testID === "theme-swatch")[0]!;
    const fills = swatch
      .findAll((n) => n.type === View && n.props.testID === "swatch-dot")
      .map((n) => (n.props.style as { backgroundColor: string }).backgroundColor);
    expect(fills).toEqual([c.page, c.accent, c.led]);
    expect(swatch.props.importantForAccessibility).toBe("no-hide-descendants");
  }
}
