/**
 * All outing times are shown in India Standard Time, whatever the device's timezone setting,
 * because hostel rules are in IST. IST has no daylight saving, so +05:30 is always exact.
 */

const ZONE = "Asia/Kolkata";

const timeFormat = new Intl.DateTimeFormat("en-IN", {
  timeZone: ZONE,
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

const dateFormat = new Intl.DateTimeFormat("en-IN", {
  timeZone: ZONE,
  weekday: "short",
  day: "numeric",
  month: "short",
});

/** "8:00 pm" -> split so the period can be typeset smaller. */
export function clockParts(iso: string | Date): { time: string; period: string } {
  const formatted = timeFormat.format(new Date(iso)).replace(/ /g, " ");
  const [time, period = ""] = formatted.split(" ");
  return { time, period: period.toUpperCase() };
}

export function formatTime(iso: string | Date): string {
  const { time, period } = clockParts(iso);
  return `${time} ${period}`;
}

export function formatDay(iso: string | Date): string {
  return dateFormat.format(new Date(iso));
}

const longDateFormat = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  day: "numeric",
  month: "long",
  year: "numeric",
});

/** "6 October 2026" */
export function formatDate(iso: string | Date): string {
  return longDateFormat.format(new Date(iso));
}

/** "2 h 15 min", "45 min" */
export function formatMinutes(total: number): string {
  if (total < 1) return "under a minute";
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return `${minutes} min`;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

// ---------- datetime-local inputs, always IST ----------

const IST_OFFSET_MS = 330 * 60_000;
const LOCAL_INPUT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** An instant as IST wall time for a datetime-local input: "2026-11-06T19:40". */
export function istInputValue(when: string | Date): string {
  return new Date(new Date(when).getTime() + IST_OFFSET_MS).toISOString().slice(0, 16);
}

/** An instant as an ISO string in IST: "2026-11-06T19:40:00+05:30". */
export function istIso(ms: number): string {
  return `${new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 19)}+05:30`;
}

/**
 * A datetime-local value read as IST wall time (whatever the browser's timezone), as an ISO
 * string with +05:30; null if it isn't a real date and time.
 *
 * The input only has minutes, so a time in the same minute as `notBefore` (e.g. when they
 * left, at 7:40:30 PM) that falls before it means `notBefore` itself, not "before they left".
 */
export function istInputToIso(value: string, notBefore?: string | null): string | null {
  const match = LOCAL_INPUT.exec(value.trim());
  if (!match) return null;
  const [y, mo, d, h, mi, s] = match.slice(1).map((part) => Number(part ?? "0"));
  if (h > 23 || mi > 59 || s > 59) return null;
  const wall = Date.UTC(y, mo - 1, d, h, mi, s);
  const check = new Date(wall);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
    return null; // e.g. 31 November
  }
  const at = wall - IST_OFFSET_MS;
  if (notBefore) {
    const floor = Date.parse(notBefore); // whole milliseconds: the server keeps microseconds
    if (Number.isFinite(floor) && at <= floor && istInputValue(new Date(floor)) === value.trim()) {
      return notBefore; // exactly as the server sent it, so it is never a moment too early
    }
  }
  return istIso(at);
}

/** Fraction of the planned outing that has elapsed, clamped to [0, 1]. */
export function progress(leftAt: string, expectedAt: string, now: Date = new Date()): number {
  const start = new Date(leftAt).getTime();
  const end = new Date(expectedAt).getTime();
  if (end <= start) return 1;
  return Math.min(1, Math.max(0, (now.getTime() - start) / (end - start)));
}
