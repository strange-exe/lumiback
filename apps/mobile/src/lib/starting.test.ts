import {
  firstName,
  handoffSteps,
  SLOW_AFTER_MS,
  startingLines,
  waitedLabel,
  WOKE_AFTER_MS,
} from "@/lib/starting";

test("a quick start shows only the title", () => {
  expect(startingLines(0)).toEqual({ title: "Starting", detail: null });
  expect(startingLines(SLOW_AFTER_MS - 1).detail).toBeNull();
});

test("a slow start says the server is waking, how long it can take, and that it moves on", () => {
  const { title, detail } = startingLines(SLOW_AFTER_MS);
  expect(title).toBe("Waking the server");
  expect(detail).toContain("up to a minute");
  expect(detail).toContain("moves on by itself");
});

test("the waited clock counts minutes and seconds", () => {
  expect(waitedLabel(0)).toBe("0:00");
  expect(waitedLabel(7_900)).toBe("0:07");
  expect(waitedLabel(62_000)).toBe("1:02");
  expect(waitedLabel(-5)).toBe("0:00");
});

test("first names come from the first word only", () => {
  expect(firstName("Riya Sharma")).toBe("Riya");
  expect(firstName("  Ishaan  ")).toBe("Ishaan");
  expect(firstName("")).toBeNull();
  expect(firstName("   ")).toBeNull();
  expect(firstName(null)).toBeNull();
});

test("a woken server plays started, signing in, welcome back", () => {
  const steps = handoffSteps("signedIn", WOKE_AFTER_MS, "Riya Sharma");
  expect(steps.map((s) => s.line)).toEqual([
    "Server started",
    "Signing you in",
    "Welcome back, Riya",
  ]);
  for (const s of steps) expect(s.holdMs).toBeGreaterThan(0);
  // The whole hand-off stays short: under two and a half seconds of holds.
  expect(steps.reduce((t, s) => t + s.holdMs, 0)).toBeLessThan(2_500);
});

test("an awake server only says welcome back", () => {
  expect(handoffSteps("signedIn", WOKE_AFTER_MS - 1, "Riya").map((s) => s.line)).toEqual([
    "Welcome back, Riya",
  ]);
  expect(handoffSteps("signedIn", 0, null).map((s) => s.line)).toEqual(["Welcome back"]);
});

test("a refused session says the server started, then goes to sign-in; nothing else claims a sign-in", () => {
  expect(handoffSteps("signedOut", WOKE_AFTER_MS, "Riya").map((s) => s.line)).toEqual([
    "Server started",
  ]);
  // No stored session, or the server was awake: straight to the sign-in form.
  expect(handoffSteps("signedOut", 10, null)).toEqual([]);
});

test("offline plays nothing: the can't-reach screen takes over", () => {
  expect(handoffSteps("offline", 60_000, "Riya")).toEqual([]);
});
