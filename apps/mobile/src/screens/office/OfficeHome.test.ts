import { createElement } from "react";
import { AccessibilityInfo, Text } from "react-native";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";

import type { OfficeOverview } from "@/lib/types";
import { OfficeHome } from "@/screens/office/OfficeHome";

jest.mock("expo-router", () => ({ router: { push: jest.fn() } }));
// The icon font needs native modules jest doesn't have; icons carry no words anyway.
jest.mock("@expo/vector-icons/Ionicons", () => () => null);

beforeEach(() => {
  // The LED board's loops wait for this answer; never giving one keeps them (and their timers)
  // out of these tests, which are about words. src/ui/led.test.ts covers the motion.
  jest
    .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
    .mockReturnValue(new Promise<boolean>(() => undefined));
});

const OVERVIEW: OfficeOverview = {
  out_now: 3,
  overdue: 1,
  open_escalations: 2,
  pending_requests: 4,
  corrections: 5,
};

// What the Today rows say when there's nothing to do: only true when the overview really loaded.
const ZERO_STATE = [
  "Late students who don't answer or aren't back",
  "Today's forms",
  "Students' asks and return times to fix",
];

function render(props: Parameters<typeof OfficeHome>[0]): ReactTestRenderer {
  let tree: ReactTestRenderer | undefined;
  act(() => {
    tree = create(createElement(OfficeHome, props));
  });
  return tree!;
}

function words(tree: ReactTestRenderer): string[] {
  return tree.root.findAllByType(Text).map((node: ReactTestInstance) => {
    const children = node.props.children as unknown;
    return (Array.isArray(children) ? children : [children])
      .filter((c) => typeof c === "string" || typeof c === "number")
      .join("");
  });
}

const base = { role: "warden" as const, refreshing: false, onRetry: () => Promise.resolve() };

describe("OfficeHome", () => {
  it("shows the error and a retry when the overview didn't load, never zero counts", () => {
    const shown = words(
      render({ ...base, overview: undefined, loading: false, error: "You're offline." }),
    );
    expect(shown.join("\n")).toContain("You're offline.");
    expect(shown).toContain("Try again");
    for (const zero of ZERO_STATE) expect(shown).not.toContain(zero);
    expect(shown.some((s) => /^\d+ out/.test(s) || s === "0")).toBe(false);
    // The rest of the office still opens.
    expect(shown).toContain("Students");
  });

  it("shows no counts while the first load is running", () => {
    const shown = words(render({ ...base, overview: undefined, loading: true, error: null }));
    for (const zero of ZERO_STATE) expect(shown).not.toContain(zero);
    expect(shown).not.toContain("Escalations");
    expect(shown).not.toContain("Try again");
  });

  it("puts who's out on the LED board, in words for screen readers, only once loaded", () => {
    const labels = (tree: ReactTestRenderer): unknown[] =>
      tree.root
        .findAll((n) => typeof n.type !== "string" && n.props.accessible === true)
        .map((n) => n.props.accessibilityLabel);
    const loaded = labels(render({ ...base, overview: OVERVIEW, loading: false, error: null }));
    expect(loaded).toContain("4 students out");
    expect(loaded).toContain("1 late");
    const failed = labels(
      render({ ...base, overview: undefined, loading: false, error: "You're offline." }),
    );
    expect(failed.some((l) => typeof l === "string" && / out$| late$/.test(l))).toBe(false);
  });

  it("shows the real counts once the overview loaded", () => {
    const shown = words(render({ ...base, overview: OVERVIEW, loading: false, error: null }));
    expect(shown).toContain("2 late students need follow-up");
    expect(shown).toContain("4 waiting for you");
    expect(shown).toContain("4 out, 1 late");
    expect(shown).toContain("5 to look at");
    expect(shown).not.toContain("Try again");
  });

  it("says what Corrections is for when there's nothing to fix", () => {
    const shown = words(
      render({ ...base, overview: { ...OVERVIEW, corrections: 0 }, loading: false, error: null }),
    );
    expect(shown).toContain("Students' asks and return times to fix");
    expect(shown).not.toContain("0");
  });

  it("keeps the last real counts and says a refresh failed", () => {
    const shown = words(
      render({ ...base, overview: OVERVIEW, loading: false, error: "You're offline." }),
    );
    expect(shown).toContain("2 late students need follow-up");
    expect(shown.join("\n")).toContain("You're offline.");
  });
});
