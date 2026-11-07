import {
  clearOfficeFilters,
  DEFAULT_OFFICE_FILTERS,
  known,
  loadOfficeFilters,
  parseOfficeFilters,
  rememberOfficeFilter,
} from "@/lib/office-filters";

const store = new Map<string, string>();
const mockGetItem = jest.fn(async (key: string): Promise<string | null> => store.get(key) ?? null);
const mockSetItem = jest.fn(async (key: string, value: string) => {
  store.set(key, value);
});
const mockDeleteItem = jest.fn(async (key: string) => {
  store.delete(key);
});
jest.mock("expo-secure-store", () => ({
  getItemAsync: (key: string) => mockGetItem(key),
  setItemAsync: (key: string, value: string) => mockSetItem(key, value),
  deleteItemAsync: (key: string) => mockDeleteItem(key),
}));

const HOSTEL = "5f0c2a1e-0000-4000-8000-000000000001";
const GATE = "5f0c2a1e-0000-4000-8000-000000000002";

test("missing, broken or foreign storage gives the defaults", () => {
  expect(parseOfficeFilters(null)).toEqual(DEFAULT_OFFICE_FILTERS);
  expect(parseOfficeFilters("{not json")).toEqual(DEFAULT_OFFICE_FILTERS);
  expect(parseOfficeFilters("[]")).toEqual(DEFAULT_OFFICE_FILTERS);
  expect(parseOfficeFilters("x".repeat(2000))).toEqual(DEFAULT_OFFICE_FILTERS);
});

test("only UUIDs and the fixed choices are kept; anything else falls back to all", () => {
  const raw = JSON.stringify({
    students: { hostel: HOSTEL.toUpperCase(), account: "invited", extra: 1 },
    scans: { gate: GATE, result: "too_far" },
    other: { x: 1 },
  });
  expect(parseOfficeFilters(raw)).toEqual({
    students: { hostel: HOSTEL, account: "invited" },
    scans: { gate: GATE, result: "too_far" },
  });
  const bad = JSON.stringify({
    students: { hostel: "../admin", account: "deleted" },
    scans: { gate: 7, result: "accepted;drop" },
  });
  expect(parseOfficeFilters(bad)).toEqual(DEFAULT_OFFICE_FILTERS);
});

test("a remembered hostel or gate that isn't in the list now is all", () => {
  expect(known(HOSTEL, [HOSTEL])).toBe(HOSTEL);
  expect(known(HOSTEL, [GATE])).toBe("all");
  expect(known("all", [])).toBe("all");
});

test("a choice is remembered per screen, read back after a restart, and cleared", async () => {
  await rememberOfficeFilter("students", { hostel: HOSTEL, account: "off" });
  await rememberOfficeFilter("scans", { gate: GATE, result: "accepted" });
  expect(await loadOfficeFilters()).toEqual({
    students: { hostel: HOSTEL, account: "off" },
    scans: { gate: GATE, result: "accepted" },
  });
  const stored = parseOfficeFilters([...store.values()][0] ?? null);
  expect(stored.students.hostel).toBe(HOSTEL);

  await clearOfficeFilters();
  expect(store.size).toBe(0);
  expect(await loadOfficeFilters()).toEqual(DEFAULT_OFFICE_FILTERS);
});

test("an invalid choice is never written", async () => {
  await clearOfficeFilters();
  mockSetItem.mockClear();
  await rememberOfficeFilter("students", { hostel: "not-a-uuid", account: "off" });
  expect(await loadOfficeFilters()).toEqual({
    ...DEFAULT_OFFICE_FILTERS,
    students: { hostel: "all", account: "off" },
  });
  expect(store.get([...store.keys()][0]!)).not.toContain("not-a-uuid");
});
