"use server";

import { cookies } from "next/headers";

import { THEME_COOKIE, THEME_NAMES, themeCookieOptions } from "@/lib/theme";
import type { FormState } from "@/lib/types";

/**
 * Saves this browser's colour theme. Per device (a cookie, like light or dark), so it needs no
 * account and never reaches the API. Setting the cookie re-renders the page and the root layout,
 * so <html data-theme> changes in the same round trip.
 */
export async function saveTheme(_: FormState, form: FormData): Promise<FormState> {
  const value = form.get("theme");
  if (typeof value !== "string" || !(THEME_NAMES as readonly string[]).includes(value)) {
    return { error: "Choose one of the three themes." };
  }
  (await cookies()).set(THEME_COOKIE, value, themeCookieOptions(process.env.NODE_ENV));
  return { error: null, notice: "Saved. This browser uses it from now on." };
}
