import { createElement } from "react";
import { AccessibilityInfo, Animated, Image, StyleSheet, type ImageStyle } from "react-native";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";

import { setPrefs } from "@/lib/prefs";
import { DotBackground, fieldDots, PITCH } from "@/ui/backdrop";
import { palettes } from "@/ui/theme";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
}));

let tree: ReactTestRenderer | undefined;

async function render(reduced: boolean, scan = false): Promise<ReactTestRenderer> {
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(reduced);
  await act(async () => {
    tree = create(createElement(DotBackground, { scan }));
  });
  await act(async () => {
    await Promise.resolve();
  });
  return tree!;
}

function stub(): Animated.CompositeAnimation {
  return { start: jest.fn(), stop: jest.fn(), reset: jest.fn() } as Animated.CompositeAnimation;
}

beforeEach(() => {
  jest.spyOn(Animated, "loop").mockImplementation(() => stub());
});

afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
  jest.restoreAllMocks();
});

describe("LED field dots", () => {
  const dots = fieldDots(412, 915);
  const cells = Math.ceil(412 / PITCH) * Math.ceil(915 / PITCH);

  it("sit exactly on the grid's own dots (the centre of each 9 dp tile)", () => {
    for (const d of dots) {
      expect((d.x - PITCH / 2) % PITCH).toBe(0);
      expect((d.y - PITCH / 2) % PITCH).toBe(0);
    }
  });

  it("are sparse: a few percent of the grid, enough to read as a wave", () => {
    expect(dots.length).toBeGreaterThan(cells * 0.05);
    expect(dots.length).toBeLessThan(cells * 0.13);
  });

  it("peak inside the pass, so each rise and fade fits between 0 and 1", () => {
    for (const d of dots) {
      expect(d.at - 0.05).toBeGreaterThanOrEqual(0);
      expect(d.at + 0.16).toBeLessThanOrEqual(1);
      expect(d.peak).toBeGreaterThan(0);
      // A quiet texture (owner, 2026-11-14): no dot gets brighter than 40%.
      expect(d.peak).toBeLessThanOrEqual(0.4);
    }
  });

  it("run as a wave: top-left dots light before bottom-right ones", () => {
    const early = dots.filter((d) => d.x < 100 && d.y < 200);
    const late = dots.filter((d) => d.x > 312 && d.y > 715);
    const mean = (xs: typeof dots) => xs.reduce((n, d) => n + d.at, 0) / xs.length;
    expect(mean(early)).toBeLessThan(mean(late) - 0.4);
  });

  it("are the same on every visit", () => {
    expect(fieldDots(412, 915)).toEqual(dots);
  });
});

describe("DotBackground", () => {
  it("animates the LED field when motion is allowed", async () => {
    const { root } = await render(false);
    const field = root.findAll((n) => n.props.testID === "led-field" && typeof n.type !== "string");
    expect(field).toHaveLength(1);
    expect(Animated.loop).toHaveBeenCalled();
  });

  it("is a still grid with Android's Remove animations on", async () => {
    const { root } = await render(true);
    expect(root.findAll((n) => n.props.testID === "led-field")).toHaveLength(0);
    expect(Animated.loop).not.toHaveBeenCalled();
  });

  it("tints the grid's dots with the theme's dot colour", async () => {
    for (const theme of ["gate", "led", "dusk"] as const) {
      await act(async () => setPrefs({ theme }));
      const { root } = await render(true);
      const [grid] = root.findAllByType(Image);
      expect(StyleSheet.flatten(grid!.props.style as ImageStyle).tintColor).toBe(
        palettes[`${theme}/light`].dot,
      );
      act(() => tree?.unmount());
    }
    await act(async () => setPrefs({ theme: "gate" }));
  });
});

describe("the scan band over status screens", () => {
  const bands = (root: ReactTestInstance): ReactTestInstance[] =>
    root.findAll((n) => n.props.testID === "scan-band", { deep: false });

  afterEach(async () => {
    await act(async () => setPrefs({ theme: "gate" }));
  });

  it("is LED night's decoration: Gate glass and Dusk keep a still grid", async () => {
    await act(async () => setPrefs({ theme: "led" }));
    expect(bands((await render(false, true)).root)).toHaveLength(1);
    act(() => tree?.unmount());
    for (const theme of ["gate", "dusk"] as const) {
      await act(async () => setPrefs({ theme }));
      expect(bands((await render(false, true)).root)).toHaveLength(0);
      act(() => tree?.unmount());
    }
  });
});
