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

/** Fraction of the planned outing that has elapsed, clamped to [0, 1]. */
export function progress(leftAt: string, expectedAt: string, now: Date = new Date()): number {
  const start = new Date(leftAt).getTime();
  const end = new Date(expectedAt).getTime();
  if (end <= start) return 1;
  return Math.min(1, Math.max(0, (now.getTime() - start) / (end - start)));
}
