import {
  APP_UPDATE_ACTIONS,
  APP_UPDATE_CATEGORY,
  APP_UPDATES_CHANNEL,
  DEFAULT_TAP,
  tapTarget,
  endedMessage,
  followRequestNotice,
  isAppUpdate,
  mutedChannels,
  notificationRoute,
  newRequests,
  RETURN_DUE,
  RETURN_SOON,
  returnReminders,
} from "@/notify/plan";

describe("app update announcements", () => {
  test("a push with kind app-update is an update announcement", () => {
    expect(isAppUpdate({ kind: "app-update" })).toBe(true);
  });

  test("anything else is not, so it opens its screen as before", () => {
    for (const data of [
      null,
      undefined,
      "app-update",
      {},
      { kind: "App-Update" },
      { kind: ["app-update"] },
      { url: "/today" },
      { kind: "app-update-x" },
    ]) {
      expect(isAppUpdate(data)).toBe(false);
    }
  });

  test("the Changelog and Update buttons: the category the server names (wave 5)", () => {
    // backend/app/api/admin.py UPDATE_CATEGORY; Android drops ':' and '-' in category ids.
    expect(APP_UPDATE_CATEGORY).toBe("app_update");
    expect(APP_UPDATE_ACTIONS).toEqual([
      {
        identifier: "changelog",
        buttonTitle: "Changelog",
        options: { opensAppToForeground: true },
      },
      { identifier: "update", buttonTitle: "Update", options: { opensAppToForeground: true } },
    ]);
  });

  test("a tap routes by kind: Changelog opens What's new, Update and a plain tap check", () => {
    const update = { kind: "app-update" };
    expect(tapTarget(update, DEFAULT_TAP)).toEqual({ to: "update" });
    expect(tapTarget(update, "update")).toEqual({ to: "update" });
    expect(tapTarget(update, "changelog")).toEqual({ to: "whats-new" });
    // Any other push opens its own screen, whichever button.
    expect(tapTarget({ url: "/office/escalations" }, DEFAULT_TAP)).toEqual({
      to: "route",
      route: "/office/escalations",
    });
    expect(tapTarget({ url: "/office/requests" }, "changelog")).toEqual({
      to: "route",
      route: "/office/requests",
    });
    expect(tapTarget(null, DEFAULT_TAP)).toEqual({ to: "route", route: "/today" });
  });

  test("its own Android channel, apart from the student's in-app switches", () => {
    expect(APP_UPDATES_CHANNEL).toBe("app-updates");
    // The in-app mute switches stay as they are: app updates are muted in Android's settings.
    expect(
      mutedChannels({ followRequests: false, returnReminders: false, shareStatus: false }),
    ).not.toContain(APP_UPDATES_CHANNEL);
  });
});

test("the follower notices open the Follow view", () => {
  expect(notificationRoute({ url: "/live?view=follow" })).toBe("/live?view=follow");
});

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

describe("notificationRoute", () => {
  it("opens the screen the notification names", () => {
    expect(notificationRoute({ url: "/live" })).toBe("/live");
    expect(notificationRoute({ url: "/today" })).toBe("/today");
    expect(notificationRoute({ url: "/office/requests" })).toBe("/office/requests");
    expect(notificationRoute({ url: "/office/escalations" })).toBe("/office/escalations");
  });

  it("opens the Follow view for an 'approved you' push, not the Share view", () => {
    expect(notificationRoute({ url: "/live?view=follow" })).toBe("/live?view=follow");
    expect(notificationRoute({ url: "/live?view=other" })).toBe("/today");
  });

  it("opens the corrections queue for staff and History for the student", () => {
    expect(notificationRoute({ url: "/office/corrections" })).toBe("/office/corrections");
    expect(notificationRoute({ url: "/history" })).toBe("/history");
  });

  it("opens a student's history for an 'ask the office to call me' alert", () => {
    const id = "5f0c2a1e-0000-4000-8000-000000000001";
    expect(notificationRoute({ url: `/office/student/${id}` })).toBe(`/office/student/${id}`);
    // Lowercased, like the history screen reads it.
    expect(notificationRoute({ url: `/office/student/${id.toUpperCase()}` })).toBe(
      `/office/student/${id}`,
    );
  });

  it("refuses an office/student url that isn't exactly one UUID", () => {
    const id = "5f0c2a1e-0000-4000-8000-000000000001";
    for (const url of [
      "/office/student/",
      "/office/student/abc",
      `/office/student/${id}/`,
      `/office/student/${id}?x=1`,
      `/office/student/${id}#x`,
      `/office/student/${id}/../../admin`,
      `/office/student/../${id}`,
      `/office/student/%2e%2e%2f${id}`,
      `/office/student/${id}0`,
      ` /office/student/${id}`,
      `https://evil.example/office/student/${id}`,
      `/office/students/${id}`,
    ]) {
      expect(notificationRoute({ url })).toBe("/today");
    }
  });

  it("opens Today when the url is missing or unknown", () => {
    for (const data of [undefined, null, {}, { url: null }, { url: "/admin" }, { url: 3 }, "x"]) {
      expect(notificationRoute(data)).toBe("/today");
    }
  });
});

describe("followRequestNotice", () => {
  test("a guest who copies the contact's label is still called a guest", () => {
    // A Cyrillic "e": looks like the label Lumiback gives the real contact.
    const lookAlike = "Sunita (" + String.fromCodePoint(0x0435) + "mergency contact)";
    expect(followRequestNotice({ name: lookAlike, kind: "guest" })).toEqual({
      title: `${lookAlike} (guest) wants to follow you`,
      body: "Joined with a code, no account. Your emergency contact never has to ask.",
    });
  });

  test("a student is named as a student", () => {
    const notice = followRequestNotice({ name: "Arjun", kind: "user" });
    expect(notice).toEqual({
      title: "Arjun wants to follow you",
      body: "A Lumiback student. Open Lumiback to approve or decline.",
    });
  });
});
