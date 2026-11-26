import { router } from "expo-router";
import { createElement } from "react";
import {
  AccessibilityInfo,
  Animated,
  Dimensions,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from "react-native";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";

import { useAuth } from "@/lib/auth";
import { setPrefs } from "@/lib/prefs";
import { clearSafeReturn, safeReturnFor, setSafeReturnTicked } from "@/gate/intent";
import { CENTRE_GAP, Dock, SCAN_MOTION, SCAN_SIZE, scanLoop } from "@/ui/dock";
import { sceneTarget } from "@/ui/glass";
import { haptic } from "@/ui/haptics";
import { Press } from "@/ui/kit";
import { dock, dockClearance, palettes, useColors } from "@/ui/theme";

jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
// The icon font needs native modules jest doesn't have; a named stand-in keeps the icon's props.
jest.mock(
  "@expo/vector-icons/Ionicons",
  () =>
    function Icon() {
      return null;
    },
);
jest.mock("@/lib/auth", () => ({ useAuth: jest.fn() }));
jest.mock("@/ui/haptics", () => ({ haptic: { tap: jest.fn() } }));
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
}));
jest.mock("react-native-safe-area-context", () => ({
  ...jest.requireActual("react-native-safe-area-context"),
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 24, left: 0 }),
}));
// The blur is a native view; plain Views keep its props for the assertions.
jest.mock("expo-blur", () => {
  const { createElement: h } = jest.requireActual("react");
  const { View: V } = jest.requireActual("react-native");
  return {
    BlurView: function BlurView(props: object) {
      return h(V, props);
    },
    BlurTargetView: V,
  };
});

const ROUTES = ["today", "live", "history", "profile"].map((name) => ({
  key: `${name}-key`,
  name,
  params: undefined,
}));

let tree: ReactTestRenderer | undefined;
const navigate = jest.fn();

function props(index: number, routes = ROUTES): Parameters<typeof Dock>[0] {
  return {
    state: { index, routes, key: "tabs", routeNames: routes.map((r) => r.name), type: "tab" },
    navigation: { emit: () => ({ defaultPrevented: false }), navigate },
  } as unknown as Parameters<typeof Dock>[0];
}

async function render({
  index = 0,
  role = "student",
  width = 412,
  fontScale = 1,
  reduceTransparency = false,
  routes = ROUTES,
}: {
  index?: number;
  role?: string;
  width?: number;
  fontScale?: number;
  reduceTransparency?: boolean;
  routes?: typeof ROUTES;
} = {}): Promise<ReactTestRenderer> {
  (useAuth as jest.Mock).mockReturnValue({ user: { role } });
  jest
    .spyOn(AccessibilityInfo, "isReduceTransparencyEnabled")
    .mockResolvedValue(reduceTransparency);
  const window = { width, height: 915, scale: 2.625, fontScale };
  Dimensions.set({ window, screen: window });
  await act(async () => {
    tree = create(createElement(Dock, props(index, routes)));
  });
  return tree!;
}

const flat = (node: ReactTestInstance): ViewStyle =>
  (StyleSheet.flatten(node.props.style as ViewStyle) ?? {}) as ViewStyle;

/** The only node in a list (fails the test when there are none or several). */
function one(nodes: ReactTestInstance[]): ReactTestInstance {
  expect(nodes).toHaveLength(1);
  return nodes[0]!;
}

/** The tab controls, outermost only (their props repeat on the views they render). */
const tabNodes = (root: ReactTestInstance): ReactTestInstance[] =>
  root.findAll(
    (n) => n.props.accessibilityRole === "tab" && typeof n.props.onPress === "function",
    { deep: false },
  );

const tabs = (root: ReactTestInstance): string[] =>
  tabNodes(root).map((n) => n.props.accessibilityLabel as string);

const scans = (root: ReactTestInstance): ReactTestInstance[] =>
  root.findAllByType(Press).filter((n) => n.props.accessibilityLabel === "Scan at the gate");

const tablist = (root: ReactTestInstance): ReactTestInstance =>
  root.find((n) => n.type === View && n.props.accessibilityRole === "tablist");

/** The theme's colours as the dock sees them (jest's colour scheme is light). */
function colours(): ReturnType<typeof useColors> {
  let c: ReturnType<typeof useColors> | undefined;
  function Probe(): null {
    c = useColors();
    return null;
  }
  let probe: ReactTestRenderer | undefined;
  act(() => {
    probe = create(createElement(Probe));
  });
  act(() => probe?.unmount());
  return c!;
}

const words = (root: ReactTestInstance): string[] =>
  root.findAllByType(Text).map((n) => String(n.props.children));

beforeEach(() => {
  // Press's spring waits for this answer; never giving one keeps animations out of these tests.
  jest
    .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
    .mockReturnValue(new Promise<boolean>(() => undefined));
});

afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe("Dock (students)", () => {
  it("lists the four tabs, two each side of a gap that Scan fits in", async () => {
    const root = (await render()).root;
    expect(tabs(root)).toEqual(["Today", "Live", "History", "Profile"]);
    const list = tablist(root);
    const halves = list.findAll((n) => n.type === View && flat(n).flex === 1, { deep: false });
    expect(halves.map(tabs)).toEqual([
      ["Today", "Live"],
      ["History", "Profile"],
    ]);
    // Between the halves: an empty gap wider than Scan with its ring.
    const gap = one(list.findAll((n) => n.type === View && flat(n).width === CENTRE_GAP));
    expect(tabNodes(gap)).toHaveLength(0);
    expect(CENTRE_GAP).toBeGreaterThanOrEqual(dock.scan + dock.ring * 2 + 8);
    expect(SCAN_SIZE).toBe(dock.scan + dock.ring * 2);
  });

  it("makes Scan a button outside the tab list, labelled for screen readers", async () => {
    const root = (await render()).root;
    const scan = one(scans(root));
    expect(scan.props.accessibilityRole ?? "button").toBe("button");
    expect(scans(tablist(root))).toHaveLength(0);
  });

  it("raises Scan, centred, its accent circle rising dock.rise above the pill", async () => {
    const root = (await render()).root;
    const scan = one(scans(root));
    // Scan's slot: pinned to the top of the dock's box and centred across it.
    const slot = root.find(
      (n) => n.type === View && n.findAll((m) => m === scan).length > 0 && flat(n).top === 0,
    );
    expect(flat(slot)).toMatchObject({
      position: "absolute",
      left: 0,
      right: 0,
      alignItems: "center",
    });
    // The dock's box is the pill plus the rise: the pill sits at its bottom.
    const box = root.find((n) => n.type === View && n.props.pointerEvents === "box-none");
    expect(flat(box).height).toBe(dock.height + dock.rise + dock.ring);
    const ring = flat(scan);
    expect(ring.width).toBe(SCAN_SIZE);
    expect(ring.borderRadius).toBe(SCAN_SIZE / 2);
    const circle = scan.find((n) => n.type === View && flat(n).backgroundColor === colours().scan);
    expect(flat(circle)).toMatchObject({ width: dock.scan, height: dock.scan });
  });

  it("draws a QR code in the scanner's brackets, its scan line hidden from screen readers", async () => {
    const scan = one(scans((await render()).root));
    expect(scan.findAll((n) => n.props.name === "scan")).toHaveLength(1);
    expect(scan.findAll((n) => n.props.name === "qr-code")).toHaveLength(1);
    // The glyph is the theme's onScan, never a fixed ink.
    for (const name of ["scan", "qr-code"]) {
      expect(scan.find((n) => n.props.name === name).props.color).toBe(colours().onScan);
    }
    // The sweeping line is decoration: Scan is announced once, by its label.
    const line = one(
      scan.findAll(
        (n) =>
          typeof n.type === "string" && n.props.importantForAccessibility === "no-hide-descendants",
      ),
    );
    expect(line.props).toMatchObject({ accessibilityElementsHidden: true, pointerEvents: "none" });
    expect(scan.props.accessibilityLabel).toBe("Scan at the gate");
  });

  it("lifts Scan with the theme's own shadow, never a fixed colour", async () => {
    const scan = one(scans((await render()).root));
    expect(flat(scan).boxShadow).toBe(colours().scanShadow);
    for (const p of Object.values(palettes)) expect(p.scanShadow).toMatch(/^0 \d+px \d+px rgba\(/);
  });

  it("gives the scan line a fading trail above it, hidden from screen readers", async () => {
    const scan = one(scans((await render()).root));
    const beam = one(
      scan.findAll(
        (n) =>
          typeof n.type === "string" && n.props.importantForAccessibility === "no-hide-descendants",
      ),
    );
    // The line, then two bands above it that fade the further they are from it.
    const bands = beam.findAll((n) => n.type === View && typeof flat(n).opacity === "number");
    expect(bands).toHaveLength(2);
    const [near, far] = bands.map(flat).sort((a, b) => Number(b.opacity) - Number(a.opacity));
    expect(Number(near!.bottom)).toBeLessThan(Number(far!.bottom)); // nearer the line
    expect(Number(near!.opacity)).toBeLessThan(1);
    for (const b of bands) expect(flat(b).backgroundColor).toBe(colours().onScan);
  });

  it("gives Scan's glyph at least the 3:1 an icon needs in every theme, light or dark glyph", () => {
    // WCAG relative luminance and contrast ratio, from #rrggbb.
    const lum = (hex: string): number => {
      const [r, g, b] = [1, 3, 5].map((i) => {
        const v = parseInt(hex.slice(i, i + 2), 16) / 255;
        return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    const ratio = (a: string, b: string): number => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi! + 0.05) / (lo! + 0.05);
    };
    expect(Object.keys(palettes)).toHaveLength(6); // three themes, light and dark
    for (const p of Object.values(palettes)) {
      expect(ratio(p.onScan, p.scan)).toBeGreaterThanOrEqual(3);
    }
    // Either way round passes: Dusk's dark Scan is a light orchid with a dark glyph.
    expect(lum(palettes["dusk/dark"].onScan)).toBeLessThan(lum(palettes["dusk/dark"].scan));
  });

  it("fills Scan and draws its glyph in the chosen theme's colours, keeping the rise", async () => {
    await act(async () => setPrefs({ theme: "dusk" }));
    try {
      const root = (await render()).root;
      const scan = one(scans(root));
      const dusk = palettes["dusk/light"];
      expect(colours()).toBe(dusk);
      const circle = scan.find((n) => n.type === View && flat(n).backgroundColor === dusk.scan);
      expect(flat(circle)).toMatchObject({ width: dock.scan, height: dock.scan });
      expect(scan.find((n) => n.props.name === "qr-code").props.color).toBe(dusk.onScan);
      expect(flat(scan).boxShadow).toBe(dusk.scanShadow);
      const box = root.find((n) => n.type === View && n.props.pointerEvents === "box-none");
      expect(flat(box).height).toBe(dock.height + dock.rise + dock.ring);
    } finally {
      await act(async () => setPrefs({ theme: "gate" }));
    }
  });

  it("opens the scanner with a tap when Scan is pressed", async () => {
    const root = (await render()).root;
    act(() => (one(scans(root)).props.onPress as () => void)());
    expect(router.push).toHaveBeenCalledWith("/scan");
    expect(haptic.tap).toHaveBeenCalledTimes(1);
  });

  it("carries Today's ticked safe-return box to the scanner as an armed intent", async () => {
    const root = (await render()).root;
    setSafeReturnTicked(true);
    try {
      act(() => (one(scans(root)).props.onPress as () => void)());
      const [to] = (router.push as jest.Mock).mock.calls[0] as [
        { pathname: string; params: { intent: string } },
      ];
      expect(to.pathname).toBe("/scan");
      // The id the scanner gets is the one armed at the press, so the scan screen honours it.
      expect(safeReturnFor(to.params)).toBe(true);
    } finally {
      clearSafeReturn();
    }
  });

  it("names every tab, under its icon, at every width", async () => {
    for (const width of [412, 360, 320]) {
      const root = (await render({ index: 2, width })).root;
      expect(words(root)).toEqual(["Today", "Live", "History", "Profile"]);
      for (const label of root.findAllByType(Text)) {
        expect(flat(label.parent!).flexDirection).toBe("column");
        expect(label.props.adjustsFontSizeToFit).toBe(true);
      }
      act(() => tree?.unmount());
    }
  });

  it("caps tab names at 1.3x the font size setting, on one line, shrinking before cutting", async () => {
    // A characterisation guard: the cap already exists, so this has no red run of its own.
    for (const role of ["student", "warden"] as const) {
      const root = (await render({ role, fontScale: 2 })).root;
      // Only the tab names: each tab holds exactly one Text, and it reads the tab's name.
      const all = tabNodes(root);
      expect(all).toHaveLength(role === "student" ? 4 : 2);
      const labels = all.map((tab) => {
        const texts = tab.findAllByType(Text);
        expect(texts).toHaveLength(1);
        expect(texts[0]!.props.children).toBe(tab.props.accessibilityLabel);
        return texts[0]!;
      });
      for (const label of labels) {
        const cap = label.props.maxFontSizeMultiplier as number;
        expect(cap).toBeGreaterThanOrEqual(1);
        expect(cap).toBeLessThanOrEqual(1.3);
        expect(label.props.numberOfLines).toBe(1);
        expect(label.props.adjustsFontSizeToFit).toBe(true);
        expect(label.props.minimumFontScale).toBeLessThan(1);
      }
      act(() => tree?.unmount());
    }
  });

  it("keeps every tab at least 44 x 44", async () => {
    const root = (await render({ width: 360 })).root;
    const all = tabNodes(root);
    expect(all).toHaveLength(4);
    for (const tab of all) {
      expect(flat(tab).minWidth).toBeGreaterThanOrEqual(44);
      expect(flat(tab).height).toBeGreaterThanOrEqual(44);
    }
  });

  it("keeps each tab's rounded chip a real view, so switching tabs can't square it", async () => {
    // Android flattens an idle (transparent) chip away; when it lit up on a tab switch, the view
    // rebuilt for it lost its corner radius and drew as a square block (seen on build 4).
    for (const role of ["student", "warden"] as const) {
      const root = (await render({ role })).root;
      for (const tab of tabNodes(root)) {
        const chip = tab.findAll((n) => n.type === View && flat(n).borderRadius !== undefined);
        expect(chip).toHaveLength(1);
        expect(chip[0]!.props.collapsable).toBe(false);
      }
      act(() => tree?.unmount());
    }
  });
});

describe("Dock (staff)", () => {
  it("has their two tabs and no Scan", async () => {
    const root = (await render({ role: "warden" })).root;
    expect(tabs(root)).toEqual(["Today", "Profile"]);
    expect(scans(root)).toHaveLength(0);
    expect(root.findAll((n) => n.props.name === "scan")).toHaveLength(0);
  });
});

describe("Dock glass", () => {
  const blurs = (root: ReactTestInstance): ReactTestInstance[] =>
    root.findAll((n) => typeof n.type === "function" && n.type.name === "BlurView");

  it("blurs the active tab's scene, dark, with Android 12+'s blur", async () => {
    let root = (await render({ index: 0 })).root;
    const blur = one(blurs(root));
    expect(blur.props).toMatchObject({ tint: "dark", blurMethod: "dimezisBlurViewSdk31Plus" });
    expect(blur.props.blurTarget).toBe(sceneTarget("today-key"));
    act(() => tree?.unmount());
    root = (await render({ index: 2 })).root;
    expect(one(blurs(root)).props.blurTarget).toBe(sceneTarget("history-key"));
  });

  it("lays the dock colour over the blur at 80% or more, with a hairline edge", async () => {
    const root = (await render()).root;
    const c = colours();
    expect(c.dockGlass.slice(0, 7)).toBe(c.dock);
    expect(parseInt(c.dockGlass.slice(7, 9), 16) / 255).toBeGreaterThanOrEqual(0.8);
    const fill = root.findAll((n) => n.type === View && flat(n).backgroundColor === c.dockGlass);
    expect(fill).toHaveLength(1);
    const edge = one(root.findAll((n) => n.type === View && flat(n).borderColor === c.glassLine));
    expect(flat(edge).borderWidth).toBe(1);
  });

  it("is opaque, with no blur, when the system asks for less transparency", async () => {
    const root = (await render({ reduceTransparency: true })).root;
    expect(blurs(root)).toHaveLength(0);
    const c = colours();
    // The pill itself, not Scan's line (drawn in the same ink as the dock).
    const inScan = new Set(scans(root).flatMap((s) => s.findAll(() => true)));
    const fills = root.findAll(
      (n) => n.type === View && !inScan.has(n) && flat(n).backgroundColor === c.dock,
    );
    expect(fills).toHaveLength(1);
    expect(
      root.findAll((n) => n.type === View && flat(n).backgroundColor === c.dockGlass),
    ).toHaveLength(0);
  });

  it("is glass for staff too", async () => {
    const root = (await render({ role: "warden" })).root;
    expect(blurs(root)).toHaveLength(1);
  });
});

describe("Scan's motion", () => {
  // Driven on the JS side here (jest has no native driver), sampled every frame.
  function run(): { beam: number; shown: number; pop: number; t: number }[] {
    jest.useFakeTimers();
    const v = {
      beam: new Animated.Value(0),
      shown: new Animated.Value(0),
      pop: new Animated.Value(0),
    };
    const loop = scanLoop(v, false);
    loop.start();
    const frames = [];
    const total = SCAN_MOTION.pass + SCAN_MOTION.fadeOut + SCAN_MOTION.rest + 400;
    for (let t = 0; t <= total * 2; t += 16) {
      jest.advanceTimersByTime(16);
      frames.push({
        t,
        beam: (v.beam as unknown as { __getValue(): number }).__getValue(),
        shown: (v.shown as unknown as { __getValue(): number }).__getValue(),
        pop: (v.pop as unknown as { __getValue(): number }).__getValue(),
      });
    }
    loop.stop();
    jest.useRealTimers();
    return frames;
  }

  it("passes the line down once while it shows, never back up: a scanner reads one way", () => {
    const frames = run();
    for (let i = 1; i < frames.length; i++) {
      if (frames[i]!.shown > 0.01 && frames[i - 1]!.shown > 0.01) {
        expect(frames[i]!.beam).toBeGreaterThanOrEqual(frames[i - 1]!.beam - 1e-6);
      }
    }
    // It does reach the bottom, and it is back at the top for the next pass.
    expect(Math.max(...frames.map((f) => f.beam))).toBeCloseTo(1, 2);
    expect(frames.some((f, i) => i > 0 && f.beam < 0.01 && frames[i - 1]!.beam > 0.99)).toBe(true);
  });

  it("pops the QR code once the line has read it, then rests with nothing moving", () => {
    const frames = run();
    const peak = frames.reduce((a, f) => (f.pop > a.pop ? f : a));
    expect(peak.pop).toBeGreaterThan(0.9);
    // The pop comes after the line reached the bottom.
    const bottom = frames.find((f) => f.beam > 0.99)!;
    expect(peak.t).toBeGreaterThanOrEqual(bottom.t);
    // A rest of at least 2 s where the line is hidden and the code is still.
    let still = 0;
    let longest = 0;
    for (const f of frames) {
      still = f.shown < 0.01 && Math.abs(f.pop) < 0.01 ? still + 16 : 0;
      longest = Math.max(longest, still);
    }
    expect(longest).toBeGreaterThanOrEqual(2000);
  });

  it("eases everything: entrances out, exits in, the pass in-out, nothing linear", () => {
    const { fadeInEasing, passEasing, fadeOutEasing } = SCAN_MOTION;
    expect(fadeInEasing(0.25)).toBeGreaterThan(0.3); // ease-out: quick start
    expect(fadeOutEasing(0.25)).toBeLessThan(0.2); // ease-in: slow start
    expect(passEasing(0.15)).toBeLessThan(0.1); // in-out: slow at both ends
    expect(passEasing(0.85)).toBeGreaterThan(0.9);
    expect(SCAN_MOTION.pass).toBeGreaterThanOrEqual(900);
    expect(SCAN_MOTION.pass).toBeLessThanOrEqual(1300);
  });
});

describe("dockClearance", () => {
  it("lets a page's end scroll clear of Scan where it rises above the dock", () => {
    for (const inset of [0, 24, 48]) {
      const aboveDock = dockClearance(inset) - inset - dock.lift - dock.height;
      expect(aboveDock).toBeGreaterThanOrEqual(dock.rise + dock.ring + 16);
    }
  });
});
