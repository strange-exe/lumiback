import { createWakeGate, WAKE_EVERY_MS } from "@/lib/wake";

test("the first wake goes out at once", () => {
  const gate = createWakeGate();
  expect(gate.shouldWake(1_000)).toBe(true);
});

test("a second trigger within a minute is skipped, whichever screen asked", () => {
  const gate = createWakeGate();
  expect(gate.shouldWake(10_000)).toBe(true); // the app came to the foreground
  expect(gate.shouldWake(10_500)).toBe(false); // the scanner opened right after
  expect(gate.shouldWake(10_000 + WAKE_EVERY_MS - 1)).toBe(false);
});

test("once the minute has passed it wakes again, and the minute restarts from then", () => {
  const gate = createWakeGate();
  expect(gate.shouldWake(0)).toBe(true);
  expect(gate.shouldWake(WAKE_EVERY_MS)).toBe(true);
  expect(gate.shouldWake(WAKE_EVERY_MS + 30_000)).toBe(false);
  expect(gate.shouldWake(2 * WAKE_EVERY_MS)).toBe(true);
});

test("a skipped trigger doesn't push the next wake later", () => {
  const gate = createWakeGate(60_000);
  expect(gate.shouldWake(0)).toBe(true);
  expect(gate.shouldWake(59_000)).toBe(false);
  expect(gate.shouldWake(60_000)).toBe(true);
});

test("a clock that jumps back doesn't block waking for long", () => {
  const gate = createWakeGate(60_000);
  expect(gate.shouldWake(500_000)).toBe(true);
  // The phone's clock was corrected backwards: treat it as a fresh start, not "in the future".
  expect(gate.shouldWake(100_000)).toBe(true);
  expect(gate.shouldWake(100_500)).toBe(false);
});

test("the interval is about a minute", () => {
  expect(WAKE_EVERY_MS).toBe(60_000);
});
