/**
 * Remembered filters for the hostel office's lists (Register, People, Scans, Escalations): the
 * last hostel or filter chosen on each comes back on the next visit. One small cookie holds
 * them, read only by the server (httpOnly), cleared on sign-out and on a fresh sign-in.
 *
 * - Choosing a filter goes through /admin/filter (a Route Handler: Server Components can't set
 *   cookies), which remembers the choice and opens the page with it in the address.
 * - The address always wins: a visit with any filter, search or page in it shows exactly that.
 *   Only a bare visit (/admin/scans) uses what was remembered.
 * - Choosing "All" is the reset: that page's entry is removed.
 * - Everything read back is checked against a fixed allowlist: hostel and gate ids must be
 *   UUIDs, other values come from fixed lists. Anything else is ignored.
 *
 * Requests is not remembered on purpose: its only choice is a past day, and opening Requests on
 * an old day would hide today's waiting requests.
 *
 * Pure (no Next.js imports), so `node --test` can load it.
 */

import { isUuid } from "./ids.ts";

export const FILTERS_COOKIE = "lb_office_filters";
/** About a term; each choice renews it. */
export const FILTERS_MAX_AGE = 90 * 24 * 60 * 60;
/** Longer than any valid value (about 250 characters with every page remembered). */
const MAX_COOKIE_CHARS = 1024;
/** The People search box's own limit. */
const MAX_Q = 100;

export type FilterView = "register" | "people" | "scans" | "escalations";
export type FilterValues = Readonly<Record<string, string>>;
export type Remembered = Readonly<Partial<Record<FilterView, FilterValues>>>;

/** A field's check: the value to keep, or null when it's the default or not allowed. */
type Check = (value: unknown) => string | null;

const oneOf =
  (...allowed: string[]): Check =>
  (value) =>
    typeof value === "string" && allowed.includes(value) ? value : null;
const uuid: Check = (value) => (isUuid(value) ? value.toLowerCase() : null);

interface ViewSpec {
  path: string;
  /** The remembered fields, in address order. Defaults ("all", "open") are never stored. */
  fields: Readonly<Record<string, Check>>;
  /** Other address keys that make a visit explicit (a search, a page of older scans). */
  explicit: readonly string[];
}

export const VIEWS: Readonly<Record<FilterView, ViewSpec>> = {
  register: { path: "/admin", fields: { state: oneOf("overdue", "out") }, explicit: [] },
  people: {
    path: "/admin/people",
    fields: { hostel: uuid, account: oneOf("invited", "off") },
    explicit: ["q"],
  },
  scans: {
    path: "/admin/scans",
    fields: {
      gate: uuid,
      result: oneOf("accepted", "bad_code", "gate_off", "too_far", "weak_gps", "mock_gps"),
    },
    explicit: ["before"],
  },
  escalations: { path: "/admin/escalations", fields: { state: oneOf("all") }, explicit: [] },
};

export function filterView(value: unknown): FilterView | null {
  return value === "register" || value === "people" || value === "scans" || value === "escalations"
    ? value
    : null;
}

/** The valid, non-default values among `input` (an address's query or a stored entry). */
export function chosenFrom(
  view: FilterView,
  input: Readonly<Record<string, unknown>>,
): FilterValues {
  const out: Record<string, string> = {};
  for (const [field, check] of Object.entries(VIEWS[view].fields)) {
    if (!Object.hasOwn(input, field)) continue;
    const value = check(input[field]);
    if (value !== null) out[field] = value;
  }
  return out;
}

/** The cookie's value, read defensively: anything malformed is simply not remembered. */
export function parseFilters(raw: string | null | undefined): Remembered {
  if (!raw || raw.length > MAX_COOKIE_CHARS) return {};
  let stored: unknown;
  try {
    stored = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
  const out: Partial<Record<FilterView, FilterValues>> = {};
  for (const view of Object.keys(VIEWS) as FilterView[]) {
    if (!Object.hasOwn(stored, view)) continue;
    const entry = (stored as Record<string, unknown>)[view];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const values = chosenFrom(view, entry as Record<string, unknown>);
    if (Object.keys(values).length > 0) out[view] = values;
  }
  return out;
}

export function serializeFilters(remembered: Remembered): string {
  return JSON.stringify(remembered);
}

/** `remembered` with this page's choice (an empty choice removes the page's entry). */
export function remember(
  remembered: Remembered,
  view: FilterView,
  values: FilterValues,
): Remembered {
  const next: Partial<Record<FilterView, FilterValues>> = { ...remembered };
  if (Object.keys(values).length > 0) next[view] = values;
  else delete next[view];
  return next;
}

/** The address names a filter, a search or a page: show exactly that. */
export function isExplicit(view: FilterView, query: Readonly<Record<string, unknown>>): boolean {
  const spec = VIEWS[view];
  return [...Object.keys(spec.fields), ...spec.explicit].some((key) => Object.hasOwn(query, key));
}

/** What a page shows: the address's filters, or on a bare visit the remembered ones. */
export function resolveFilters(
  view: FilterView,
  query: Readonly<Record<string, unknown>>,
  remembered: Remembered,
): { values: FilterValues; remembered: boolean } {
  if (isExplicit(view, query)) return { values: chosenFrom(view, query), remembered: false };
  const kept = remembered[view];
  return kept && Object.keys(kept).length > 0
    ? { values: kept, remembered: true }
    : { values: {}, remembered: false };
}

function search(view: FilterView, values: FilterValues, extra?: { q?: string }): URLSearchParams {
  const query = new URLSearchParams();
  const clean = chosenFrom(view, values);
  for (const field of Object.keys(VIEWS[view].fields)) {
    if (clean[field]) query.set(field, clean[field]);
  }
  const q = extra?.q?.trim().slice(0, MAX_Q);
  if (view === "people" && q) query.set("q", q);
  return query;
}

/** The page itself with these filters (and, on People, a search). */
export function pageHref(view: FilterView, values: FilterValues, extra?: { q?: string }): string {
  const query = search(view, values, extra).toString();
  return query ? `${VIEWS[view].path}?${query}` : VIEWS[view].path;
}

/** A filter link: remembers the choice, then opens the page with it (app/(admin)/admin/filter). */
export function filterHref(view: FilterView, values: FilterValues, extra?: { q?: string }): string {
  const query = search(view, values, extra);
  const all = new URLSearchParams({ view });
  for (const [key, value] of query) all.append(key, value);
  return `/admin/filter?${all.toString()}`;
}
