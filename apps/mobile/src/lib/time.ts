/**
 * All outing times are shown in India Standard Time, whatever the device's timezone setting,
 * because the campus runs on IST. IST has no daylight saving, so +05:30 is always exact.
 */

const ZONE = "Asia/Kolkata";
const IST_OFFSET = "+05:30";

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

const partsFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** "8:30 pm" -> split so the period can be typeset smaller. */
export function clockParts(iso: string | Date): { time: string; period: string } {
  const formatted = timeFormat.format(new Date(iso)).replace(/ /g, " ");
  const [time = formatted, period = ""] = formatted.split(" ");
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

/**
 * Turn the check-out choice into an absolute instant.
 * - "60" / "120" / "180": minutes from now
 * - "HH:MM": that clock time in IST, today, or tomorrow if it has already passed
 */
export function expectedReturn(choice: string, now: Date = new Date()): Date | null {
  if (/^\d{1,4}$/.test(choice)) {
    const minutes = Number(choice);
    return minutes > 0 ? new Date(now.getTime() + minutes * 60_000) : null;
  }
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(choice);
  if (!match) return null;
  const today = partsFormat.format(now); // YYYY-MM-DD in IST
  let target = new Date(`${today}T${match[1]}:${match[2]}:00${IST_OFFSET}`);
  if (target.getTime() <= now.getTime() + 60_000) {
    target = new Date(target.getTime() + 24 * 60 * 60_000);
  }
  return target;
}

/** Fraction of the planned outing that has elapsed, clamped to [0, 1]. */
export function progress(leftAt: string, expectedAt: string, now: Date = new Date()): number {
  const start = new Date(leftAt).getTime();
  const end = new Date(expectedAt).getTime();
  if (end <= start) return 1;
  return Math.min(1, Math.max(0, (now.getTime() - start) / (end - start)));
}
