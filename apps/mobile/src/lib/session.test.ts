import { api, ApiError } from "@/lib/api";
import {
  accessToken,
  clearTokens,
  onSignedOut,
  refresh,
  SessionUnavailable,
  storedRefreshToken,
  storeTokens,
} from "@/lib/session";
import type { TokenPair } from "@/lib/types";

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

describe("a refresh that outlives its session", () => {
  const next = { access_token: "b1", token_type: "bearer", expires_in: 900, refresh_token: "rb" };

  /** Settle microtasks until the refresh under test has really sent its request. */
  async function untilSent(requests: number): Promise<void> {
    for (let i = 0; i < 50 && fetchMock.mock.calls.length < requests; i++) await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(requests);
  }

  test("never stores the old session's tokens over a new sign-in", async () => {
    let release!: (r: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise((resolve) => (release = resolve)));
    const pending = refresh(); // started with the kept session's "r1"
    await untilSent(1);
    await storeTokens(next as TokenPair); // another student signs in meanwhile
    release(
      reply(200, {
        access_token: "a2",
        token_type: "bearer",
        expires_in: 900,
        refresh_token: "r2",
      }),
    );
    // Its callers began under the old session: they get nothing, never the new token.
    expect(await pending).toBeNull();
    expect(await storedRefreshToken()).toBe("rb");
    expect(await accessToken()).toBe("b1");
  });

  test("a refresh after the sign-in is its own request, with the new token", async () => {
    fetchMock.mockReturnValueOnce(new Promise(() => undefined)); // the old one never answers
    void refresh();
    await untilSent(1);
    await storeTokens(next as TokenPair);
    fetchMock.mockResolvedValueOnce(
      reply(200, {
        access_token: "b2",
        token_type: "bearer",
        expires_in: 900,
        refresh_token: "rc",
      }),
    );
    expect(await refresh()).toBe("b2");
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1].body))).toEqual({ refresh_token: "rb" });
  });

  test("never signs the new session out when the old one is refused", async () => {
    const signedOut = jest.fn();
    const off = onSignedOut(signedOut);
    let release!: (r: Response) => void;
    fetchMock.mockReturnValueOnce(new Promise((resolve) => (release = resolve)));
    const pending = refresh();
    await untilSent(1);
    await storeTokens(next as TokenPair);
    release(reply(401, { detail: "revoked" })); // the sign-in ended the old login
    expect(await pending).toBeNull();
    expect(await storedRefreshToken()).toBe("rb");
    expect(signedOut).not.toHaveBeenCalled();
    off();
  });
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

test("server errors and offline are 'unavailable', not signed out: the token is kept", async () => {
  const signedOut = jest.fn();
  const off = onSignedOut(signedOut);
  fetchMock.mockResolvedValueOnce(reply(503));
  await expect(refresh()).rejects.toBeInstanceOf(SessionUnavailable);
  expect(await storedRefreshToken()).toBe("r1");

  fetchMock.mockRejectedValueOnce(new TypeError("Network request failed"));
  await expect(accessToken()).rejects.toBeInstanceOf(SessionUnavailable);
  expect(await storedRefreshToken()).toBe("r1");
  expect(signedOut).not.toHaveBeenCalled();
  off();
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
  await expect(refresh()).rejects.toBeInstanceOf(SessionUnavailable);
  expect(await refresh()).toBe("a3");
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test("a request begun before another sign-in never signs the new student out", async () => {
  await storeTokens({
    access_token: "a1",
    token_type: "bearer",
    expires_in: 900,
    refresh_token: "r1",
  }); // student A
  const signedOut = jest.fn();
  const off = onSignedOut(signedOut);
  let release!: (r: Response) => void;
  fetchMock
    .mockResolvedValueOnce(reply(401)) // A's access token is refused
    .mockResolvedValueOnce(
      reply(200, {
        access_token: "a2",
        token_type: "bearer",
        expires_in: 900,
        refresh_token: "r2",
      }),
    )
    .mockReturnValueOnce(new Promise((resolve) => (release = resolve))); // the retry
  const request = api("/sessions/s1").catch((error: unknown) => error);
  for (let i = 0; i < 200 && fetchMock.mock.calls.length < 3; i++) await Promise.resolve();
  expect(fetchMock).toHaveBeenCalledTimes(3);
  await storeTokens({
    access_token: "b1",
    token_type: "bearer",
    expires_in: 900,
    refresh_token: "rb",
  });
  release(reply(401)); // the sign-in ended the old login
  expect(((await request) as ApiError).status).toBe(401);
  expect(await storedRefreshToken()).toBe("rb");
  expect(signedOut).not.toHaveBeenCalled();
  off();
});

test("a request begun before another sign-in is never renewed with the new session", async () => {
  await storeTokens({
    access_token: "a1",
    token_type: "bearer",
    expires_in: 900,
    refresh_token: "r1",
  }); // student A
  let release!: (r: Response) => void;
  fetchMock.mockReturnValueOnce(new Promise((resolve) => (release = resolve))); // A's request
  const request = api("/sessions/s1").catch((error: unknown) => error);
  for (let i = 0; i < 200 && fetchMock.mock.calls.length < 1; i++) await Promise.resolve();
  await storeTokens({
    access_token: "b1",
    token_type: "bearer",
    expires_in: 900,
    refresh_token: "rb",
  }); // student B signs in while it runs
  release(reply(401));
  expect(((await request) as ApiError).status).toBe(401);
  expect(fetchMock).toHaveBeenCalledTimes(1); // no refresh of B's login, no retry with B's token
  expect(await storedRefreshToken()).toBe("rb");
});

test("opening the app offline is a network error (status 0), never a sign-out (401)", async () => {
  fetchMock.mockRejectedValue(new TypeError("Network request failed"));
  const failure = await api("/auth/me").catch((error: unknown) => error);
  expect(failure).toBeInstanceOf(ApiError);
  expect((failure as ApiError).status).toBe(0);
  expect(await storedRefreshToken()).toBe("r1");
});
