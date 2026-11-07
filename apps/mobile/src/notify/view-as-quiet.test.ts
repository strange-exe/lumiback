import { Platform } from "react-native";

import { api } from "@/lib/api";
import { clearViewAs, setViewAs } from "@/lib/view-as";
import { syncReturnReminders } from "@/notify/notify";
import { registerPush } from "@/notify/push";

/**
 * While a developer views the app as another role, this phone registers no push token and
 * schedules no return reminders: a read-only preview has no side effects on the phone.
 */

// jest.mock factories are hoisted: they may read only `mock`-prefixed variables, when called.
const mockStore = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (key: string) => mockStore.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => void mockStore.set(key, value)),
  deleteItemAsync: jest.fn(async (key: string) => void mockStore.delete(key)),
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

const Notifications = jest.requireMock<{ scheduleNotificationAsync: jest.Mock }>(
  "expo-notifications",
);
const apiMock = api as jest.Mock;
const inTwoHours = (): string => new Date(Date.now() + 2 * 3_600_000).toISOString();

beforeEach(async () => {
  // Both run on Android only.
  jest.replaceProperty(Platform, "OS", "android");
  await clearViewAs();
  mockStore.clear();
  apiMock.mockClear();
  Notifications.scheduleNotificationAsync.mockClear();
});

describe("push-token registration", () => {
  it("is skipped while viewing as another role", async () => {
    await setViewAs("student");
    await registerPush();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it("happens as usual in the developer's own view", async () => {
    await registerPush();
    expect(apiMock).toHaveBeenCalledWith(
      "/devices/push-token",
      expect.objectContaining({ method: "POST" }),
    );
  });
});

describe("return reminders", () => {
  it("are never scheduled while viewing as another role", async () => {
    await setViewAs("student");
    await syncReturnReminders(inTwoHours());
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });

  it("are scheduled as usual in the developer's own view", async () => {
    await syncReturnReminders(inTwoHours());
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalled();
  });
});
