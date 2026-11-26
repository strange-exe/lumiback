import {
  BOARD_CATEGORIES,
  BOARD_HINT,
  boardRowDetail,
  cardOnScreen,
  checkPost,
  defaultExpiry,
  draftFill,
  EXPIRY_DAYS,
  expiryLabel,
  GONE_FROM_BOARD,
  goneFromBoard,
  holidayCompose,
  OUT_NOTICE,
  postA11yLabel,
  postBody,
  reachLine,
  boardTagId,
  boardTapParams,
  seenLine,
  staleBoardNotifications,
  STATUS_LABEL,
  targetQuery,
  unseenIds,
  withdrawMissing,
  activeCount,
  authorLine,
  boardError,
  bodyCounter,
  composeParams,
  hostelPicker,
  hostelsLine,
  olderTimings,
  postedLine,
  replaceLabel,
  startTarget,
  toggleHostel,
  untilText,
  withdrawPrompt,
  type BoardForm,
} from "@/lib/board";
import type { BoardPost, StaffBoardPost } from "@/lib/types";

const ZWJ = String.fromCodePoint(0x200d);

const form = (patch: Partial<BoardForm> = {}): BoardForm => ({
  category: "mess",
  title: "Mess timings",
  body: "Breakfast 7:30 to 9:00.",
  hostelIds: ["h1"],
  allHostels: false,
  expiresInDays: 7,
  replaceTimings: false,
  ...patch,
});

describe("categories and how long a post shows", () => {
  it("lists the five categories in sentence case", () => {
    expect(BOARD_CATEGORIES.map((c) => c.label)).toEqual([
      "Timings",
      "Mess",
      "Laundry",
      "Maintenance",
      "General",
    ]);
    expect(BOARD_CATEGORIES.map((c) => c.value)).toEqual([
      "timings",
      "mess",
      "laundry",
      "maintenance",
      "general",
    ]);
  });

  it("defaults to 30 days for timings and 7 for anything else, as the server does", () => {
    expect(defaultExpiry("timings")).toBe(30);
    for (const c of ["mess", "laundry", "maintenance", "general"] as const) {
      expect(defaultExpiry(c)).toBe(7);
    }
    expect(EXPIRY_DAYS).toEqual([1, 3, 7, 30, 60]);
    expect(expiryLabel(1)).toBe("1 day");
    expect(expiryLabel(30)).toBe("30 days");
  });
});

describe("checkPost: mirrors the server's checks (backend schemas BoardTitle and BoardBody)", () => {
  it("accepts line breaks and sends them as LF; CRLF and CR become LF", () => {
    const ok = checkPost(form({ body: "Line one\r\nLine two\rLine three\nLine four" }));
    expect(ok).toEqual({
      ok: true,
      body: expect.objectContaining({ body: "Line one\nLine two\nLine three\nLine four" }),
    });
  });

  it("trims the title and body", () => {
    const ok = checkPost(form({ title: "  Mess  ", body: "\n  Menu  \n" }));
    expect(ok.ok && ok.body.title).toBe("Mess");
    expect(ok.ok && ok.body.body).toBe("Menu");
  });

  it("refuses a tab, a bidi override, a line separator and NUL in the body", () => {
    for (const cp of [0x09, 0x202e, 0x2028, 0x2029, 0x00, 0x200b]) {
      const result = checkPost(form({ body: `a${String.fromCodePoint(cp)}b` }));
      expect(result.ok).toBe(false);
    }
  });

  it("keeps the zero-width joiner (Indic scripts spell words with it)", () => {
    const word = String.fromCodePoint(0x0915, 0x094d) + ZWJ + String.fromCodePoint(0x0937);
    expect(checkPost(form({ body: word, title: word })).ok).toBe(true);
  });

  it("allows one blank line in a row, not two; at most 20 lines", () => {
    expect(checkPost(form({ body: "a\n\nb" })).ok).toBe(true);
    expect(checkPost(form({ body: "a\n\n\nb" }))).toEqual({
      ok: false,
      error: "Leave at most one blank line in a row.",
    });
    expect(checkPost(form({ body: Array(20).fill("x").join("\n") })).ok).toBe(true);
    expect(checkPost(form({ body: Array(21).fill("x").join("\n") }))).toEqual({
      ok: false,
      error: "Keep it to 20 lines.",
    });
  });

  it("counts characters as the server does (an emoji is one)", () => {
    const smile = String.fromCodePoint(0x1f600);
    expect(checkPost(form({ body: smile.repeat(600) })).ok).toBe(true);
    expect(checkPost(form({ body: "x".repeat(601) }))).toEqual({
      ok: false,
      error: "Keep it to 600 characters.",
    });
    expect(checkPost(form({ title: "x".repeat(61) }))).toEqual({
      ok: false,
      error: "Keep the title to 60 characters.",
    });
  });

  it("needs a title with a letter or digit, on one line, and a body", () => {
    expect(checkPost(form({ title: "  " }))).toEqual({ ok: false, error: "Add a title." });
    expect(checkPost(form({ title: "..." }))).toEqual({
      ok: false,
      error: "Give the title a word or number.",
    });
    expect(checkPost(form({ title: "Mess\nmenu" }))).toEqual({
      ok: false,
      error: "Write the title as one line of plain text.",
    });
    expect(checkPost(form({ body: " \n " }))).toEqual({ ok: false, error: "Write the post." });
  });

  it("needs hostels, or all hostels", () => {
    expect(checkPost(form({ hostelIds: [] }))).toEqual({
      ok: false,
      error: "Choose a hostel, or all hostels.",
    });
    const all = checkPost(form({ hostelIds: ["h1"], allHostels: true }));
    expect(all.ok && all.body.hostel_ids).toEqual([]);
    expect(all.ok && all.body.all_hostels).toBe(true);
  });

  it("an XSS-looking body is plain text: sent exactly as typed", () => {
    const xss = "<img src=x onerror=alert(1)>";
    const ok = checkPost(form({ body: xss }));
    expect(ok.ok && ok.body.body).toBe(xss);
  });
});

describe("postBody", () => {
  it("is what POST /admin/board takes; replace_timings only for a timings post", () => {
    expect(postBody(form({ replaceTimings: true }))).toEqual({
      category: "mess",
      title: "Mess timings",
      body: "Breakfast 7:30 to 9:00.",
      hostel_ids: ["h1"],
      all_hostels: false,
      expires_in_days: 7,
      replace_timings: false,
    });
    expect(postBody(form({ category: "timings", replaceTimings: true })).replace_timings).toBe(
      true,
    );
  });
});

describe("targetQuery", () => {
  it("names each hostel, or all hostels", () => {
    expect(targetQuery({ hostelIds: ["a", "b"], allHostels: false })).toBe(
      "hostel_ids=a&hostel_ids=b",
    );
    expect(targetQuery({ hostelIds: ["a"], allHostels: true })).toBe("all_hostels=true");
    expect(targetQuery({ hostelIds: [], allHostels: false })).toBeNull();
  });
});

describe("the office's words", () => {
  it("says who a post reaches", () => {
    expect(reachLine({ students: 312, devices: 240 })).toBe(
      "For 312 students, 240 phones get a notification",
    );
    expect(reachLine({ students: 1, devices: 1 })).toBe(
      "For 1 student, 1 phone gets a notification",
    );
    expect(reachLine({ students: 0, devices: 0 })).toBe(
      "For 0 students, 0 phones get a notification",
    );
  });

  // The server rounds the count down to a step of 5, or sends null near either edge (owner,
  // 2026-11-26): the line says the step, never a number it doesn't know.
  it("gives two facts, never 'N of M', a step of 5, and nothing near either edge", () => {
    expect(seenLine({ students: 40, seen: 10 })).toBe("Sent to 40 students, seen by 10 to 14");
    expect(seenLine({ students: 10, seen: 5 })).toBe("Sent to 10 students, seen by 5 to 9");
    const hidden = "A seen count shows once at least 5 have opened it and 5 haven't.";
    expect(seenLine({ students: 40, seen: null })).toBe(`Sent to 40 students. ${hidden}`);
    expect(seenLine({ students: 4, seen: null })).toBe(`Sent to 4 students. ${hidden}`);
    expect(seenLine({ students: 1, seen: null })).toBe(`Sent to 1 student. ${hidden}`);
  });

  it("shows status as text", () => {
    expect(STATUS_LABEL).toEqual({ active: "Active", ended: "Ended", withdrawn: "Withdrawn" });
  });

  it("says why Withdraw is missing", () => {
    expect(withdrawMissing({ author: "Head warden", status: "active", can_withdraw: false })).toBe(
      "Posted by the head warden",
    );
    expect(withdrawMissing({ author: "Warden", status: "active", can_withdraw: false })).toBe(
      "Posted by another warden",
    );
    expect(withdrawMissing({ author: "Admin", status: "active", can_withdraw: false })).toBe(
      "Posted by an admin",
    );
    expect(withdrawMissing({ author: "You", status: "active", can_withdraw: true })).toBeNull();
    expect(withdrawMissing({ author: "Admin", status: "ended", can_withdraw: false })).toBeNull();
  });

  it("the OfficeHome row says how many posts are up, when known", () => {
    expect(boardRowDetail(undefined)).toBe(
      "Timings, mess, laundry: every student in your hostels sees it",
    );
    expect(boardRowDetail(0)).toBe("Nothing on the board right now");
    expect(boardRowDetail(1)).toBe("1 active post");
    expect(boardRowDetail(3)).toBe("3 active posts");
  });

  it("names the old notice by its audience, and the hint warns about names", () => {
    expect(OUT_NOTICE.title).toBe("Message students who are out");
    expect(OUT_NOTICE.detail).toBe(
      "Urgent: a notification now (or email). For things every student should see, post to the hostel board.",
    );
    expect(OUT_NOTICE.placeholder).toBe("Heavy rain near Clock Tower. Take a cab back.");
    expect(BOARD_HINT).toBe("Board posts go to every student in the hostel: don't name students.");
  });
});

describe("draftFill: 'Use the outing rules' fills only empty fields", () => {
  const draft = { title: "Outing timings", body: "Outing timings from Tue 24 Nov:\nWeekdays: x" };

  it("fills empty fields without asking", () => {
    expect(draftFill({ title: "", body: "" }, draft)).toEqual({ asks: false, ...draft });
    expect(draftFill({ title: "Mine", body: "" }, draft)).toEqual({
      asks: false,
      title: "Mine",
      body: draft.body,
    });
  });

  it("asks before replacing what was written", () => {
    expect(draftFill({ title: "", body: "My words" }, draft)).toEqual({ asks: true, ...draft });
    expect(draftFill({ title: "  ", body: "  " }, draft)).toEqual({ asks: false, ...draft });
  });
});

describe("holidayCompose: 'Tell students' after adding a holiday", () => {
  it("drafts the holiday for every hostel, for those who may post", () => {
    expect(holidayCompose("2026-12-25", "head_warden")).toEqual({
      holiday: "2026-12-25",
      all: "1",
    });
    expect(holidayCompose("2026-12-25", "admin")).toEqual({ holiday: "2026-12-25", all: "1" });
  });

  it("never for a developer, a warden (holidays are every hostel's) or a student", () => {
    for (const role of ["developer", "warden", "student", undefined] as const) {
      expect(holidayCompose("2026-12-25", role)).toBeNull();
    }
  });
});

describe("student view", () => {
  const post = (patch: Partial<BoardPost> = {}): BoardPost => ({
    id: 1,
    category: "laundry",
    title: "Laundry closed",
    body: "Closed on Sunday.",
    from_label: "Hostel office, Ganga",
    created_at: "2026-11-24T09:00:00+05:30",
    expires_at: "2026-12-01T09:00:00+05:30",
    seen: false,
    ...patch,
  });

  it("says New in the accessible label, never colour alone", () => {
    const label = postA11yLabel(post(), true);
    expect(label).toContain("New");
    expect(label).toContain("Laundry closed");
    expect(label).toContain("Laundry");
    expect(label).toContain("Hostel office, Ganga");
    expect(postA11yLabel(post(), false)).not.toContain("New");
  });

  it("counts a card as on screen once enough of it is in view", () => {
    // A card 200 px tall at 900 px down a 800 px screen: not yet.
    expect(cardOnScreen({ top: 900, height: 200, scrollY: 0, viewport: 800 })).toBe(false);
    // Scrolled 200 px: 100 px of it shows.
    expect(cardOnScreen({ top: 900, height: 200, scrollY: 200, viewport: 800 })).toBe(true);
    // Only a sliver.
    expect(cardOnScreen({ top: 900, height: 200, scrollY: 120, viewport: 800 })).toBe(false);
    // Scrolled past it.
    expect(cardOnScreen({ top: 100, height: 200, scrollY: 1000, viewport: 800 })).toBe(false);
    // A short card fully in view.
    expect(cardOnScreen({ top: 10, height: 40, scrollY: 0, viewport: 800 })).toBe(true);
    // Not laid out yet.
    expect(cardOnScreen({ top: 0, height: 0, scrollY: 0, viewport: 800 })).toBe(false);
  });

  // expo-notifications 57.0.25 (ExpoPresentationDelegate.kt getInternalIdentifierKey) names a
  // notification it didn't draw "expo-notifications://foreign_notifications?tag=..&id=..".
  it("reads a board post's id from a notification's tag, in both shapes Android gives", () => {
    expect(boardTagId("board:12")).toBe(12);
    expect(boardTagId("expo-notifications://foreign_notifications?tag=board%3A34&id=0")).toBe(34);
    expect(boardTagId("expo-notifications://foreign_notifications?id=3")).toBeNull();
    expect(boardTagId("expo-notifications://foreign_notifications?tag=board%3A1x&id=0")).toBeNull();
    expect(boardTagId("https://evil.example/?tag=board%3A34")).toBeNull();
    expect(boardTagId("expo-notifications://foreign_notifications?tag=%E0%A4%A&id=0")).toBeNull();
    for (const odd of ["board:", "board:-1", "board:1x", "boards:1", "board:0", "x", ""]) {
      expect(boardTagId(odd)).toBeNull();
    }
    expect(boardTagId(`board:${"9".repeat(25)}`)).toBeNull();
  });

  it("a tapped board push opens the board with its post id, else its title", () => {
    expect(boardTapParams("board:12", "Mess")).toEqual({ post: "12" });
    expect(
      boardTapParams("expo-notifications://foreign_notifications?tag=board%3A34&id=0", null),
    ).toEqual({ post: "34" });
    // Android kept no tag: the title is all there is.
    expect(boardTapParams("0:1700000000%abc", "Laundry closed")).toEqual({
      title: "Laundry closed",
    });
    expect(boardTapParams("0:1700000000%abc", "  ")).toEqual({});
    expect(boardTapParams("0:1700000000%abc", null)).toEqual({});
    // Never longer than a title can be.
    expect(boardTapParams("x", "y".repeat(500))).toEqual({ title: "y".repeat(60) });
  });

  it("marks only the posts not seen yet, at most 30", () => {
    const many = Array.from({ length: 40 }, (_, i) => post({ id: i + 1, seen: i % 2 === 0 }));
    const ids = unseenIds(many);
    expect(ids).toHaveLength(20);
    expect(ids.every((id) => id % 2 === 0)).toBe(true);
    expect(unseenIds([post({ seen: true })])).toEqual([]);
    expect(unseenIds(Array.from({ length: 70 }, (_, i) => post({ id: i + 1 })))).toHaveLength(30);
  });

  it("dismisses board notifications whose post is no longer up, and nothing else", () => {
    const active = [post({ id: 5, title: "Mess" })];
    const shown = [
      { identifier: "board:5", title: "Mess", url: "/today/board" },
      { identifier: "board:4", title: "Old", url: "/today/board" },
      // A tag Android didn't keep: matched by title.
      { identifier: "0:1700000000%abc", title: "Gone post", url: "/today/board" },
      { identifier: "0:1700000001%abc", title: "Mess", url: "/today/board" },
      // Not a board notification.
      { identifier: "return-soon", title: "Old", url: "/today" },
      {
        identifier: "expo-notifications://foreign_notifications?tag=board%3A9&id=0",
        title: null,
        url: null,
      },
    ].map((n) => ({ ...n, date: 1_000 }));
    expect(staleBoardNotifications(shown, active, 2_000)).toEqual([
      "board:4",
      "0:1700000000%abc",
      "expo-notifications://foreign_notifications?tag=board%3A9&id=0",
    ]);
    // An empty board (all ended): every board notification goes.
    expect(staleBoardNotifications(shown, [], 2_000)).toEqual([
      "board:5",
      "board:4",
      "0:1700000000%abc",
      "0:1700000001%abc",
      "expo-notifications://foreign_notifications?tag=board%3A9&id=0",
    ]);
  });

  it("keeps a board notification that arrived after the board was asked for", () => {
    // Post 50 went up, and its push landed, while GET /board (asked at 2000) was on its way:
    // the answer can't say whether it is up, so the next load decides.
    const active = [post({ id: 5, title: "Mess" })];
    const shown = [
      { identifier: "board:50", title: "New", url: "/today/board", date: 2_400 },
      { identifier: "0:1700000002%abc", title: "New too", url: "/today/board", date: 2_000 },
      { identifier: "board:4", title: "Old", url: "/today/board", date: 1_999 },
      { identifier: "0:1700000003%abc", title: "Gone", url: "/today/board", date: 1_500 },
    ];
    expect(staleBoardNotifications(shown, active, 2_000)).toEqual(["board:4", "0:1700000003%abc"]);
  });

  it("says a tapped post is gone only when it is", () => {
    const posts = [post({ id: 5, title: "Mess" })];
    expect(goneFromBoard({ post: "5" }, posts)).toBe(false);
    expect(goneFromBoard({ post: "6" }, posts)).toBe(true);
    expect(goneFromBoard({ title: "Mess" }, posts)).toBe(false);
    expect(goneFromBoard({ title: "Other" }, posts)).toBe(true);
    expect(goneFromBoard({}, posts)).toBe(false);
    expect(goneFromBoard({ post: "abc" }, posts)).toBe(false);
    expect(GONE_FROM_BOARD).toBe(
      "This post is no longer on the board. The hostel office took it down or it ended.",
    );
  });
});

const staffPost = (patch: Partial<StaffBoardPost> = {}): StaffBoardPost => ({
  id: 1,
  category: "timings",
  title: "Outing timings",
  body: "Weekdays: 6:00 AM to 9:00 PM",
  from_label: "Hostel office, A block",
  created_at: "2026-11-20T10:00:00+05:30",
  expires_at: "2026-12-20T10:00:00+05:30",
  status: "active",
  all_hostels: false,
  hostels: [{ id: "a", name: "A block" }],
  author: "You",
  students: 40,
  seen: 10,
  can_withdraw: true,
  ...patch,
});

describe("compose: the office's form", () => {
  it("says when a post stops showing, in campus time, from how many days it shows", () => {
    const now = new Date("2026-11-25T05:00:00Z"); // 10:30 AM in Dehradun
    expect(untilText(7, now)).toBe("Shows until Wed 2 Dec, 10:30 AM");
    expect(untilText(1, new Date("2026-11-25T20:00:00Z"))).toBe("Shows until Fri 27 Nov, 1:30 AM");
  });

  it("counts the body as the server does, and speaks only near the limit", () => {
    expect(bodyCounter("")).toEqual({
      count: 0,
      over: false,
      text: "0 of 600 characters",
      announce: "",
    });
    // CRLF counts as one character, as the server stores LF; the ends are trimmed.
    expect(bodyCounter("  a\r\nb  ").count).toBe(3);
    expect(bodyCounter("x".repeat(539)).announce).toBe("");
    expect(bodyCounter("x".repeat(540)).announce).toBe("60 characters left");
    expect(bodyCounter("x".repeat(599)).announce).toBe("1 character left");
    expect(bodyCounter("x".repeat(600))).toEqual({
      count: 600,
      over: false,
      text: "600 of 600 characters",
      announce: "0 characters left",
    });
    expect(bodyCounter("x".repeat(601))).toEqual({
      count: 601,
      over: true,
      text: "601 of 600 characters: 1 too many",
      announce: "1 character too many",
    });
    // An emoji is one character to the server.
    const smile = String.fromCodePoint(0x1f600);
    expect(bodyCounter(smile.repeat(3)).count).toBe(3);
  });

  it("names how many older timings posts the take-down choice removes", () => {
    expect(replaceLabel(1)).toBe("Take down the older timings post");
    expect(replaceLabel(3)).toBe("Take down the 3 older timings posts");
  });

  it("older timings posts are the active ones the sender may take down that the new post covers", () => {
    const posts = [
      staffPost({ id: 1 }),
      staffPost({
        id: 2,
        hostels: [
          { id: "a", name: "A" },
          { id: "b", name: "B" },
        ],
      }),
      staffPost({ id: 3, can_withdraw: false }),
      staffPost({ id: 4, status: "ended" }),
      staffPost({ id: 5, category: "mess" }),
      staffPost({ id: 6, all_hostels: true, hostels: [] }),
      staffPost({ id: 7, hostels: [] }), // its hostels were removed: covered by anything
      staffPost({ id: 8, hostels: [{ id: "c", name: "C" }] }),
      staffPost({ id: 9, status: "withdrawn" }),
    ];
    const ids = (list: StaffBoardPost[]): number[] => list.map((p) => p.id);
    expect(ids(olderTimings(posts, { hostelIds: ["a"], allHostels: false }))).toEqual([1, 7]);
    expect(ids(olderTimings(posts, { hostelIds: ["a", "b"], allHostels: false }))).toEqual([
      1, 2, 7,
    ]);
    expect(ids(olderTimings(posts, { hostelIds: [], allHostels: true }))).toEqual([1, 2, 6, 7, 8]);
  });

  it("chooses how hostels are picked from the role and the hostels looked after", () => {
    expect(hostelPicker("warden", 0)).toBe("none");
    expect(hostelPicker("warden", 1)).toBe("one");
    expect(hostelPicker("warden", 3)).toBe("several");
    expect(hostelPicker("head_warden", 0)).toBe("every");
    expect(hostelPicker("admin", 5)).toBe("every");
    // Never a way to post for anyone else.
    for (const role of ["developer", "student", undefined] as const) {
      expect(hostelPicker(role, 3)).toBe("none");
    }
  });

  it("starts a warden on their own hostels, and every-hostel staff on all only when asked", () => {
    const hostels = [{ id: "a" }, { id: "b" }];
    expect(startTarget("warden", hostels, false)).toEqual({
      hostelIds: ["a", "b"],
      allHostels: false,
    });
    // A warden can't post to all hostels, even from a link that asks.
    expect(startTarget("warden", hostels, true)).toEqual({
      hostelIds: ["a", "b"],
      allHostels: false,
    });
    expect(startTarget("head_warden", hostels, false)).toEqual({
      hostelIds: [],
      allHostels: false,
    });
    expect(startTarget("admin", hostels, true)).toEqual({ hostelIds: [], allHostels: true });
    expect(startTarget("developer", hostels, true)).toEqual({ hostelIds: [], allHostels: false });
  });

  it("ticks and unticks a hostel, keeping the order", () => {
    expect(toggleHostel(["a"], "b")).toEqual(["a", "b"]);
    expect(toggleHostel(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });

  it("reads the screen's link: a holiday date and all hostels, nothing else", () => {
    expect(composeParams({ holiday: "2026-12-25", all: "1" })).toEqual({
      holiday: "2026-12-25",
      all: true,
    });
    expect(composeParams({})).toEqual({ holiday: null, all: false });
    expect(composeParams({ holiday: "25/12/2026", all: "yes" })).toEqual({
      holiday: null,
      all: false,
    });
    expect(composeParams({ holiday: ["2026-12-25", "x"], all: ["1"] })).toEqual({
      holiday: "2026-12-25",
      all: true,
    });
    expect(composeParams({ holiday: "2026-12-25&x=1" })).toEqual({ holiday: null, all: false });
  });

  it("says what was sent", () => {
    expect(postedLine({ students: 312, devices: 240 })).toBe(
      "Posted. For 312 students, 240 phones get a notification.",
    );
  });

  it("turns refusals into what to do", () => {
    expect(boardError(404, "Not found", "post")).toBe(
      "One of those hostels isn't one you look after any more. Go back and choose again.",
    );
    expect(boardError(404, "Not found", "withdraw")).toBe(
      "That post isn't on your hostels' board any more. Pull down to refresh.",
    );
    expect(boardError(429, "Too many requests", "post")).toBe(
      "The board takes at most 10 posts an hour from each person. Try again later.",
    );
    expect(boardError(403, "Read-only while viewing as another role", "post")).toBe(
      "Read-only while viewing as another role",
    );
    expect(boardError(422, "", "reach")).toBe("Something went wrong. Try again.");
  });
});

describe("the office's list", () => {
  it("counts the posts still up", () => {
    expect(activeCount([])).toBe(0);
    expect(
      activeCount([
        staffPost(),
        staffPost({ id: 2, status: "ended" }),
        staffPost({ id: 3, status: "withdrawn" }),
        staffPost({ id: 4 }),
      ]),
    ).toBe(2);
  });

  it("names the hostels a post was for", () => {
    expect(hostelsLine(staffPost({ all_hostels: true, hostels: [] }))).toBe("All hostels");
    expect(hostelsLine(staffPost({ hostels: [] }))).toBe("Hostels since removed");
    expect(
      hostelsLine(
        staffPost({
          hostels: [
            { id: "a", name: "A block" },
            { id: "b", name: "B block" },
          ],
        }),
      ),
    ).toBe("A block, B block");
  });

  it("says who posted it, never a name", () => {
    expect(authorLine("You")).toBe("Posted by you");
    expect(authorLine("Head warden")).toBe("Posted by the head warden");
    expect(authorLine("Warden")).toBe("Posted by another warden");
    expect(authorLine("Admin")).toBe("Posted by an admin");
  });

  it("asks before taking a post down, by its title", () => {
    expect(withdrawPrompt("Mess closed Sunday")).toEqual({
      title: 'Take down "Mess closed Sunday"?',
      message:
        "Students stop seeing it straight away. It stays in this list as Withdrawn, and it can't be put back.",
    });
  });
});
