"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { tokenOrSignIn } from "@/features/admin/form";
import { callBackend } from "@/lib/backend";
import { COOKIE_BASE } from "@/lib/cookies";
import type { User } from "@/lib/types";
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

/** Stop viewing as a role: back to yourself, in the hostel office. */
export async function stopViewAs(): Promise<void> {
  (await cookies()).delete(VIEW_AS_COOKIE);
  redirect("/admin");
}
