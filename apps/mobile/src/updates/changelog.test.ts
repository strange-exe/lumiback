import { CHANGELOG, compareVersions, CURRENT, shouldShowWhatsNew } from "./changelog";

test("versions are x.y.z, unique and newest first", () => {
  for (const r of CHANGELOG) expect(r.version).toMatch(/^\d+\.\d+\.\d+$/);
  for (let i = 1; i < CHANGELOG.length; i++) {
    expect(compareVersions(CHANGELOG[i - 1]!.version, CHANGELOG[i]!.version)).toBe(1);
    expect(CHANGELOG[i - 1]!.date >= CHANGELOG[i]!.date).toBe(true);
  }
  expect(CURRENT).toBe(CHANGELOG[0]);
});

test("every release says what changed", () => {
  for (const r of CHANGELOG) {
    expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.title.length).toBeGreaterThan(0);
    expect(r.points.length).toBeGreaterThan(0);
  }
});

test("what's new shows once per newer release, not on a fresh install", () => {
  const show = (seen: string | null, isEmbeddedLaunch = false) =>
    shouldShowWhatsNew({ seen, current: "1.3.0", isEmbeddedLaunch });
  expect(show(null)).toBe(true); // updated from a version before this existed
  expect(show(null, true)).toBe(false); // fresh install
  expect(show("1.2.0")).toBe(true);
  expect(show("1.3.0")).toBe(false);
  expect(show("1.4.0")).toBe(false); // never "new" when going back
});

test("compares by number, not text", () => {
  expect(compareVersions("1.10.0", "1.9.0")).toBe(1);
  expect(compareVersions("2.0.0", "1.12.3")).toBe(1);
  expect(compareVersions("1.3.0", "1.3.0")).toBe(0);
});
