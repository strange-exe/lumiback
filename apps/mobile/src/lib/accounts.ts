/** Account controls in the hostel office, with no app dependencies (unit-tested). The server
 * checks every rule here again; these only decide what a screen offers. API calls: office-api.ts. */
import type { AccountEdit, AccountFilter, NewPerson, OfficeStudent, Role } from "@/lib/types";

/** What a viewer may do to one person in the students list. */
export interface AccountControls {
  /** Turn the account off, or back on. */
  turn: boolean;
  /** Correct the name, roll no. and phone. */
  edit: boolean;
  /** Also the email address (admins only). */
  editEmail: boolean;
  /** Remove an account nobody has set up yet (admins only). */
  cancelInvite: boolean;
  /** Email a set-password link (admins only; not to an account that's off). */
  passwordLink: boolean;
}

const NONE: AccountControls = {
  turn: false,
  edit: false,
  editEmail: false,
  cancelInvite: false,
  passwordLink: false,
};

/**
 * Admins: anyone but themselves. Wardens and head wardens: students only (the list already
 * holds only the hostels they look after). Nobody changes their own account here.
 */
export function accountControls(
  viewer: { id: string; role: Role } | null | undefined,
  person: Pick<OfficeStudent, "id" | "role" | "account">,
): AccountControls {
  if (!viewer || viewer.id === person.id) return NONE;
  const admin = viewer.role === "admin";
  const staffViewer = admin || viewer.role === "warden" || viewer.role === "head_warden";
  if (!staffViewer || (!admin && person.role !== "student")) return NONE;
  return {
    turn: true,
    edit: true,
    editEmail: admin,
    cancelInvite: admin && person.account === "invited",
    passwordLink: admin && person.account !== "off",
  };
}

/** The confirmation before turning an account off or on, saying what it does. */
export function turnCopy(
  person: Pick<OfficeStudent, "name" | "role">,
  on: boolean,
): { title: string; message: string; action: string } {
  if (on) {
    return {
      title: "Turn this account on?",
      message: `${person.name} can sign in again with their password.`,
      action: "Turn on",
    };
  }
  const handover =
    person.role === "student" ? "" : " Requests for the hostels they look after go to other staff.";
  return {
    title: "Turn this account off?",
    message: `${person.name} is signed out on every phone and can't sign in, and any live share they're in ends.${handover} Their outings and history are kept, and you can turn it back on.`,
    action: "Turn off",
  };
}

/** Before cancelling an invite: the account goes, and the emailed link stops working. */
export function cancelInviteCopy(person: Pick<OfficeStudent, "name" | "email">): {
  title: string;
  message: string;
} {
  return {
    title: "Cancel this invite?",
    message: `${person.name} (${person.email}) hasn't set up yet. Their account is removed and the link they were emailed stops working. Add them again if this was a mistake.`,
  };
}

/** What the edit form holds: text as typed. */
export interface EditForm {
  name: string;
  email: string;
  rollNo: string;
  phone: string;
}

export function editForm(
  person: Pick<OfficeStudent, "name" | "email" | "roll_no" | "phone">,
): EditForm {
  return {
    name: person.name,
    email: person.email,
    rollNo: person.roll_no ?? "",
    phone: person.phone ?? "",
  };
}

/**
 * The PATCH body: only what changed (the server changes only the fields sent). An emptied roll
 * no. or phone is sent as null, which clears it. The email is sent only when the viewer may change
 * it. `{ error }` when the form can't be sent; `{ body: {} }` when nothing changed.
 */
export function editBody(
  person: Pick<OfficeStudent, "name" | "email" | "roll_no" | "phone">,
  form: EditForm,
  canEditEmail: boolean,
): { body: AccountEdit } | { error: string } {
  const name = form.name.trim();
  const email = form.email.trim().toLowerCase();
  const rollNo = form.rollNo.trim();
  const phone = form.phone.trim();
  if (!name) return { error: "Enter their name." };
  if (canEditEmail && !email) return { error: "Enter their email address." };
  const body: AccountEdit = {};
  if (name !== person.name) body.name = name;
  if (canEditEmail && email !== person.email.toLowerCase()) body.email = email;
  if (rollNo !== (person.roll_no ?? "")) body.roll_no = rollNo || null;
  if (phone !== (person.phone ?? "")) body.phone = phone || null;
  return { body };
}

/** The list's "Show" choice: everyone, or only accounts in one state (GET ?account=). */
export const ACCOUNT_FILTERS: { value: "all" | AccountFilter; label: string }[] = [
  { value: "all", label: "Everyone" },
  { value: "invited", label: "Hasn't set up" },
  { value: "off", label: "Turned off" },
];

/** The list's empty state, by what was asked for. */
export function emptyListText(filter: "all" | AccountFilter, search: string): string {
  const matching = search ? ` matching "${search}"` : "";
  if (filter === "invited") return `Everyone${matching} has set up their account.`;
  if (filter === "off") return `No accounts${matching} are turned off.`;
  return search ? `Nobody matches "${search}".` : "No students have chosen this hostel yet.";
}

/** What the add-a-person form holds: text as typed. */
export interface PersonForm {
  name: string;
  role: Role;
  studentId: string;
  email: string;
  /** "" for none. */
  hostelId: string;
  phone: string;
  parentName: string;
  parentPhone: string;
}

export const EMPTY_PERSON: PersonForm = {
  name: "",
  role: "student",
  studentId: "",
  email: "",
  hostelId: "",
  phone: "",
  parentName: "",
  parentPhone: "",
};

/** Which fields the add form shows for a role: a student's hostel and parent, a warden's
 * hostel ("Looks after"); head wardens and admins see every hostel and have neither. */
export function personFields(role: Role): {
  hostel: "Hostel" | "Looks after" | null;
  parent: boolean;
} {
  if (role === "student") return { hostel: "Hostel", parent: true };
  if (role === "warden") return { hostel: "Looks after", parent: false };
  return { hostel: null, parent: false };
}

/**
 * POST /admin/people's body. Empty fields are left out, and so are the fields the role's form
 * hides. The server checks everything like a CSV row and says what's wrong; only a missing name
 * is caught here.
 */
export function personBody(form: PersonForm): { body: NewPerson } | { error: string } {
  const name = form.name.trim();
  if (!name) return { error: "Enter their name." };
  const fields = personFields(form.role);
  const body: NewPerson = { name, role: form.role };
  const set = (key: Exclude<keyof NewPerson, "name" | "role">, value: string): void => {
    const text = value.trim();
    if (text) body[key] = text;
  };
  set("student_id", form.studentId);
  set("email", form.email.toLowerCase());
  set("phone", form.phone);
  if (fields.hostel) set("hostel_id", form.hostelId);
  if (fields.parent) {
    set("parent_name", form.parentName);
    set("parent_phone", form.parentPhone);
  }
  return { body };
}

/** The sign-in screen's reaction to a refused sign-in: only "Email not verified" goes to the
 * code screen; every other refusal (a turned-off account included) is shown as the server says. */
export function signInRefusal(
  status: number,
  detail: string,
): { verify: true } | { verify: false; message: string } {
  if (status === 403 && detail === "Email not verified") return { verify: true };
  return { verify: false, message: detail };
}
