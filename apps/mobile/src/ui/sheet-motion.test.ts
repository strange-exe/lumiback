import { dragOffset, shouldDismiss } from "@/ui/sheet-motion";

describe("shouldDismiss", () => {
  const height = 500;

  it("closes when dragged down far enough, however slowly", () => {
    expect(shouldDismiss(160, 0, height)).toBe(true);
    expect(shouldDismiss(140, 0, height)).toBe(false);
  });

  it("closes on a downward flick, even a short one", () => {
    expect(shouldDismiss(30, 900, height)).toBe(true);
  });

  it("stays open on a flick back up, even after a long drag", () => {
    expect(shouldDismiss(300, -900, height)).toBe(false);
  });

  it("never closes from an upward drag", () => {
    expect(shouldDismiss(-200, 0, height)).toBe(false);
  });

  it("a short sheet still needs a real drag (a floor, not a share of nothing)", () => {
    expect(shouldDismiss(40, 0, 120)).toBe(false);
    expect(shouldDismiss(90, 0, 120)).toBe(true);
  });
});

describe("dragOffset", () => {
  it("follows the finger downward", () => {
    expect(dragOffset(120)).toBe(120);
  });

  it("resists upward: moves less than the finger and never past a small limit", () => {
    const up = dragOffset(-100);
    expect(up).toBeLessThan(0);
    expect(up).toBeGreaterThan(-100);
    expect(dragOffset(-10_000)).toBeGreaterThanOrEqual(-24);
  });
});
