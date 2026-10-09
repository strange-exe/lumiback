"use server";

import { revalidatePath } from "next/cache";

import { attempt, number, text, tokenOrSignIn } from "@/features/admin/form";
import { callBackend } from "@/lib/backend";
import type { DayRule, DayType, FormState, RuleSet } from "@/lib/types";

const DAY_TYPES: DayType[] = ["weekday", "saturday", "sunday", "holiday"];

// ---------- weekend / holiday requests ----------

export async function decideRequest(_: FormState, form: FormData): Promise<FormState> {
  const token = await tokenOrSignIn();
  const id = text(form, "request_id");
  const approve = text(form, "decision") === "approve";
  const note = text(form, "note");
  if (!approve && !note) {
    return { error: "Say why, so the student knows what to do.", fields: { note } };
  }
  const result = await attempt(() =>
    callBackend(`/admin/requests/${encodeURIComponent(id)}/decision`, {
      method: "POST",
      token,
      body: { approve, note: note || null },
    }),
  );
  if ("error" in result) return result.error;
  revalidatePath("/admin/requests");
  return { error: null, notice: approve ? "Approved." : "Declined." };
}

// ---------- escalations ----------

export async function resolveEscalation(_: FormState, form: FormData): Promise<FormState> {
  const token = await tokenOrSignIn();
  const id = text(form, "escalation_id");
  const note = text(form, "note");
  if (!note) return { error: "Note what happened, for the record." };
  const result = await attempt(() =>
    callBackend(`/admin/escalations/${encodeURIComponent(id)}/resolve`, {
      method: "POST",
      token,
      body: { note },
    }),
  );
  if ("error" in result) return result.error;
  revalidatePath("/admin/escalations");
  revalidatePath("/admin");
  return { error: null, notice: "Marked as handled." };
}

// ---------- rule sets ----------

/** One rule set's form: four day types, each with its times, an optional limit and form. */
function daysFrom(form: FormData): { days: DayRule[] } | { error: string } {
  const days: DayRule[] = [];
  for (const day of DAY_TYPES) {
    const opens = text(form, `${day}.opens_at`);
    const returnBy = text(form, `${day}.return_by`);
    if (!opens || !returnBy) return { error: "Every day needs an opening and a return time." };
    const hours = number(form, `${day}.max_hours`);
    if (hours !== null && (hours < 0.5 || hours > 12)) {
      return { error: "A maximum outing is between 0.5 and 12 hours." };
    }
    days.push({
      day_type: day,
      opens_at: opens,
      return_by: returnBy,
      max_minutes: hours === null ? null : Math.round(hours * 60),
      needs_form: form.get(`${day}.needs_form`) === "on",
    });
  }
  return { days };
}

export async function saveRuleSet(_: FormState, form: FormData): Promise<FormState> {
  const token = await tokenOrSignIn();
  const id = text(form, "rule_set_id");
  const name = text(form, "name");
  if (!name) return { error: "Give the rules a name." };
  const parsed = daysFrom(form);
  if ("error" in parsed) return { error: parsed.error };
  const result = await attempt(() =>
    callBackend(`/admin/rule-sets/${encodeURIComponent(id)}`, {
      method: "PUT",
      token,
      body: { name, days: parsed.days },
    }),
  );
  if ("error" in result) return result.error;
  revalidatePath("/admin/rules");
  return { error: null, notice: "Saved. New tap-outs follow these rules." };
}

export async function createRuleSet(_: FormState, form: FormData): Promise<FormState> {
  const token = await tokenOrSignIn();
  const name = text(form, "name");
  if (!name) return { error: "Give the new rules a name.", fields: { name } };
  // Start as a copy of an existing set, then edit it.
  const sets = await callBackend<RuleSet[]>("/admin/rule-sets", { token });
  const from = sets.find((s) => s.id === text(form, "copy_from")) ?? sets[0];
  if (!from) return { error: "There are no rules to copy.", fields: { name } };
  const result = await attempt(
    () =>
      callBackend("/admin/rule-sets", { method: "POST", token, body: { name, days: from.days } }),
    { name },
  );
  if ("error" in result) return result.error;
  revalidatePath("/admin/rules");
  return { error: null, notice: `Added "${name}". Edit its times below.` };
}

export async function makeDefaultRuleSet(_: FormState, form: FormData): Promise<FormState> {
  const token = await tokenOrSignIn();
  const id = text(form, "rule_set_id");
  const result = await attempt(() =>
    callBackend(`/admin/rule-sets/${encodeURIComponent(id)}/default`, { method: "POST", token }),
  );
  if ("error" in result) return result.error;
  revalidatePath("/admin/rules");
  return { error: null };
}

export async function deleteRuleSet(_: FormState, form: FormData): Promise<FormState> {
  const token = await tokenOrSignIn();
  const id = text(form, "rule_set_id");
  const result = await attempt(() =>
    callBackend(`/admin/rule-sets/${encodeURIComponent(id)}`, { method: "DELETE", token }),
  );
  if ("error" in result) return result.error;
  revalidatePath("/admin/rules");
  return { error: null };
}

// ---------- hostels ----------

export async function saveHostel(_: FormState, form: FormData): Promise<FormState> {
  const token = await tokenOrSignIn();
  const id = text(form, "hostel_id");
  const fields = {
    name: text(form, "name"),
    rule_set_id: text(form, "rule_set_id"),
    warden_name: text(form, "warden_name"),
    warden_phone: text(form, "warden_phone"),
  };
  if (!fields.name) return { error: "Give the hostel a name.", fields };
  if (!fields.rule_set_id) return { error: "Choose which rules it follows.", fields };
  const body = {
    name: fields.name,
    rule_set_id: fields.rule_set_id,
    warden_name: fields.warden_name || null,
    warden_phone: fields.warden_phone || null,
  };
  const result = await attempt(
    () =>
      callBackend(id ? `/admin/hostels/${encodeURIComponent(id)}` : "/admin/hostels", {
        method: id ? "PUT" : "POST",
        token,
        body,
      }),
    fields,
  );
  if ("error" in result) return result.error;
  revalidatePath("/admin/rules");
  return { error: null, notice: id ? "Saved." : `Added ${fields.name}.` };
}

export async function deleteHostel(_: FormState, form: FormData): Promise<FormState> {
  const token = await tokenOrSignIn();
  const id = text(form, "hostel_id");
  const result = await attempt(() =>
    callBackend(`/admin/hostels/${encodeURIComponent(id)}`, { method: "DELETE", token }),
  );
  if ("error" in result) return result.error;
  revalidatePath("/admin/rules");
  return { error: null };
}

// ---------- holidays ----------

export async function addHoliday(_: FormState, form: FormData): Promise<FormState> {
  const token = await tokenOrSignIn();
  const fields = { day: text(form, "day"), name: text(form, "name") };
  if (!fields.day || !fields.name) return { error: "Pick a date and name the holiday.", fields };
  const result = await attempt(
    () =>
      callBackend(`/admin/holidays/${encodeURIComponent(fields.day)}`, {
        method: "PUT",
        token,
        body: fields,
      }),
    fields,
  );
  if ("error" in result) return result.error;
  revalidatePath("/admin/rules");
  return { error: null, notice: `Added ${fields.name}.` };
}

export async function deleteHoliday(_: FormState, form: FormData): Promise<FormState> {
  const token = await tokenOrSignIn();
  const day = text(form, "day");
  const result = await attempt(() =>
    callBackend(`/admin/holidays/${encodeURIComponent(day)}`, { method: "DELETE", token }),
  );
  if ("error" in result) return result.error;
  revalidatePath("/admin/rules");
  return { error: null };
}
