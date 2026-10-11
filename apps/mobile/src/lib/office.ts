/** Hostel office helpers with no app dependencies (unit-tested). API calls: office-api.ts. */
import type { DayRule, Role } from "@/lib/types";

export const DAY_LABEL: Record<DayRule["day_type"], string> = {
  weekday: "Weekdays",
  saturday: "Saturday",
  sunday: "Sunday",
  holiday: "Holidays",
};

/** "18:00" -> "6:00 PM" (campus clock values, no time zone involved). */
export function clock(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (h === undefined || m === undefined || Number.isNaN(h) || Number.isNaN(m)) return hhmm;
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** One day's rules in words, as the website's rules form says them. */
export function dayLine(d: DayRule): string {
  const parts = [`${clock(d.opens_at)}–${clock(d.return_by)}`];
  if (d.needs_form) {
    parts.push("needs approval");
    if (d.max_minutes) parts.push(`up to ${Math.round((d.max_minutes / 60) * 10) / 10} h`);
    if (d.no_form_from) parts.push(`no form needed from ${clock(d.no_form_from)}`);
  } else {
    parts.push("no form needed");
  }
  return parts.join(" · ");
}

/** The address a gate's tablet opens. The token stays in the #fragment (never sent to a server). */
export function kioskLink(webUrl: string, token: string): string {
  return `${webUrl}/kiosk#k=${token}`;
}

export function isStaff(role: Role | undefined): boolean {
  return role === "warden" || role === "admin";
}

/** "+919876543210" -> "+91 98765 43210"; anything else is shown as stored. */
export function formatPhone(phone: string): string {
  const india = /^\+91(\d{5})(\d{5})$/.exec(phone);
  return india ? `+91 ${india[1]} ${india[2]}` : phone;
}

/** Where to look at the office first: an unanswered late student, then requests, then the list. */
export function officeStart(o: {
  open_escalations?: number;
  pending_requests?: number;
}): "escalations" | "requests" | "out" {
  if ((o.open_escalations ?? 0) > 0) return "escalations";
  if ((o.pending_requests ?? 0) > 0) return "requests";
  return "out";
}
