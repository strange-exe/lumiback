"use server";

import { revalidatePath } from "next/cache";

import { callBody, noticeBody, noticeResult, shortText } from "@/features/admin/alerts";
import { attempt, pathId, text, tokenOrSignIn } from "@/features/admin/form";
import { callBackend } from "@/lib/backend";
import type { FormState } from "@/lib/types";

/** Every follow-up shows on the escalations page and in the register's counts. */
function refresh(): void {
  revalidatePath("/admin/escalations");
  revalidatePath("/admin");
}

// ---------- following up an escalation ----------

/** "I'm on it": the office's re-alerts stop while someone has it. */
export async function claimEscalation(_: FormState, form: FormData): Promise<FormState> {
  const token = await tokenOrSignIn();
  const id = text(form, "escalation_id");
  const result = await attempt(() =>
    callBackend<void>(`/admin/escalations/${pathId(id)}/claim`, { method: "POST", token }),
  );
  if ("error" in result) return result.error;
  refresh();
  return { error: null, notice: "You're on it." };
}

/** Gives the claim back (the claimer, or a head warden or admin: the API decides). */
export async function releaseEscalation(_: FormState, form: FormData): Promise<FormState> {
  const token = await tokenOrSignIn();
  const id = text(form, "escalation_id");
  const result = await attempt(() =>
    callBackend<void>(`/admin/escalations/${pathId(id)}/claim`, { method: "DELETE", token }),
  );
  if ("error" in result) return result.error;
  refresh();
  return { error: null, notice: "Given back." };
}

/** A call made while following up; logging one also claims it if nobody has. */
export async function logEscalationCall(_: FormState, form: FormData): Promise<FormState> {
  const token = await tokenOrSignIn();
  const id = text(form, "escalation_id");
  const fields = { outcome: text(form, "outcome"), note: text(form, "note") };
  const checked = callBody(fields.outcome, fields.note);
  if ("error" in checked) return { error: checked.error, fields };
  const result = await attempt(
    () =>
      callBackend(`/admin/escalations/${pathId(id)}/calls`, {
        method: "POST",
        token,
        body: checked.body,
      }),
    fields,
  );
  if ("error" in result) return result.error;
  refresh();
  return { error: null, notice: "Call logged." };
}

// ---------- help requests ----------

export async function handleHelp(_: FormState, form: FormData): Promise<FormState> {
  const token = await tokenOrSignIn();
  const id = text(form, "help_id");
  const fields = { note: text(form, "note") };
  const note = shortText(fields.note, "note");
  if (!note.ok) return { error: note.error, fields };
  const result = await attempt(
    () =>
      callBackend<void>(`/admin/help/${pathId(id)}/handle`, {
        method: "POST",
        token,
        body: { note: note.value },
      }),
    fields,
  );
  if ("error" in result) return result.error;
  refresh();
  return { error: null, notice: "Marked as handled." };
}

// ---------- notices to students who are out ----------

/**
 * A short notice, or a recall ("come back now"), to the students out now in this office's
 * hostels or one of them. The API checks the hostel is the sender's.
 */
export async function sendNotice(_: FormState, form: FormData): Promise<FormState> {
  const token = await tokenOrSignIn();
  const fields = {
    message: text(form, "message"),
    recall: form.get("recall") === "on" ? "on" : "",
    hostel_id: text(form, "hostel_id"),
  };
  const checked = noticeBody(fields.message, fields.recall === "on", fields.hostel_id);
  if ("error" in checked) return { error: checked.error, fields };
  const result = await attempt(
    () =>
      callBackend<{ sent: number }>("/admin/notices", {
        method: "POST",
        token,
        body: checked.body,
      }),
    fields,
  );
  if ("error" in result) return result.error;
  return { error: null, notice: noticeResult(result.ok.sent) };
}
