"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { accountFilter, editBody, personBody } from "@/features/admin/accounts";
import { attempt, number, pathId, text, tokenOrSignIn } from "@/features/admin/form";
import { correctionBody } from "@/features/outings/corrections";
import { callBackend } from "@/lib/backend";
import type {
  AdminUser,
  FormState,
  GateCreated,
  PasswordLinkSent,
  StudentImportResult,
  StudentImportRow,
} from "@/lib/types";

/** Gate forms also hand back a kiosk token, the one time it exists in plain text. */
export interface GateFormState extends FormState {
  kiosk?: { gate: string; token: string } | null;
}

// ---------- gates ----------

export async function createGate(_: GateFormState, form: FormData): Promise<GateFormState> {
  const token = await tokenOrSignIn();
  const fields = {
    name: text(form, "name"),
    lat: text(form, "lat"),
    lng: text(form, "lng"),
    radius_m: text(form, "radius_m"),
  };
  const lat = number(form, "lat");
  const lng = number(form, "lng");
  const radius = number(form, "radius_m") ?? 75;
  if (!fields.name) return { error: "Give the gate a name.", fields };
  if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return { error: "Enter the gate's location, or use this device's location.", fields };
  }
  const result = await attempt(
    () =>
      callBackend<GateCreated>("/admin/gates", {
        method: "POST",
        token,
        body: { name: fields.name, lat, lng, radius_m: Math.round(radius) },
      }),
    fields,
  );
  if ("error" in result) return result.error;
  revalidatePath("/admin/gates");
  return { error: null, kiosk: { gate: result.ok.gate.name, token: result.ok.kiosk_token } };
}

export async function updateGate(_: GateFormState, form: FormData): Promise<GateFormState> {
  const token = await tokenOrSignIn();
  const id = text(form, "gate_id");
  const name = text(form, "name");
  const radius = number(form, "radius_m");
  const result = await attempt(() =>
    callBackend(`/admin/gates/${pathId(id)}`, {
      method: "PATCH",
      token,
      body: { name: name || undefined, radius_m: radius === null ? undefined : Math.round(radius) },
    }),
  );
  // Keep what they typed (e.g. a radius the server refused) instead of the saved values.
  if ("error" in result) {
    return { ...result.error, fields: { name, radius_m: text(form, "radius_m") } };
  }
  revalidatePath("/admin/gates");
  return { error: null, notice: "Saved." };
}

export async function setGateActive(_: GateFormState, form: FormData): Promise<GateFormState> {
  const token = await tokenOrSignIn();
  const id = text(form, "gate_id");
  const result = await attempt(() =>
    callBackend(`/admin/gates/${pathId(id)}`, {
      method: "PATCH",
      token,
      body: { active: text(form, "active") === "true" },
    }),
  );
  if ("error" in result) return result.error;
  revalidatePath("/admin/gates");
  revalidatePath("/admin");
  return { error: null };
}

/** Removes a gate nobody has used (admins only); the server refuses a used one with a reason. */
export async function removeGate(_: GateFormState, form: FormData): Promise<GateFormState> {
  const token = await tokenOrSignIn();
  const id = text(form, "gate_id");
  const result = await attempt(() =>
    callBackend<void>(`/admin/gates/${pathId(id)}`, { method: "DELETE", token }),
  );
  if ("error" in result) return result.error;
  revalidatePath("/admin/gates");
  revalidatePath("/admin");
  return { error: null };
}

export async function newKioskLink(_: GateFormState, form: FormData): Promise<GateFormState> {
  const token = await tokenOrSignIn();
  const id = text(form, "gate_id");
  const result = await attempt(() =>
    callBackend<GateCreated>(`/admin/gates/${pathId(id)}/kiosk-token`, {
      method: "POST",
      token,
    }),
  );
  if ("error" in result) return result.error;
  return { error: null, kiosk: { gate: result.ok.gate.name, token: result.ok.kiosk_token } };
}

// ---------- settings & people ----------

export async function saveSettings(_: FormState, form: FormData): Promise<FormState> {
  const token = await tokenOrSignIn();
  const fields = { retention: text(form, "retention") };
  const days = number(form, "retention");
  if (days === null || days < 7 || days > 730) {
    return { error: "Keep campus records for between 7 and 730 days.", fields };
  }
  const result = await attempt(
    () =>
      callBackend("/admin/settings", {
        method: "PUT",
        token,
        body: { scan_retention_days: Math.round(days) },
      }),
    fields,
  );
  if ("error" in result) return result.error;
  revalidatePath("/admin/settings");
  return { error: null, notice: "Saved." };
}

/** Students choose their hostel once; the office moves them after that. */
export async function moveStudent(_: FormState, form: FormData): Promise<FormState> {
  const token = await tokenOrSignIn();
  const id = text(form, "user_id");
  const hostelId = text(form, "hostel_id");
  if (!hostelId) return { error: "Choose the hostel to move them to." };
  const result = await attempt(() =>
    callBackend(`/admin/students/${pathId(id)}/hostel`, {
      method: "POST",
      token,
      body: { hostel_id: hostelId },
    }),
  );
  if ("error" in result) return result.error;
  revalidatePath("/admin/people");
  return { error: null, notice: "Moved." };
}

export async function setRole(_: FormState, form: FormData): Promise<FormState> {
  const token = await tokenOrSignIn();
  const id = text(form, "user_id");
  const picked = text(form, "role");
  const role =
    picked === "admin" || picked === "warden" || picked === "head_warden" ? picked : "student";
  const hostelIds =
    role === "warden"
      ? form.getAll("hostel_ids").filter((v): v is string => typeof v === "string")
      : [];
  const result = await attempt(() =>
    callBackend(`/admin/users/${pathId(id)}/role`, {
      method: "POST",
      token,
      body: { role, hostel_ids: hostelIds },
    }),
  );
  if ("error" in result) return result.error;
  revalidatePath("/admin/people");
  const notice = {
    admin: "Now an admin.",
    head_warden: "Now a head warden.",
    warden: "Now a warden.",
    student: "Now a student.",
  };
  return { error: null, notice: notice[role] };
}

// ---------- outing corrections ----------

/**
 * The office corrects an outing at once, with a reason: records a return (open outing), changes
 * a return time (closed one), or cancels a mistaken tap. The backend checks the office covers
 * the outing's hostel and that the time is possible.
 */
export async function correctOuting(_: FormState, form: FormData): Promise<FormState> {
  const token = await tokenOrSignIn();
  const id = text(form, "outing_id");
  const fields = {
    kind: text(form, "kind"),
    returned_at: text(form, "returned_at"),
    reason: text(form, "reason"),
  };
  const checked = correctionBody(
    {
      kind: fields.kind,
      time: fields.returned_at,
      leftAt: text(form, "left_at"),
      reason: fields.reason,
    },
    "staff",
  );
  if ("error" in checked) return { error: checked.error, fields };
  const result = await attempt(
    () =>
      callBackend(`/admin/outings/${pathId(id)}/correction`, {
        method: "POST",
        token,
        body: checked.body,
      }),
    fields,
  );
  if ("error" in result) return result.error;
  revalidatePath("/admin");
  revalidatePath("/admin/corrections");
  const notice = {
    return: "Return recorded.",
    return_time: "Return time changed.",
    cancel: "Outing cancelled.",
  };
  return { error: null, notice: notice[checked.body.kind] };
}

/** Approve (the change applies now) or decline a student's correction ask. */
export async function decideCorrection(_: FormState, form: FormData): Promise<FormState> {
  const token = await tokenOrSignIn();
  const id = text(form, "correction_id");
  const approve = text(form, "decision") === "approve";
  const note = text(form, "note");
  if (note.length > 300) {
    return { error: "Keep the note under 300 characters.", fields: { note } };
  }
  const result = await attempt(
    () =>
      callBackend(`/admin/corrections/${pathId(id)}/decision`, {
        method: "POST",
        token,
        body: { approve, note: note || null },
      }),
    { note },
  );
  if ("error" in result) return result.error;
  revalidatePath("/admin");
  revalidatePath("/admin/corrections");
  return { error: null, notice: approve ? "Approved." : "Declined." };
}

// ---------- adding students, password links ----------

/** What checking or adding a CSV hands back. `confirmed`: this was the "add" step. */
export interface ImportState extends FormState {
  result?: StudentImportResult | null;
  confirmed?: boolean;
}

/** The backend's own limit on the text (it also caps the file at 512 KB). */
const MAX_CSV_CHARS = 600_000;

/**
 * Checks a CSV of people (confirm=false), or adds the new ones and emails each a link to
 * choose a password (confirm=true). The browser reads the file and sends its text as a form
 * field; the backend checks every row again when confirming, so nothing is trusted from the
 * earlier check.
 */
export async function importStudents(_: ImportState, form: FormData): Promise<ImportState> {
  const token = await tokenOrSignIn();
  const csv = form.get("csv");
  const confirm = text(form, "confirm") === "true";
  if (typeof csv !== "string" || csv.trim() === "") return { error: "Choose a CSV file first." };
  if (csv.length > MAX_CSV_CHARS) {
    return { error: "The file is larger than 512 KB. Split it into smaller files." };
  }
  const result = await attempt(() =>
    callBackend<StudentImportResult>("/admin/students/import", {
      method: "POST",
      token,
      body: { csv, confirm },
    }),
  );
  if ("error" in result) return result.error;
  if (confirm) revalidatePath("/admin/people");
  return { error: null, result: result.ok, confirmed: confirm };
}

/**
 * Emails someone (student or staff, never the admin themself) a one-time link to choose a
 * password: their set-up link again if they haven't set up yet, otherwise a reset (their
 * current password stops working at once).
 */
export async function sendPasswordLink(_: FormState, form: FormData): Promise<FormState> {
  const token = await tokenOrSignIn();
  const id = text(form, "user_id");
  const result = await attempt(() =>
    callBackend<PasswordLinkSent>(`/admin/users/${pathId(id)}/password-link`, {
      method: "POST",
      token,
    }),
  );
  if ("error" in result) return result.error;
  revalidatePath("/admin/people");
  return { error: null, notice: `Sent to ${result.ok.email}` };
}

// ---------- account controls, adding one person ----------

/**
 * Corrects someone's name, roll no., phone, or (admins) email. Wardens may do this for their own
 * hostels' students; the backend decides who may change what.
 */
export async function editAccount(_: FormState, form: FormData): Promise<FormState> {
  const token = await tokenOrSignIn();
  const id = text(form, "user_id");
  const fields = {
    name: text(form, "name"),
    roll_no: text(form, "roll_no"),
    phone: text(form, "phone"),
    email: text(form, "email"),
  };
  const checked = editBody({
    name: fields.name,
    rollNo: fields.roll_no,
    phone: fields.phone,
    phoneKnown: text(form, "phone_known") === "true",
    email: fields.email,
    emailWas: text(form, "email_was"),
  });
  if ("error" in checked) return { error: checked.error, fields };
  const result = await attempt(
    () =>
      callBackend<AdminUser>(`/admin/users/${pathId(id)}`, {
        method: "PATCH",
        token,
        body: checked.body,
      }),
    fields,
  );
  if ("error" in result) return result.error;
  revalidatePath("/admin/people");
  return { error: null, notice: "Details saved." };
}

/** Turns an account off (signed out everywhere, history kept) or back on. */
export async function setAccountOn(_: FormState, form: FormData): Promise<FormState> {
  const token = await tokenOrSignIn();
  const id = text(form, "user_id");
  const on = text(form, "on") === "true";
  const result = await attempt(() =>
    callBackend<AdminUser>(`/admin/users/${pathId(id)}/active`, {
      method: "POST",
      token,
      body: { on },
    }),
  );
  if ("error" in result) return result.error;
  revalidatePath("/admin/people");
  revalidatePath("/admin");
  return { error: null, notice: on ? "Turned on." : "Turned off." };
}

/**
 * Removes an account nobody has set up yet (admins only); its emailed link stops working. The
 * row goes from the list, so the page says it was done (a fixed message, nothing from the
 * address bar is shown).
 */
export async function cancelInvite(_: FormState, form: FormData): Promise<FormState> {
  const token = await tokenOrSignIn();
  const id = text(form, "user_id");
  const result = await attempt(() =>
    callBackend<void>(`/admin/users/${pathId(id)}/invite`, {
      method: "DELETE",
      token,
    }),
  );
  if ("error" in result) return result.error;
  revalidatePath("/admin/people");
  const back = new URLSearchParams({ cancelled: "1" });
  const q = text(form, "q").slice(0, 100);
  const account = accountFilter(text(form, "account"));
  if (q) back.set("q", q);
  if (account) back.set("account", account);
  redirect(`/admin/people?${back.toString()}`);
}

/** What adding one person hands back: who was added, for the message beside the button. */
export interface AddPersonState extends FormState {
  added?: { name: string; email: string } | null;
}

/** Adds one student or staff member (admins only) and emails them a link to set up. */
export async function addPerson(_: AddPersonState, form: FormData): Promise<AddPersonState> {
  const token = await tokenOrSignIn();
  const fields = {
    name: text(form, "name"),
    role: text(form, "role"),
    student_id: text(form, "student_id"),
    email: text(form, "email"),
    hostel_id: text(form, "hostel_id"),
    phone: text(form, "phone"),
    parent_name: text(form, "parent_name"),
    parent_phone: text(form, "parent_phone"),
  };
  const checked = personBody({
    name: fields.name,
    role: fields.role,
    studentId: fields.student_id,
    email: fields.email,
    hostelId: fields.hostel_id,
    phone: fields.phone,
    parentName: fields.parent_name,
    parentPhone: fields.parent_phone,
  });
  if ("error" in checked) return { error: checked.error, fields };
  const result = await attempt(
    () =>
      callBackend<StudentImportRow>("/admin/people", {
        method: "POST",
        token,
        body: checked.body,
      }),
    fields,
  );
  if ("error" in result) return result.error;
  revalidatePath("/admin/people");
  return { error: null, added: { name: result.ok.name, email: result.ok.email } };
}
