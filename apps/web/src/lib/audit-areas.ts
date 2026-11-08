/**
 * The areas of the admin audit log an admin can filter by, with their labels. The same fixed
 * list as the API's (backend/app/services/admin.py AUDIT_AREAS): an action belongs to an area when
 * it is the area itself or starts with "area:". Pure, so `node --test` can load it.
 */

export const AUDIT_AREAS = [
  "account",
  "announce",
  "correction",
  "escalation",
  "gate",
  "help",
  "holiday",
  "hostel",
  "invite",
  "notice",
  "outing",
  "password",
  "people",
  "request",
  "role",
  "rules",
  "settings",
  "student",
] as const;

export type AuditArea = (typeof AUDIT_AREAS)[number];

export const AUDIT_AREA_LABELS: Readonly<Record<AuditArea, string>> = {
  account: "Accounts",
  announce: "Announcements",
  correction: "Corrections",
  escalation: "Late follow-ups",
  gate: "Gates",
  help: "Help requests",
  holiday: "Holidays",
  hostel: "Hostels",
  invite: "Invites",
  notice: "Notices",
  outing: "Outings",
  password: "Passwords",
  people: "People",
  request: "Requests",
  role: "Roles",
  rules: "Outing rules",
  settings: "Settings",
  student: "Students",
};

export function isAuditArea(value: unknown): value is AuditArea {
  return typeof value === "string" && (AUDIT_AREAS as readonly string[]).includes(value);
}

/** "people:deactivate" reads "People: deactivate"; "settings" reads "Settings". */
export function actionLabel(action: string): string {
  const [area, ...rest] = action.split(":");
  const head = isAuditArea(area) ? AUDIT_AREA_LABELS[area] : area;
  const tail = rest.join(":").replace(/_/g, " ");
  return tail ? `${head}: ${tail}` : head;
}
