import { createElement } from "react";
import { AccessibilityInfo, Animated } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { DotBackground, fieldDots, PITCH } from "@/ui/backdrop";

let tree: ReactTestRenderer | undefined;

async function render(reduced: boolean): Promise<ReactTestRenderer> {
  jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockResolvedValue(reduced);
  await act(async () => {
    tree = create(createElement(DotBackground));
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
      expect(d.peak).toBeLessThanOrEqual(0.9);
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
});
