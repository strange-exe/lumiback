/**
 * The Settings form's kiosk quiet hours: off, or a start and an end time ("HH:MM", IST) that
 * may cross midnight. The API checks the same rules; this gives the admin a plain message first.
 * Pure, so `node --test` can load it.
 */

const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

export type QuietHoursInput =
  { ok: true; from: string | null; until: string | null } | { ok: false; error: string };

/** Browsers send "HH:MM" from a time input; some add seconds ("HH:MM:SS"), which are dropped. */
function clock(value: string): string | null {
  const hhmm = /^\d{2}:\d{2}:[0-5]\d$/.test(value) ? value.slice(0, 5) : value;
  return CLOCK.test(hhmm) ? hhmm : null;
}

export function readQuietHours(on: boolean, from: string, until: string): QuietHoursInput {
  if (!on) return { ok: true, from: null, until: null };
  if (!from.trim() || !until.trim()) {
    return { ok: false, error: "Give both times for quiet hours, or switch them off." };
  }
  const start = clock(from.trim());
  const end = clock(until.trim());
  if (!start || !end) return { ok: false, error: "Enter quiet-hour times like 23:00." };
  if (start === end) {
    return { ok: false, error: "Quiet hours need different start and end times." };
  }
  return { ok: true, from: start, until: end };
}
