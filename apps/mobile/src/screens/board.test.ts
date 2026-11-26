import { createElement, type ReactNode } from "react";
import type { LayoutChangeEvent } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { useOnScreen } from "@/screens/board";
import type { Viewport } from "@/ui/kit";

jest.mock("@/lib/config", () => ({ API_URL: "https://api.test" }));
jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
// The icon font needs native modules jest doesn't have; icons carry no words anyway.
jest.mock("@expo/vector-icons/Ionicons", () => () => null);
jest.mock("@/lib/view-as", () => ({ useViewAs: () => null }));

type Handlers = ReturnType<typeof useOnScreen>;

/** Holds the hook's handlers as props, where the test reads them. */
function Sink(_: Handlers): ReactNode {
  return null;
}

function Probe({ onSeen }: { onSeen: () => void }): ReactNode {
  return createElement(Sink, useOnScreen(onSeen));
}

const layout = (y: number, height: number): LayoutChangeEvent =>
  ({ nativeEvent: { layout: { x: 0, y, width: 300, height } } }) as LayoutChangeEvent;

const viewport = (scrollY: number, height: number): Viewport => ({ scrollY, viewport: height });

const handlers = (tree: ReactTestRenderer): Handlers =>
  tree.root.findAllByType(Sink)[0]!.props as unknown as Handlers;

/** Mounts the hook, then puts the card at `top` in an 800-high viewport scrolled to 0. */
function mounted(onSeen: () => void, top: number): ReactTestRenderer {
  let tree: ReactTestRenderer | undefined;
  act(() => {
    tree = create(createElement(Probe, { onSeen }));
  });
  act(() => {
    handlers(tree!).onViewport(viewport(0, 800));
    handlers(tree!).onLayout(layout(top, 200));
  });
  return tree!;
}

describe("useOnScreen", () => {
  it("calls a new onSeen while the card stays in view, with no new layout or scroll", () => {
    // Today's onSeen changes with every load (new posts); the card's frame and the scroll
    // don't, so neither onLayout nor onScroll fires again.
    const first = jest.fn();
    const second = jest.fn();
    const tree = mounted(first, 100);
    expect(first).toHaveBeenCalled();
    act(() => {
      tree.update(createElement(Probe, { onSeen: second }));
    });
    expect(second).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  it("doesn't call it while the card is out of view", () => {
    const first = jest.fn();
    const second = jest.fn();
    const tree = mounted(first, 2_000);
    act(() => {
      tree.update(createElement(Probe, { onSeen: second }));
    });
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });
});
