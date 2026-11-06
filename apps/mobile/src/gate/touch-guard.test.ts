import type { ComponentType } from "react";
import { View } from "react-native";

import {
  PlainTouchGuard,
  TouchGuard,
  pickTouchGuard,
  touchGuardActive,
  type TouchGuardProps,
} from "../../modules/touch-guard";

// As in a binary without the module: no native module, and no view manager to load.
// (jest.mock is hoisted above the imports.)
jest.mock("expo", () => ({
  requireOptionalNativeModule: () => null,
  requireNativeView: () => {
    throw new Error("no native view in jest");
  },
}));

const Native: ComponentType<TouchGuardProps> = () => null;

describe("pickTouchGuard", () => {
  it("uses the native guard on Android when the binary has the module", () => {
    expect(pickTouchGuard("android", true, () => Native)).toBe(Native);
  });

  it("falls back to a plain View on an old Android binary without the module (OTA update)", () => {
    const load = jest.fn(() => Native);
    expect(pickTouchGuard("android", false, load)).toBe(PlainTouchGuard);
    expect(load).not.toHaveBeenCalled();
  });

  it("falls back on web and iOS, where there is no native guard", () => {
    expect(pickTouchGuard("web", true, () => Native)).toBe(PlainTouchGuard);
    expect(pickTouchGuard("ios", true, () => Native)).toBe(PlainTouchGuard);
  });

  it("falls back rather than crashing the screen when the native view can't load", () => {
    const broken = (): ComponentType<TouchGuardProps> => {
      throw new Error("view manager missing");
    };
    expect(pickTouchGuard("android", true, broken)).toBe(PlainTouchGuard);
  });
});

describe("TouchGuard in jest", () => {
  it("is the plain stand-in, so screens still render", () => {
    expect(TouchGuard).toBe(PlainTouchGuard);
    expect(touchGuardActive).toBe(false);
  });
});

describe("PlainTouchGuard", () => {
  it("renders a View with the same props, minus the native-only event", () => {
    const onBlockedTouch = jest.fn();
    const element = PlainTouchGuard({ testID: "guard", onBlockedTouch, children: "x" });
    expect(element.type).toBe(View);
    expect(element.props).toEqual({ testID: "guard", children: "x" });
    expect(element.props).not.toHaveProperty("onBlockedTouch");
    expect(onBlockedTouch).not.toHaveBeenCalled();
  });
});
