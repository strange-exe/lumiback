/**
 * Calendar days from a URL (YYYY-MM-DD). Pure (no Next.js imports) so it runs under `node --test`.
 */

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A real calendar date: "2026-02-30" and other roll-overs are refused. */
export function isRealDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
}

/**
 * The day to show on a "today by default" page: an earlier real day, or null for today (also
 * for a future day or anything malformed). ISO dates compare correctly as strings.
 */
export function pastDay(value: unknown, today: string): string | null {
  return isRealDate(value) && value < today ? value : null;
}
