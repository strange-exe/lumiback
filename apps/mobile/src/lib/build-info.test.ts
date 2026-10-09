import { buildLines } from "./build-info";

const day = (iso: string) => (iso === "2026-10-09" ? "9 Oct 2026" : iso);
const base = {
  version: "1.3.0",
  date: "2026-10-09",
  runtimeVersion: "c22cefa5baa82b88409c594c5d53df19ed6c2fe1",
  updateId: "01a11f55-91ed-7da8-8312-4d95792def74",
  isEmbeddedLaunch: false,
  builds: { c22cefa5baa82b88409c594c5d53df19ed6c2fe1: 1 },
};

test("an installed update shows the version, the app build and the update", () => {
  expect(buildLines(base, day)).toEqual([
    "Version 1.3.0 · 9 Oct 2026",
    "App build 1 · update 01a11f55",
  ]);
});

test("running the code that came with the app says so", () => {
  expect(buildLines({ ...base, isEmbeddedLaunch: true }, day)[1]).toBe(
    "App build 1 · built-in code",
  );
});

test("a build missing from the list shows its short code", () => {
  expect(buildLines({ ...base, builds: {} }, day)[1]).toBe("App build c22cefa5 · update 01a11f55");
});

test("development builds show only the version", () => {
  expect(buildLines({ ...base, runtimeVersion: null, updateId: null }, day)).toEqual([
    "Version 1.3.0 · 9 Oct 2026",
  ]);
});
