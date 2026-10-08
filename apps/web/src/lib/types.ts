/** Shapes returned by the FastAPI backend (see backend/app/schemas.py). */

export interface User {
  id: string;
  name: string;
  email: string;
  roll_no: string | null;
  hostel: string | null;
  email_verified: boolean;
  created_at: string;
  role: "student" | "admin";
}

export interface TokenPair {
  access_token: string;
  token_type: "bearer";
  expires_in: number;
  refresh_token: string;
}

export type OutingStatus = "out" | "overdue" | "returned";

export interface Outing {
  id: string;
  destination: string | null;
  purpose: string | null;
  /** ISO timestamps with +05:30 offset (IST). */
  left_at: string;
  expected_return_at: string;
  returned_at: string | null;
  status: OutingStatus;
  late_minutes: number;
  duration_minutes: number | null;
  /** "gate": scanned at a gate with a GPS check; "self": the student logged it. */
  out_via: "self" | "gate";
  in_via: "self" | "gate" | null;
}

export interface OutingPage {
  items: Outing[];
  next_before: string | null;
}

export interface OutingSummary {
  total: number;
  returned: number;
  returned_late: number;
  on_time_rate: number | null;
  currently: "in" | "out" | "overdue";
}

// ---------- live sharing ----------

export type ViewerStatus = "pending" | "granted" | "revoked";

export interface Viewer {
  id: string;
  kind: "user" | "guest";
  name: string;
  status: ViewerStatus;
  requested_at: string;
  granted_at: string | null;
  revoked_at: string | null;
}

/** The sharer's own view of a session. `status` is effective: past ends_at reads "ended". */
export interface ShareSession {
  id: string;
  source: "manual" | "tab_live" | "app" | "outing" | "pairing";
  ends_when: string;
  status: "active" | "ended" | "revoked";
  ends_at: string;
  created_at: string;
  ended_at: string | null;
  ended_reason: string | null;
  viewers: Viewer[];
}

/** A session someone shared with me. */
export interface Watching {
  id: string;
  sharer: { id: string; name: string };
  source: string;
  ends_at: string;
}

export interface LiveLocation {
  lat: number;
  lng: number;
  accuracy_m: number;
  recorded_at: string;
  stale: boolean;
}

export interface JoinCode {
  /** Shown once; only its HMAC is stored. */
  code: string;
  expires_at: string;
}

export interface Redeemed {
  session_id: string;
  viewer_id: string;
  status: ViewerStatus;
  guest_token: string | null;
}

/** Result shape for Server Actions used with useActionState. */
export interface FormState {
  error: string | null;
  notice?: string | null;
  /**
   * What the student typed, handed back after an error. React resets a form once its action
   * finishes; inputs use these as default values so nothing has to be typed twice.
   * Never includes passwords.
   */
  fields?: Record<string, string>;
}

// ---------- admin ----------

export interface AdminOverview {
  out_now: number;
  overdue: number;
  scans_today: number;
  rejected_today: number;
  active_gates: number;
  pending_requests?: number;
  open_escalations?: number;
}

export interface AdminOuting {
  id: string;
  student_id: string;
  name: string;
  email: string;
  roll_no: string | null;
  destination: string | null;
  /** IST (+05:30) */
  left_at: string;
  expected_return_at: string;
  status: OutingStatus;
  late_minutes: number;
  out_via: "self" | "gate";
  out_gate: string | null;
  hostel?: string | null;
  /** Took the later return option (weekday 8:30 PM), and why. */
  late_reason?: string | null;
  /** The answer to the "are you OK?" alert, if any. */
  late_reply?: LateReply | null;
  /** A weekend/holiday outing an admin approved. */
  on_request?: boolean;
}

export type ScanResult = "accepted" | "bad_code" | "gate_off" | "too_far" | "weak_gps" | "mock_gps";

export interface AdminScan {
  id: number;
  name: string;
  roll_no: string | null;
  gate: string | null;
  direction: "out" | "in";
  result: ScanResult;
  distance_m: number | null;
  accuracy_m: number | null;
  scanned_at: string;
}

export interface AdminScanPage {
  items: AdminScan[];
  next_before: number | null;
}

export interface Gate {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radius_m: number;
  active: boolean;
  created_at: string;
}

export interface GateCreated {
  gate: Gate;
  /** Shown once; only its hash is stored. */
  kiosk_token: string;
}

export interface CampusSettings {
  /** "HH:MM", IST. Superseded by rule sets. */
  curfew: string | null;
  scan_retention_days: number;
}

// ---------- outing rules (admin) ----------

export type DayType = "weekday" | "saturday" | "sunday" | "holiday";
export type LateReply = "on_my_way" | "safe";

export interface DayRule {
  day_type: DayType;
  /** "HH:MM", IST */
  opens_at: string;
  return_by: string;
  late_until: string | null;
  max_minutes: number | null;
  needs_form: boolean;
}

export interface RuleSet {
  id: string;
  name: string;
  is_default: boolean;
  hostels: string[];
  days: DayRule[];
}

export interface Hostel {
  id: string;
  name: string;
  rule_set_id: string;
  rule_set: string;
  warden_name: string | null;
  warden_phone: string | null;
  students: number;
}

export interface Holiday {
  /** "YYYY-MM-DD" */
  day: string;
  name: string;
}

export type RequestStatus = "pending" | "approved" | "declined" | "cancelled";

export interface AdminRequest {
  id: string;
  student_id: string;
  name: string;
  email: string;
  roll_no: string | null;
  hostel: string | null;
  day: string;
  purpose: string;
  phone: string;
  emergency_name: string;
  emergency_relation: string;
  emergency_phone: string;
  requested_minutes: number | null;
  max_minutes: number | null;
  status: RequestStatus;
  note: string | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
  used: boolean;
}

export interface LastSeen {
  kind: "live" | "gate";
  at: string;
  lat: number | null;
  lng: number | null;
  accuracy_m: number | null;
  gate: string | null;
  mock_since: string | null;
}

export interface Escalation {
  id: string;
  created_at: string;
  name: string;
  email: string;
  roll_no: string | null;
  hostel: string | null;
  warden_name: string | null;
  warden_phone: string | null;
  phone: string | null;
  emergency_name: string | null;
  emergency_relation: string | null;
  emergency_phone: string | null;
  destination: string | null;
  purpose: string | null;
  left_at: string;
  expected_return_at: string;
  returned_at: string | null;
  late_minutes: number;
  alert_at: string | null;
  late_reply: LateReply | null;
  late_replied_at: string | null;
  last_seen: LastSeen | null;
  resolved_by: string | null;
  resolved_at: string | null;
  note: string | null;
}

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  roll_no: string | null;
  role: "student" | "admin";
}

/** What a gate kiosk shows (GET /kiosk/qr). */
export interface KioskCode {
  gate_id: string;
  gate_name: string;
  qr: string;
  refresh_at: string;
}
