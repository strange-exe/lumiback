"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { text, tokenOrSignIn } from "@/features/admin/form";
import {
  announceBody,
  announceError,
  reachedLine,
  type Announced,
} from "@/features/developer/announce";
import { ApiError, callBackend } from "@/lib/backend";
import { COOKIE_BASE } from "@/lib/cookies";
import type { FormState, User } from "@/lib/types";
import { homeFor, VIEW_AS_COOKIE, VIEW_AS_MAX_AGE, viewChoice } from "@/lib/view-as";

/**
 * The View as menu: view the site as a role (read-only, with your own data), or "developer"
 * to stop. Only a real developer's choice sets the cookie: /auth/me is asked as the person
 * themselves (no header). Anyone else's choice just clears it. The API checks again on every
 * call, so a cookie can never give more than the developer already has.
 */
export async function chooseViewAs(choice: string): Promise<void> {
  const token = await tokenOrSignIn();
  const chosen = viewChoice(choice);
  const jar = await cookies();
  // Unanswered or refused: nothing is set, and the office's own guard sends a signed-out
  // person to sign in.
  const self = await callBackend<User>("/auth/me", { token, asSelf: true }).catch(() => null);
  if (!self || self.role !== "developer" || chosen === null || chosen === "developer") {
    jar.delete(VIEW_AS_COOKIE);
    redirect(self?.role === "student" ? "/home" : "/admin");
  }
  jar.set(VIEW_AS_COOKIE, chosen, { ...COOKIE_BASE, maxAge: VIEW_AS_MAX_AGE });
  redirect(homeFor(chosen));
}

/**
 * "Announce an update": a push to every phone with Lumiback (developers only, once a day; the
 * API enforces both and audits it). Plain text, checked here too before it is sent.
 */
export async function announceUpdate(_: FormState, form: FormData): Promise<FormState> {
  const token = await tokenOrSignIn();
  const fields = { title: text(form, "title"), body: text(form, "body") };
  const checked = announceBody(fields.title, fields.body);
  if (!checked.ok) return { error: checked.error, fields };
  let sent: Announced;
  try {
    sent = await callBackend<Announced>("/admin/announcements", {
      method: "POST",
      token,
      body: checked.body,
    });
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 401) redirect("/sign-in");
      return { error: announceError(error.status, error.detail), fields };
    }
    throw error;
  }
  revalidatePath("/admin/status");
  return { error: null, notice: reachedLine(sent.devices) };
}

/** Stop viewing as a role: back to yourself, in the hostel office. */
export async function stopViewAs(): Promise<void> {
  (await cookies()).delete(VIEW_AS_COOKIE);
  redirect("/admin");
}
