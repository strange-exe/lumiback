"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { pathId } from "@/features/admin/form";
import { CALL_ME_SENT, callMeError, helpError, helpFix } from "@/features/outings/alerts";
import { correctionBody } from "@/features/outings/corrections";
import { lateMinutes, lateReason, runningLateError } from "@/features/outings/running-late";
import { safeReturnShareToSend } from "@/features/outings/safe-return";
import { ApiError, callBackend } from "@/lib/backend";
import { accessToken } from "@/lib/session";
import type { FormState, HelpSent, Outing } from "@/lib/types";

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

/** What a check-out hands back to its form. */
export interface CheckOutState extends FormState {
  /** The safe-return share the submitting tab now sends location for (see safe-return.ts). */
  sendFor?: string | null;
}

/** The hostel's rules set the return time; the server refuses outside today's hours. */
export async function checkOut(_: CheckOutState, form: FormData): Promise<CheckOutState> {
  const token = await tokenOrSignIn();
  const destination = text(form, "destination");
  const safeReturn = form.get("safe_return") === "on";
  let outing: Outing | null = null;
  const state = await run(
    async () => {
      outing = await callBackend<Outing>("/outings", {
        method: "POST",
        token,
        body: { destination: destination || null, safe_return: safeReturn },
      });
    },
    { destination },
  );
  // Ticked, but it couldn't start (usually today's email limit): the outing itself is fine, and
  // Today (now showing the outing) says so.
  if (!state.error && safeReturn && !(outing as Outing | null)?.safe_return_session_id) {
    redirect("/home?safe_return=off");
  }
  if (state.error) return state;
  return { ...state, sendFor: safeReturnShareToSend(safeReturn, outing as Outing | null) };
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

// ---------- reaching the hostel office while out ----------

/** "Ask the office to call me", for a hostel with no office number (3 an hour). */
export async function askOfficeToCall(_: FormState): Promise<FormState> {
  const token = await tokenOrSignIn();
  try {
    await callBackend("/outings/current/call-me", { method: "POST", token });
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 401) redirect("/sign-in");
      return { error: callMeError(error.status, error.detail) };
    }
    throw error;
  }
  return { error: null, notice: CALL_ME_SENT };
}

/**
 * "Running late?", after the student confirmed: moves the due-back time by 15, 30 or 60
 * minutes, once per outing, and tells the hostel office (with the optional reason) and the
 * student's followers (only the new time). The server decides what is still allowed.
 */
export async function sayRunningLate(_: FormState, form: FormData): Promise<FormState> {
  const token = await tokenOrSignIn();
  const fields = { minutes: text(form, "minutes"), reason: text(form, "reason") };
  const minutes = lateMinutes(fields.minutes);
  if (minutes === null) return { error: "Choose how much later you'll be.", fields };
  const reason = lateReason(fields.reason);
  if (!reason.ok) return { error: reason.error, fields };
  try {
    await callBackend<Outing>("/outings/current/running-late", {
      method: "POST",
      token,
      body: { minutes, reason: reason.value },
    });
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 401) redirect("/sign-in");
      return { error: runningLateError(error.status, error.detail), fields };
    }
    throw error;
  }
  revalidatePath("/home");
  revalidatePath("/history");
  return { error: null, notice: "The hostel office has been told." };
}

/** What a help alert hands back: who was told, and the office number to call. */
export interface HelpState extends FormState {
  sent?: HelpSent | null;
}

/**
 * The Help button, after the student confirmed: an urgent alert to the hostel office, the
 * people they share their location with and their emergency contact, with the one location
 * fix the browser gave (lat, lng, accuracy_m; none if it gave none). 5 an hour.
 */
export async function askForHelp(_: HelpState, form: FormData): Promise<HelpState> {
  const token = await tokenOrSignIn();
  const location = helpFix(text(form, "lat"), text(form, "lng"), text(form, "accuracy_m"));
  try {
    const sent = await callBackend<HelpSent>("/outings/current/help", {
      method: "POST",
      token,
      body: { location },
    });
    return { error: null, sent };
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 401) redirect("/sign-in");
      return { error: helpError(error.status, error.detail) };
    }
    throw error;
  }
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
  return run(() => callBackend(`/outings/request/${pathId(id)}`, { method: "DELETE", token }));
}

// ---------- corrections ----------

/**
 * Asks the hostel office to correct one of the student's outings: when they really came back
 * (a forgotten tap-in), or that the trip didn't happen. The office approves or declines.
 */
export async function askCorrection(_: FormState, form: FormData): Promise<FormState> {
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
    "student",
  );
  if ("error" in checked) return { error: checked.error, fields };
  return run(
    () =>
      callBackend(`/outings/${pathId(id)}/correction`, {
        method: "POST",
        token,
        body: checked.body,
      }),
    fields,
    "Sent. The hostel office will look at it.",
  );
}

// ---------- hostel and contacts ----------

/** A first check for a typo; the server validates the address properly. */
const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  // Optional, and saved apart from the four above: empty clears it.
  const email = text(form, "emergency_email");
  const typed = { ...fields, emergency_email: email };
  if (Object.values(fields).some((v) => !v)) {
    return { error: "Fill in your number and your emergency contact's details.", fields: typed };
  }
  if (email && !LOOKS_LIKE_EMAIL.test(email)) {
    return { error: "Enter their full email address, like name@gmail.com.", fields: typed };
  }
  return run(
    () =>
      callBackend("/profile", {
        method: "PATCH",
        token,
        body: { contacts: fields, emergency_email: email || null },
      }),
    typed,
    "Saved.",
  );
}
