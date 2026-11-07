import "server-only";

import { callBackend } from "@/lib/backend";
import type {
  AdminOuting,
  AdminOverview,
  AdminScanPage,
  AdminRequest,
  AdminUser,
  CampusSettings,
  CorrectionQueue,
  Escalation,
  Gate,
  Holiday,
  Hostel,
  OfficeStudent,
  RuleSet,
  ScanResult,
} from "@/lib/types";

/** Reads for admin Server Components. The backend enforces the admin role on every call. */
export const adminApi = {
  overview(token: string): Promise<AdminOverview> {
    return callBackend<AdminOverview>("/admin/overview", { token });
  },

  outings(token: string, state: "all" | "out" | "overdue" = "all"): Promise<AdminOuting[]> {
    return callBackend<AdminOuting[]>(`/admin/outings?state=${state}`, { token });
  },

  lateToday(token: string): Promise<AdminOuting[]> {
    return callBackend<AdminOuting[]>("/admin/late-today", { token });
  },

  scans(
    token: string,
    filters: { before?: string; gate?: string; result?: ScanResult },
  ): Promise<AdminScanPage> {
    const query = new URLSearchParams({ limit: "50" });
    if (filters.before) query.set("before", filters.before);
    if (filters.gate) query.set("gate_id", filters.gate);
    if (filters.result) query.set("result", filters.result);
    return callBackend<AdminScanPage>(`/admin/scans?${query.toString()}`, { token });
  },

  gates(token: string): Promise<Gate[]> {
    return callBackend<Gate[]>("/admin/gates", { token });
  },

  settings(token: string): Promise<CampusSettings> {
    return callBackend<CampusSettings>("/admin/settings", { token });
  },

  users(token: string, q: string): Promise<AdminUser[]> {
    return callBackend<AdminUser[]>(`/admin/users?q=${encodeURIComponent(q)}`, { token });
  },

  /**
   * People the office looks after, with their phone numbers: a warden's own hostels' students,
   * or (for an admin) anyone matching `q`. `account`: only those who haven't set up, or only
   * accounts turned off (for an admin, staff too). `hostel`: one hostel's people only.
   */
  students(
    token: string,
    filters: { q?: string; account?: "invited" | "off"; hostel?: string },
  ): Promise<OfficeStudent[]> {
    const query = new URLSearchParams();
    if (filters.hostel) query.set("hostel_id", filters.hostel);
    if (filters.q) query.set("q", filters.q);
    if (filters.account) query.set("account", filters.account);
    const search = query.toString();
    return callBackend<OfficeStudent[]>(`/admin/students${search ? `?${search}` : ""}`, { token });
  },

  /** A day's requests: today, or an earlier day (YYYY-MM-DD, already checked by the page). */
  requests(token: string, day?: string | null): Promise<AdminRequest[]> {
    const query = day ? `?${new URLSearchParams({ day }).toString()}` : "";
    return callBackend<AdminRequest[]>(`/admin/requests${query}`, { token });
  },

  escalations(token: string, state: "open" | "all" = "open"): Promise<Escalation[]> {
    return callBackend<Escalation[]>(`/admin/escalations?state=${state}`, { token });
  },

  /** Students' correction asks, and returns the gate never saw, in this office's hostels. */
  corrections(token: string): Promise<CorrectionQueue> {
    return callBackend<CorrectionQueue>("/admin/corrections", { token });
  },

  ruleSets(token: string): Promise<RuleSet[]> {
    return callBackend<RuleSet[]>("/admin/rule-sets", { token });
  },

  /** The hostels this person looks after (a warden's own; every hostel for an admin). */
  myHostels(token: string): Promise<Hostel[]> {
    return callBackend<Hostel[]>("/admin/my-hostels", { token });
  },
  hostels(token: string): Promise<Hostel[]> {
    return callBackend<Hostel[]>("/admin/hostels", { token });
  },

  holidays(token: string, year: number): Promise<Holiday[]> {
    return callBackend<Holiday[]>(`/admin/holidays?year=${year}`, { token });
  },
};
