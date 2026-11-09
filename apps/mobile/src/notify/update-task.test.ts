import { Platform } from "react-native";

import { api } from "@/lib/api";
import { APP_UPDATE_ACTIONS, APP_UPDATE_CATEGORY, APP_UPDATES_CHANNEL } from "@/notify/plan";
import { registerPush } from "@/notify/push";
import { drawUpdate, UPDATE_TASK } from "@/notify/update-task";

/**
 * The update announcement drawn by the app (data-only push, 2026-11-09): the background task
 * draws it with the Changelog and Update buttons, exactly once, and this app tells the server
 * it can (draws_updates), so only such phones get the push data-only.
 */

// jest.mock factories are hoisted: they may read only `mock`-prefixed variables, when called.
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
jest.mock("expo-router", () => ({ router: { navigate: jest.fn() } }));
jest.mock("expo-constants", () => ({ expoConfig: { extra: { eas: { projectId: "p" } } } }));
jest.mock("expo-task-manager", () => ({ defineTask: jest.fn() }));
jest.mock("expo-notifications", () => ({
  AndroidImportance: { HIGH: 4, DEFAULT: 3 },
  SchedulableTriggerInputTypes: { DATE: "date" },
  setNotificationHandler: jest.fn(),
  registerTaskAsync: jest.fn(async () => null),
  getPermissionsAsync: jest.fn(async () => ({ granted: true })),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: "ExponentPushToken[test]" })),
  setNotificationChannelAsync: jest.fn(async () => undefined),
  setNotificationCategoryAsync: jest.fn(async () => ({})),
  cancelScheduledNotificationAsync: jest.fn(async () => undefined),
  scheduleNotificationAsync: jest.fn(async () => "id"),
}));
jest.mock("@/lib/api", () => ({ api: jest.fn(async () => undefined) }));
jest.mock("@/lib/prefs", () => ({
  loadPrefs: jest.fn(async () => ({
    followRequests: true,
    returnReminders: true,
    shareStatus: true,
  })),
}));

type Handler = {
  handleNotification: (n: unknown) => Promise<{ shouldShowBanner: boolean }>;
};
const Notifications = jest.requireMock<{
  setNotificationHandler: jest.Mock;
  registerTaskAsync: jest.Mock;
  setNotificationChannelAsync: jest.Mock;
  setNotificationCategoryAsync: jest.Mock;
  scheduleNotificationAsync: jest.Mock;
}>("expo-notifications");
const TaskManager = jest.requireMock<{ defineTask: jest.Mock }>("expo-task-manager");

const sent = {
  lumiback: "app_update",
  title: "Lumiback 1.21.0",
  body: "Tell the office you're running late.",
  tag: "lumiback-update",
  kind: "app-update",
};
const handed = (data: unknown): unknown => ({
  notification: null,
  data: { dataString: JSON.stringify(data), body: JSON.stringify(data) },
});
const received = (data: unknown): unknown => ({ request: { content: { data } } });

beforeEach(() => {
  jest.replaceProperty(Platform, "OS", "android");
  Notifications.scheduleNotificationAsync.mockClear();
  (api as jest.Mock).mockClear();
});

it("defines and registers the task when the module loads (TaskManager needs module scope)", () => {
  expect(TaskManager.defineTask).toHaveBeenCalledWith(UPDATE_TASK, expect.any(Function));
  expect(Notifications.registerTaskAsync).toHaveBeenCalledWith(UPDATE_TASK);
});

it("draws the notice with the buttons, on the App updates channel, replacing the last one", async () => {
  const task = TaskManager.defineTask.mock.calls[0][1] as (body: { data: unknown }) => unknown;
  await task({ data: handed(sent) });
  // The channel and the buttons exist first: the task may run before the app ever has.
  expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledWith(
    APP_UPDATES_CHANNEL,
    expect.anything(),
  );
  expect(Notifications.setNotificationCategoryAsync).toHaveBeenCalledWith(APP_UPDATE_CATEGORY, [
    ...APP_UPDATE_ACTIONS,
  ]);
  expect(Notifications.scheduleNotificationAsync.mock.calls).toEqual([
    [
      {
        identifier: "lumiback-update",
        content: {
          title: sent.title,
          body: sent.body,
          data: { kind: "app-update" },
          categoryIdentifier: APP_UPDATE_CATEGORY,
        },
        trigger: { channelId: APP_UPDATES_CHANNEL },
      },
    ],
  ]);
});

it("draws nothing for anything else, and never throws", async () => {
  await drawUpdate(handed({ ...sent, lumiback: "other" }));
  await drawUpdate({ actionIdentifier: "update", notification: {} });
  await drawUpdate(undefined);
  expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  Notifications.scheduleNotificationAsync.mockRejectedValueOnce(new Error("no permission"));
  await expect(drawUpdate(handed(sent))).resolves.toBeUndefined();
});

it("hides the data-only push while the app is open: the task draws it then too", async () => {
  const handler = Notifications.setNotificationHandler.mock.calls[0][0] as Handler;
  // The push itself, as the handler sees it (Expo parses dataString into data).
  expect((await handler.handleNotification(received(sent))).shouldShowBanner).toBe(false);
  // The notice the task drew, and every other notification, show as before.
  for (const data of [{ kind: "app-update" }, { url: "/live" }, {}, undefined]) {
    expect((await handler.handleNotification(received(data))).shouldShowBanner).toBe(true);
  }
});

it("tells the server this app draws the update notice itself", async () => {
  await registerPush();
  expect(api).toHaveBeenCalledWith("/devices/push-token", {
    method: "POST",
    body: { token: "ExponentPushToken[test]", platform: "android", muted: [], draws_updates: true },
  });
});
