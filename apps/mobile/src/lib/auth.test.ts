import { createElement, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { AuthProvider, useAuth } from "@/lib/auth";

// Every step of signing out records itself here, so the tests can check the order.
const mockCalls: string[] = [];
const mockStopSending = jest.fn(async () => void mockCalls.push("stopSending"));

jest.mock("@/location/task", () => ({ stopSending: () => mockStopSending() }));
jest.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {},
  api: jest.fn(async (path: string) => void mockCalls.push(`api ${path}`)),
}));
jest.mock("@/lib/session", () => ({
  clearTokens: jest.fn(async () => void mockCalls.push("clearTokens")),
  onSignedOut: () => () => undefined,
  // Signed out at launch: the provider makes no requests of its own during the test.
  storedRefreshToken: jest.fn(async () => (mockCalls.length > 0 ? "r1" : null)),
  storeTokens: jest.fn(),
}));
jest.mock("@/notify/notify", () => ({ syncPush: jest.fn() }));
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
