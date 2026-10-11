/** Hostel office helpers with no app dependencies (unit-tested). API calls: office-api.ts. */
import type { Role } from "@/lib/types";

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
