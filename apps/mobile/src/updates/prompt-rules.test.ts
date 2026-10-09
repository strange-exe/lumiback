import { CHECK_EVERY_MS, shouldCheck, shouldPrompt, SNOOZE_MS } from "./prompt-rules";

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
