import { Platform } from "react-native";

import { hasPushToken, registerPush } from "@/notify/push";

/**
 * A registration still on its way when the student signs out must not leave the token stored
 * on the phone afterwards: the location task would then skip its local alerts, believing the
 * server still pushes to this phone.
 */

// jest.mock factories are hoisted: they may read only `mock`-prefixed variables, when called.
const mockStore = new Map<string, string>();
let mockGeneration = 1;
let mockSignOutDuringRequest = false;

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (key: string) => mockStore.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => void mockStore.set(key, value)),
  deleteItemAsync: jest.fn(async (key: string) => void mockStore.delete(key)),
}));
jest.mock("expo-constants", () => ({ expoConfig: { extra: { eas: { projectId: "p" } } } }));
jest.mock("expo-notifications", () => ({
  AndroidImportance: { HIGH: 4, DEFAULT: 3 },
  getPermissionsAsync: jest.fn(async () => ({ granted: true })),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: "ExponentPushToken[test]" })),
  setNotificationChannelAsync: jest.fn(async () => undefined),
  addPushTokenListener: jest.fn(),
}));
jest.mock("@/lib/api", () => ({
  api: jest.fn(async () => {
    if (mockSignOutDuringRequest) mockGeneration += 1; // clearTokens() bumps the generation
  }),
}));
jest.mock("@/lib/session", () => ({ sessionGeneration: () => mockGeneration }));
jest.mock("@/lib/view-as", () => ({ loadViewAs: jest.fn(async () => null) }));
jest.mock("@/lib/prefs", () => ({
  loadPrefs: jest.fn(async () => ({
    followRequests: true,
    returnReminders: true,
    shareStatus: true,
    hostelBoard: false,
  })),
}));

// The channels are made once per app run (channels.test.ts covers them): here only whether
// they were made matters.
jest.mock("@/notify/channels", () => ({ ensureChannels: jest.fn(async () => undefined) }));

const { ensureChannels } = jest.requireMock<{ ensureChannels: jest.Mock }>("@/notify/channels");
const { api } = jest.requireMock<{ api: jest.Mock }>("@/lib/api");

function lastBody(): Record<string, unknown> {
  const call = api.mock.calls.at(-1) as [string, { body: Record<string, unknown> }];
  expect(call[0]).toBe("/devices/push-token");
  return call[1].body;
}

beforeEach(() => {
  mockStore.clear();
  mockSignOutDuringRequest = false;
  jest.replaceProperty(Platform, "OS", "android");
});

afterEach(() => jest.restoreAllMocks());

it("stores the token once the server has it", async () => {
  await registerPush();
  expect(await hasPushToken()).toBe(true);
});

/**
 * The hostel board's pushes name the "hostel-board" channel. A phone where that channel
 * couldn't be made would draw them in a fallback channel the student can't mute, so the
 * server pushes board posts only to phones that say `board: true`.
 */
it("tells the server board=false when the channels can't be made, and true once they are", async () => {
  ensureChannels.mockRejectedValueOnce(new Error("no"));
  await registerPush();
  expect(lastBody()).toMatchObject({ board: false, draws_updates: true });
  await registerPush();
  expect(lastBody()).toMatchObject({ board: true });
});

it("sends the hostel board's switch as a muted channel", async () => {
  await registerPush();
  expect(lastBody().muted).toEqual(["hostel-board"]);
});

it("stores nothing when the student signed out while it was registering", async () => {
  mockSignOutDuringRequest = true;
  await registerPush();
  expect(await hasPushToken()).toBe(false);
});
