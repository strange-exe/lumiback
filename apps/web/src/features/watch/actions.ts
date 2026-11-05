"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { claimKey, type ClaimResult } from "@/features/watch/access";
import { probeWatchAccess } from "@/features/watch/probe";
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

/**
 * Safe return: an emergency contact opened the link a student's check-out emailed them. The key
 * (after "#" in the link, so it never reached a server log) becomes the same httpOnly guest
 * cookie a code-joined guest gets, but only once the backend confirms it grants access to this
 * share, and only if the signed-in user can't already see it. A crafted link with a made-up key
 * sets nothing (see access.ts).
 */
export async function claimWatchKey(sessionId: string, key: string): Promise<ClaimResult> {
  if (typeof sessionId !== "string" || typeof key !== "string" || !isUuid(sessionId)) {
    return "invalid";
  }
  return claimKey(key, {
    userToken: await accessToken(),
    probe: (credential) => probeWatchAccess(sessionId, credential),
    store: async (verified) => {
      (await cookies()).set(guestCookie(sessionId), verified, {
        ...COOKIE_BASE,
        maxAge: WATCH_KEY_MAX_AGE,
      });
    },
  });
}
