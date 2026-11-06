import { api, ApiError, detailOf, problemOf } from "@/lib/api";

jest.mock("@/lib/config", () => ({ API_URL: "https://api.test" }));
jest.mock("@/lib/session", () => ({
  accessToken: jest.fn(async () => "token"),
  refresh: jest.fn(async () => "token"),
  clearTokens: jest.fn(async () => undefined),
  sessionGeneration: jest.fn(() => 1),
  SessionUnavailable: class extends Error {},
}));

const STALE = {
  detail: {
    code: "stale_outing",
    left_at: "2026-11-05T18:10:00+05:30",
    message:
      "Your outing from Thu 5 Nov was never closed. Are you coming back in, or going out now?",
  },
};

function reply(status: number, body?: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

const fetchMock = jest.fn<Promise<Response>, [string, RequestInit]>();
globalThis.fetch = fetchMock as unknown as typeof fetch;

describe("error details", () => {
  it("reads an object detail's message, and keeps its fields", () => {
    expect(detailOf(STALE, 409)).toBe(STALE.detail.message);
    expect(problemOf(STALE)).toEqual(STALE.detail);
  });

  it("keeps plain and validation details as before", () => {
    expect(detailOf({ detail: "You're already checked out." }, 409)).toBe(
      "You're already checked out.",
    );
    expect(problemOf({ detail: "You're already checked out." })).toBeNull();
    expect(detailOf({ detail: [{ msg: "Value error, Say when they came back" }] }, 422)).toBe(
      "Say when they came back",
    );
    expect(problemOf({ detail: [{ msg: "x" }] })).toBeNull();
  });

  it("falls back when an object detail isn't {code, message}", () => {
    expect(problemOf({ detail: { code: "x" } })).toBeNull();
    expect(problemOf({ detail: { message: 1, code: "x" } })).toBeNull();
    expect(problemOf(null)).toBeNull();
    expect(detailOf({ detail: { code: "x" } }, 409)).toBe("Something went wrong. Try again.");
    expect(detailOf({ detail: {} }, 429)).toBe("Too many attempts. Wait a moment and try again.");
  });
});

describe("api errors", () => {
  beforeEach(() => fetchMock.mockReset());

  it("carries the stale-outing question to the caller", async () => {
    fetchMock.mockResolvedValueOnce(reply(409, STALE));
    const failure = (await api("/gates/scan", { method: "POST", body: {} }).catch(
      (e: unknown) => e,
    )) as ApiError;
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure.status).toBe(409);
    expect(failure.detail).toBe(STALE.detail.message);
    expect(failure.problem).toEqual(STALE.detail);
  });

  it("has no problem for a plain sentence", async () => {
    fetchMock.mockResolvedValueOnce(reply(404, { detail: "Outing not found" }));
    const failure = (await api("/outings/x/correction", { method: "POST", body: {} }).catch(
      (e: unknown) => e,
    )) as ApiError;
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure.detail).toBe("Outing not found");
    expect(failure.problem).toBeNull();
  });
});
