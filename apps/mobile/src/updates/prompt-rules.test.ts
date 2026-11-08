import {
  announcedUpdateStep,
  CHECK_EVERY_MS,
  overTheAirProgress,
  promptAllowed,
  shouldCheck,
  shouldPrompt,
  SNOOZE_MS,
} from "./prompt-rules";

describe("announcedUpdateStep (an app-update notification was tapped)", () => {
  test("an update on the server: download it and restart, whatever was snoozed", () => {
    expect(announcedUpdateStep({ enabled: true, dev: false, check: { isAvailable: true } })).toBe(
      "update",
    );
  });

  test("already up to date: show what's new instead", () => {
    expect(announcedUpdateStep({ enabled: true, dev: false, check: { isAvailable: false } })).toBe(
      "notes",
    );
  });

  test("the check failed (offline): nothing to install, show what's new", () => {
    expect(announcedUpdateStep({ enabled: true, dev: false, check: null })).toBe("notes");
  });

  test("development builds and builds without updates never check or restart", () => {
    expect(announcedUpdateStep({ enabled: false, dev: false, check: null })).toBe("notes");
    expect(announcedUpdateStep({ enabled: true, dev: true, check: { isAvailable: true } })).toBe(
      "notes",
    );
  });
});

const T0 = 1_000_000;

test("checks at launch, then at most every few minutes", () => {
  expect(shouldCheck(null, T0)).toBe(true);
  expect(shouldCheck(T0, T0 + CHECK_EVERY_MS - 1)).toBe(false);
  expect(shouldCheck(T0, T0 + CHECK_EVERY_MS)).toBe(true);
});

test("prompts only when an update exists", () => {
  expect(shouldPrompt({ available: false, id: "a", snooze: null, now: T0 })).toBe(false);
  expect(shouldPrompt({ available: true, id: "a", snooze: null, now: T0 })).toBe(true);
});

test("remind me later: quiet for a few hours, then asks again", () => {
  const snooze = { id: "a", at: T0 };
  expect(shouldPrompt({ available: true, id: "a", snooze, now: T0 + 60_000 })).toBe(false);
  expect(shouldPrompt({ available: true, id: "a", snooze, now: T0 + SNOOZE_MS })).toBe(true);
});

test("a newer update asks straight away, even after remind me later", () => {
  const snooze = { id: "a", at: T0 };
  expect(shouldPrompt({ available: true, id: "b", snooze, now: T0 + 60_000 })).toBe(true);
});

test("never over the gate scanner, and only once signed in unless a build is required", () => {
  expect(promptAllowed({ signedIn: true, pathname: "/today" })).toBe(true);
  expect(promptAllowed({ signedIn: true, pathname: "/scan" })).toBe(false);
  expect(promptAllowed({ signedIn: true, pathname: "/scan", required: true })).toBe(false);
  expect(promptAllowed({ signedIn: false, pathname: "/sign-in" })).toBe(false);
  expect(promptAllowed({ signedIn: false, pathname: "/sign-in", required: true })).toBe(true);
});

test("an over-the-air update shows its download progress, then restarting", () => {
  const idle = { updating: false, pending: false, downloading: false, progress: 0 };
  expect(overTheAirProgress(idle)).toEqual({ bar: false, percent: null, label: "Updating…" });
  expect(overTheAirProgress({ ...idle, updating: true })).toEqual({
    bar: true,
    percent: null,
    label: "Downloading…",
  });
  expect(
    overTheAirProgress({ ...idle, updating: true, downloading: true, progress: 0.416 }),
  ).toEqual({ bar: true, percent: 42, label: "Downloading… 42%" });
  // Out-of-range or missing values never draw a broken bar.
  expect(
    overTheAirProgress({ ...idle, updating: true, downloading: true, progress: 7 }).percent,
  ).toBe(100);
  expect(
    overTheAirProgress({ ...idle, updating: true, downloading: true, progress: Number.NaN })
      .percent,
  ).toBeNull();
  // Already downloaded (or done downloading): only the restart is left.
  expect(overTheAirProgress({ ...idle, updating: true, pending: true })).toEqual({
    bar: false,
    percent: null,
    label: "Restarting…",
  });
});
