import {
  allSwitchesOn,
  DEFAULT_PREFS,
  loadPrefs,
  notificationSwitches,
  parsePrefs,
  setPrefs,
} from "@/lib/prefs";

const mockGetItem = jest.fn(async (): Promise<string | null> => null);
const mockSetItem = jest.fn(async (_key: string, _value: string) => undefined);
jest.mock("expo-secure-store", () => ({
  getItemAsync: () => mockGetItem(),
  setItemAsync: (key: string, value: string) => mockSetItem(key, value),
}));

// loadPrefs no longer applies light or dark: the root layout must call applyStoredAppearance on
// every mount (an Activity relaunch resets the mode natively), or the stored choice is never used.
test("the root layout applies the stored light or dark on each mount", () => {
  const { readFileSync } = jest.requireActual<typeof import("fs")>("fs");
  const { join } = jest.requireActual<typeof import("path")>("path");
  const source = readFileSync(join(__dirname, "..", "app", "_layout.tsx"), "utf8");
  expect(source).toMatch(
    /useEffect\(\(\) => \{\s*void applyStoredAppearance\(\)\.finally\(\(\) => setPrefsLoaded\(true\)\);\s*\}, \[\]\);/,
  );
});

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

test("the hostel board switch: on by default, kept when off, and survives a round trip", () => {
  expect(DEFAULT_PREFS.hostelBoard).toBe(true);
  // Prefs saved before the hostel board existed have no such key: it loads as on.
  const before = JSON.stringify({ followRequests: false, onboarded: true });
  expect(parsePrefs(before).hostelBoard).toBe(true);
  expect(parsePrefs(JSON.stringify({ hostelBoard: "off" })).hostelBoard).toBe(true);
  const off = { ...DEFAULT_PREFS, hostelBoard: false };
  expect(parsePrefs(JSON.stringify(off))).toEqual(off);
});

test("the hostel board switch shows for students only, and counts in 'All on' only for them", () => {
  expect(notificationSwitches(true)).toEqual([
    "followRequests",
    "returnReminders",
    "shareStatus",
    "hostelBoard",
  ]);
  expect(notificationSwitches(false)).toEqual(["followRequests", "returnReminders", "shareStatus"]);
  const boardOff = { ...DEFAULT_PREFS, hostelBoard: false };
  expect(allSwitchesOn(DEFAULT_PREFS, true)).toBe(true);
  expect(allSwitchesOn(boardOff, true)).toBe(false);
  expect(allSwitchesOn(boardOff, false)).toBe(true);
  expect(allSwitchesOn({ ...DEFAULT_PREFS, shareStatus: false }, false)).toBe(false);
});

test("the colour theme: Gate glass by default, a stored choice kept, anything else back to Gate glass", () => {
  expect(DEFAULT_PREFS.theme).toBe("gate");
  // Prefs saved before themes existed have no such key: everyone starts on Gate glass.
  expect(parsePrefs(JSON.stringify({ appearance: "dark" })).theme).toBe("gate");
  for (const theme of ["gate", "led", "dusk"]) {
    expect(parsePrefs(JSON.stringify({ theme })).theme).toBe(theme);
  }
  for (const bad of ["purple", "LED", "", 3, null, ["dusk"], { name: "dusk" }]) {
    expect(parsePrefs(JSON.stringify({ theme: bad })).theme).toBe("gate");
  }
});

test("a chosen theme is saved with the other prefs and survives a reload", async () => {
  await setPrefs({ theme: "dusk" });
  const [, saved] = mockSetItem.mock.calls.at(-1)!;
  expect(JSON.parse(saved).theme).toBe("dusk");
  expect(parsePrefs(saved).theme).toBe("dusk");
  expect((await loadPrefs()).theme).toBe("dusk");
});

test.each([
  ["dark", "dark"],
  ["light", "light"],
  ["system", "unspecified"],
] as const)(
  "a stored %s choice is applied again each time the root layout mounts",
  async (appearance, native) => {
    // Android recreates the Activity after a font or display size change while the JS process
    // lives on, and expo-system-ui resets the night mode to app.json's in every Activity
    // onCreate: applying the choice once per process left a stored "Dark" rendering light.
    await jest.isolateModulesAsync(async () => {
      const { Appearance } = jest.requireActual<typeof import("react-native")>("react-native");
      const set = jest.spyOn(Appearance, "setColorScheme").mockImplementation(() => undefined);
      mockGetItem.mockResolvedValueOnce(JSON.stringify({ appearance }));
      const prefs = jest.requireActual<typeof import("@/lib/prefs")>("@/lib/prefs");
      await prefs.applyStoredAppearance(); // the first mount
      await prefs.applyStoredAppearance(); // the mount after an Activity relaunch
      expect(set.mock.calls).toEqual([[native], [native]]);
    });
  },
);
