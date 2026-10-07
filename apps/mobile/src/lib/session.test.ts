import { accessToken, clearTokens, onSignedOut, refresh, storedRefreshToken } from "@/lib/session";

const mockStore = new Map<string, string>();

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (key: string) => mockStore.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => void mockStore.set(key, value)),
  deleteItemAsync: jest.fn(async (key: string) => void mockStore.delete(key)),
}));
jest.mock("@/lib/config", () => ({ API_URL: "https://api.test" }));

function reply(status: number, body?: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

const fetchMock = jest.fn<Promise<Response>, [string, RequestInit]>();
globalThis.fetch = fetchMock as unknown as typeof fetch;

beforeEach(async () => {
  fetchMock.mockReset();
  await clearTokens();
  mockStore.set("lumiback.refresh", "r1");
});

test("concurrent callers share one refresh request (reusing a rotated token logs out)", async () => {
  let release!: (r: Response) => void;
  fetchMock.mockReturnValueOnce(new Promise((resolve) => (release = resolve)));

  const both = Promise.all([accessToken(), refresh(), accessToken()]);
  release(
    reply(200, { access_token: "a2", token_type: "bearer", expires_in: 900, refresh_token: "r2" }),
  );

  expect(await both).toEqual(["a2", "a2", "a2"]);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1].body))).toEqual({ refresh_token: "r1" });
  expect(await storedRefreshToken()).toBe("r2");
  // The fresh access token is cached: no second request.
  expect(await accessToken()).toBe("a2");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

test("a refused refresh token signs out", async () => {
  const signedOut = jest.fn();
  const off = onSignedOut(signedOut);
  fetchMock.mockResolvedValueOnce(reply(401, { detail: "revoked" }));

  expect(await refresh()).toBeNull();
  expect(await storedRefreshToken()).toBeNull();
  expect(signedOut).toHaveBeenCalledTimes(1);
  off();
});

test("server errors and offline keep the refresh token for a later retry", async () => {
  fetchMock.mockResolvedValueOnce(reply(503));
  expect(await refresh()).toBeNull();
  expect(await storedRefreshToken()).toBe("r1");

  fetchMock.mockRejectedValueOnce(new TypeError("Network request failed"));
  expect(await refresh()).toBeNull();
  expect(await storedRefreshToken()).toBe("r1");
});

test("a new refresh can start once the previous one settled", async () => {
  fetchMock.mockResolvedValueOnce(reply(503)).mockResolvedValueOnce(
    reply(200, {
      access_token: "a3",
      token_type: "bearer",
      expires_in: 900,
      refresh_token: "r3",
    }),
  );
  expect(await refresh()).toBeNull();
  expect(await refresh()).toBe("a3");
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
