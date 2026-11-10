import "server-only";

import { callBackend } from "@/lib/backend";
import type {
  AdminOuting,
  AdminOverview,
  AdminScanPage,
  AdminRequest,
  AdminUser,
  AuditPage,
  CampusSettings,
  CorrectionQueue,
  ErrorGroupList,
  Escalation,
  Gate,
  HelpRequest,
  Holiday,
  Hostel,
  OfficeStudent,
  RecordOutingPage,
  RecordRequestPage,
  Report,
  Role,
  RuleSet,
  ScanResult,
  StudentRecord,
} from "@/lib/types";

interface RegisterFilters {
  hostel?: string;
  q?: string;
}

function registerQuery(filters: RegisterFilters): URLSearchParams {
  const query = new URLSearchParams();
  if (filters.hostel) query.set("hostel_id", filters.hostel);
  if (filters.q) query.set("q", filters.q);
  return query;
}

/** The ids reaching here were checked as UUIDs by the page; encoding is belt and braces. */
function recordPath(id: string, list: "outings" | "requests" | "scans", before?: string): string {
  const path = `/admin/students/${encodeURIComponent(id)}/${list}`;
  return before ? `${path}?${new URLSearchParams({ before }).toString()}` : path;
}

/** Reads for admin Server Components. The backend enforces the admin role on every call. */
export const adminApi = {
  overview(token: string): Promise<AdminOverview> {
    return callBackend<AdminOverview>("/admin/overview", { token });
  },

  /** `hostel`: one of the office's hostels (else a 404). `q`: a name or roll number. */
  outings(
    token: string,
    state: "all" | "out" | "overdue" = "all",
    filters: RegisterFilters = {},
  ): Promise<AdminOuting[]> {
    const query = registerQuery(filters);
    query.set("state", state);
    return callBackend<AdminOuting[]>(`/admin/outings?${query.toString()}`, { token });
  },

  lateToday(token: string, filters: RegisterFilters = {}): Promise<AdminOuting[]> {
    const search = registerQuery(filters).toString();
    return callBackend<AdminOuting[]>(`/admin/late-today${search ? `?${search}` : ""}`, { token });
  },

  /** `q`: a student's name or roll number. `from`/`to`: IST days (YYYY-MM-DD), inclusive. */
  scans(
    token: string,
    filters: {
      before?: string;
      gate?: string;
      /** One of the office's hostels (else a 404): its students' scans only. */
      hostel?: string;
      result?: ScanResult;
      q?: string;
      from?: string;
      to?: string;
    },
  ): Promise<AdminScanPage> {
    const query = new URLSearchParams({ limit: "50" });
    if (filters.before) query.set("before", filters.before);
    if (filters.gate) query.set("gate_id", filters.gate);
    if (filters.hostel) query.set("hostel_id", filters.hostel);
    if (filters.result) query.set("result", filters.result);
    if (filters.q) query.set("q", filters.q);
    if (filters.from) query.set("from", filters.from);
    if (filters.to) query.set("to", filters.to);
    return callBackend<AdminScanPage>(`/admin/scans?${query.toString()}`, { token });
  },

  /** The admin audit log, newest first (admins and developers only). */
  audit(
    token: string,
    filters: { before?: string; area?: string; q?: string; from?: string; to?: string },
  ): Promise<AuditPage> {
    const query = new URLSearchParams({ limit: "50" });
    for (const key of ["before", "area", "q", "from", "to"] as const) {
      const value = filters[key];
      if (value) query.set(key, value);
    }
    return callBackend<AuditPage>(`/admin/audit?${query.toString()}`, { token });
  },

  /** One student's record: a 404 for anyone who isn't a student this office looks after. */
  studentRecord(token: string, id: string): Promise<StudentRecord> {
    return callBackend<StudentRecord>(`/admin/students/${encodeURIComponent(id)}`, { token });
  },
  recordOutings(token: string, id: string, before?: string): Promise<RecordOutingPage> {
    return callBackend<RecordOutingPage>(recordPath(id, "outings", before), { token });
  },
  recordRequests(token: string, id: string, before?: string): Promise<RecordRequestPage> {
    return callBackend<RecordRequestPage>(recordPath(id, "requests", before), { token });
  },
  recordScans(token: string, id: string, before?: string): Promise<AdminScanPage> {
    return callBackend<AdminScanPage>(recordPath(id, "scans", before), { token });
  },

  gates(token: string): Promise<Gate[]> {
    return callBackend<Gate[]>("/admin/gates", { token });
  },

  settings(token: string): Promise<CampusSettings> {
    return callBackend<CampusSettings>("/admin/settings", { token });
  },

  /**
   * Admins' people search: `q` (2+ letters) and/or one role. With a role, the first 50 by name;
   * a search alone, the best 20.
   */
  users(token: string, filters: { q?: string; role?: Role }): Promise<AdminUser[]> {
    const query = new URLSearchParams();
    if (filters.q) query.set("q", filters.q);
    if (filters.role) query.set("role", filters.role);
    return callBackend<AdminUser[]>(`/admin/users?${query.toString()}`, { token });
  },

  /**
   * People the office looks after, with their phone numbers: a warden's own hostels' students,
   * or (for an admin) anyone matching `q`. `account`: only those who haven't set up, or only
   * accounts turned off (for an admin, staff too). `hostel`: one hostel's people only. `role`:
   * one role's people (admins only; the API ignores it for anyone else). By name, `limit` at a
   * time (300 without it); `after`: the last id of the page before.
   */
  students(
    token: string,
    filters: {
      q?: string;
      account?: "invited" | "off";
      hostel?: string;
      role?: Role;
      after?: string;
      limit?: number;
    },
  ): Promise<OfficeStudent[]> {
    const query = new URLSearchParams();
    if (filters.hostel) query.set("hostel_id", filters.hostel);
    if (filters.q) query.set("q", filters.q);
    if (filters.account) query.set("account", filters.account);
    if (filters.role) query.set("role", filters.role);
    if (filters.after) query.set("after", filters.after);
    if (filters.limit) query.set("limit", String(filters.limit));
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

  /** Students who pressed Help while out, newest first, in this office's hostels. */
  help(token: string, state: "open" | "all" = "open"): Promise<HelpRequest[]> {
    return callBackend<HelpRequest[]>(`/admin/help?state=${state}`, { token });
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

  /** Counts per hostel the office looks after, for IST days `from` to `to` (checked dates). */
  report(token: string, from: string, to: string): Promise<Report> {
    const query = new URLSearchParams({ from, to });
    return callBackend<Report>(`/admin/reports?${query.toString()}`, { token });
  },

  /** The latest groups of errors from the website and the app: developers only. */
  errors(token: string): Promise<ErrorGroupList> {
    return callBackend<ErrorGroupList>("/errors?limit=50", { token });
  },
};
