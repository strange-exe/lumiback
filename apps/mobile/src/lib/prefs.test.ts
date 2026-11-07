import { DEFAULT_PREFS, loadPrefs, parsePrefs, setPrefs } from "@/lib/prefs";

const mockGetItem = jest.fn(async (): Promise<string | null> => null);
const mockSetItem = jest.fn(async () => undefined);
jest.mock("expo-secure-store", () => ({
  getItemAsync: () => mockGetItem(),
  setItemAsync: () => mockSetItem(),
}));

test("loadPrefs returns the switches as they are now, after a change, without reading storage again", async () => {
  expect((await loadPrefs()).followRequests).toBe(true);
  await setPrefs({ followRequests: false });
  expect((await loadPrefs()).followRequests).toBe(false);
  await setPrefs({ returnReminders: false });
  expect((await loadPrefs()).returnReminders).toBe(false);
  expect(mockGetItem).toHaveBeenCalledTimes(1);
});

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
