import { Platform } from "react-native";

import { syncPush, syncReturnReminders } from "@/notify/notify";
import { APP_UPDATE_ACTIONS, APP_UPDATE_CATEGORY } from "@/notify/plan";

/**
 * Wave 5: the update announcement's Changelog and Update buttons are registered when the app
 * starts (syncPush), in JS only. If that fails, the channels and reminders still work, and the
 * next launch tries again.
 */

// jest.mock factories are hoisted: they may read only `mock`-prefixed variables, when called.
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));
jest.mock("expo-router", () => ({ router: { navigate: jest.fn() } }));
jest.mock("expo-constants", () => ({ expoConfig: { extra: { eas: { projectId: "p" } } } }));
jest.mock("expo-notifications", () => ({
  AndroidImportance: { HIGH: 4, DEFAULT: 3 },
  SchedulableTriggerInputTypes: { DATE: "date" },
  setNotificationHandler: jest.fn(),
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

const Notifications = jest.requireMock<{
  setNotificationCategoryAsync: jest.Mock;
  scheduleNotificationAsync: jest.Mock;
}>("expo-notifications");

beforeEach(() => {
  jest.replaceProperty(Platform, "OS", "android");
});

// One test: the module keeps what it registered for the app's whole run.
it("registers the buttons at start; a failure stops nothing and is tried again", async () => {
  Notifications.setNotificationCategoryAsync.mockRejectedValueOnce(new Error("no"));
  await syncPush();
  expect(Notifications.setNotificationCategoryAsync).toHaveBeenCalledWith(APP_UPDATE_CATEGORY, [
    ...APP_UPDATE_ACTIONS,
  ]);
  // The failure didn't stop the channels or the reminders.
  await syncReturnReminders(new Date(Date.now() + 2 * 3_600_000).toISOString());
  expect(Notifications.scheduleNotificationAsync).toHaveBeenCalled();
  // Tried again at the next start, and kept once it worked.
  await syncPush();
  await syncPush();
  expect(Notifications.setNotificationCategoryAsync).toHaveBeenCalledTimes(2);
});
