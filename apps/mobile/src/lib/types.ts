/** Shapes returned by the FastAPI backend (see backend/app/schemas.py; mirrors apps/web). */

export interface User {
  id: string;
  name: string;
  email: string;
  roll_no: string | null;
  hostel: string | null;
  email_verified: boolean;
  created_at: string;
  /** Wardens (their hostels) and admins (every hostel) also get the hostel office. */
  role?: Role;
}

export type Role = "student" | "warden" | "admin";

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
  /** "gate": scanned at a gate with a GPS check; "self": logged in the app. */
  out_via: "self" | "gate";
  in_via: "self" | "gate" | null;
  /** The answer to "you're late, are you OK?". */
  late_reply?: "on_my_way" | "safe" | null;
}

// ---------- outing rules ----------

export type DayType = "weekday" | "saturday" | "sunday" | "holiday";

/** GET /campus: today's outing rules for this student (their hostel's, or the default). */
export interface TodayRules {
  day: string;
  day_type: DayType;
  /** "Weekday", "Sunday", or the holiday's name. */
  label: string;
  rule_set: string;
  hostel: string | null;
  /** ISO, IST offset */
  opens_at: string;
  return_by: string;
  max_minutes: number | null;
  /** Today needs an approved form... */
  needs_form: boolean;
  /** ...except from this time (ISO, IST): no form and no maximum, like a weekday evening. */
  no_form_from?: string | null;
}

export interface Campus {
  /** Legacy single curfew; null (or absent) when the outing rules aren't set up. Unused here. */
  curfew?: string | null;
  curfew_at?: string | null;
  /** Null when the outing rules aren't set up. */
  today: TodayRules | null;
}

export type RequestStatus = "pending" | "approved" | "declined" | "cancelled";

/** Today's outing request (the form), on a day that needs approval (currently Sundays and holidays). */
export interface OutingRequest {
  id: string;
  day: string;
  purpose: string;
  requested_minutes: number | null;
  status: RequestStatus;
  note: string | null;
  decided_at: string | null;
  created_at: string;
  used: boolean;
}

export interface Profile {
  hostel_id: string | null;
  hostel: string | null;
  phone: string | null;
  emergency_name: string | null;
  emergency_relation: string | null;
  emergency_phone: string | null;
}

export interface HostelChoice {
  id: string;
  name: string;
  rule_set: string;
}

export interface AccessLogEntry {
  viewer_id: string | null;
  viewer_name: string;
  kind: "user" | "guest" | "admin";
  channel: string;
  viewed_at: string;
}

/** POST /gates/scan */
export interface GateScanned {
  direction: "out" | "in";
  gate: string;
  outing: Outing;
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

export interface Registered {
  email: string;
  code_expires_in_minutes: number;
}

// ---------- the hostel office (admins and wardens; the API limits a warden to their hostels) ----------

export type LateReply = "on_my_way" | "safe";

export interface OfficeOverview {
  out_now: number;
  overdue: number;
  pending_requests?: number;
  open_escalations?: number;
}

export interface OfficeOuting {
  id: string;
  name: string;
  roll_no: string | null;
  hostel?: string | null;
  destination: string | null;
  left_at: string;
  expected_return_at: string;
  status: OutingStatus;
  late_minutes: number;
  out_via: "self" | "gate";
  out_gate: string | null;
  late_reply?: LateReply | null;
}

export interface OfficeRequest {
  id: string;
  name: string;
  roll_no: string | null;
  hostel: string | null;
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
  name: string;
  roll_no: string | null;
  hostel: string | null;
  warden_name: string | null;
  warden_phone: string | null;
  phone: string | null;
  emergency_name: string | null;
  emergency_relation: string | null;
  emergency_phone: string | null;
  destination: string | null;
  left_at: string;
  expected_return_at: string;
  returned_at?: string | null;
  late_minutes: number;
  alert_at: string | null;
  late_reply: LateReply | null;
  last_seen: LastSeen | null;
  resolved_by: string | null;
  resolved_at: string | null;
  note: string | null;
}

export interface OfficeStudent {
  id: string;
  name: string;
  email: string;
  roll_no: string | null;
  role: Role;
  hostel_id: string | null;
  hostel: string | null;
  phone: string | null;
  emergency_name: string | null;
  emergency_relation: string | null;
  emergency_phone: string | null;
  /** Right now. */
  status: "in" | "out" | "overdue";
}

export interface OfficeHostel {
  id: string;
  name: string;
  rule_set_id: string;
  rule_set: string;
  warden_name: string | null;
  warden_phone: string | null;
  students: number;
}

export interface DayRule {
  day_type: "weekday" | "saturday" | "sunday" | "holiday";
  opens_at: string;
  return_by: string;
  max_minutes: number | null;
  needs_form: boolean;
  no_form_from: string | null;
}

export interface RuleSet {
  id: string;
  name: string;
  is_default: boolean;
  hostels: string[];
  days: DayRule[];
}

export interface Holiday {
  day: string;
  name: string;
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
  /** Shown once: the kiosk link's secret. */
  kiosk_token: string;
}

export interface Person {
  id: string;
  name: string;
  email: string;
  roll_no: string | null;
  role: Role;
  hostel_ids: string[];
  hostels: string[];
}
