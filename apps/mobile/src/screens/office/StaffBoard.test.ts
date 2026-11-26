import { createElement } from "react";
import { AccessibilityInfo } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { TickRow } from "@/screens/office/StaffBoard";
import { Press } from "@/ui/kit";

// The icon font needs native modules jest doesn't have; icons carry no words anyway.
jest.mock("@expo/vector-icons/Ionicons", () => () => null);

beforeEach(() => {
  // Press asks this for its motion; never answering keeps the answer out of these word tests.
  jest
    .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
    .mockReturnValue(new Promise<boolean>(() => undefined));
});

function label(props: Parameters<typeof TickRow>[0]): unknown {
  let tree: ReactTestRenderer | undefined;
  act(() => {
    tree = create(createElement(TickRow, props));
  });
  const value = tree!.root.findAllByType(Press)[0]!.props.accessibilityLabel;
  act(() => tree!.unmount());
  return value;
}

describe("TickRow", () => {
  it("reads its detail out with the label: a screen reader hears which posts go", () => {
    expect(
      label({
        label: "Take down the older timings post",
        detail: "Hostel A timings",
        checked: true,
        onPress: () => undefined,
      }),
    ).toBe("Take down the older timings post. Hostel A timings");
    expect(label({ label: "Hostel A", checked: false, onPress: () => undefined })).toBe("Hostel A");
  });
});
