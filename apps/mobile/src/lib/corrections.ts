/**
 * Outing corrections, as pure functions (no Expo or API imports) so they are unit-tested.
 *
 * Times are entered and shown on the campus clock (IST, UTC+5:30, no daylight saving),
 * whatever the phone's own timezone is set to: the conversion here never reads the device zone.
 */
import type { Correction, CorrectionKind, Outing } from "@/lib/types";

const IST_MS = 330 * 60_000;
const DAY_MS = 86_400_000;
/** A student can ask about their open outing, or one that ended this recently (the server's
 * STUDENT_CAN_ASK_FOR). */
export const STUDENT_ASK_DAYS = 7;
/** How many days a return can be put on: from the day they left, up to today. */
const MAX_DAY_CHOICES = 8;

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function ms(t: string | Date | number): number {
  return typeof t === "number" ? t : new Date(t).getTime();
}

/** The campus-clock date of an instant, as YYYY-MM-DD. */
export function istDay(t: string | Date | number): string {
  return new Date(ms(t) + IST_MS).toISOString().slice(0, 10);
}

/** Minutes after midnight on the campus clock. */
export function istMinutes(t: string | Date | number): number {
  const shifted = new Date(ms(t) + IST_MS);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

/** "7:05 pm" on the campus clock: the same form `parseClock` reads back. */
export function clockText(t: string | Date | number): string {
  return minutesText(istMinutes(t));
}

function minutesText(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
}

/**
 * A typed time of day -> minutes after midnight, or null. Takes "7:40 pm", "7.40pm", "7 pm",
 * "12:15 am" and the 24-hour "19:40". A bare "7" is ambiguous and refused.
 */
export function parseClock(text: string): number | null {
  const match = /^(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?$/i.exec(text.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = match[2] === undefined ? 0 : Number(match[2]);
  const period = match[3]?.toLowerCase().replace(/\./g, "");
  if (minute > 59) return null;
  if (period) {
    if (hour < 1 || hour > 12) return null;
    return ((hour % 12) + (period === "pm" ? 12 : 0)) * 60 + minute;
  }
  if (match[2] === undefined || hour > 23) return null;
  return hour * 60 + minute;
}

/** A campus-clock date and time -> an ISO instant with the +05:30 offset the API expects. */
export function istInstant(day: string, minutes: number): string {
  const hh = String(Math.floor(minutes / 60)).padStart(2, "0");
  const mm = String(minutes % 60).padStart(2, "0");
  return `${day}T${hh}:${mm}:00+05:30`;
}

/** "Tue 4 Nov" for a YYYY-MM-DD date. */
export function dayText(day: string): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  return `${WEEKDAYS[date.getUTCDay()]} ${d} ${MONTHS[m - 1]}`;
}

function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The days a return can be put on, oldest first: the day they left, then each day after, up to
 * today (at most eight). Labelled "Today" and "Yesterday" where that's what they are.
 */
export function dayChoices(
  leftAt: string,
  now: number = Date.now(),
): { value: string; label: string }[] {
  const today = istDay(now);
  const choices: { value: string; label: string }[] = [];
  for (let day = istDay(leftAt); day <= today && choices.length < MAX_DAY_CHOICES;) {
    const label = day === today ? "Today" : day === addDays(today, -1) ? "Yesterday" : dayText(day);
    choices.push({ value: day, label });
    day = addDays(day, 1);
  }
  return choices;
}

/**
 * The return time to send, from the chosen day and the typed time, or what's wrong with it in
 * words. The server checks again (and also that it's before the next outing started).
 */
export function returnAt(
  day: string,
  typed: string,
  leftAt: string,
  now: number = Date.now(),
): { iso: string } | { error: string } {
  const minutes = parseClock(typed);
  if (minutes === null) return { error: "Type the time like 7:40 pm." };
  const iso = istInstant(day, minutes);
  if (ms(iso) < ms(leftAt)) {
    return {
      error: `That's before the outing started (${dayText(istDay(leftAt))}, ${clockText(leftAt)}). Choose a later time.`,
    };
  }
  if (ms(iso) > now) return { error: "That time hasn't come yet. Choose a time up to now." };
  return { iso };
}

/** What's wrong with a reason, or null (the server's limits: 3 to 300 characters). */
export function reasonError(reason: string): string | null {
  const length = reason.trim().length;
  if (length < 3) return "Say briefly what happened.";
  if (length > 300) return "Keep the reason under 300 characters.";
  return null;
}

/** A trip the office cancelled as a mistaken tap. */
export function isCancelled(outing: Pick<Outing, "correction">): boolean {
  return outing.correction?.kind === "cancel" && outing.correction.status === "approved";
}

/**
 * Can the student ask the office to correct this outing? Open, or ended in the last 7 days;
 * not while an ask about it is waiting, and not once it's cancelled (there's nothing left to fix).
 */
export function canAsk(
  outing: Pick<Outing, "returned_at" | "correction">,
  now: number = Date.now(),
): boolean {
  if (outing.correction?.status === "pending") return false;
  if (isCancelled(outing)) return false;
  if (outing.returned_at === null) return true;
  return now - ms(outing.returned_at) <= STUDENT_ASK_DAYS * DAY_MS;
}

/** The time correction that fits the outing: record the return of an open one, or change it. */
export function timeKind(outing: Pick<Outing, "returned_at">): Exclude<CorrectionKind, "cancel"> {
  return outing.returned_at === null ? "return" : "return_time";
}

/** A correction's state on a student's trip, in words, or null when there's nothing to say. */
export function correctionStatus(
  c: Correction | null | undefined,
): { label: string; tone: "accent" | "good" | "danger" | "muted"; detail: string | null } | null {
  if (!c) return null;
  switch (c.status) {
    case "pending":
      return {
        label: "Correction asked",
        tone: "accent",
        detail: "Waiting for the hostel office.",
      };
    case "approved":
      return {
        label: "Corrected by the office",
        tone: "good",
        detail: c.by_staff ? c.reason : (c.note ?? "Your correction was approved."),
      };
    case "declined":
      return {
        label: "Correction declined",
        tone: "danger",
        detail: c.note ?? "Ask the hostel office if you have questions.",
      };
    case "cancelled":
      return null; // the office corrected the outing instead: that newer change is shown
  }
}

/** What a correction asks for, in a line: "Came back Tue 4 Nov, 7:40 pm" or "The trip didn't
 * happen". */
export function correctionAsk(c: Pick<Correction, "kind" | "returned_at">): string {
  if (c.kind === "cancel" || !c.returned_at) return "The trip didn't happen";
  return `Came back ${dayText(istDay(c.returned_at))}, ${clockText(c.returned_at)}`;
}
