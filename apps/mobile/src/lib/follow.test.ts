import { followFailure, isUuid } from "@/lib/follow";

jest.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    detail: string;
    constructor(mockStatus: number, mockDetail: string) {
      super(`${mockStatus}: ${mockDetail}`);
      this.status = mockStatus;
      this.detail = mockDetail;
    }
  },
}));

const { ApiError } = jest.requireMock("@/lib/api");
const WAITING = "Waiting for the sharer to approve you";

describe("isUuid", () => {
  it("accepts the ids the server hands out", () => {
    expect(isUuid("3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b")).toBe(true);
    expect(isUuid("3F2B8C1E-9A4D-4E6F-8B7A-1C2D3E4F5A6B")).toBe(true);
  });

  it("refuses anything else before it reaches a backend path", () => {
    for (const id of ["", "abc", "../auth/me", "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b/x", 3, null]) {
      expect(isUuid(id)).toBe(false);
    }
  });
});

describe("followFailure", () => {
  it("waits while the sharer hasn't approved yet", () => {
    expect(followFailure(new ApiError(403, WAITING))).toEqual({ kind: "pending" });
  });

  it("ends on a refusal, a missing share or an ended one", () => {
    expect(followFailure(new ApiError(403, "You were removed"))).toEqual({
      kind: "ended",
      reason: "You were removed",
    });
    expect(followFailure(new ApiError(404, "Not found")).kind).toBe("ended");
    expect(followFailure(new ApiError(409, "Ended")).kind).toBe("ended");
  });

  it("stops retrying on any other answer from the server, such as a malformed link", () => {
    expect(followFailure(new ApiError(422, "Input should be a valid UUID"))).toEqual({
      kind: "failed",
      reason: "This link doesn't open a live share. Check it with the person who sent it.",
    });
    expect(followFailure(new ApiError(400, "Bad")).kind).toBe("failed");
  });

  it("keeps retrying only when the server can't be reached or is having trouble", () => {
    expect(followFailure(new ApiError(0, "offline")).kind).toBe("offline");
    expect(followFailure(new ApiError(503, "down")).kind).toBe("offline");
    expect(followFailure(new ApiError(429, "slow down")).kind).toBe("offline");
    expect(followFailure(new Error("network")).kind).toBe("offline");
  });
});
