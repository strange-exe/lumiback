/** The hostel office's API calls. The server checks the role on every call, and limits a
 * warden to their own hostels' students. */
import { api } from "@/lib/api";
import { scanQuery } from "@/lib/office";
import type {
  Correction,
  CorrectionBody,
  CorrectionQueue,
  Escalation,
  Gate,
  GateCreated,
  Holiday,
  OfficeHostel,
  OfficeOuting,
  OfficeOverview,
  OfficeRequest,
  OfficeStudent,
  OfficeScanPage,
  PasswordLinkSent,
  Person,
  Role,
  RuleSet,
  ScanResult,
} from "@/lib/types";

export const office = {
  overview: () => api<OfficeOverview>("/admin/overview"),
  requests: () => api<OfficeRequest[]>("/admin/requests"),
  decide: (id: string, approve: boolean, note: string | null) =>
    api<OfficeRequest>(`/admin/requests/${encodeURIComponent(id)}/decision`, {
      method: "POST",
      body: { approve, note },
    }),
  escalations: () => api<Escalation[]>("/admin/escalations"),
  resolve: (id: string, note: string | null) =>
    api<void>(`/admin/escalations/${encodeURIComponent(id)}/resolve`, {
      method: "POST",
      body: { note },
    }),
  outings: () => api<OfficeOuting[]>("/admin/outings"),
  /** Outings that ended today (IST), latest first: to correct a return time or a mistaken tap. */
  backToday: () => api<OfficeOuting[]>("/admin/outings?state=back"),

  /** Students' correction asks (oldest first) and returns the gate never saw. */
  corrections: () => api<CorrectionQueue>("/admin/corrections"),
  /** Record a return, fix a return time, or cancel a mistaken tap: applied at once. */
  correct: (outingId: string, body: CorrectionBody) =>
    api<OfficeOuting>(`/admin/outings/${encodeURIComponent(outingId)}/correction`, {
      method: "POST",
      body,
    }),
  decideCorrection: (id: string, approve: boolean, note: string | null) =>
    api<Correction>(`/admin/corrections/${encodeURIComponent(id)}/decision`, {
      method: "POST",
      body: { approve, note },
    }),

  /** A warden's own hostels; every hostel for an admin. */
  hostels: () => api<OfficeHostel[]>("/admin/my-hostels"),
  students: (filter: { hostelId?: string | null; q?: string }) => {
    const query = new URLSearchParams();
    if (filter.hostelId) query.set("hostel_id", filter.hostelId);
    if (filter.q && filter.q.trim().length >= 2) query.set("q", filter.q.trim());
    const qs = query.toString();
    return api<OfficeStudent[]>(`/admin/students${qs ? `?${qs}` : ""}`);
  },
  /** Students choose their hostel once; after that the office moves them (both hostels theirs). */
  moveStudent: (userId: string, hostelId: string) =>
    api<OfficeStudent>(`/admin/students/${encodeURIComponent(userId)}/hostel`, {
      method: "POST",
      body: { hostel_id: hostelId },
    }),
  /** Admins only. */
  setRole: (userId: string, role: Role, hostelIds: string[]) =>
    api<Person>(`/admin/users/${encodeURIComponent(userId)}/role`, {
      method: "POST",
      body: { role, hostel_ids: role === "warden" ? hostelIds : [] },
    }),
  /** Admins only, students only: emails a link to choose a password. For an active account
   * it's a reset (the old password stops working and they're signed out everywhere); for an
   * invited one, the set-up link again. */
  sendPasswordLink: (userId: string) =>
    api<PasswordLinkSent>(`/admin/users/${encodeURIComponent(userId)}/password-link`, {
      method: "POST",
    }),

  /** Read-only here; a warden gets just the sets their hostels follow. */
  ruleSets: () => api<RuleSet[]>("/admin/rule-sets"),
  holidays: (year: number) => api<Holiday[]>(`/admin/holidays?year=${year}`),
  /** Admins and head wardens only, like removing one. Adding an existing date renames it. */
  setHoliday: (holiday: Holiday) =>
    api<Holiday>(`/admin/holidays/${encodeURIComponent(holiday.day)}`, {
      method: "PUT",
      body: holiday,
    }),
  removeHoliday: (day: string) =>
    api<void>(`/admin/holidays/${encodeURIComponent(day)}`, { method: "DELETE" }),

  /** Gate scans, newest first, a page at a time; a warden sees their hostels' students only. */
  scans: (filter: { before?: number | null; gateId?: string | null; result?: ScanResult | null }) =>
    api<OfficeScanPage>(`/admin/scans?${scanQuery(filter)}`),

  gates: () => api<Gate[]>("/admin/gates"),
  /** Admins only, like the two below. */
  addGate: (gate: { name: string; lat: number; lng: number; radius_m: number }) =>
    api<GateCreated>("/admin/gates", { method: "POST", body: gate }),
  switchGate: (id: string, active: boolean) =>
    api<Gate>(`/admin/gates/${encodeURIComponent(id)}`, { method: "PATCH", body: { active } }),
  newKioskLink: (id: string) =>
    api<GateCreated>(`/admin/gates/${encodeURIComponent(id)}/kiosk-token`, { method: "POST" }),
};
