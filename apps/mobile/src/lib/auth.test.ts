import { createElement, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { armSafeReturn, clearSafeReturn, safeReturnFor } from "@/gate/intent";
import { AuthProvider, useAuth } from "@/lib/auth";

// Every step of signing out records itself here, so the tests can check the order.
const mockCalls: string[] = [];
const mockStopSending = jest.fn(async () => void mockCalls.push("stopSending"));

// The shares this phone is sending (read before the service stops).
const mockSendingShareIds = jest.fn(async (): Promise<string[]> => []);
// What GET /sessions/{id} says started the share: "app" (Share screen) or "outing" (safe return).
let mockShareSource = "app";
async function mockRecord(path: string): Promise<unknown> {
  mockCalls.push(`api ${path}`);
  return path === "/sessions/s1" ? { id: "s1", source: mockShareSource } : undefined;
}
const mockApi = jest.fn(mockRecord);
// The provider's listener for a forced sign-out (the server refused the session).
let mockSignedOutListener: (() => void) | null = null;

jest.mock("@/location/task", () => ({
  stopSending: () => mockStopSending(),
  sendingShareIds: () => mockSendingShareIds(),
}));
jest.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(mockStatus: number) {
      super(`HTTP ${mockStatus}`);
      this.status = mockStatus;
    }
  },
  api: (path: string) => mockApi(path),
}));
// The refresh token the launch check finds: none by default (signed out at launch).
let mockStoredToken: string | null = null;
jest.mock("@/lib/session", () => ({
  clearTokens: jest.fn(async () => void mockCalls.push("clearTokens")),
  onSignedOut: (listener: () => void) => {
    mockSignedOutListener = listener;
    return () => undefined;
  },
  storedRefreshToken: jest.fn(async () => mockStoredToken),
  storeTokens: jest.fn(async () => void mockCalls.push("storeTokens")),
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

// Most tests look only at what happens after launch: signed out on screen, with a stored
// session for signOut to end, and a clean record.
async function mountQuietly(): Promise<{ auth: Auth; tree: ReactTestRenderer }> {
  const mounted = await mount();
  mockStoredToken = "r1";
  mockCalls.length = 0;
  mockStopSending.mockClear();
  return mounted;
}

beforeEach(() => {
  mockCalls.length = 0;
  mockStopSending.mockClear();
  mockStopSending.mockImplementation(async () => void mockCalls.push("stopSending"));
  mockSendingShareIds.mockReset();
  mockSendingShareIds.mockResolvedValue([]);
  mockApi.mockReset();
  mockApi.mockImplementation(mockRecord);
  mockShareSource = "app";
  mockStoredToken = null;
  clearSafeReturn();
});

describe("the launch check", () => {
  it("with no stored session, forgets what a session ended out of sight left behind", async () => {
    const id = armSafeReturn();
    const { tree } = await mount();
    expect(mockCalls).toEqual(expect.arrayContaining(["stopSending", "syncReturnReminders"]));
    expect(safeReturnFor({ intent: id })).toBe(false);
    act(() => tree.unmount());
  });

  it("keeps the session through a server error, as refresh does, and says it couldn't connect", async () => {
    const { ApiError } = jest.requireMock("@/lib/api");
    mockStoredToken = "r1";
    mockApi.mockRejectedValue(new ApiError(503));
    const { auth, tree } = await mount();
    expect(mockCalls).not.toContain("clearTokens");
    expect(mockCalls).not.toContain("stopSending");
    expect(auth.status).toBe("offline");
    act(() => tree.unmount());
  });

  it("offline at launch keeps the student signed in, and a retry once back online opens the app", async () => {
    const { ApiError } = jest.requireMock("@/lib/api");
    mockStoredToken = "r1";
    mockApi.mockRejectedValueOnce(new ApiError(0));
    let auth: Auth | undefined;
    function Probe(): ReactNode {
      auth = useAuth();
      return null;
    }
    let tree: ReactTestRenderer | undefined;
    await act(async () => {
      tree = create(createElement(AuthProvider, null, createElement(Probe)));
    });
    expect(auth!.status).toBe("offline");
    expect(mockCalls).not.toContain("clearTokens");
    expect(mockCalls).not.toContain("stopSending"); // a running safe-return share keeps going
    await act(async () => auth!.retry());
    expect(auth!.status).toBe("signedIn");
    act(() => tree!.unmount());
  });

  it("a retry that is still offline stays on the offline screen", async () => {
    const { ApiError } = jest.requireMock("@/lib/api");
    mockStoredToken = "r1";
    mockApi.mockRejectedValue(new ApiError(0));
    let auth: Auth | undefined;
    function Probe(): ReactNode {
      auth = useAuth();
      return null;
    }
    let tree: ReactTestRenderer | undefined;
    await act(async () => {
      tree = create(createElement(AuthProvider, null, createElement(Probe)));
    });
    await act(async () => auth!.retry());
    expect(auth!.status).toBe("offline");
    act(() => auth!.switchAccount());
    expect(auth!.status).toBe("signedOut");
    expect(mockCalls).not.toContain("clearTokens"); // signIn forgets the kept session itself
    act(() => tree!.unmount());
  });

  it("signing in over a session kept through a server error forgets that student first", async () => {
    const { ApiError } = jest.requireMock("@/lib/api");
    mockStoredToken = "r1";
    mockApi.mockRejectedValueOnce(new ApiError(503)); // the launch check's /auth/me
    const id = armSafeReturn(); // the kept student's, armed before the app was closed
    const { auth, tree } = await mount();
    act(() => auth.switchAccount());
    mockCalls.length = 0;
    await act(async () => auth.signIn("next@geu.ac.in", "pw"));
    expect(safeReturnFor({ intent: id })).toBe(false);
    expect(mockCalls).toEqual(expect.arrayContaining(["stopSending", "syncReturnReminders"]));
    // The kept login is ended on the server before the new one is stored.
    expect(mockCalls.indexOf("api /auth/logout")).toBeGreaterThanOrEqual(0);
    expect(mockCalls.indexOf("api /auth/logout")).toBeLessThan(mockCalls.indexOf("storeTokens"));
    act(() => tree.unmount());
  });

  it("a plain sign-in, with nothing kept, ends no session and stops nothing", async () => {
    const { auth, tree } = await mount();
    mockCalls.length = 0;
    await act(async () => auth.signIn("next@geu.ac.in", "pw"));
    expect(mockCalls).not.toContain("api /auth/logout");
    expect(mockCalls).not.toContain("stopSending");
    expect(mockCalls).toContain("storeTokens");
    act(() => tree.unmount());
  });

  it("ends the session when the server refuses it", async () => {
    const { ApiError } = jest.requireMock("@/lib/api");
    mockStoredToken = "r1";
    mockApi.mockRejectedValue(new ApiError(401));
    const { tree } = await mount();
    expect(mockCalls).toContain("clearTokens");
    act(() => tree.unmount());
  });
});

describe("signing out ends the share on the server", () => {
  it("stops the share this phone is sending, after the service and before logout", async () => {
    mockSendingShareIds.mockResolvedValue(["s1"]);
    const { auth, tree } = await mountQuietly();
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
    mockSendingShareIds.mockResolvedValue(["s1"]);
    mockShareSource = "outing";
    const { auth, tree } = await mountQuietly();
    await auth.signOut();
    expect(mockCalls).toContain("stopSending"); // the phone itself stops sending
    expect(mockCalls.some((c) => c.endsWith("/stop"))).toBe(false);
    expect(mockCalls.at(-1)).toBe("clearTokens");
    act(() => tree.unmount());
  });

  it("leaves the share alone when it can't tell what started it", async () => {
    mockSendingShareIds.mockResolvedValue(["s1"]);
    mockApi.mockImplementation(async (path: string) => {
      mockCalls.push(`api ${path}`);
      if (path === "/sessions/s1") throw new Error("offline");
    });
    const { auth, tree } = await mountQuietly();
    await expect(auth.signOut()).resolves.toBeUndefined();
    expect(mockCalls.some((c) => c.endsWith("/stop"))).toBe(false);
    expect(mockCalls.at(-1)).toBe("clearTokens");
    act(() => tree.unmount());
  });

  it("makes no stop request when the phone isn't sending", async () => {
    const { auth, tree } = await mountQuietly();
    await auth.signOut();
    expect(mockCalls.some((c) => c.includes("/stop"))).toBe(false);
    act(() => tree.unmount());
  });

  it("still signs out when the server stop fails", async () => {
    mockSendingShareIds.mockResolvedValue(["s1"]);
    mockApi.mockImplementation(async (path: string) => {
      if (path.endsWith("/stop")) {
        mockCalls.push(`api ${path}`);
        throw new Error("offline");
      }
      return mockRecord(path);
    });
    const { auth, tree } = await mountQuietly();
    await expect(auth.signOut()).resolves.toBeUndefined();
    expect(mockCalls).toContain("api /auth/logout");
    expect(mockCalls.at(-1)).toBe("clearTokens");
    act(() => tree.unmount());
  });

  it("still signs out when reading the stored share fails", async () => {
    mockSendingShareIds.mockRejectedValue(new Error("keystore locked"));
    const { auth, tree } = await mountQuietly();
    await expect(auth.signOut()).resolves.toBeUndefined();
    expect(mockCalls).toContain("stopSending");
    expect(mockCalls.at(-1)).toBe("clearTokens");
    act(() => tree.unmount());
  });
});

describe("a forced sign-out leaves nothing of the student on the phone", () => {
  it("stops sending, clears return reminders and forgets an armed intent", async () => {
    const id = armSafeReturn();
    const { tree } = await mountQuietly();
    await act(async () => mockSignedOutListener?.());
    expect(mockCalls).toEqual(expect.arrayContaining(["stopSending", "syncReturnReminders"]));
    expect(safeReturnFor({ intent: id })).toBe(false);
    act(() => tree.unmount());
  });
});

describe("signing out forgets an armed safe-return intent", () => {
  it("signOut clears it", async () => {
    const id = armSafeReturn();
    const { auth, tree } = await mountQuietly();
    await auth.signOut();
    expect(safeReturnFor({ intent: id })).toBe(false);
    act(() => tree.unmount());
  });

  it("deleteAccount clears it", async () => {
    const id = armSafeReturn();
    const { auth, tree } = await mountQuietly();
    await auth.deleteAccount("pw");
    expect(safeReturnFor({ intent: id })).toBe(false);
    act(() => tree.unmount());
  });
});

describe("signing out stops location sharing", () => {
  it("signOut stops the location service and its stored share before clearing the tokens", async () => {
    const { auth, tree } = await mountQuietly();
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
    const { auth, tree } = await mountQuietly();
    await expect(auth.signOut()).resolves.toBeUndefined();
    expect(mockCalls).toContain("stopSending");
    expect(mockCalls.at(-1)).toBe("clearTokens");
    act(() => tree.unmount());
  });

  it("deleteAccount stops sharing after the server deletes the account, before clearing tokens", async () => {
    const { auth, tree } = await mountQuietly();
    await auth.deleteAccount("pw");
    expect(mockCalls[0]).toBe("api /auth/delete-account");
    expect(mockStopSending).toHaveBeenCalledTimes(1);
    expect(mockCalls.indexOf("stopSending")).toBeLessThan(mockCalls.indexOf("clearTokens"));
    act(() => tree.unmount());
  });

  it("a refused deletion (out right now) stops nothing and passes on the server's reason", async () => {
    const { ApiError } = jest.requireMock("@/lib/api");
    const { auth, tree } = await mountQuietly();
    const refused = Object.assign(new ApiError(409), {
      detail: "You're out right now. Tap back in first",
    });
    mockApi.mockImplementation(async (path: string) => {
      mockCalls.push(`api ${path}`);
      if (path === "/auth/delete-account") throw refused;
    });
    await expect(auth.deleteAccount("pw")).rejects.toBe(refused);
    expect(mockCalls).toEqual(["api /auth/delete-account"]);
    act(() => tree.unmount());
  });

  it("deleteAccount clears the return reminders once the account is gone", async () => {
    const { auth, tree } = await mountQuietly();
    await auth.deleteAccount("pw");
    expect(mockCalls).toContain("syncReturnReminders");
    act(() => tree.unmount());
  });

  it("deleteAccount still clears the tokens when stopping the share fails", async () => {
    mockStopSending.mockRejectedValue(new Error("location service gone"));
    const { auth, tree } = await mountQuietly();
    await expect(auth.deleteAccount("pw")).resolves.toBeUndefined();
    expect(mockCalls.at(-1)).toBe("clearTokens");
    act(() => tree.unmount());
  });
});
