import {
  armSafeReturn,
  clearSafeReturn,
  consumeSafeReturn,
  INTENT_TTL_MS,
  safeReturnFor,
} from "@/gate/intent";

beforeEach(() => clearSafeReturn());

describe("safe-return intent (Today's tick, carried in memory to Scan)", () => {
  it("is honoured once, for the id Today armed", () => {
    const id = armSafeReturn(1_000);
    expect(safeReturnFor({ intent: id }, 1_000)).toBe(true);
    expect(consumeSafeReturn(id, 2_000)).toBe(true);
    // Consumed: a second screen (or a replayed link with the same id) gets nothing.
    expect(safeReturnFor({ intent: id }, 2_000)).toBe(false);
    expect(consumeSafeReturn(id, 2_000)).toBe(false);
  });

  it("expires after the time limit", () => {
    const id = armSafeReturn(0);
    expect(safeReturnFor({ intent: id }, INTENT_TTL_MS)).toBe(true);
    expect(safeReturnFor({ intent: id }, INTENT_TTL_MS + 1)).toBe(false);
    expect(consumeSafeReturn(id, INTENT_TTL_MS + 1)).toBe(false);
  });

  it("a new tick replaces the old one", () => {
    const first = armSafeReturn(0);
    const second = armSafeReturn(10);
    expect(first).not.toBe(second);
    expect(safeReturnFor({ intent: first }, 20)).toBe(false);
    expect(safeReturnFor({ intent: second }, 20)).toBe(true);
  });

  it("consuming another id leaves the armed one alone", () => {
    const id = armSafeReturn(0);
    expect(consumeSafeReturn("guess", 1)).toBe(false);
    expect(safeReturnFor({ intent: id }, 1)).toBe(true);
  });

  it("ignores a `safe` route parameter: a deep link can't turn safe return on", () => {
    expect(safeReturnFor({ safe: "1" }, 0)).toBe(false);
    expect(safeReturnFor({ safe: "1", qr: "x" }, 0)).toBe(false);
    // Even while Today's tick is armed, a link without its id gets nothing.
    const id = armSafeReturn(0);
    expect(safeReturnFor({ safe: "1" }, 1)).toBe(false);
    expect(safeReturnFor({ safe: "1", intent: "guess" }, 1)).toBe(false);
    expect(safeReturnFor({ intent: ["x", id] }, 1)).toBe(false);
    expect(safeReturnFor({ intent: "" }, 1)).toBe(false);
  });

  it("nothing armed means no safe return", () => {
    expect(safeReturnFor({}, 0)).toBe(false);
    expect(safeReturnFor({ intent: undefined }, 0)).toBe(false);
  });
});
