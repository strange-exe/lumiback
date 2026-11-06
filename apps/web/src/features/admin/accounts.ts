/**
 * The hostel office's account controls and "add a person": wording and request bodies, kept
 * free of server code so they can be unit tested. The backend checks everything again
 * (backend/app/services/accounts.py, student_import.py).
 */

import type { AccountState, Role } from "@/lib/types";

/** An account that can't be used as normal, said in words (never by colour alone). */
export const ACCOUNT_LABEL: Record<Exclude<AccountState, "active">, string> = {
  invited: "Hasn't set up",
  reset: "Password reset sent",
  off: "Turned off",
};

/** The `account` filter on the People list, from the address bar (anything else: no filter). */
export function accountFilter(value: string | undefined): "invited" | "off" | undefined {
  return value === "invited" || value === "off" ? value : undefined;
}

/** backend/app/schemas.py RollNo. Also the edit form's `pattern`. */
export const ROLL_NO = /^[A-Za-z0-9]{3,32}$/;

export interface EditInput {
  name: string;
  rollNo: string;
  phone: string;
  /** False when the page didn't know the current number: then a blank field keeps it. */
  phoneKnown: boolean;
  /** Admins only; blank when the form had no email field. */
  email: string;
  emailWas: string;
}

export type EditBody = {
  name: string;
  roll_no: string | null;
  phone?: string | null;
  email?: string;
};

/**
 * PATCH /admin/users/{id}: only the fields that should change. A blank roll no. (or a blank
 * phone the page knew) clears it; the email is sent only when an admin changed it, so a warden's
 * form never trips "Only an admin can change an email address".
 */
export function editBody(input: EditInput): { body: EditBody } | { error: string } {
  const name = input.name.trim();
  if (!name) return { error: "Enter their name." };
  if (name.length > 100) return { error: "Keep the name to 100 characters or fewer." };
  const rollNo = input.rollNo.trim();
  // The backend's own rule (schemas.RollNo); its 422 would only quote the pattern.
  if (rollNo && !ROLL_NO.test(rollNo)) {
    return { error: "A roll no. is 3 to 32 letters or digits, with no spaces." };
  }
  const body: EditBody = { name, roll_no: rollNo || null };
  const phone = input.phone.trim();
  if (input.phoneKnown) body.phone = phone || null;
  else if (phone) body.phone = phone;
  const email = input.email.trim().toLowerCase();
  if (email && email !== input.emailWas.trim().toLowerCase()) body.email = email;
  return { body };
}

export const ROLES: readonly { value: Role; label: string }[] = [
  { value: "student", label: "Student" },
  { value: "warden", label: "Warden" },
  { value: "head_warden", label: "Head warden" },
  { value: "admin", label: "Admin" },
];

export function asRole(value: string): Role {
  return ROLES.find((r) => r.value === value)?.value ?? "student";
}

export interface PersonInput {
  name: string;
  role: string;
  studentId: string;
  email: string;
  hostelId: string;
  phone: string;
  parentName: string;
  parentPhone: string;
}

export interface PersonBody {
  name: string;
  role: Role;
  student_id: string | null;
  email: string | null;
  hostel_id: string | null;
  phone: string | null;
  parent_name: string | null;
  parent_phone: string | null;
}

/**
 * POST /admin/people. Only the fields this role's form shows are sent: a head warden or admin
 * looks after no single hostel, and parents are a student's emergency contact. The backend
 * checks the row exactly like a CSV line and answers with its own message.
 */
export function personBody(input: PersonInput): { body: PersonBody } | { error: string } {
  const role = asRole(input.role);
  const student = role === "student";
  const name = input.name.trim();
  if (!name) return { error: "Enter their name." };
  const or = (value: string) => value.trim() || null;
  return {
    body: {
      name,
      role,
      student_id: or(input.studentId),
      email: input.email.trim().toLowerCase() || null,
      hostel_id: student || role === "warden" ? or(input.hostelId) : null,
      phone: or(input.phone),
      parent_name: student ? or(input.parentName) : null,
      parent_phone: student ? or(input.parentPhone) : null,
    },
  };
}
