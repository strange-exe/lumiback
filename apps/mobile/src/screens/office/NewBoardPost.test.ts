import { createElement, type ReactNode } from "react";
import { AccessibilityInfo, View } from "react-native";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";

import NewBoardPost from "@/app/office/board/new";
import { replaceLabel } from "@/lib/board";
import { office } from "@/lib/office-api";
import type { OfficeHostel, StaffBoardPost } from "@/lib/types";
import { TickRow } from "@/screens/office/StaffBoard";
import { Button, Chips, Field } from "@/ui/kit";

jest.mock("@/lib/config", () => ({ API_URL: "https://api.test" }));
jest.mock("expo-router", () => {
  const { useEffect } = jest.requireActual("react");
  return {
    router: { dismissTo: jest.fn() },
    useLocalSearchParams: () => ({}),
    // The compose screen keeps focus through "Posted" and "Write another".
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  };
});
jest.mock("@expo/vector-icons/Ionicons", () => () => null);
jest.mock("@/lib/auth", () => ({ useAuth: () => ({ user: { role: "warden" } }) }));
jest.mock("@/lib/view-as", () => ({ useViewAs: () => null, READ_ONLY: "Read-only" }));
jest.mock("@/ui/haptics", () => ({ haptic: { success: jest.fn(), warning: jest.fn() } }));
jest.mock("@/lib/office-api", () => ({
  office: {
    hostels: jest.fn(),
    board: jest.fn(),
    // Never answers: who it reaches isn't what this test is about.
    boardReach: jest.fn(() => new Promise(() => undefined)),
    boardDraft: jest.fn(),
    postToBoard: jest.fn(),
  },
}));
// The sheet's motion and the page shell aren't what this test is about: plain Views.
jest.mock("@/ui/sheet", () => {
  const { createElement: h } = jest.requireActual("react");
  const { View: V } = jest.requireActual("react-native");
  return {
    Sheet: ({ open, children }: { open: boolean; children: ReactNode }) =>
      open ? h(V, null, children) : null,
  };
});
jest.mock("@/ui/kit", () => {
  const actual = jest.requireActual("@/ui/kit");
  const { createElement: h } = jest.requireActual("react");
  const { View: V } = jest.requireActual("react-native");
  return {
    ...actual,
    Screen: ({ children }: { children: ReactNode }) => h(V, null, children),
  };
});

const mocked = office as jest.Mocked<typeof office>;

let tree: ReactTestRenderer | undefined;

afterEach(() => {
  if (tree) act(() => tree!.unmount());
  tree = undefined;
});

beforeEach(() => {
  // Press asks this for its motion; never answering keeps the answer out of this test.
  jest
    .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
    .mockReturnValue(new Promise<boolean>(() => undefined));
});

const HOSTEL: OfficeHostel = {
  id: "h1",
  name: "Hostel A",
  rule_set_id: "r1",
  rule_set: "Default",
  warden_name: null,
  warden_phone: null,
  students: 10,
};

const posted: StaffBoardPost = {
  id: 9,
  category: "timings",
  title: "Hostel A timings",
  body: "Gate closes at 9:30 PM.",
  from_label: "Hostel office, Hostel A",
  created_at: "2026-11-25T09:00:00+05:30",
  expires_at: "2026-12-25T09:00:00+05:30",
  status: "active",
  all_hostels: false,
  hostels: [{ id: "h1", name: "Hostel A" }],
  author: "You",
  students: 10,
  seen: null,
  can_withdraw: true,
};

function byLabel(tree: ReactTestRenderer, type: unknown, label: string): ReactTestInstance {
  return tree.root.find((n) => n.type === type && n.props.label === label);
}

/** Fills a timings post and opens the confirm step. */
function writeTimings(tree: ReactTestRenderer): void {
  act(() => {
    (byLabel(tree, Chips, "Category").props.onChange as (v: string) => void)("timings");
  });
  act(() => {
    (byLabel(tree, Field, "Title").props.onChangeText as (v: string) => void)("Hostel A timings");
    (byLabel(tree, Field, "Post").props.onChangeText as (v: string) => void)(
      "Gate closes at 9:30 PM.",
    );
  });
  act(() => {
    (byLabel(tree, Button, "Review and post").props.onPress as () => void)();
  });
}

const offersTakeDown = (tree: ReactTestRenderer): boolean =>
  tree.root.findAll((n) => n.type === TickRow && n.props.label === replaceLabel(1)).length > 0;

describe("New board post", () => {
  it("offers to take down the timings post it just made when 'Write another' writes one more", async () => {
    mocked.hostels.mockResolvedValue([HOSTEL]);
    // Before the first post the office has no timings post; after it, the one just made.
    mocked.board.mockResolvedValueOnce({ posts: [] }).mockResolvedValue({ posts: [posted] });
    mocked.postToBoard.mockResolvedValue({ id: 9, students: 10, devices: 8 });

    await act(async () => {
      tree = create(createElement(View, null, createElement(NewBoardPost)));
    });
    writeTimings(tree!);
    expect(offersTakeDown(tree!)).toBe(false);
    await act(async () => {
      (byLabel(tree!, Button, "Post to the board").props.onPress as () => void)();
    });
    await act(async () => {
      (byLabel(tree!, Button, "Write another").props.onPress as () => void)();
    });

    writeTimings(tree!);
    expect(offersTakeDown(tree!)).toBe(true);
  });
});
