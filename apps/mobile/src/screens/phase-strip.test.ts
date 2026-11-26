import { createElement } from "react";
import { StyleSheet, Text, View, type TextStyle } from "react-native";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";

import { formatTime } from "@/lib/time";
import type { Outing } from "@/lib/types";
import { useColors, type Colors } from "@/ui/theme";

import { PhaseStrip } from "./phase-strip";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
}));

const outing = {
  id: "o1",
  left_at: "2026-11-25T03:14:00+05:30",
  expected_return_at: "2026-11-25T22:30:00+05:30",
} as Outing;

let tree: ReactTestRenderer | undefined;
/** Told, on each render, the colours the rest of the app sees. */
const report = jest.fn<void, [Colors]>();

function Probe(): null {
  report(useColors());
  return null;
}

async function render(overdue: boolean): Promise<ReactTestInstance> {
  await act(async () => {
    tree = create(
      createElement(
        View,
        null,
        createElement(PhaseStrip, { outing, overdue }),
        createElement(Probe),
      ),
    );
  });
  return tree!.root;
}

afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
});

/** What a step shows, whether its children are one string or several. */
const shown = (n: ReactTestInstance): string =>
  [n.props.children]
    .flat(Infinity)
    .filter((x) => x !== null && x !== false)
    .join("");

const steps = (root: ReactTestInstance): ReactTestInstance[] => root.findAllByType(Text);

describe("PhaseStrip", () => {
  it("puts each step's word and its time on two lines, in order", async () => {
    const root = await render(false);
    expect(steps(root).map(shown)).toEqual([
      `Left\n${formatTime(outing.left_at)}`,
      "Out now",
      `Due\n${formatTime(outing.expected_return_at)}`,
      "In",
    ]);
  });

  it("says Late in the danger colour when overdue, and the first step keeps its full time", async () => {
    const root = await render(true);
    const all = steps(root);
    expect(all.map(shown)).toEqual([
      `Left\n${formatTime(outing.left_at)}`,
      "Out now",
      "Late",
      "In",
    ]);
    const style = StyleSheet.flatten(all[2]!.props.style as TextStyle);
    expect(style.color).toBe(report.mock.calls.at(-1)![0].danger);
  });

  it("never caps a step to one line", async () => {
    for (const overdue of [false, true]) {
      const root = await render(overdue);
      for (const n of steps(root)) expect(n.props.numberOfLines).toBeUndefined();
      act(() => tree?.unmount());
    }
  });

  it("reads one sentence to a screen reader", async () => {
    const left = formatTime(outing.left_at);
    const due = formatTime(outing.expected_return_at);
    const label = (n: ReactTestInstance): unknown => n.props.accessibilityLabel;
    const onTime = await render(false);
    expect(onTime.findAll((n) => label(n) !== undefined, { deep: false }).map(label)).toEqual([
      `Left ${left}, out now, due ${due}, not back in yet`,
    ]);
    act(() => tree?.unmount());
    const late = await render(true);
    expect(late.findAll((n) => label(n) !== undefined, { deep: false }).map(label)).toEqual([
      `Left ${left}, late, was due ${due}, not back in yet`,
    ]);
  });
});
