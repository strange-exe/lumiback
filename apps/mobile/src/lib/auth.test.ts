import { createElement, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { armSafeReturn, clearSafeReturn, safeReturnFor } from "@/gate/intent";
import { AuthProvider, useAuth } from "@/lib/auth";

// Every step of signing out records itself here, so the tests can check the order.
const mockCalls: string[] = [];
const mockStopSending = jest.fn(async () => void mockCalls.push("stopSending"));

// The share this phone is sending (read before the service stops), or null.
const mockSendingShareId = jest.fn(async (): Promise<string | null> => null);
// What GET /sessions/{id} says started the share: "app" (Share screen) or "outing" (safe return).
let mockShareSource = "app";
async function mockRecord(path: string): Promise<unknown> {
  mockCalls.push(`api ${path}`);
  return path === "/sessions/s1" ? { id: "s1", source: mockShareSource } : undefined;
}
const mockApi = jest.fn(mockRecord);

jest.mock("@/location/task", () => ({
  stopSending: () => mockStopSending(),
  sendingShareId: () => mockSendingShareId(),
}));
jest.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {},
  api: (path: string) => mockApi(path),
}));
jest.mock("@/lib/session", () => ({
  clearTokens: jest.fn(async () => void mockCalls.push("clearTokens")),
  onSignedOut: () => () => undefined,
  // Signed out at launch: the provider makes no requests of its own during the test.
  storedRefreshToken: jest.fn(async () => (mockCalls.length > 0 ? "r1" : null)),
  storeTokens: jest.fn(),
}));
jest.mock("@/notify/notify", () => ({
  syncPush: jest.fn(),
  syncReturnReminders: jest.fn(async () => void mockCalls.push("syncReturnReminders")),
}));
jest.mock("@/notify/push", () => ({
  forgetPushToken: jest.fn(async () => void mockCalls.push("forgetPushToken")),
  unregisterPush: jest.fn(async () => void mockCalls.push("unregisterPush")),
  watchPushToken: () => () => undefined,
}));

type Auth = ReturnType<typeof useAuth>;

async function mount(): Promise<{ auth: Auth; tree: ReactTestRenderer }> {
  let auth: Auth | undefined;
  function Probe(): ReactNode {
    auth = useAuth();
    return null;
  }
  let tree: ReactTestRenderer | undefined;
  // Async act: also settles the provider's launch check (no stored token: signed out).
  await act(async () => {
    tree = create(createElement(AuthProvider, null, createElement(Probe)));
  });
  return { auth: auth!, tree: tree! };
}

beforeEach(() => {
  mockCalls.length = 0;
  mockStopSending.mockClear();
  mockStopSending.mockImplementation(async () => void mockCalls.push("stopSending"));
  mockSendingShareId.mockReset();
  mockSendingShareId.mockResolvedValue(null);
  mockApi.mockReset();
  mockApi.mockImplementation(mockRecord);
  mockShareSource = "app";
  clearSafeReturn();
});

describe("signing out ends the share on the server", () => {
  it("stops the share this phone is sending, after the service and before logout", async () => {
    mockSendingShareId.mockResolvedValue("s1");
    const { auth, tree } = await mount();
    await auth.signOut();
    expect(mockCalls).toEqual([
      "stopSending",
      "syncReturnReminders",
      "api /sessions/s1",
      "api /sessions/s1/stop",
      "unregisterPush",
      "api /auth/logout",
      "clearTokens",
    ]);
    act(() => tree.unmount());
  });

  it("leaves a safe-return share running, so the contact's overdue email still comes", async () => {
    mockSendingShareId.mockResolvedValue("s1");
    mockShareSource = "outing";
    const { auth, tree } = await mount();
    await auth.signOut();
    expect(mockCalls).toContain("stopSending"); // the phone itself stops sending
    expect(mockCalls.some((c) => c.endsWith("/stop"))).toBe(false);
    expect(mockCalls.at(-1)).toBe("clearTokens");
    act(() => tree.unmount());
  });

  it("leaves the share alone when it can't tell what started it", async () => {
    mockSendingShareId.mockResolvedValue("s1");
    mockApi.mockImplementation(async (path: string) => {
      mockCalls.push(`api ${path}`);
      if (path === "/sessions/s1") throw new Error("offline");
    });
    const { auth, tree } = await mount();
    await expect(auth.signOut()).resolves.toBeUndefined();
    expect(mockCalls.some((c) => c.endsWith("/stop"))).toBe(false);
    expect(mockCalls.at(-1)).toBe("clearTokens");
    act(() => tree.unmount());
  });

  it("makes no stop request when the phone isn't sending", async () => {
    const { auth, tree } = await mount();
    await auth.signOut();
    expect(mockCalls.some((c) => c.includes("/stop"))).toBe(false);
    act(() => tree.unmount());
  });

  it("still signs out when the server stop fails", async () => {
    mockSendingShareId.mockResolvedValue("s1");
    mockApi.mockImplementation(async (path: string) => {
      if (path.endsWith("/stop")) {
        mockCalls.push(`api ${path}`);
        throw new Error("offline");
      }
      return mockRecord(path);
    });
    const { auth, tree } = await mount();
    await expect(auth.signOut()).resolves.toBeUndefined();
    expect(mockCalls).toContain("api /auth/logout");
    expect(mockCalls.at(-1)).toBe("clearTokens");
    act(() => tree.unmount());
  });

  it("still signs out when reading the stored share fails", async () => {
    mockSendingShareId.mockRejectedValue(new Error("keystore locked"));
    const { auth, tree } = await mount();
    await expect(auth.signOut()).resolves.toBeUndefined();
    expect(mockCalls).toContain("stopSending");
    expect(mockCalls.at(-1)).toBe("clearTokens");
    act(() => tree.unmount());
  });
});

describe("signing out forgets an armed safe-return intent", () => {
  it("signOut clears it", async () => {
    const id = armSafeReturn();
    const { auth, tree } = await mount();
    await auth.signOut();
    expect(safeReturnFor({ intent: id })).toBe(false);
    act(() => tree.unmount());
  });

  it("deleteAccount clears it", async () => {
    const id = armSafeReturn();
    const { auth, tree } = await mount();
    await auth.deleteAccount("pw");
    expect(safeReturnFor({ intent: id })).toBe(false);
    act(() => tree.unmount());
  });
});

describe("signing out stops location sharing", () => {
  it("signOut stops the location service and its stored share before clearing the tokens", async () => {
    const { auth, tree } = await mount();
    await auth.signOut();
    expect(mockStopSending).toHaveBeenCalledTimes(1);
    expect(mockCalls.indexOf("stopSending")).toBeLessThan(mockCalls.indexOf("clearTokens"));
    expect(mockCalls).toContain("clearTokens");
    act(() => tree.unmount());
  });

  it("signOut still signs out when stopping the share fails", async () => {
    mockStopSending.mockImplementation(async () => {
      mockCalls.push("stopSending");
      throw new Error("location service gone");
    });
    const { auth, tree } = await mount();
    await expect(auth.signOut()).resolves.toBeUndefined();
    expect(mockCalls).toContain("stopSending");
    expect(mockCalls.at(-1)).toBe("clearTokens");
    act(() => tree.unmount());
  });

  it("deleteAccount stops sharing after the server deletes the account, before clearing tokens", async () => {
    const { auth, tree } = await mount();
    await auth.deleteAccount("pw");
    expect(mockCalls[0]).toBe("api /auth/delete-account");
    expect(mockStopSending).toHaveBeenCalledTimes(1);
    expect(mockCalls.indexOf("stopSending")).toBeLessThan(mockCalls.indexOf("clearTokens"));
    act(() => tree.unmount());
  });

  it("deleteAccount still clears the tokens when stopping the share fails", async () => {
    mockStopSending.mockRejectedValue(new Error("location service gone"));
    const { auth, tree } = await mount();
    await expect(auth.deleteAccount("pw")).resolves.toBeUndefined();
    expect(mockCalls.at(-1)).toBe("clearTokens");
    act(() => tree.unmount());
  });
});
