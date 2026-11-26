import { Platform } from "react-native";

import { ensureChannels } from "@/notify/channels";

jest.mock("expo-notifications", () => ({
  AndroidImportance: { HIGH: 4, DEFAULT: 3 },
  setNotificationChannelAsync: jest.fn(async () => undefined),
}));

const Notifications = jest.requireMock<{ setNotificationChannelAsync: jest.Mock }>(
  "expo-notifications",
);

beforeEach(() => {
  jest.replaceProperty(Platform, "OS", "android");
  Notifications.setNotificationChannelAsync.mockClear();
});

afterEach(() => jest.restoreAllMocks());

// Runs first: the channels are made once per app run.
it("tries again after a failure, then makes the hostel board's channel last", async () => {
  Notifications.setNotificationChannelAsync.mockRejectedValueOnce(new Error("no"));
  await expect(ensureChannels()).rejects.toThrow("no");
  await ensureChannels();
  const ids = Notifications.setNotificationChannelAsync.mock.calls.map((call) => call[0]);
  // Last, so a phone that says board=true has every channel the server's pushes name.
  expect(ids.at(-1)).toBe("hostel-board");
  // Default importance (sound, no pop-up): Android fixes it when the channel is created.
  expect(Notifications.setNotificationChannelAsync).toHaveBeenCalledWith("hostel-board", {
    name: "Hostel board",
    description: "New posts from your hostel office: timings, mess, laundry.",
    importance: 3,
  });
});

it("makes them once", async () => {
  await ensureChannels();
  expect(Notifications.setNotificationChannelAsync).not.toHaveBeenCalled();
});
