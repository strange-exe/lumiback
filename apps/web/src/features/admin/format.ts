import { formatDay, formatTime } from "@/features/outings/time";

const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" });

/** "8:00 PM" today; "Mon 6 Oct, 8:00 PM" otherwise. Always IST. */
export function formatWhen(iso: string, now: Date = new Date()): string {
  const sameDay = dayKey.format(new Date(iso)) === dayKey.format(now);
  return sameDay ? formatTime(iso) : `${formatDay(iso)}, ${formatTime(iso)}`;
}

/** "+919876543210" -> "+91 98765 43210" (Indian mobiles); other numbers as stored. */
export function formatPhone(phone: string): string {
  if (phone.startsWith("+91") && phone.length === 13) {
    return `+91 ${phone.slice(3, 8)} ${phone.slice(8)}`;
  }
  return phone;
}

/** "3 h", "1 h 30 min" from minutes. */
export function formatHours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return [h ? `${h} h` : "", m ? `${m} min` : ""].filter(Boolean).join(" ");
}

/** Today's date in IST as YYYY-MM-DD (for date inputs). */
export function istToday(now: Date = new Date()): string {
  return dayKey.format(now);
}
