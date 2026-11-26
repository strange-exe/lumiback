import { readFileSync } from "fs";
import { join } from "path";

import { outingRowLayout, TIME_WIDTH } from "@/ui/OutingRow";

// 2026-11-26, Android font size 2.0 on a 1080 px phone: a trip row (History, Today's Recent
// trips) kept its three columns, so the middle one shrank to a few letters ("Ver / ifie / d at")
// and the fixed 76 dp time column cut "3:52 PM" to "3:52 ...". The time column now grows with
// the font setting, and from 1.3 up the row stacks: times, then the trip, then its status.
describe("a trip row's layout", () => {
  it("is unchanged at the default font size", () => {
    expect(outingRowLayout(1)).toEqual({ stacked: false, timeWidth: TIME_WIDTH });
    expect(TIME_WIDTH).toBe(76);
  });

  it("never narrows the time column below its default", () => {
    expect(outingRowLayout(0.85)).toEqual({ stacked: false, timeWidth: TIME_WIDTH });
  });

  it("widens the time column with a slightly larger font", () => {
    expect(outingRowLayout(1.15)).toEqual({
      stacked: false,
      timeWidth: Math.ceil(TIME_WIDTH * 1.15),
    });
  });

  it("stacks from 1.3 up, where three columns no longer fit", () => {
    for (const scale of [1.3, 1.5, 1.8, 2]) {
      expect(outingRowLayout(scale).stacked).toBe(true);
    }
  });

  it("is what the row lays itself out with", () => {
    const source = readFileSync(join(__dirname, "OutingRow.tsx"), "utf8");
    expect(source).toMatch(/outingRowLayout\(useWindowDimensions\(\)\.fontScale\)/);
    expect(source).not.toMatch(/width:\s*76\b/);
  });
});
