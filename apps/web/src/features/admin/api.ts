import "server-only";

import { callBackend } from "@/lib/backend";
import type {
  AdminOuting,
  AdminOverview,
  AdminScanPage,
  AdminRequest,
  AdminUser,
  CampusSettings,
  Escalation,
  Gate,
  Holiday,
  Hostel,
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

  requests(token: string): Promise<AdminRequest[]> {
    return callBackend<AdminRequest[]>("/admin/requests", { token });
  },

  escalations(token: string, state: "open" | "all" = "open"): Promise<Escalation[]> {
    return callBackend<Escalation[]>(`/admin/escalations?state=${state}`, { token });
  },

  ruleSets(token: string): Promise<RuleSet[]> {
    return callBackend<RuleSet[]>("/admin/rule-sets", { token });
  },

  hostels(token: string): Promise<Hostel[]> {
    return callBackend<Hostel[]>("/admin/hostels", { token });
  },

  holidays(token: string, year: number): Promise<Holiday[]> {
    return callBackend<Holiday[]>(`/admin/holidays?year=${year}`, { token });
  },
};
