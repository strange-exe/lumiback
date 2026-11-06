import "server-only";

import { redirect } from "next/navigation";

import { ApiError } from "@/lib/backend";
import { isUuid, MISSING_ITEM } from "@/lib/ids";
import { accessToken } from "@/lib/session";
import type { FormState } from "@/lib/types";

/** Every action re-checks the session; the backend re-checks the admin role. */
export async function tokenOrSignIn(): Promise<string> {
  const token = await accessToken();
  if (!token) redirect("/sign-in");
  return token;
}

export function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export function number(form: FormData, name: string): number | null {
  const raw = text(form, name);
  if (raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * A record id from a form, ready for a backend path. Not a UUID: throws the same 404 the
 * backend would give, so `attempt` shows it and nothing is sent. Call it inside the attempt.
 */
export function pathId(id: string): string {
  if (!isUuid(id)) throw new ApiError(404, MISSING_ITEM);
  return id;
}

export async function attempt<T>(
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
