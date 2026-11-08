/** Hostel office helpers with no app dependencies (unit-tested). API calls: office-api.ts. */
import type {
  AccountFilter,
  AccountState,
  DayRule,
  OfficeScan,
  Role,
  ScanResult,
} from "@/lib/types";

/** What each scan result means, in the website's words. */
export const SCAN_RESULT_LABEL: Record<ScanResult, string> = {
  accepted: "Accepted",
  bad_code: "Invalid or old code",
  gate_off: "Gate switched off",
  too_far: "Too far from the gate",
  weak_gps: "GPS too weak",
  mock_gps: "Mock location",
  not_allowed: "Outside the outing rules",
};

const SCANS_PER_PAGE = 30;

/** The query for one page of the scan log; filters left unset are left out. */
export function scanQuery(filter: {
  before?: number | null;
  gateId?: string | null;
  result?: ScanResult | null;
}): string {
  const query = new URLSearchParams({ limit: String(SCANS_PER_PAGE) });
  if (filter.before != null) query.set("before", String(filter.before));
  if (filter.gateId) query.set("gate_id", filter.gateId);
  if (filter.result) query.set("result", filter.result);
  return query.toString();
}

/** The students list's query string ("" or "?..."); searches under 2 letters are left out, as
 * the API ignores them. */
export function studentsQuery(filter: {
  hostelId?: string | null;
  q?: string;
  account?: AccountFilter | null;
}): string {
  const query = new URLSearchParams();
  if (filter.hostelId) query.set("hostel_id", filter.hostelId);
  if (filter.q && filter.q.trim().length >= 2) query.set("q", filter.q.trim());
  if (filter.account) query.set("account", filter.account);
  const qs = query.toString();
  return qs ? `?${qs}` : "";
}

/** "12 m from the gate (GPS ±9 m)"; null when the scan had no position (a bad code). */
export function scanDistance(scan: Pick<OfficeScan, "distance_m" | "accuracy_m">): string | null {
  if (scan.distance_m === null) return null;
  const accuracy = scan.accuracy_m === null ? "" : ` (GPS ±${Math.round(scan.accuracy_m)} m)`;
  return `${Math.round(scan.distance_m)} m from the gate${accuracy}`;
}

/** Today's date on the campus clock (IST, UTC+5:30, no daylight saving), as YYYY-MM-DD. */
export function campusToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

/** A typed holiday date: "25/12/2026" (day first, as written in India) or "2026-12-25".
 * `today` is campusToday(); a holiday can't be added for a day that has passed. */
export function parseHolidayDate(
  input: string,
  today: string,
): { day: string } | { error: string } {
  const text = input.trim();
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const parts = dmy ? [dmy[3], dmy[2], dmy[1]] : iso ? [iso[1], iso[2], iso[3]] : null;
  if (!parts) return { error: "Type the date as day/month/year, for example 25/12/2026." };
  const [y, m, d] = parts.map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  if (
    y < 2020 ||
    y > 2100 ||
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  ) {
    return { error: "That date doesn't exist. Check the day and month." };
  }
  const day = date.toISOString().slice(0, 10);
  if (day < today) return { error: "That date has passed. Pick today or a later date." };
  return { day };
}

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

/** Admin powers: admins, and developers (who have every admin power). */
export function isAdmin(role: Role | undefined): boolean {
  return role === "admin" || role === "developer";
}

export function isStaff(role: Role | undefined): boolean {
  return role === "warden" || role === "head_warden" || isAdmin(role);
}

/** Only a developer may view the app as another role. */
export function isDeveloper(role: Role | undefined): boolean {
  return role === "developer";
}

/** Admins and head wardens look after every hostel; a warden, only theirs. */
export function everyHostel(role: Role | undefined): boolean {
  return role === "head_warden" || isAdmin(role);
}

/** Who may change the outing rules (on the website) and the holidays (here too): admins and
 * head wardens. */
export function canEditRules(role: Role | undefined): boolean {
  return everyHostel(role);
}

export const ROLE_LABEL: Record<Role, string> = {
  student: "Student",
  warden: "Warden",
  head_warden: "Head warden",
  admin: "Admin",
  developer: "Developer",
};

/** A person's account in words, or null when it's in use (nothing to say). */
export function accountLabel(account: AccountState): string | null {
  switch (account) {
    case "invited":
      return "Hasn't set up";
    case "reset":
      return "Password reset sent";
    case "off":
      return "Turned off";
    default:
      return null;
  }
}

/**
 * The "Send password link" confirmation, by what the server will do (see
 * POST /admin/users/{id}/password-link): an invited student gets their set-up link again; any
 * other gets a reset link, which for an active account stops their password working now.
 */
export function passwordLinkCopy(account: AccountState): { title: string; message: string } {
  if (account === "invited") {
    return {
      title: "Send the set-up link again?",
      message: "Sends their set-up link again (valid 7 days).",
    };
  }
  if (account === "reset") {
    return {
      title: "Send a new password link?",
      message:
        "Sends them a new link to choose a password (valid 24 hours). The link sent before stops working.",
    };
  }
  return {
    title: "Reset their password?",
    message:
      "Their current password stops working now and they're signed out everywhere. They get an email to choose a new one (valid 24 hours).",
  };
}

/** "+919876543210" -> "+91 98765 43210"; anything else is shown as stored. */
export function formatPhone(phone: string): string {
  const india = /^\+91(\d{5})(\d{5})$/.exec(phone);
  return india ? `+91 ${india[1]} ${india[2]}` : phone;
}
