import {
  endedMessage,
  mutedChannels,
  newRequests,
  RETURN_DUE,
  RETURN_SOON,
  returnReminders,
} from "@/notify/plan";

const due = "2026-10-07T20:30:00+05:30";
const dueMs = new Date(due).getTime();

describe("returnReminders", () => {
  test("schedules 10 minutes before and at the planned return", () => {
    const plan = returnReminders(due, dueMs - 60 * 60_000);
    expect(plan.map((r) => [r.id, r.at.getTime()])).toEqual([
      [RETURN_SOON, dueMs - 10 * 60_000],
      [RETURN_DUE, dueMs],
    ]);
    expect(plan[0]?.title).toBe("Heading back? You're due at 8:30 PM");
  });

  test("skips reminders whose time has passed", () => {
    expect(returnReminders(due, dueMs - 5 * 60_000).map((r) => r.id)).toEqual([RETURN_DUE]);
    expect(returnReminders(due, dueMs + 60_000)).toEqual([]);
  });

  test("no outing, no reminders", () => {
    expect(returnReminders(null, dueMs)).toEqual([]);
  });
});

describe("newRequests", () => {
  const viewers = [
    { id: "a", status: "pending" },
    { id: "b", status: "granted" },
    { id: "c", status: "pending" },
    { id: "d", status: "revoked" },
  ];

  test("only pending viewers not yet notified", () => {
    expect(newRequests(viewers, ["a"]).map((v) => v.id)).toEqual(["c"]);
    expect(newRequests(viewers, []).map((v) => v.id)).toEqual(["a", "c"]);
    expect(newRequests(viewers, ["a", "c"])).toEqual([]);
  });
});

describe("endedMessage", () => {
  test.each(["expired", "device_quiet", "tab_closed", "stopped_by_sharer"])(
    "has its own wording for the backend reason %s",
    (reason) => {
      expect(endedMessage(reason)).not.toBe("Your live share has ended.");
    },
  );

  test("falls back for unknown or missing reasons", () => {
    expect(endedMessage("something_new")).toBe("Your live share has ended.");
    expect(endedMessage(null)).toBe("Your live share has ended.");
    expect(endedMessage("")).toBe("Your live share has ended.");
  });
});

describe("mutedChannels", () => {
  it("lists exactly the switched-off channels", () => {
    const on = { followRequests: true, returnReminders: true, shareStatus: true };
    expect(mutedChannels(on)).toEqual([]);
    expect(mutedChannels({ ...on, followRequests: false })).toEqual(["follow-requests"]);
    expect(
      mutedChannels({ followRequests: false, returnReminders: false, shareStatus: false }),
    ).toEqual(["follow-requests", "return-reminders", "share-status"]);
  });
});
