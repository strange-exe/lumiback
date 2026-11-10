import { router } from "expo-router";
import { createElement } from "react";
import {
  AccessibilityInfo,
  Dimensions,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from "react-native";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";

import { useAuth } from "@/lib/auth";
import { CENTRE_GAP, Dock, labelBeside, SCAN_SIZE } from "@/ui/dock";
import { sceneTarget } from "@/ui/glass";
import { haptic } from "@/ui/haptics";
import { Press } from "@/ui/kit";
import { dock, dockClearance, useColors } from "@/ui/theme";

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
    const icon = scan.find((n) => n.props.name === "scan");
    const circle = icon.parent!;
    expect(flat(circle)).toMatchObject({ width: dock.scan, height: dock.scan });
  });

  it("opens the scanner with a tap when Scan is pressed", async () => {
    const root = (await render()).root;
    act(() => (one(scans(root)).props.onPress as () => void)());
    expect(router.push).toHaveBeenCalledWith("/scan");
    expect(haptic.tap).toHaveBeenCalledTimes(1);
  });

  it("names only the active tab: beside its icon when it fits, under it when it doesn't", async () => {
    expect(labelBeside(412, 1)).toBe(true);
    expect(labelBeside(360, 1)).toBe(false);
    expect(labelBeside(412, 1.3)).toBe(false);
    for (const [width, direction] of [
      [412, "row"],
      [360, "column"],
      [320, "column"],
    ] as const) {
      const root = (await render({ index: 2, width })).root;
      expect(words(root)).toEqual(["History"]);
      const label = one(root.findAllByType(Text));
      expect(flat(label.parent!).flexDirection).toBe(direction);
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
    expect(root.findAll((n) => n.type === View && flat(n).backgroundColor === c.dock)).toHaveLength(
      1,
    );
    expect(
      root.findAll((n) => n.type === View && flat(n).backgroundColor === c.dockGlass),
    ).toHaveLength(0);
  });

  it("is glass for staff too", async () => {
    const root = (await render({ role: "warden" })).root;
    expect(blurs(root)).toHaveLength(1);
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
