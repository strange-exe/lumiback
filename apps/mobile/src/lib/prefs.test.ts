import { DEFAULT_PREFS, parsePrefs } from "@/lib/prefs";

jest.mock("expo-secure-store", () => ({}));

test("missing or broken storage gives the defaults", () => {
  expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
  expect(parsePrefs("{not json")).toEqual(DEFAULT_PREFS);
  expect(parsePrefs("[]")).toEqual(DEFAULT_PREFS);
});

test("stored values override defaults; unknown or wrongly typed values are ignored", () => {
  const raw = JSON.stringify({
    appearance: "dark",
    followRequests: false,
    returnReminders: "no",
    onboarded: true,
    extra: 1,
  });
  expect(parsePrefs(raw)).toEqual({
    ...DEFAULT_PREFS,
    appearance: "dark",
    followRequests: false,
    onboarded: true,
  });
  expect(parsePrefs(JSON.stringify({ appearance: "purple" })).appearance).toBe("system");
});
