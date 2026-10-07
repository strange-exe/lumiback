"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ApiError, callBackend } from "@/lib/backend";
import { accessToken } from "@/lib/session";
import type { FormState, GateCreated } from "@/lib/types";

/** Gate forms also hand back a kiosk token, the one time it exists in plain text. */
export interface GateFormState extends FormState {
  kiosk?: { gate: string; token: string } | null;
}

/** Every action re-checks the session; the backend re-checks the admin role. */
async function tokenOrSignIn(): Promise<string> {
  const token = await accessToken();
  if (!token) redirect("/sign-in");
  return token;
}

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function number(form: FormData, name: string): number | null {
  const raw = text(form, name);
  if (raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

async function attempt<T>(
  call: () => Promise<T>,
  fields?: Record<string, string>,
): Promise<{ ok: T } | { error: FormState }> {
  try {
    return { ok: await call() };
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 401) redirect("/sign-in");
      return { error: { error: error.detail, fields } };
    }
    throw error;
  }
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
    callBackend(`/admin/gates/${encodeURIComponent(id)}`, {
      method: "PATCH",
      token,
      body: { name: name || undefined, radius_m: radius === null ? undefined : Math.round(radius) },
    }),
  );
  if ("error" in result) return result.error;
  revalidatePath("/admin/gates");
  return { error: null, notice: "Saved." };
}

export async function setGateActive(_: GateFormState, form: FormData): Promise<GateFormState> {
  const token = await tokenOrSignIn();
  const id = text(form, "gate_id");
  const result = await attempt(() =>
    callBackend(`/admin/gates/${encodeURIComponent(id)}`, {
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

export async function newKioskLink(_: GateFormState, form: FormData): Promise<GateFormState> {
  const token = await tokenOrSignIn();
  const id = text(form, "gate_id");
  const result = await attempt(() =>
    callBackend<GateCreated>(`/admin/gates/${encodeURIComponent(id)}/kiosk-token`, {
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
  const fields = { curfew: text(form, "curfew"), retention: text(form, "retention") };
  const days = number(form, "retention");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(fields.curfew)) {
    return { error: "Choose the curfew time.", fields };
  }
  if (days === null || days < 7 || days > 730) {
    return { error: "Keep gate scans for between 7 and 730 days.", fields };
  }
  const result = await attempt(
    () =>
      callBackend("/admin/settings", {
        method: "PUT",
        token,
        body: { curfew: fields.curfew, scan_retention_days: Math.round(days) },
      }),
    fields,
  );
  if ("error" in result) return result.error;
  revalidatePath("/admin/settings");
  return { error: null, notice: "Saved. New tap-outs use this curfew." };
}

export async function setRole(_: FormState, form: FormData): Promise<FormState> {
  const token = await tokenOrSignIn();
  const id = text(form, "user_id");
  const role = text(form, "role") === "admin" ? "admin" : "student";
  const result = await attempt(() =>
    callBackend(`/admin/users/${encodeURIComponent(id)}/role`, {
      method: "POST",
      token,
      body: { role },
    }),
  );
  if ("error" in result) return result.error;
  revalidatePath("/admin/people");
  return { error: null, notice: role === "admin" ? "Now an admin." : "Now a student." };
}
