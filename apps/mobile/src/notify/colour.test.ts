import { Platform } from "react-native";

import { notifyShareEnded, syncReturnReminders } from "@/notify/notify";
import { themes } from "@/ui/theme";

/**
 * Android tints a notification's small icon and app name. Local notifications take the chosen
 * theme's Scan colour, the same as the sharing notice (location/task.ts), so notices from this
 * phone never mix an orange one with a teal one. (Server pushes keep app.json's colour until
 * the next native build.)
 */

// jest.mock factories are hoisted: they may read only `mock`-prefixed variables, when called.
const mockStore = new Map<string, string>();
let mockTheme = "dusk";
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
  setNotificationChannelAsync: jest.fn(async () => undefined),
  cancelScheduledNotificationAsync: jest.fn(async () => undefined),
  scheduleNotificationAsync: jest.fn(async () => "id"),
}));
jest.mock("@/lib/api", () => ({ api: jest.fn(async () => undefined) }));
jest.mock("@/lib/session", () => ({ sessionGeneration: () => 0 }));
jest.mock("@/lib/prefs", () => ({
  loadPrefs: jest.fn(async () => ({
    followRequests: true,
    returnReminders: true,
    shareStatus: true,
    theme: mockTheme,
  })),
}));

const Notifications = jest.requireMock<{ scheduleNotificationAsync: jest.Mock }>(
  "expo-notifications",
);
const colours = (): unknown[] =>
  Notifications.scheduleNotificationAsync.mock.calls.map(
    ([request]: [{ content: { color?: string } }]) => request.content.color,
  );

beforeEach(() => {
  jest.replaceProperty(Platform, "OS", "android");
  mockStore.clear();
  Notifications.scheduleNotificationAsync.mockClear();
});

describe("local notifications", () => {
  for (const theme of ["dusk", "gate"] as const) {
    it(`take the ${theme} theme's Scan colour: return reminders`, async () => {
      mockTheme = theme;
      await syncReturnReminders(new Date(Date.now() + 2 * 3_600_000).toISOString());
      expect(colours().length).toBeGreaterThan(0);
      expect(new Set(colours())).toEqual(new Set([themes[theme].light.scan]));
    });

    it(`take the ${theme} theme's Scan colour: sharing notices`, async () => {
      mockTheme = theme;
      await notifyShareEnded(null);
      expect(colours()).toEqual([themes[theme].light.scan]);
    });
  }
});
