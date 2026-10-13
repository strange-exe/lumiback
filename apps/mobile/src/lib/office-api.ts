/** The hostel office's API calls. The server checks the role on every call, and limits a
 * warden to their own hostels' students. */
import { api } from "@/lib/api";
import type {
  Escalation,
  Gate,
  GateCreated,
  Holiday,
  OfficeHostel,
  OfficeOuting,
  OfficeOverview,
  OfficeRequest,
  OfficeStudent,
  Person,
  Role,
  RuleSet,
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

  /** Read-only here; a warden gets just the sets their hostels follow. */
  ruleSets: () => api<RuleSet[]>("/admin/rule-sets"),
  holidays: (year: number) => api<Holiday[]>(`/admin/holidays?year=${year}`),

  gates: () => api<Gate[]>("/admin/gates"),
  /** Admins only, like the two below. */
  addGate: (gate: { name: string; lat: number; lng: number; radius_m: number }) =>
    api<GateCreated>("/admin/gates", { method: "POST", body: gate }),
  switchGate: (id: string, active: boolean) =>
    api<Gate>(`/admin/gates/${encodeURIComponent(id)}`, { method: "PATCH", body: { active } }),
  newKioskLink: (id: string) =>
    api<GateCreated>(`/admin/gates/${encodeURIComponent(id)}/kiosk-token`, { method: "POST" }),
};
