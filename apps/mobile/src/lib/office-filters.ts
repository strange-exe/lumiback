import * as SecureStore from "expo-secure-store";

import type { AccountFilter, ScanResult } from "@/lib/types";

/**
 * The office screens' last hostel and filter choices (Students, Scans), so a warden who looks
 * at one hostel opens it again next time. Kept in SecureStore (already a dependency, no native
 * change), validated on the way in and out, and cleared on sign-out and sign-in, so one
 * person's choices never show for the next.
 *
 * Only ids and fixed choices are stored: hostel and gate ids must be UUIDs (anything else is
 * "all"), and a remembered id that isn't in today's list is "all" too (see known()).
 */
export interface OfficeFilters {
  students: { hostel: string; account: "all" | AccountFilter };
  scans: { gate: string; result: "any" | ScanResult };
}
export type OfficeScreen = keyof OfficeFilters;

const KEY = "lumiback.office-filters";
const MAX_LENGTH = 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ACCOUNTS: readonly string[] = ["all", "invited", "off"];
const RESULTS: readonly string[] = [
  "any",
  "accepted",
  "bad_code",
  "gate_off",
  "too_far",
  "weak_gps",
  "mock_gps",
  "not_allowed",
];

export const DEFAULT_OFFICE_FILTERS: OfficeFilters = {
  students: { hostel: "all", account: "all" },
  scans: { gate: "all", result: "any" },
};

/** A UUID (lowercased), or "all". */
function idOrAll(value: unknown): string {
  if (typeof value !== "string") return "all";
  const id = value.trim().toLowerCase();
  return UUID.test(id) ? id : "all";
}

function oneOf<T extends string>(value: unknown, allowed: readonly string[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value) ? (value as T) : fallback;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function clean(raw: unknown): OfficeFilters {
  const all = record(raw);
  const students = record(all.students);
  const scans = record(all.scans);
  return {
    students: {
      hostel: idOrAll(students.hostel),
      account: oneOf(students.account, ACCOUNTS, "all"),
    },
    scans: { gate: idOrAll(scans.gate), result: oneOf(scans.result, RESULTS, "any") },
  };
}

/** The stored choices, keeping only what's valid; anything else gives the defaults. */
export function parseOfficeFilters(raw: string | null): OfficeFilters {
  if (!raw || raw.length > MAX_LENGTH) return DEFAULT_OFFICE_FILTERS;
  try {
    return clean(JSON.parse(raw));
  } catch {
    return DEFAULT_OFFICE_FILTERS;
  }
}

/** The remembered hostel or gate if it's still in the list, else "all". */
export function known(id: string, ids: readonly string[]): string {
  return ids.includes(id) ? id : "all";
}

let current: OfficeFilters | null = null;
let loading: Promise<OfficeFilters> | null = null;

/** Reads storage once per launch; later calls return the choices as they are now. */
export async function loadOfficeFilters(): Promise<OfficeFilters> {
  if (current) return current;
  loading ??= SecureStore.getItemAsync(KEY)
    .then(parseOfficeFilters)
    .catch(() => DEFAULT_OFFICE_FILTERS)
    .then((stored) => (current ??= stored));
  return loading;
}

/** Remembers one screen's choice (validated first). Best effort: storage errors are ignored. */
export async function rememberOfficeFilter<S extends OfficeScreen>(
  screen: S,
  value: OfficeFilters[S],
): Promise<void> {
  const base = await loadOfficeFilters();
  const next = clean({ ...base, [screen]: value });
  current = next;
  await SecureStore.setItemAsync(KEY, JSON.stringify(next)).catch(() => undefined);
}

/** Forgets every choice (sign-out, and a new sign-in). */
export async function clearOfficeFilters(): Promise<void> {
  current = DEFAULT_OFFICE_FILTERS;
  loading = null;
  await SecureStore.deleteItemAsync(KEY).catch(() => undefined);
}
