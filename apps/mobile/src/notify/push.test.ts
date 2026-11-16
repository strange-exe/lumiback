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
  getPermissionsAsync: jest.fn(async () => ({ granted: true })),
  getExpoPushTokenAsync: jest.fn(async () => ({ data: "ExponentPushToken[test]" })),
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
  })),
}));

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

it("stores nothing when the student signed out while it was registering", async () => {
  mockSignOutDuringRequest = true;
  await registerPush();
  expect(await hasPushToken()).toBe(false);
});
