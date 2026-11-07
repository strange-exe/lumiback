import { compareVersions, CURRENT } from "@/updates/changelog";

import { planTour, STEPS, stepText } from "./steps";
import { placeCard } from "./store";

const ids = (plan: ReturnType<typeof planTour>) => plan?.steps.map((s) => s.id) ?? null;

describe("planTour", () => {
  it("walks a student through everything the first time", () => {
    const plan = planTour({ seen: null, current: "1.13.0", audience: "student" });
    expect(plan?.kind).toBe("welcome");
    expect(ids(plan)).toEqual(["board", "scan", "today", "live", "history", "profile"]);
  });

  it("gives staff their own tour, without the student-only controls", () => {
    const plan = planTour({ seen: null, current: "1.13.0", audience: "staff" });
    expect(ids(plan)).toEqual(["office", "staff-profile"]);
  });

  it("after an update, shows only what that release added or changed", () => {
    const plan = planTour({ seen: "1.12.1", current: "1.13.0", audience: "student" });
    expect(plan?.kind).toBe("new");
    expect(ids(plan)).toEqual(["board", "scan", "history"]);
  });

  it("shows nothing on the same version, or when an update changed no control", () => {
    expect(planTour({ seen: "1.13.0", current: "1.13.0", audience: "student" })).toBeNull();
    expect(planTour({ seen: "1.13.0", current: "1.13.1", audience: "student" })).toBeNull();
    // Staff controls didn't change in 1.13.0.
    expect(planTour({ seen: "1.12.1", current: "1.13.0", audience: "staff" })).toBeNull();
  });

  it("never announces a step from a release the phone doesn't have yet", () => {
    expect(planTour({ seen: "1.11.0", current: "1.12.1", audience: "student" })).toBeNull();
  });

  it("replays the whole tour from Help, whatever was seen", () => {
    const plan = planTour({ seen: "1.13.0", current: "1.13.0", audience: "student", replay: true });
    expect(plan?.kind).toBe("welcome");
    expect(plan?.steps).toHaveLength(6);
  });
});

describe("tour copy", () => {
  it("uses the update wording after an update, the full wording otherwise", () => {
    const scan = STEPS.find((s) => s.id === "scan")!;
    expect(stepText(scan, "new")).toBe(scan.changed);
    expect(stepText(scan, "welcome")).toBe(scan.body);
    const live = STEPS.find((s) => s.id === "live")!;
    expect(stepText(live, "new")).toBe(live.body);
  });

  it("is plain: no exclamation marks, every step titled and explained", () => {
    for (const s of STEPS) {
      expect(s.title.length).toBeGreaterThan(0);
      expect(s.body.length).toBeGreaterThan(20);
      expect(`${s.title} ${s.body} ${s.changed ?? ""}`).not.toMatch(/!/);
    }
  });

  it("dates every step at or before the app's own version", () => {
    for (const s of STEPS) expect(compareVersions(s.since, CURRENT.version)).toBeLessThanOrEqual(0);
  });

  it("has unique step ids", () => {
    expect(new Set(STEPS.map((s) => s.id)).size).toBe(STEPS.length);
  });
});

describe("placeCard", () => {
  const base = { screenHeight: 800, cardHeight: 200, gap: 14, top: 30, bottom: 20 };

  it("goes under the highlight when it fits", () => {
    expect(placeCard({ ...base, hole: { x: 0, y: 100, width: 300, height: 200 } })).toBe(314);
  });

  it("goes above a highlight near the bottom (the dock)", () => {
    expect(placeCard({ ...base, hole: { x: 0, y: 700, width: 300, height: 64 } })).toBe(486);
  });

  it("stays on screen for a highlight too tall for either side", () => {
    const top = placeCard({ ...base, hole: { x: 0, y: 100, width: 300, height: 600 } });
    expect(top).toBeGreaterThanOrEqual(30);
    expect(top + 200).toBeLessThanOrEqual(780);
  });

  it("centres without a highlight", () => {
    expect(placeCard({ ...base, hole: null })).toBe(300);
  });
});
