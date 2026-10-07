import { formatDay, formatTime } from "@/features/outings/time";

const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" });

/** "8:30 PM" today; "Mon 6 Oct, 8:30 PM" otherwise. Always IST. */
export function formatWhen(iso: string, now: Date = new Date()): string {
  const sameDay = dayKey.format(new Date(iso)) === dayKey.format(now);
  return sameDay ? formatTime(iso) : `${formatDay(iso)}, ${formatTime(iso)}`;
}

/** Today's date in IST as YYYY-MM-DD (for date inputs). */
export function istToday(now: Date = new Date()): string {
  return dayKey.format(now);
}
