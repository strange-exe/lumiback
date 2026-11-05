"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ApiError, callBackend, visitorIp } from "@/lib/backend";
import { COOKIE_BASE, GUEST_MAX_AGE, guestCookie, WATCH_KEY_MAX_AGE } from "@/lib/cookies";
import { isUuid } from "@/lib/route";
import { accessToken } from "@/lib/session";
import type { FormState, Redeemed } from "@/lib/types";

function text(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Redeem a join code: as the signed-in student if there is one, otherwise as a named guest.
 * Either way this only creates a request; the sharer approves it before anything is visible.
 */
export async function joinWithCode(_: FormState, form: FormData): Promise<FormState> {
  const code = text(form, "code");
  const name = text(form, "name");
  const fields = { code, name };
  if (!code) return { error: "Enter the code you were sent.", fields };
  const token = await accessToken();
  if (!token && !name) return { error: "Enter your name so they know who's asking.", fields };

  let joined: Redeemed;
  try {
    joined = await callBackend<Redeemed>("/codes/redeem", {
      method: "POST",
      token,
      clientIp: await visitorIp(),
      body: token ? { code } : { code, guest_label: name.slice(0, 40) },
    });
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    if (error.status === 400) {
      return {
        error:
          "That code didn't work. Codes work once and expire after 10 minutes, so ask for a new one.",
        fields,
      };
    }
    return { error: error.detail, fields };
  }

  if (joined.guest_token) {
    (await cookies()).set(guestCookie(joined.session_id), joined.guest_token, {
      ...COOKIE_BASE,
      maxAge: GUEST_MAX_AGE,
    });
  }
  redirect(`/watch/${joined.session_id}`);
}

const WATCH_KEY = /^[A-Za-z0-9_-]{20,100}$/;

/**
 * Safe return: an emergency contact opened the link a student's check-out emailed them. The key
 * (after "#" in the link, so it never reached a server log) becomes the same httpOnly guest
 * cookie a code-joined guest gets. Nothing is checked here: the backend decides on every read,
 * and a wrong key simply sees nothing.
 */
export async function claimWatchKey(sessionId: string, key: string): Promise<boolean> {
  if (!isUuid(sessionId) || !WATCH_KEY.test(key)) return false;
  (await cookies()).set(guestCookie(sessionId), key, {
    ...COOKIE_BASE,
    maxAge: WATCH_KEY_MAX_AGE,
  });
  return true;
}
