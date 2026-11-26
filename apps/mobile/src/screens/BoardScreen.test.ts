import { createElement, type ReactNode } from "react";
import { AccessibilityInfo, Text, View } from "react-native";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";

import BoardScreen from "@/app/(app)/today/board";
import { GONE_FROM_BOARD } from "@/lib/board";
import { student } from "@/lib/student-api";
import type { BoardList, BoardPost } from "@/lib/types";

jest.mock("@/lib/config", () => ({ API_URL: "https://api.test" }));
// The route's params: a tapped push changes them on the screen that is already open.
let mockParams: { post?: string; title?: string } = {};
jest.mock("expo-router", () => {
  const { useEffect } = jest.requireActual("react");
  return {
    router: { push: jest.fn() },
    useLocalSearchParams: () => mockParams,
    // Focus is not what changes here: the screen is focused once, as when it opened.
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  };
});
jest.mock("@expo/vector-icons/Ionicons", () => () => null);
jest.mock("@/lib/student-api", () => ({
  student: { board: jest.fn(), boardSeen: jest.fn(() => Promise.resolve()) },
}));
jest.mock("@/notify/notify", () => ({
  dismissStaleBoardNotifications: jest.fn(() => Promise.resolve()),
}));
jest.mock("@/lib/view-as", () => ({ useViewAs: () => null }));
// The page shell (safe areas, dot grid) isn't what these tests are about.
jest.mock("@/ui/kit", () => {
  const actual = jest.requireActual("@/ui/kit");
  const { createElement: h } = jest.requireActual("react");
  const { View: V } = jest.requireActual("react-native");
  return {
    ...actual,
    Screen: ({ children }: { children: ReactNode }) => h(V, null, children),
  };
});

const board = student.board as jest.MockedFunction<typeof student.board>;

const post = (id: number, title: string): BoardPost => ({
  id,
  category: "general",
  title,
  body: "Details.",
  from_label: "Hostel office",
  created_at: "2026-11-24T09:00:00+05:30",
  expires_at: "2026-12-01T09:00:00+05:30",
  seen: true,
});

function words(tree: ReactTestRenderer): string {
  return tree.root
    .findAllByType(Text)
    .map((node: ReactTestInstance) => {
      const children = node.props.children as unknown;
      return (Array.isArray(children) ? children : [children])
        .filter((c) => typeof c === "string")
        .join("");
    })
    .join("\n");
}

async function render(): Promise<ReactTestRenderer> {
  let tree: ReactTestRenderer | undefined;
  await act(async () => {
    tree = create(createElement(View, null, createElement(BoardScreen)));
  });
  rendered = tree;
  return tree!;
}

let rendered: ReactTestRenderer | undefined;

beforeEach(() => {
  mockParams = {};
  board.mockReset();
  // Buttons ask this for their motion; never answering keeps the answer out of these tests.
  jest
    .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
    .mockReturnValue(new Promise<boolean>(() => undefined));
});

afterEach(() => {
  if (rendered) act(() => rendered!.unmount());
  rendered = undefined;
});

describe("the board screen", () => {
  it("loads again when a push is tapped while it is open, and never calls the new post gone", async () => {
    board.mockResolvedValueOnce({ posts: [post(1, "Laundry closed")] });
    const tree = await render();
    expect(words(tree)).toContain("Laundry closed");

    // Post 42 went up after that load; its push is tapped and only the params change.
    let answer: (list: BoardList) => void = () => undefined;
    board.mockReturnValueOnce(new Promise<BoardList>((resolve) => (answer = resolve)));
    mockParams = { post: "42" };
    await act(async () => {
      tree.update(createElement(View, null, createElement(BoardScreen)));
    });
    expect(board).toHaveBeenCalledTimes(2);
    // The list on screen was loaded before post 42 existed: it can't say 42 is gone.
    expect(words(tree)).not.toContain(GONE_FROM_BOARD);

    await act(async () => {
      answer({ posts: [post(42, "Mess open late"), post(1, "Laundry closed")] });
    });
    expect(words(tree)).toContain("Mess open late");
    expect(words(tree)).not.toContain(GONE_FROM_BOARD);
  });

  it("says a tapped post is gone once a load made for it doesn't have it", async () => {
    mockParams = { post: "7" };
    board.mockResolvedValue({ posts: [post(1, "Laundry closed")] });
    const tree = await render();
    expect(words(tree)).toContain(GONE_FROM_BOARD);
    expect(board).toHaveBeenCalledTimes(1);
  });
});
