import { buildLines } from "./build-info";

const day = () => "8 Oct";
const base = {
  version: "0.1.0",
  runtimeVersion: "c22cefa5baa82b88409c594c5d53df19ed6c2fe1",
  updateId: "01a11bae-a631-747a-92a2-213a34a45f4f",
  createdAt: new Date("2026-10-08T13:23:13Z"),
  isEmbeddedLaunch: false,
};

test("an installed update shows the build and the update", () => {
  expect(buildLines(base, day)).toEqual([
    "Lumiback 0.1.0",
    "Build c22cefa5 · Update 01a11bae, 8 Oct",
  ]);
});

test("running the code that came with the APK says so", () => {
  expect(buildLines({ ...base, isEmbeddedLaunch: true }, day)[1]).toBe(
    "Build c22cefa5 · No updates yet",
  );
});

test("development builds show only the version", () => {
  expect(buildLines({ ...base, runtimeVersion: null, updateId: null }, day)).toEqual([
    "Lumiback 0.1.0",
  ]);
});
