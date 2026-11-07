import { createElement } from "react";
import { AccessibilityInfo, Animated, StyleSheet, Text, type ViewStyle } from "react-native";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";

import { layout, ROWS } from "@/lib/glyphs";
import { IN, spokenMinutes, timeLate, timeLeft, type LedReading } from "@/lib/led";
import { LedFigure } from "@/ui/led";

const LED = "#ff6a2b";
const LED_DANGER = "#ff5a4e";
const LED_GOOD = "#5ed38c";

/** Stands in for a started animation, so the test can see what was asked to run. */
function stub(): Animated.CompositeAnimation {
  return { start: jest.fn(), stop: jest.fn(), reset: jest.fn() } as Animated.CompositeAnimation;
}

let tree: ReactTestRenderer | undefined;

async function render(reading: LedReading, reduced = false): Promise<ReactTestRenderer> {
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(reduced);
  await act(async () => {
    tree = create(createElement(LedFigure, { reading }));
  });
  // Let the setting's promise land, and the effects that wait for it run.
  await act(async () => {
    await Promise.resolve();
  });
  return tree!;
}

function byId(root: ReactTestInstance, id: string): ReactTestInstance {
  const [node] = root.findAll((n) => n.props.testID === id && typeof n.type !== "string");
  if (!node) throw new Error(`no ${id}`);
  return node;
}

/** The round dots under a node: host Views with a borderRadius. */
function dotsIn(node: ReactTestInstance): ViewStyle[] {
  return node
    .findAll((n) => n.type === "View")
    .map((n) => StyleSheet.flatten(n.props.style as ViewStyle))
    .filter((s) => s?.borderRadius !== undefined);
}

/** The lit figure's colour: its first dot inside the lit layer. */
function litColor(root: ReactTestInstance): unknown {
  return dotsIn(byId(root, "led-lit"))[0]!.backgroundColor;
}

beforeEach(() => {
  jest.spyOn(Animated, "loop").mockImplementation(() => stub());
  jest.spyOn(Animated, "timing").mockImplementation(() => stub());
});

afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
  jest.restoreAllMocks();
});

describe("LED readings", () => {
  it("say the time in words", () => {
    expect(spokenMinutes(72)).toBe("1 hour 12 minutes");
    expect(spokenMinutes(45)).toBe("45 minutes");
    expect(spokenMinutes(1)).toBe("1 minute");
    expect(spokenMinutes(120)).toBe("2 hours");
  });

  it("count down, then count how late", () => {
    expect(timeLeft(72)).toEqual({
      text: "1:12",
      state: "out",
      unit: "h left",
      label: "1 hour 12 minutes left",
    });
    // Under an hour: minutes alone, never "0:32".
    expect(timeLeft(32)).toMatchObject({ text: "32", unit: "min left", label: "32 minutes left" });
    expect(timeLeft(60)).toMatchObject({ text: "1:00", unit: "h left" });
    expect(timeLeft(-3)).toMatchObject({ text: "0", unit: "min left" });
    expect(timeLate(18)).toMatchObject({
      text: "+18",
      state: "late",
      unit: "min late",
      label: "18 minutes late",
    });
    expect(timeLate(65)).toMatchObject({
      text: "+1:05",
      unit: "h late",
      label: "1 hour 5 minutes late",
    });
    expect(timeLate(0).text).toBe("+1");
  });

  it("lay out on the same 5x7 dot font as the web", () => {
    // 5-wide digits, a 1-wide colon, one unlit column between characters.
    expect(layout("1:12").columns).toBe(19);
    expect(layout("+1:05").columns).toBe(25);
    expect(layout("1:12").chars[1]!.dots).toEqual([
      [6, 2],
      [6, 4],
    ]);
    expect(layout("?").chars[0]!.dots).toEqual([]); // unknown: blank, never a crash
  });
});

describe("LedFigure", () => {
  it("is one element for screen readers, named in words", async () => {
    const { root } = await render(timeLeft(72));
    const named = root.findAll(
      (n) => typeof n.type !== "string" && n.props.accessibilityLabel === "1 hour 12 minutes left",
    );
    expect(named.length).toBeGreaterThan(0);
    expect(named[0]!.props.accessible).toBe(true);
  });

  it("colours the figure by state: out, late, in", async () => {
    expect(litColor((await render(timeLeft(30))).root)).toBe(LED);
    act(() => tree?.unmount());
    expect(litColor((await render(timeLate(18))).root)).toBe(LED_DANGER);
    act(() => tree?.unmount());
    expect(litColor((await render(IN)).root)).toBe(LED_GOOD);
  });

  it("draws every dot of the panel, dim, with the figure's dots lit over it", async () => {
    const { root } = await render(timeLeft(72));
    const panel = byId(root, "led-panel");
    expect(panel.props.importantForAccessibility).toBe("no-hide-descendants");
    expect(panel.props.accessibilityElementsHidden).toBe(true);
    const unlit = dotsIn(byId(root, "led-unlit"));
    expect(unlit).toHaveLength(19 * ROWS);
    // Unlit: the led colour at 13% alpha, never a readable colour.
    expect(new Set(unlit.map((s) => s.backgroundColor))).toEqual(new Set(["#ff6a2b21"]));
    const lit = dotsIn(byId(root, "led-lit"));
    const expected = layout("1:12").chars.reduce((n, ch) => n + ch.dots.length, 0);
    expect(lit).toHaveLength(expected);
    expect(lit.every((s) => typeof s.boxShadow === "string")).toBe(true); // the glow
    // The colon's own group (the one that blinks) holds just its two dots.
    expect(dotsIn(byId(root, "led-colon"))).toHaveLength(2);
    // No text inside the panel: the figure is dots, and its words are the label.
    expect(panel.findAllByType(Text)).toHaveLength(0);
  });

  it("blinks the colon and lights up in steps when motion is allowed", async () => {
    await render(timeLeft(72), false);
    expect(Animated.loop).toHaveBeenCalled(); // the colon blink
    expect(Animated.timing).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ duration: 600, useNativeDriver: true }),
    );
  });

  it("starts no animation with Android's Remove animations on", async () => {
    const { root } = await render(timeLeft(72), true);
    expect(Animated.loop).not.toHaveBeenCalled();
    expect(Animated.timing).not.toHaveBeenCalled();
    // Fully lit and steady.
    const lit = byId(root, "led-lit");
    const { opacity } = StyleSheet.flatten(lit.props.style as object) as {
      opacity: { __getValue(): number };
    };
    expect(opacity.__getValue()).toBe(1);
  });

  it("doesn't blink a figure without a colon", async () => {
    await render(timeLate(18), false);
    expect(Animated.loop).not.toHaveBeenCalled();
  });
});
