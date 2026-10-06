/** Shapes returned by the FastAPI backend (see backend/app/schemas.py). */

export interface User {
  id: string;
  name: string;
  email: string;
  roll_no: string | null;
  hostel: string | null;
  email_verified: boolean;
  created_at: string;
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
  source: "manual" | "tab_live" | "outing" | "pairing";
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
