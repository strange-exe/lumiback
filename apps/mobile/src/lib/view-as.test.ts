import { api, ApiError, detailOf } from "@/lib/api";
import {
  canViewAs,
  clearViewAs,
  DEVELOPERS_ONLY,
  isReadOnlyRefusal,
  loadViewAs,
  parseViewAsRole,
  READ_ONLY,
  refusesViewAs,
  setViewAs,
  UNKNOWN_ROLE,
  VIEW_AS_ROLES,
  viewAsHeaders,
  viewAsLine,
  viewingAs,
} from "@/lib/view-as";
import type { ViewAsRole } from "@/lib/types";

jest.mock("@/lib/config", () => ({ API_URL: "https://api.test" }));
jest.mock("@/lib/session", () => ({
  accessToken: jest.fn(async () => "token"),
  refresh: jest.fn(async () => "token"),
  clearTokens: jest.fn(async () => undefined),
  sessionGeneration: jest.fn(() => 1),
  SessionUnavailable: class extends Error {},
}));
// jest.mock factories are hoisted: they may read only `mock`-prefixed variables, when called.
const mockStore = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (key: string) => mockStore.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => void mockStore.set(key, value)),
  deleteItemAsync: jest.fn(async (key: string) => void mockStore.delete(key)),
}));

const KEY = "lumiback.view-as-role";

function reply(status: number, body?: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

const fetchMock = jest.fn<Promise<Response>, [string, RequestInit]>();
globalThis.fetch = fetchMock as unknown as typeof fetch;

/** The headers the n-th fetch sent. */
function sentHeaders(n = 0): Record<string, string> {
  return (fetchMock.mock.calls[n]?.[1]?.headers ?? {}) as Record<string, string>;
}

beforeEach(async () => {
  fetchMock.mockReset();
  await clearViewAs();
  mockStore.clear();
});

describe("the role", () => {
  it("is one of the four viewable roles, in the selector's order", () => {
    expect(VIEW_AS_ROLES).toEqual(["admin", "head_warden", "warden", "student"]);
    for (const role of VIEW_AS_ROLES) expect(parseViewAsRole(role)).toBe(role);
  });

  it("is never developer, a near miss, or anything that isn't a role string", () => {
    for (const value of [
      "developer",
      "Admin",
      " student",
      "student ",
      "head-warden",
      "",
      "9b2f0c1e-0000-4000-8000-000000000001",
      '{"role":"student"}',
      null,
      undefined,
      42,
      ["student"],
      { role: "student" },
    ]) {
      expect(parseViewAsRole(value)).toBeNull();
    }
  });

  it("is ignored when invalid, so nothing is stored or sent", async () => {
    await setViewAs("developer" as ViewAsRole);
    await setViewAs("root" as ViewAsRole);
    expect(viewingAs()).toBeNull();
    expect(mockStore.has(KEY)).toBe(false);
  });

  it("survives a restart through SecureStore, as the bare role", async () => {
    await setViewAs("warden");
    expect(mockStore.get(KEY)).toBe("warden");
    // loadViewAs reads storage only once per launch; this launch already knows it.
    await expect(loadViewAs()).resolves.toBe("warden");
  });

  it("is cleared only when it is still the one asked about", async () => {
    await setViewAs("student");
    await clearViewAs("warden");
    expect(viewingAs()).toBe("student");
    await clearViewAs("student");
    expect(viewingAs()).toBeNull();
    expect(mockStore.has(KEY)).toBe(false);
  });
});

describe("loading the stored role at launch", () => {
  // loadViewAs reads storage once per module instance: each case gets a fresh one.
  async function launchWith(stored: string | null): Promise<ViewAsRole | null> {
    mockStore.clear();
    if (stored !== null) mockStore.set(KEY, stored);
    let fresh: typeof import("@/lib/view-as") | undefined;
    jest.isolateModules(() => {
      fresh = jest.requireActual<typeof import("@/lib/view-as")>("@/lib/view-as");
    });
    return fresh!.loadViewAs();
  }

  it("keeps a valid stored role", async () => {
    await expect(launchWith("head_warden")).resolves.toBe("head_warden");
  });

  it("drops anything else (a tampered or older value)", async () => {
    await expect(launchWith("developer")).resolves.toBeNull();
    await expect(launchWith('{"id":"x","name":"Asha","role":"student"}')).resolves.toBeNull();
    await expect(launchWith("")).resolves.toBeNull();
    await expect(launchWith(null)).resolves.toBeNull();
  });
});

describe("the X-View-As-Role header", () => {
  it("is built only from a valid role", () => {
    expect(viewAsHeaders("student")).toEqual({ "X-View-As-Role": "student" });
    expect(viewAsHeaders("head_warden")).toEqual({ "X-View-As-Role": "head_warden" });
    expect(viewAsHeaders(null)).toEqual({});
    expect(viewAsHeaders("developer" as ViewAsRole)).toEqual({});
    expect(viewAsHeaders("admin\r\nX-Evil: 1" as ViewAsRole)).toEqual({});
  });

  it("is added to signed-in requests while viewing as a role", async () => {
    await setViewAs("student");
    fetchMock.mockResolvedValueOnce(reply(200, {}));
    await api("/auth/me");
    expect(sentHeaders()["X-View-As-Role"]).toBe("student");
    expect(sentHeaders().Authorization).toBe("Bearer token");
  });

  it("is never sent while not viewing", async () => {
    fetchMock.mockResolvedValueOnce(reply(200, {}));
    await api("/auth/me");
    expect(sentHeaders()).not.toHaveProperty("X-View-As-Role");
  });

  it("is never sent without the user's token, or for the phone's own share", async () => {
    await setViewAs("admin");
    fetchMock.mockResolvedValue(reply(200, {}));
    await api("/auth/login", { method: "POST", auth: false, body: {} });
    await api("/sessions/s1/location", { method: "PUT", self: true, body: {} });
    expect(sentHeaders(0)).not.toHaveProperty("X-View-As-Role");
    expect(sentHeaders(1)).not.toHaveProperty("X-View-As-Role");
  });

  it("is still sent on the retry after a token refresh", async () => {
    await setViewAs("warden");
    fetchMock
      .mockResolvedValueOnce(reply(401, { detail: "Not signed in" }))
      .mockResolvedValueOnce(reply(200, {}));
    await api("/outings");
    expect(sentHeaders(1)["X-View-As-Role"]).toBe("warden");
  });

  it("never carries the old per-account header", async () => {
    await setViewAs("student");
    fetchMock.mockResolvedValueOnce(reply(200, {}));
    await api("/auth/me");
    expect(sentHeaders()).not.toHaveProperty("X-View-As");
  });
});

describe("a refusal that ends the view", () => {
  it.each([
    [403, DEVELOPERS_ONLY],
    [400, UNKNOWN_ROLE],
  ])("%i %s clears the role, in memory and in storage", async (status, detail) => {
    await setViewAs("student");
    expect(mockStore.has(KEY)).toBe(true);
    fetchMock.mockResolvedValueOnce(reply(status, { detail }));
    const failure = (await api("/auth/me").catch((e: unknown) => e)) as ApiError;
    expect(failure.status).toBe(status);
    expect(viewingAs()).toBeNull();
    expect(mockStore.has(KEY)).toBe(false);
    // The next request goes out as the developer's own view.
    fetchMock.mockResolvedValueOnce(reply(200, {}));
    await api("/auth/me");
    expect(sentHeaders(1)).not.toHaveProperty("X-View-As-Role");
  });

  it("doesn't end a newer choice made while it was on its way", async () => {
    await setViewAs("student");
    let answer: (r: Response) => void = () => undefined;
    fetchMock.mockReturnValueOnce(new Promise<Response>((resolve) => (answer = resolve)));
    const pending = api("/auth/me").catch((e: unknown) => e);
    await new Promise((r) => setTimeout(r, 0));
    await setViewAs("warden");
    answer(reply(400, { detail: UNKNOWN_ROLE }));
    await pending;
    expect(viewingAs()).toBe("warden");
  });

  it("leaves the view alone for any other refusal, the read-only one included", async () => {
    await setViewAs("admin");
    fetchMock.mockResolvedValueOnce(reply(403, { detail: READ_ONLY }));
    await api("/outings", { method: "POST", body: {} }).catch(() => undefined);
    fetchMock.mockResolvedValueOnce(reply(403, { detail: "Not your hostel" }));
    await api("/admin/overview").catch(() => undefined);
    fetchMock.mockResolvedValueOnce(reply(400, { detail: "Pick a return time" }));
    await api("/outings").catch(() => undefined);
    expect(viewingAs()).toBe("admin");
  });

  it("is told apart by status and wording", () => {
    expect(refusesViewAs(403, DEVELOPERS_ONLY)).toBe(true);
    expect(refusesViewAs(400, UNKNOWN_ROLE)).toBe(true);
    expect(refusesViewAs(400, DEVELOPERS_ONLY)).toBe(false);
    expect(refusesViewAs(403, UNKNOWN_ROLE)).toBe(false);
    expect(refusesViewAs(403, READ_ONLY)).toBe(false);
    expect(refusesViewAs(404, "No such account to view as")).toBe(false);
  });
});

describe("the read-only refusal", () => {
  it("reaches the screen in the server's own words, not a generic failure", async () => {
    await setViewAs("student");
    fetchMock.mockResolvedValueOnce(reply(403, { detail: READ_ONLY }));
    const failure = (await api("/outings", { method: "POST", body: {} }).catch(
      (e: unknown) => e,
    )) as ApiError;
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure.detail).toBe("Read-only while viewing as another role");
    expect(detailOf({ detail: READ_ONLY }, 403)).toBe(READ_ONLY);
    expect(isReadOnlyRefusal(failure.status, failure.detail)).toBe(true);
    expect(isReadOnlyRefusal(403, DEVELOPERS_ONLY)).toBe(false);
  });
});

describe("the banner and who may use View as", () => {
  it("says which role, read-only", () => {
    expect(viewAsLine("student")).toBe("Viewing as Student. Read-only.");
    expect(viewAsLine("head_warden")).toBe("Viewing as Head warden. Read-only.");
  });

  it("is a developer, or a developer already viewing as a role", () => {
    expect(canViewAs({ role: "developer", viewing_as: null })).toBe(true);
    expect(canViewAs({ role: "student", viewing_as: "student" })).toBe(true);
    expect(canViewAs({ role: "admin", viewing_as: "admin" })).toBe(true);
    for (const role of ["admin", "head_warden", "warden", "student"] as const) {
      expect(canViewAs({ role, viewing_as: null })).toBe(false);
      expect(canViewAs({ role })).toBe(false);
    }
    expect(canViewAs({ role: "admin", viewing_as: "developer" as ViewAsRole })).toBe(false);
    expect(canViewAs(null)).toBe(false);
  });
});
