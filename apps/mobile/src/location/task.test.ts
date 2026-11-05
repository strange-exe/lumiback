import { sendingShareId, stopSending } from "@/location/task";

// jest.mock calls are hoisted above the import; the factories read these only when called.
const mockHasStarted = jest.fn();
const mockStop = jest.fn(async () => undefined);
const mockStore = new Map<string, string>();

jest.mock("expo-location", () => ({
  Accuracy: { High: 4 },
  hasStartedLocationUpdatesAsync: () => mockHasStarted(),
  stopLocationUpdatesAsync: () => mockStop(),
}));
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (key: string) => mockStore.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => void mockStore.set(key, value)),
  deleteItemAsync: jest.fn(async (key: string) => void mockStore.delete(key)),
}));
jest.mock("expo-task-manager", () => ({ defineTask: jest.fn() }));
jest.mock("@/lib/api", () => ({ ApiError: class ApiError extends Error {}, api: jest.fn() }));
jest.mock("@/notify/notify", () => ({
  notifyFollowRequest: jest.fn(),
  notifyShareEnded: jest.fn(),
}));
jest.mock("@/notify/push", () => ({ hasPushToken: jest.fn() }));

beforeEach(() => {
  mockStore.clear();
  mockHasStarted.mockReset();
  mockStop.mockClear();
});

describe("stopSending is fail-safe", () => {
  it("stops the location service when it is running", async () => {
    mockHasStarted.mockResolvedValue(true);
    await stopSending();
    expect(mockStop).toHaveBeenCalledTimes(1);
  });

  it("still asks the service to stop when checking whether it runs fails", async () => {
    mockHasStarted.mockRejectedValue(new Error("task manager unavailable"));
    await expect(stopSending()).resolves.toBeUndefined();
    expect(mockStop).toHaveBeenCalledTimes(1);
  });

  it("leaves a stopped service alone", async () => {
    mockHasStarted.mockResolvedValue(false);
    await stopSending();
    expect(mockStop).not.toHaveBeenCalled();
  });

  it("never throws when the stop itself fails", async () => {
    mockHasStarted.mockRejectedValue(new Error("gone"));
    mockStop.mockRejectedValueOnce(new Error("not registered"));
    await expect(stopSending()).resolves.toBeUndefined();
  });
});

describe("sendingShareId", () => {
  it("names the share this phone is sending, and nothing once stopped", async () => {
    mockStore.set("lumiback.share", JSON.stringify({ sessionId: "s1", endsAt: "2026-11-05" }));
    expect(await sendingShareId()).toBe("s1");
    mockHasStarted.mockResolvedValue(false);
    await stopSending();
    expect(await sendingShareId()).toBeNull();
  });

  it("is null with no stored share", async () => {
    expect(await sendingShareId()).toBeNull();
  });
});
