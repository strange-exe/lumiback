import {
  isSendingFor,
  sendingShareIds,
  sendProblem,
  startSending,
  stopSending,
} from "@/location/task";
import { ApiError } from "@/lib/api";
import { clearViewAs, setViewAs } from "@/lib/view-as";

// jest.mock calls are hoisted above the import; the factories read these only when called.
const mockHasStarted = jest.fn();
const mockStop = jest.fn(async () => undefined);
const mockStore = new Map<string, string>();
const mockServicesOn = jest.fn();
const mockEnable = jest.fn();
const mockAsk = jest.fn();
const mockStart = jest.fn(async () => undefined);

jest.mock("expo-location", () => ({
  Accuracy: { High: 4 },
  hasStartedLocationUpdatesAsync: () => mockHasStarted(),
  stopLocationUpdatesAsync: () => mockStop(),
  hasServicesEnabledAsync: () => mockServicesOn(),
  enableNetworkProviderAsync: () => mockEnable(),
  requestForegroundPermissionsAsync: () => mockAsk(),
  startLocationUpdatesAsync: () => mockStart(),
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
  notifySendProblem: jest.fn(),
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

describe("starting to send with the phone's location switched off", () => {
  const later = () => new Date(Date.now() + 3_600_000).toISOString();
  beforeEach(() => {
    mockServicesOn.mockReset();
    mockEnable.mockReset();
    mockAsk.mockReset().mockResolvedValue({ granted: true, canAskAgain: true });
    mockStart.mockClear();
  });

  it("asks Android to turn location on, and starts once the student accepts", async () => {
    mockServicesOn.mockResolvedValue(false);
    mockEnable.mockResolvedValue(undefined);
    expect(await startSending("s1", later())).toBe("started");
    expect(mockEnable).toHaveBeenCalledTimes(1);
    expect(mockStart).toHaveBeenCalledTimes(1);
  });

  it("reports location off, and starts nothing, when the student declines the prompt", async () => {
    mockServicesOn.mockResolvedValue(false);
    mockEnable.mockRejectedValue(new Error("denied"));
    expect(await startSending("s1", later())).toBe("servicesOff");
    expect(mockAsk).not.toHaveBeenCalled();
    expect(mockStart).not.toHaveBeenCalled();
  });

  it("asks again on every tap, so a second tap is never a silent repeat", async () => {
    mockServicesOn.mockResolvedValue(false);
    mockEnable.mockRejectedValue(new Error("denied"));
    await startSending("s1", later());
    await startSending("s1", later());
    expect(mockEnable).toHaveBeenCalledTimes(2);
  });

  it("shows no prompt when location is already on", async () => {
    mockServicesOn.mockResolvedValue(true);
    expect(await startSending("s1", later())).toBe("started");
    expect(mockEnable).not.toHaveBeenCalled();
  });

  it("still reports a refused permission after location is turned on", async () => {
    mockServicesOn.mockResolvedValue(true);
    mockAsk.mockResolvedValue({ granted: false, canAskAgain: false });
    expect(await startSending("s1", later())).toBe("denied");
    expect(mockStart).not.toHaveBeenCalled();
  });

  it("never starts while a developer views the app as another role", async () => {
    mockServicesOn.mockResolvedValue(true);
    await setViewAs("student");
    try {
      await expect(startSending("s1", later())).rejects.toBeInstanceOf(ApiError);
      expect(mockAsk).not.toHaveBeenCalled();
      expect(mockStart).not.toHaveBeenCalled();
    } finally {
      await clearViewAs();
    }
    // Back in their own view, it starts as usual.
    expect(await startSending("s1", later())).toBe("started");
  });
});

describe("sendingShareIds", () => {
  it("names the share this phone is sending, and nothing once stopped", async () => {
    // Stored by the app before two shares: one share object, read as a list of one.
    mockStore.set("lumiback.share", JSON.stringify({ sessionId: "s1", endsAt: "2026-11-05" }));
    expect(await sendingShareIds()).toEqual(["s1"]);
    mockHasStarted.mockResolvedValue(false);
    await stopSending();
    expect(await sendingShareIds()).toEqual([]);
  });

  it("is empty with no stored share", async () => {
    expect(await sendingShareIds()).toEqual([]);
  });
});

describe("an app share and a safe-return share at once", () => {
  const later = () => new Date(Date.now() + 3_600_000).toISOString();
  beforeEach(() => {
    mockServicesOn.mockReset().mockResolvedValue(true);
    mockAsk.mockReset().mockResolvedValue({ granted: true, canAskAgain: true });
    mockStart.mockClear();
  });

  it("checking out while sharing keeps sending for both", async () => {
    await startSending("app1", later());
    await startSending("out1", later());
    expect(await sendingShareIds()).toEqual(["app1", "out1"]);
  });

  it("every fix goes to both shares", async () => {
    const { defineTask } = jest.requireMock("expo-task-manager");
    const tick = defineTask.mock.calls[0][1];
    const { api } = jest.requireMock("@/lib/api");
    api.mockReset().mockResolvedValue(undefined);
    await startSending("app1", later());
    await startSending("out1", later());
    const fix = { coords: { latitude: 30.27, longitude: 77.99, accuracy: 10 }, timestamp: 0 };
    await tick({ data: { locations: [fix] }, error: null });
    const puts = api.mock.calls
      .filter(([, options]: [string, { method?: string }?]) => options?.method === "PUT")
      .map(([path]: [string]) => path);
    expect(puts).toEqual(["/sessions/app1/location", "/sessions/out1/location"]);
  });

  it("stopping the app share leaves the safe-return share sending", async () => {
    mockHasStarted.mockResolvedValue(true);
    await startSending("app1", later());
    await startSending("out1", later());
    await stopSending("app1");
    expect(await sendingShareIds()).toEqual(["out1"]);
    expect(mockStop).not.toHaveBeenCalled();
    expect(await isSendingFor("out1")).toBe(true);
    expect(await isSendingFor("app1")).toBe(false);
  });

  it("stopping the last share stops the location service", async () => {
    mockHasStarted.mockResolvedValue(true);
    await startSending("out1", later());
    await stopSending("out1");
    expect(mockStop).toHaveBeenCalledTimes(1);
  });

  it("isSendingFor is false for a share when the service isn't running", async () => {
    await startSending("out1", later());
    mockHasStarted.mockResolvedValue(false);
    expect(await isSendingFor("out1")).toBe(false);
  });
});

describe("the server refusing a fix (phone clock ahead)", () => {
  it("records the problem, tells the student once, and clears it when a fix goes through", async () => {
    const { defineTask } = jest.requireMock("expo-task-manager");
    const tick = defineTask.mock.calls[0][1];
    const { api, ApiError } = jest.requireMock("@/lib/api");
    const { notifySendProblem } = jest.requireMock("@/notify/notify");
    notifySendProblem.mockClear();
    const later = new Date(Date.now() + 3_600_000).toISOString();
    mockStore.set(
      "lumiback.share",
      JSON.stringify({ shares: [{ sessionId: "s1", endsAt: later }] }),
    );
    const refused = Object.assign(new ApiError(), {
      status: 422,
      detail: "recorded_at is in the future",
    });
    api.mockReset().mockImplementation(async (_path: string, options?: { method?: string }) => {
      if (options?.method === "PUT") throw refused;
      return { status: "active", viewers: [] };
    });
    const fix = { coords: { latitude: 30.27, longitude: 77.99, accuracy: 10 }, timestamp: 0 };
    const nowSpy = jest.spyOn(Date, "now");
    let clock = 1_000_000_000_000;
    nowSpy.mockImplementation(() => clock);
    try {
      await tick({ data: { locations: [fix] }, error: null });
      expect(await sendProblem("s1")).toBe("clock");
      clock += 6_000;
      await tick({ data: { locations: [fix] }, error: null });
      expect(notifySendProblem).toHaveBeenCalledTimes(1);
      expect(notifySendProblem).toHaveBeenCalledWith("clock");
      api.mockImplementation(async () => ({ status: "active", viewers: [] }));
      clock += 6_000;
      await tick({ data: { locations: [fix] }, error: null });
      expect(await sendProblem("s1")).toBeNull();
    } finally {
      nowSpy.mockRestore();
    }
  });
});

describe("a fix already on its way when sharing stops on this phone", () => {
  it("tells nobody the share ended (the next student must not see it)", async () => {
    const { defineTask } = jest.requireMock("expo-task-manager");
    const tick = defineTask.mock.calls[0][1];
    const { api, ApiError } = jest.requireMock("@/lib/api");
    const { notifyShareEnded } = jest.requireMock("@/notify/notify");
    const later = new Date(Date.now() + 3_600_000).toISOString();
    mockStore.set("lumiback.share", JSON.stringify({ sessionId: "s1", endsAt: later }));
    api.mockImplementation(async () => {
      // Another student signs in while this fix is sent: the share is stopped here, and the
      // server answers the old share with 404 under the new student's token.
      mockStore.delete("lumiback.share");
      throw Object.assign(new ApiError(), { status: 404 });
    });
    const fix = { coords: { latitude: 30.27, longitude: 77.99, accuracy: 10 }, timestamp: 0 };
    await tick({ data: { locations: [fix] }, error: null });
    expect(notifyShareEnded).not.toHaveBeenCalled();
  });
});
