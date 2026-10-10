"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiError, callBackend } from "@/lib/backend";
import { accessToken } from "@/lib/session";
import type { FormState } from "@/lib/types";

/** Every action re-checks the session itself (never trust that a page was protected). */
async function tokenOrSignIn(): Promise<string> {
  const token = await accessToken();
  if (!token) redirect("/sign-in");
  return token;
}

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

async function run(
  call: () => Promise<unknown>,
  fields?: Record<string, string>,
  notice?: string,
): Promise<FormState> {
  try {
    await call();
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 401) redirect("/sign-in");
      return { error: error.detail, fields };
    }
    throw error;
  }
  revalidatePath("/home");
  revalidatePath("/history");
  revalidatePath("/account");
  return { error: null, notice };
}

/** The hostel's rules set the return time; the server refuses outside today's hours. */
export async function checkOut(_: FormState, form: FormData): Promise<FormState> {
  const token = await tokenOrSignIn();
  const destination = text(form, "destination");
  return run(
    () =>
      callBackend("/outings", {
        method: "POST",
        token,
        body: { destination: destination || null },
      }),
    { destination },
  );
}

export async function markReturn(_: FormState): Promise<FormState> {
  const token = await tokenOrSignIn();
  return run(() => callBackend("/outings/current/return", { method: "POST", token }));
}

/** "You're late, are you OK?": stops the escalation to the hostel office. */
export async function replyLate(_: FormState, form: FormData): Promise<FormState> {
  const token = await tokenOrSignIn();
  const reply = text(form, "reply") === "safe" ? "safe" : "on_my_way";
  return run(() =>
    callBackend("/outings/current/late-reply", { method: "POST", token, body: { reply } }),
  );
}

// ---------- outing request (days that need approval) ----------

export async function sendRequest(_: FormState, form: FormData): Promise<FormState> {
  const token = await tokenOrSignIn();
  const fields = {
    purpose: text(form, "purpose"),
    length: text(form, "length"),
    phone: text(form, "phone"),
    emergency_name: text(form, "emergency_name"),
    emergency_relation: text(form, "emergency_relation"),
    emergency_phone: text(form, "emergency_phone"),
  };
  if (!fields.purpose) return { error: "Say where you're going and why.", fields };
  if (
    !fields.phone ||
    !fields.emergency_name ||
    !fields.emergency_relation ||
    !fields.emergency_phone
  ) {
    return { error: "Fill in your number and an emergency contact.", fields };
  }
  const minutes = Number(fields.length);
  return run(
    () =>
      callBackend("/outings/request", {
        method: "POST",
        token,
        body: {
          purpose: fields.purpose,
          phone: fields.phone,
          emergency_name: fields.emergency_name,
          emergency_relation: fields.emergency_relation,
          emergency_phone: fields.emergency_phone,
          requested_minutes: Number.isFinite(minutes) && minutes > 0 ? minutes : null,
        },
      }),
    fields,
  );
}

export async function cancelRequest(_: FormState, form: FormData): Promise<FormState> {
  const token = await tokenOrSignIn();
  const id = text(form, "request_id");
  return run(() =>
    callBackend(`/outings/request/${encodeURIComponent(id)}`, { method: "DELETE", token }),
  );
}

// ---------- hostel and contacts ----------

export async function saveHostel(_: FormState, form: FormData): Promise<FormState> {
  const token = await tokenOrSignIn();
  const hostel = text(form, "hostel_id");
  // Errors (including the 409 for changing hostel while out, or with a request today) come
  // back as the backend's own explanation.
  return run(
    () =>
      callBackend("/profile", {
        method: "PATCH",
        token,
        body: { hostel_id: hostel || null },
      }),
    undefined,
    hostel
      ? "Saved. Your hostel's rules apply from now on."
      : "Saved. The campus default rules apply until you choose a hostel.",
  );
}

export async function saveContacts(_: FormState, form: FormData): Promise<FormState> {
  const token = await tokenOrSignIn();
  const fields = {
    phone: text(form, "phone"),
    emergency_name: text(form, "emergency_name"),
    emergency_relation: text(form, "emergency_relation"),
    emergency_phone: text(form, "emergency_phone"),
  };
  if (Object.values(fields).some((v) => !v)) {
    return { error: "Fill in all four.", fields };
  }
  return run(
    () => callBackend("/profile", { method: "PATCH", token, body: { contacts: fields } }),
    fields,
    "Saved.",
  );
}
