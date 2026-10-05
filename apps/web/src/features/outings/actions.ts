"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { expectedReturn } from "@/features/outings/time";
import { ApiError, callBackend } from "@/lib/backend";
import { accessToken } from "@/lib/session";
import type { FormState } from "@/lib/types";

/** Every action re-checks the session itself (never trust that a page was protected). */
async function tokenOrSignIn(): Promise<string> {
  const token = await accessToken();
  if (!token) redirect("/");
  return token;
}

function choiceFrom(form: FormData): string {
  const quick = form.get("quick");
  if (typeof quick === "string" && quick !== "custom") return quick;
  const custom = form.get("time");
  return typeof custom === "string" ? custom : "";
}

async function run(call: () => Promise<unknown>): Promise<FormState> {
  try {
    await call();
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 401) redirect("/");
      return { error: error.detail };
    }
    throw error;
  }
  revalidatePath("/home");
  revalidatePath("/history");
  return { error: null };
}

export async function checkOut(_: FormState, form: FormData): Promise<FormState> {
  const token = await tokenOrSignIn();
  const expected = expectedReturn(choiceFrom(form));
  if (!expected) return { error: "Choose when you'll be back." };
  const destination = form.get("destination");
  return run(() =>
    callBackend("/outings", {
      method: "POST",
      token,
      body: {
        expected_return_at: expected.toISOString(),
        destination: typeof destination === "string" && destination.trim() ? destination : null,
      },
    }),
  );
}

export async function markReturn(_: FormState): Promise<FormState> {
  const token = await tokenOrSignIn();
  return run(() => callBackend("/outings/current/return", { method: "POST", token }));
}

export async function updateReturn(_: FormState, form: FormData): Promise<FormState> {
  const token = await tokenOrSignIn();
  const expected = expectedReturn(choiceFrom(form));
  if (!expected) return { error: "Choose your new return time." };
  return run(() =>
    callBackend("/outings/current", {
      method: "PATCH",
      token,
      body: { expected_return_at: expected.toISOString() },
    }),
  );
}
