import { SLOW_AFTER_MS, startingLines } from "@/lib/starting";

test("a quick start shows only the title", () => {
  expect(startingLines(0)).toEqual({ title: "Starting Lumiback", detail: null });
  expect(startingLines(SLOW_AFTER_MS - 1).detail).toBeNull();
});

test("a slow start says the server is waking and how long it can take", () => {
  const { detail } = startingLines(SLOW_AFTER_MS);
  expect(detail).toContain("waking up");
  expect(detail).toContain("up to a minute");
});
