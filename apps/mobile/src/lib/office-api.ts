/** The hostel office's API calls. The server checks the role on every call, and limits a
 * warden to their own hostels' students. */
import { api } from "@/lib/api";
import { scanQuery, studentsQuery } from "@/lib/office";
import { recordPath } from "@/lib/record";
import type {
  AccountEdit,
  AccountFilter,
  AdminUser,
  CallOutcome,
  Correction,
  CorrectionBody,
  CorrectionQueue,
  Escalation,
  EscalationCall,
  Gate,
  GateCreated,
  HelpRequest,
  Holiday,
  OfficeHostel,
  OfficeOuting,
  OfficeOverview,
  OfficeRequest,
  OfficeStudent,
  OfficeScanPage,
  NewPerson,
  PasswordLinkSent,
  Person,
  PersonAdded,
  RecordOutingPage,
  RecordRequestPage,
  Role,
  RuleSet,
  ScanResult,
  StudentRecord,
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
  /** "I'm on it": the re-alerts stop while someone has it (409 when someone else does). */
  claim: (id: string) =>
    api<void>(`/admin/escalations/${encodeURIComponent(id)}/claim`, { method: "POST" }),
  /** Give it back (whoever claimed it, or a head warden or admin). */
  release: (id: string) =>
    api<void>(`/admin/escalations/${encodeURIComponent(id)}/claim`, { method: "DELETE" }),
  /** A call made while following up; claims it if nobody has. */
  logCall: (id: string, outcome: CallOutcome, note: string | null) =>
    api<EscalationCall>(`/admin/escalations/${encodeURIComponent(id)}/calls`, {
      method: "POST",
      body: { outcome, note },
    }),
  /** Students who pressed Help, newest first: open ones only, or all. */
  help: (state: "open" | "all" = "open") => api<HelpRequest[]>(`/admin/help?state=${state}`),
  handleHelp: (id: string, note: string | null) =>
    api<void>(`/admin/help/${encodeURIComponent(id)}/handle`, { method: "POST", body: { note } }),
  /** A one-line notice (or "come back now") to the students out now in this office's hostels. */
  notice: (message: string, recall: boolean) =>
    api<{ sent: number }>("/admin/notices", { method: "POST", body: { message, recall } }),
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
  students: (filter: {
    hostelId?: string | null;
    q?: string;
    /** Only people who haven't set up, or only accounts turned off (staff too, for admins). */
    account?: AccountFilter | null;
  }) => api<OfficeStudent[]>(`/admin/students${studentsQuery(filter)}`),

  /** Correct someone's details: only the fields in `body` change (email: admins only). */
  editAccount: (userId: string, body: AccountEdit) =>
    api<AdminUser>(`/admin/users/${encodeURIComponent(userId)}`, { method: "PATCH", body }),
  /** Turn an account off (signed out everywhere, history kept) or back on. */
  turnAccount: (userId: string, on: boolean) =>
    api<AdminUser>(`/admin/users/${encodeURIComponent(userId)}/active`, {
      method: "POST",
      body: { on },
    }),
  /** Admins only: remove an account nobody has set up; the emailed link stops working. */
  cancelInvite: (userId: string) =>
    api<void>(`/admin/users/${encodeURIComponent(userId)}/invite`, { method: "DELETE" }),
  /** Admins only: add one person; they're emailed a link to choose a password. */
  addPerson: (person: NewPerson) =>
    api<PersonAdded>("/admin/people", { method: "POST", body: person }),
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

  /** One student's history: a 404 for anyone who isn't a student this office looks after. */
  studentRecord: (id: string) => api<StudentRecord>(`/admin/students/${encodeURIComponent(id)}`),
  recordOutings: (id: string, before?: string | null) =>
    api<RecordOutingPage>(recordPath(id, "outings", before)),
  recordRequests: (id: string, before?: string | null) =>
    api<RecordRequestPage>(recordPath(id, "requests", before)),
  recordScans: (id: string, before?: number | null) =>
    api<OfficeScanPage>(recordPath(id, "scans", before)),

  gates: () => api<Gate[]>("/admin/gates"),
  /** Admins only, like the two below. */
  addGate: (gate: { name: string; lat: number; lng: number; radius_m: number }) =>
    api<GateCreated>("/admin/gates", { method: "POST", body: gate }),
  switchGate: (id: string, active: boolean) =>
    api<Gate>(`/admin/gates/${encodeURIComponent(id)}`, { method: "PATCH", body: { active } }),
  newKioskLink: (id: string) =>
    api<GateCreated>(`/admin/gates/${encodeURIComponent(id)}/kiosk-token`, { method: "POST" }),
  /** Only a gate nobody has used; the server refuses (409) any other. */
  removeGate: (id: string) =>
    api<void>(`/admin/gates/${encodeURIComponent(id)}`, { method: "DELETE" }),
};
